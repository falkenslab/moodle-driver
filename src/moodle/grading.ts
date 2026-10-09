// A teacher's side of an assignment: everyone's submissions, and grading one participant as the
// grader does (its panel's form, submitted through the grading service).
import type { BrowserContext } from "playwright-core";
import { assignmentIds, fillGradingForm, gradingPanelHtml, listParticipants, panelGrade, participantDates, readSubmissionContent, submitGradingForm, type PluginContent } from "./assign.js";
import { isoDate } from "./courses.js";
import type { FieldValue } from "./forms.js";

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
  allowSubmissionsFrom?: string;
  /** For this participant: overrides and extensions included. */
  dueDate?: string;
  cutoffDate?: string;
  /** Per submission plugin; only for submitted and draft submissions. */
  content?: PluginContent[];
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
 * Grades a participant as the grader does: a grade, feedback comments (HTML), whether to notify, and
 * any other grading field by name (a rubric's or marking guide's). Returns the grade saved.
 */
export async function gradeSubmission(
  context: BrowserContext,
  siteUrl: string,
  cmid: number,
  userId: number,
  { grade, feedback, notify, fields }: { grade?: string; feedback?: string; notify?: boolean; fields?: Record<string, FieldValue> },
) {
  const ids = await assignmentIds(context, siteUrl, cmid);
  const values: Record<string, FieldValue> = { ...fields };
  if (grade !== undefined) values.grade = grade;
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
