// A teacher's side of an assignment: everyone's submissions, and grading one participant as the
// grader does (its panel's form, submitted through the grading service).
import type { BrowserContext, Page } from "playwright-core";
import {
  GradingError,
  NotAnAssignmentError,
  assignmentIds,
  draftAreaFiles,
  fillGradingForm,
  gradingPanelHtml,
  hasSubmission,
  listParticipants,
  panelGrade,
  participantDates,
  readPanelState,
  readSubmissionContent,
  replaceDraftFiles,
  submitGradingForm,
  WORKFLOW_STATES,
  type PanelState,
  type PluginContent,
  type WorkflowState,
} from "./grader.js";
import { checkLocalFiles } from "../../core/files.js";
import { isoDate } from "../courses/list.js";
import { FormError, dateSelectorDate, dateSelectorValues, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { NotLoggedInError, fetchSitePage, moodleErrorMessage } from "../../core/session.js";
import { decodeEntities } from "../../core/text.js";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";

/** The grader's feedback comments field, when the assignment has them on. */
const FEEDBACK_FIELD = "assignfeedbackcomments_editor[text]";

/** A participant's submission to an assignment, as `assignmentSubmissions` reads it for the grader. */
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
  /**
   * The feedback files the participant has, where the assignment takes them: as the grader's file
   * manager holds them, a working copy (`draftfile.php`) that `downloadFile` saves while the session lasts.
   */
  feedbackFiles?: { name: string; url: string }[];
  /** With group submissions, the group the participant submits for; absent for none (Moodle's "Default group"). */
  group?: { id: number; name: string };
  /** With the marking workflow, the submission's state ("notmarked" before any). */
  workflowState?: WorkflowState;
  /** With marker allocation, the markers allocated to it. */
  markers?: { id: number; name: string }[];
}

