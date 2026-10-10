// A teacher's side of an assignment: everyone's submissions, and grading one participant as the
// grader does (its panel's form, submitted through the grading service).
import type { BrowserContext, Page } from "playwright-core";
import { GradingError, NotAnAssignmentError, assignmentIds, fillGradingForm, gradingPanelHtml, listParticipants, panelGrade, participantDates, readSubmissionContent, submitGradingForm, type PluginContent } from "./assign.js";
import { isoDate } from "./courses.js";
import { dateSelectorDate, dateSelectorValues, openForm, setFields, submitForm, type FieldValue } from "./forms.js";
import { NotLoggedInError } from "./session.js";
import { inPage } from "./inPage.js";

/** The grader's feedback comments field, when the assignment has them on. */
const FEEDBACK_FIELD = "assignfeedbackcomments_editor[text]";

export interface Submission {
  userId: number;
  fullName: string;
  /** Moodle's status: "submitted", "draft", "new", "reopened", or "none" without a submission. */
  status: string;
  submitted: boolean;
  needsGrading: boolean;
  extensionGranted: boolean;
  /** Until when, where an extension is granted. */
  extensionDueDate?: string;
  allowSubmissionsFrom?: string;
  /** For this participant: overrides and extensions included. */
  dueDate?: string;
  cutoffDate?: string;
  /** Per submission plugin; only for submitted and draft submissions. */
  content?: PluginContent[];
}

/** An extension's date, as its form holds it (no service open to AJAX gives it). */
async function extensionDate(context: BrowserContext, siteUrl: string, cmid: number, userId: number): Promise<string | undefined> {
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${cmid}&action=grantextension&userid=${userId}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    return undefined;
  });
  if (!page) return undefined;
  try {
    return (await dateSelectorDate(page, "extensionduedate"))?.toISOString();
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Every participant's submission to an assignment, with its content unless `includeContent` is false. */
export async function assignmentSubmissions(context: BrowserContext, siteUrl: string, cmid: number, { includeContent = true } = {}) {
  const ids = await assignmentIds(context, siteUrl, cmid);
  const participants = await listParticipants(context, siteUrl, ids.instanceId);
  // A blank tab parses the panels' HTML: nothing of Moodle's loads there.
  const parser = includeContent ? await context.newPage() : undefined;
  const submissions: Submission[] = [];
  try {
    // One participant at a time: the calls share the kept service tab (ADR-004).
    for (const participant of participants) {
      const dates = await participantDates(context, siteUrl, ids.instanceId, participant.id);
      const status = participant.submissionstatus || "none";
      const withContent = parser && (status === "submitted" || status === "draft");
      submissions.push({
        userId: participant.id,
        fullName: participant.fullname,
        status,
        submitted: participant.submitted,
        needsGrading: participant.requiregrading,
        extensionGranted: participant.grantedextension,
        extensionDueDate: participant.grantedextension ? await extensionDate(context, siteUrl, cmid, participant.id) : undefined,
        allowSubmissionsFrom: isoDate(dates.allowsubmissionsfromdate),
        dueDate: isoDate(dates.duedate),
        cutoffDate: isoDate(dates.cutoffdate),
        content: withContent ? await readSubmissionContent(parser, await gradingPanelHtml(context, siteUrl, ids.contextId, participant.id)) : undefined,
      });
    }
  } finally {
    await parser?.close().catch(() => undefined);
  }
  return { assignment: { id: cmid, instanceId: ids.instanceId }, submissions };
}

/**
 * Grades a participant as the grader does: a grade (simple grading), a rubric's level per criterion
 * or a marking guide's score per criterion (by their ids, from `rubric()`), remarks per criterion,
 * feedback comments (HTML), whether to notify, and any other grading field by name. Returns the
 * grade saved and the gradebook's grade, the total Moodle computes for a rubric or a guide.
 */
export async function gradeSubmission(
  context: BrowserContext,
  siteUrl: string,
  cmid: number,
  userId: number,
  {
    grade,
    rubric,
    guide,
    remarks,
    feedback,
    notify,
    fields,
  }: {
    grade?: string;
    /** Criterion id → level id. */
    rubric?: Record<number, number>;
    /** Criterion id → score. */
    guide?: Record<number, number>;
    /** Criterion id → remark, for a rubric or a guide. */
    remarks?: Record<number, string>;
    feedback?: string;
    notify?: boolean;
    fields?: Record<string, FieldValue>;
  },
) {
  const ids = await assignmentIds(context, siteUrl, cmid);
  const values: Record<string, FieldValue> = { ...fields };
  if (grade !== undefined) values.grade = grade;
  for (const [criterion, level] of Object.entries(rubric ?? {})) values[`advancedgrading[criteria][${criterion}][levelid]`] = String(level);
  for (const [criterion, score] of Object.entries(guide ?? {})) values[`advancedgrading[criteria][${criterion}][score]`] = String(score);
  for (const [criterion, remark] of Object.entries(remarks ?? {})) values[`advancedgrading[criteria][${criterion}][remark]`] = remark;
  if (feedback !== undefined) values[FEEDBACK_FIELD] = feedback;
  if (notify !== undefined) values.sendstudentnotifications = notify ? 1 : 0;
  // A blank tab holds the panel's form: nothing of the grader's page needs to load.
  const page = await context.newPage();
  try {
    const serialized = await fillGradingForm(page, await gradingPanelHtml(context, siteUrl, ids.contextId, userId), values).catch((error: Error) => {
      if (feedback !== undefined && error.message.includes(FEEDBACK_FIELD)) {
        throw new Error("This assignment has no feedback comments: grade it without feedback, or turn feedback comments on in its settings.");
      }
      throw error;
    });
    await submitGradingForm(context, siteUrl, ids.instanceId, userId, serialized);
    const saved = await panelGrade(page, await gradingPanelHtml(context, siteUrl, ids.contextId, userId));
    return { changed: `Graded user ${userId} in assignment ${cmid}${feedback !== undefined ? ", with feedback" : ""}.`, ...saved };
  } finally {
    await page.close().catch(() => undefined);
  }
}

export interface GradingCriterion {
  id: number;
  /** A rubric criterion's description; a guide criterion's short name. */
  description: string;
  /** A guide criterion's description for students and for markers. */
  details?: string;
  markers?: string;
  /** A rubric criterion's levels, by the ids grading takes. */
  levels?: { id: number; definition: string; score: number }[];
  /** A guide criterion's maximum score. */
  maxScore?: number;
}

export interface GradingDefinition {
  /** "simple" for a plain grade (or a scale), "rubric" or "guide" for advanced grading. */
  method: "simple" | "rubric" | "guide";
  criteria: GradingCriterion[];
}

/** The grading method and its criteria, read from a grading panel's form by field names and blocks. */
export async function readGradingDefinition(page: Page, panelHtml: string): Promise<GradingDefinition> {
  await page.setContent(panelHtml);
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      id: string;
      value: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const text = (el: El | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const method = doc.querySelector(".gradingform_rubric") ? "rubric" : doc.querySelector(".gradingform_guide") ? "guide" : "simple";
    const criteria = Array.from(doc.querySelectorAll('.gradingform_rubric tr.criterion, .gradingform_guide tr.criterion')).flatMap((row): GradingCriterion[] => {
      const id = Number(/-criteria-(\d+)$/.exec(row.id)?.[1]);
      if (!id) return [];
      if (method === "rubric") {
        const levels = Array.from(row.querySelectorAll("td.level")).map((level) => ({
          id: Number(level.querySelector('input[type="radio"]')?.value),
          definition: text(level.querySelector(".definition")),
          score: Number(text(level.querySelector(".scorevalue"))),
        }));
        return [{ id, description: text(row.querySelector("td.description")), levels }];
      }
      const max = Number(text(row.querySelector(".criteriondescriptionscore")));
      const details = text(row.querySelector(".criteriondescription"));
      const markers = text(row.querySelector(".criteriondescriptionmarkers"));
      return [{ id, description: text(row.querySelector(".criterionshortname")), ...(details ? { details } : {}), ...(markers ? { markers } : {}), ...(max ? { maxScore: max } : {}) }];
    });
    return { method, criteria } as GradingDefinition;
  }, null);
}