/** An extension's date, as its form holds it (no service open to AJAX gives it). */
async function extensionDate(context: BrowserContext, siteUrl: string, activityId: number, userId: number): Promise<string | undefined> {
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${activityId}&action=grantextension&userid=${userId}`).catch((error: unknown) => {
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

/**
 * Every participant's submission to an assignment, with the group they submit for (group
 * submissions), and, unless `includeContent` is false, its content, the feedback files they have,
 * its marking workflow state and markers (all from each participant's grading panel). Those come only
 * for participants with a submission: Moodle's grading panel creates an empty one for a participant
 * who has none, so reading leaves them at "none", without the panel's details (confirmed empirically
 * on the sandbox, 5.2). For a participant with a submission and no grade yet, the panel still leaves
 * an empty grade (-1, not graded) and a "Grading form viewed" event, as Moodle's grader does.
 */
export async function assignmentSubmissions(context: BrowserContext, siteUrl: string, activityId: number, { includeContent = true } = {}): Promise<Submission[]> {
  const ids = await assignmentIds(context, siteUrl, activityId);
  const participants = await listParticipants(context, siteUrl, ids.instanceId);
  // A blank tab parses the panels' HTML: nothing of Moodle's loads there.
  const parser = includeContent ? await context.newPage() : undefined;
  const submissions: Submission[] = [];
  try {
    // One participant at a time: one person at a time, as Moodle expects of a session.
    for (const participant of participants) {
      const dates = await participantDates(context, siteUrl, ids.instanceId, participant.id);
      const status = participant.submissionstatus || "none";
      // Only with a submission: the panel creates one for a participant without (see gradingPanelHtml).
      const panel = parser && hasSubmission(participant) ? await gradingPanelHtml(context, siteUrl, ids.contextId, participant.id) : undefined;
      const withContent = status === "submitted" || status === "draft";
      const state: PanelState = parser && panel !== undefined ? await readPanelState(parser, panel) : {};
      submissions.push({
        userId: participant.id,
        fullName: participant.fullname,
        status,
        submitted: participant.submitted,
        needsGrading: participant.requiregrading,
        extensionGranted: participant.grantedextension,
        extensionDueDate: participant.grantedextension ? await extensionDate(context, siteUrl, activityId, participant.id) : undefined,
        allowSubmissionsFrom: isoDate(dates.allowsubmissionsfromdate),
        dueDate: isoDate(dates.duedate),
        cutoffDate: isoDate(dates.cutoffdate),
        content: parser && panel !== undefined && withContent ? await readSubmissionContent(parser, panel) : undefined,
        feedbackFiles: state.draftId && state.sesskey ? await draftAreaFiles(context, siteUrl, state.sesskey, state.draftId) : undefined,
        ...(participant.groupid ? { group: { id: participant.groupid, name: participant.groupname ?? "" } } : {}),
        ...(state.workflowState ? { workflowState: state.workflowState } : {}),
        ...(state.markers ? { markers: state.markers } : {}),
      });
    }
  } finally {
    await parser?.close().catch(() => undefined);
  }
  return submissions;
}

/**
 * Grades a participant as the grader does: a grade (simple grading), a rubric's level per criterion
 * or a marking guide's score per criterion (by their ids, from `rubric()`), remarks per criterion,
 * feedback comments (HTML), feedback files (local paths that replace the ones the participant has;
 * `[]` removes them), whether to notify, and any other grading field by name. Returns the grade
 * saved and the gradebook's grade, the total Moodle computes for a rubric or a guide, and the
 * feedback files after saving when they were given. Throws `GradingError` when Moodle refuses the
 * grade, or when files are given to an assignment without feedback files.
 */
export async function gradeSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  {
    grade,
    rubric,
    guide,
    remarks,
    feedback,
    feedbackFiles,
    workflowState,
    applyToGroup,
    notify,
    fields,
  }: {
    grade?: string | number;
    /** Criterion id → level id. */
    rubric?: Record<number, number>;
    /** Criterion id → score. */
    guide?: Record<number, number>;
    /** Criterion id → remark, for a rubric or a guide. */
    remarks?: Record<number, string>;
    feedback?: string;
    /** Local paths (absolute): the participant's feedback files afterwards. */
    feedbackFiles?: string[];
    /** With the marking workflow: the state to leave the submission in ("released" shows the grade). */
    workflowState?: WorkflowState;
    /** With group submissions: grade every member of the participant's group alike (Moodle's default), or only them. */
    applyToGroup?: boolean;
    notify?: boolean;
    fields?: Record<string, FieldValue>;
  },
) {
  if (feedbackFiles) await checkLocalFiles(feedbackFiles);
  const ids = await assignmentIds(context, siteUrl, activityId);
  const values: Record<string, FieldValue> = { ...fields };
  if (grade !== undefined) values.grade = String(grade);
  for (const [criterion, level] of Object.entries(rubric ?? {})) values[`advancedgrading[criteria][${criterion}][levelid]`] = String(level);
  for (const [criterion, score] of Object.entries(guide ?? {})) values[`advancedgrading[criteria][${criterion}][score]`] = String(score);
  for (const [criterion, remark] of Object.entries(remarks ?? {})) values[`advancedgrading[criteria][${criterion}][remark]`] = remark;
  if (feedback !== undefined) values[FEEDBACK_FIELD] = feedback;
  if (notify !== undefined) values.sendstudentnotifications = notify ? 1 : 0;
  if (workflowState !== undefined) {
    if (!WORKFLOW_STATES.includes(workflowState)) throw new GradingError(`"${workflowState}" isn't a marking workflow state: one of ${WORKFLOW_STATES.join(", ")}.`);
    // The form's "Not marked" is its empty choice.
    values.workflowstate = workflowState === "notmarked" ? "" : workflowState;
  }
  if (applyToGroup !== undefined) values.applytoall = applyToGroup ? "1" : "0";
  // A blank tab holds the panel's form: nothing of the grader's page needs to load.
  const page = await context.newPage();
  try {
    const panel = await gradingPanelHtml(context, siteUrl, ids.contextId, userId);
    const serialized = await fillGradingForm(page, panel, values).catch((error: Error) => {
      if (feedback !== undefined && error.message.includes(FEEDBACK_FIELD)) {
        throw new MoodleError("This assignment has no feedback comments: grade it without feedback, or turn feedback comments on in its settings.", "not-available");
      }
      if (workflowState !== undefined && error.message.includes("workflowstate")) {
        throw new GradingError(`Assignment ${activityId} doesn't use the marking workflow (or ${workflowState} isn't a state you can set): grade it without workflowState, or turn "Use marking workflow" on in its settings.`);
      }
      if (applyToGroup !== undefined && error.message.includes("applytoall")) {
        throw new GradingError(`Assignment ${activityId} doesn't take group submissions: grade it without applyToGroup.`);
      }
      throw error;
    });
    // A select keeps no value it doesn't offer: Moodle offers each person only the states they may set.
    if (values.workflowstate !== undefined && new URLSearchParams(serialized).get("workflowstate") !== values.workflowstate) {
      throw new GradingError(`You can't set assignment ${activityId}'s submission to ${workflowState}: its grading form doesn't offer that state to you.`);
    }
    if (feedbackFiles) {
      // The panel's draft area is what the form saves as the feedback files: changed before submitting it.
      const draft = await readPanelState(page, panel);
      if (!draft.draftId || !draft.sesskey) {
        throw new GradingError(`Assignment ${activityId} has no feedback files: grade it without them, or turn "Feedback files" on in its settings.`);
      }
      await replaceDraftFiles(context, siteUrl, activityId, userId, draft.sesskey, draft.draftId, feedbackFiles);
    }
    await submitGradingForm(context, siteUrl, ids.instanceId, userId, serialized);
    const after = await gradingPanelHtml(context, siteUrl, ids.contextId, userId);
    const saved = await panelGrade(page, after);
    const state = await readPanelState(page, after);
    const extras = [feedback !== undefined ? "feedback" : "", feedbackFiles ? `${feedbackFiles.length} feedback file${feedbackFiles.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    return {
      changed: `Graded user ${userId}${applyToGroup ? " and their group" : ""} in assignment ${activityId}${extras ? `, with ${extras}` : ""}${workflowState ? `, workflow state ${workflowState}` : ""}.`,
      ...saved,
      ...(feedbackFiles && state.draftId && state.sesskey ? { feedbackFiles: await draftAreaFiles(context, siteUrl, state.sesskey, state.draftId) } : {}),
      ...(state.workflowState ? { workflowState: state.workflowState } : {}),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A criterion of a rubric or a marking guide, with the ids grading takes. */
export interface GradingCriterion {
  id: number;
  /** A rubric criterion's description; a guide criterion's short name. */
  description: string;
  /** A guide criterion's description for students and for markers. */
  details?: string;
  /** A guide criterion's description for markers only. */
  markers?: string;
  /** A rubric criterion's levels, by the ids grading takes. */
  levels?: { id: number; definition: string; score: number }[];
  /** A guide criterion's maximum score. */
  maxScore?: number;
}

/** How an assignment is graded: its method and, for advanced grading, its criteria. */
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
 * The participant whose grading panel a read opens: the first with a submission, since the panel
 * creates an empty one for a participant without (see `gradingPanelHtml`); `fallback`, or the first
 * participant, where nobody has one. `undefined` without participants.
 */
async function panelReader(context: BrowserContext, siteUrl: string, instanceId: number, fallback?: number): Promise<number | undefined> {
  const participants = await listParticipants(context, siteUrl, instanceId);
  return participants.find(hasSubmission)?.id ?? fallback ?? participants[0]?.id;
}

/**
 * An assignment's grading method and, for a rubric or a marking guide, its criteria with the ids
 * `gradeSubmission` takes: read from the grader's panel for the first participant with a submission.
 * Where nobody has one yet, the panel is the first participant's, and Moodle creates an empty
 * submission ("new") for them on opening it.
 */
export async function rubric(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ assignment: { id: number } } & GradingDefinition> {
  const ids = await assignmentIds(context, siteUrl, activityId);
  const reader = await panelReader(context, siteUrl, ids.instanceId);
  if (reader === undefined) throw new GradingError(`Assignment ${activityId} has no participants: its grading form can't be read without one.`);
  const page = await context.newPage();
  try {
    return { assignment: { id: activityId }, ...(await readGradingDefinition(page, await gradingPanelHtml(context, siteUrl, ids.contextId, reader))) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Grants participants an extension until a date, through the assignment's extension form (several at
 * once as its bulk action does). Moodle refuses a date before the assignment's due date, and a person
 * without its "grant extension" capability only on saving (the form opens for anyone, confirmed
 * empirically on the sandbox, 5.2): both throw.
 */
export async function grantExtension(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], until: Date): Promise<{ changed: string }> {
  if (userIds.length === 0) throw new GradingError("Give the participants to grant the extension to.");
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${activityId}&action=grantextension&userid=${userIds[0]}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new NotAnAssignmentError(`You can't grant extensions in activity ${activityId}: it isn't an assignment, or you aren't allowed.`);
  });
  try {
    await setFields(page, { selectedusers: userIds.join(","), "extensionduedate[enabled]": true, ...(await dateSelectorValues(page, "extensionduedate", until)) });
    await submitForm(page, "submitbutton");
    // Moodle shows the form to anyone and checks the capability on saving, answering with its error page.
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new NotAnAssignmentError(`Moodle didn't grant the extension in activity ${activityId}: ${refused}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Extension until ${until.toISOString()} granted to user${userIds.length > 1 ? "s" : ""} ${userIds.join(", ")} in assignment ${activityId}.` };
}

/**
 * Opens one of the grading table's batch forms for `userIds` (as its "With selected…" menu does),
 * or throws `GradingError` with Moodle's reason when it shows none.
 */
async function openBatchForm(context: BrowserContext, siteUrl: string, activityId: number, action: string, userIds: number[], what: string): Promise<Page> {
  if (userIds.length === 0) throw new GradingError(`Give the participants to ${what} for.`);
  const path = `mod/assign/view.php?id=${activityId}&action=${action}&selectedusers=${userIds.join(",")}`;
  return openForm(context, siteUrl, path).catch(async (error: unknown) => {
    if (!(error instanceof FormError)) throw error;
    // Moodle's error page says why (not enough markers, not allowed…): read without a tab.
    const { html } = await fetchSitePage(context, siteUrl, path);
    const reason = /class="errormessage">([^<]*)</.exec(html)?.[1];
    throw new GradingError(`Moodle didn't open the form to ${what} in activity ${activityId}: ${reason ? decodeEntities(reason).trim() : "it isn't an assignment with the marking workflow, or you aren't allowed"}`);
  });
}

/**
 * Refuses a batch action the assignment doesn't use: Moodle's batch forms open and save whatever its
 * settings (its source, and the sandbox for marker allocation, 5.2), but the grading panel has the workflow state only with the
 * marking workflow, and the marker selects only with marker allocation too. The panel read is a
 * participant's with a submission where there is one, `userId`'s otherwise: allocating markers
 * creates no submission, and the panel would.
 */
async function requireGradingFeature(context: BrowserContext, siteUrl: string, activityId: number, userId: number, feature: "workflowState" | "markers"): Promise<void> {
  const ids = await assignmentIds(context, siteUrl, activityId);
  const reader = (await panelReader(context, siteUrl, ids.instanceId, userId)) ?? userId;
  const page = await context.newPage();
  try {
    const state = await readPanelState(page, await gradingPanelHtml(context, siteUrl, ids.contextId, reader));
    if (state[feature] !== undefined) return;
  } finally {
    await page.close().catch(() => undefined);
  }
  throw new GradingError(
    feature === "workflowState"
      ? `Assignment ${activityId} doesn't use the marking workflow: turn "Use marking workflow" on in its settings first.`
      : `Assignment ${activityId} doesn't allocate markers (or you can't manage allocations): turn "Use marking workflow" and "Use marking allocation" on in its settings first.`,
  );
}

/**
 * Sets the marking workflow state of participants' submissions, as the grading table's "Set marking
 * workflow state" does; "released" shows them their grades, notifying them when `notify` is true
 * (the form's default is not to). With several markers, it sets the submission's overall state.
 */
export async function setWorkflowState(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userIds: number[],
  state: Exclude<WorkflowState, "notmarked">,
  { notify }: { notify?: boolean } = {},
): Promise<{ changed: string }> {
  if (!WORKFLOW_STATES.includes(state) || (state as string) === "notmarked") {
    throw new GradingError(`"${state}" isn't a state the batch form sets: one of ${WORKFLOW_STATES.slice(1).join(", ")}.`);
  }
  if (notify && state !== "released") throw new GradingError('Moodle notifies students only when releasing: give notify with "released".');
  if (userIds.length > 0) await requireGradingFeature(context, siteUrl, activityId, userIds[0]!, "workflowState");
  const page = await openBatchForm(context, siteUrl, activityId, "viewbatchsetmarkingworkflowstate", userIds, "set the marking workflow state");
  try {
    if ((await page.locator(`form.mform [name="markingworkflowstate"] option[value="${state}"]`).count()) === 0) {
      throw new GradingError(`You can't set submissions to ${state} in assignment ${activityId}: the form doesn't offer that state to you.`);
    }
    const values: Record<string, FieldValue> = {};
    // With several markers the form asks whose state: the submission's ("grade"), not the person's own mark.
    if ((await page.locator('form.mform [name="workflowcontext"]').count()) > 0) values.workflowcontext = "grade";
    values.markingworkflowstate = state;
    if (state === "released" && notify !== undefined) values.sendstudentnotifications = notify ? 1 : 0;
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Set the marking workflow state of user${userIds.length > 1 ? "s" : ""} ${userIds.join(", ")} to ${state} in assignment ${activityId}${notify ? ", notifying them" : ""}.` };
}

/**
 * Allocates a marker (the user id of someone who can grade; several where the assignment uses
 * several markers per submission) to participants' submissions, as the grading table's "Allocate
 * marker" does. Moodle leaves alone submissions past marking (marking completed, in review, ready
 * for release, released).
 */
export async function allocateMarker(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], markerId: number | number[]): Promise<{ changed: string }> {
  const markerIds = Array.isArray(markerId) ? markerId : [markerId];
  if (markerIds.length === 0) throw new GradingError("Give the marker to allocate.");
  if (userIds.length > 0) await requireGradingFeature(context, siteUrl, activityId, userIds[0]!, "markers");
  const page = await openBatchForm(context, siteUrl, activityId, "viewbatchmarkingallocation", userIds, "allocate markers");
  try {
    // One select per marker the assignment uses: allocatedmarker1, allocatedmarker2…
    const slots = await page.locator('form.mform select[name^="allocatedmarker"]').count();
    if (markerIds.length > slots) throw new GradingError(`Assignment ${activityId} uses ${slots} marker${slots === 1 ? "" : "s"} per submission; ${markerIds.length} given.`);
    for (const [index, id] of markerIds.entries()) {
      if ((await page.locator(`form.mform [name="allocatedmarker${index + 1}"] option[value="${id}"]`).count()) === 0) {
        throw new GradingError(`User ${id} can't mark assignment ${activityId}: markers are the course's users who can grade it.`);
      }
    }
    await setFields(page, Object.fromEntries(markerIds.map((id, index) => [`allocatedmarker${index + 1}`, String(id)])));
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Allocated marker${markerIds.length > 1 ? "s" : ""} ${markerIds.join(", ")} to user${userIds.length > 1 ? "s" : ""} ${userIds.join(", ")} in assignment ${activityId}.` };
}