/**
 * An assignment's grading method and, for a rubric or a marking guide, its criteria with the ids
 * `gradeSubmission` takes: read from the grader's panel for its first participant.
 */
export async function rubric(context: BrowserContext, siteUrl: string, cmid: number): Promise<{ assignment: { id: number } } & GradingDefinition> {
  const ids = await assignmentIds(context, siteUrl, cmid);
  const [first] = await listParticipants(context, siteUrl, ids.instanceId);
  if (!first) throw new GradingError(`Assignment ${cmid} has no participants: its grading form can't be read without one.`);
  const page = await context.newPage();
  try {
    return { assignment: { id: cmid }, ...(await readGradingDefinition(page, await gradingPanelHtml(context, siteUrl, ids.contextId, first.id))) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Grants participants an extension until a date, through the assignment's extension form (several at
 * once as its bulk action does). Moodle refuses a date before the assignment's due date.
 */
export async function grantExtension(context: BrowserContext, siteUrl: string, cmid: number, userIds: number[], until: Date): Promise<{ changed: string }> {
  if (userIds.length === 0) throw new GradingError("Give the participants to grant the extension to.");
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${cmid}&action=grantextension&userid=${userIds[0]}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new NotAnAssignmentError(`You can't grant extensions in activity ${cmid}: it isn't an assignment, or you aren't allowed.`);
  });
  try {
    await setFields(page, { selectedusers: userIds.join(","), "extensionduedate[enabled]": true, ...(await dateSelectorValues(page, "extensionduedate", until)) });
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Extension until ${until.toISOString()} granted to user${userIds.length > 1 ? "s" : ""} ${userIds.join(", ")} in assignment ${cmid}.` };
}
