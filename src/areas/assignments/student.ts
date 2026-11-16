import type { BrowserContext, Page } from "playwright-core";
import { checkLocalFiles } from "../../core/files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { openSitePage, isSessionOrBrowserFailure } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { callService } from "../../core/ajax.js";
import { participantFilters } from "../participants/participants.js";

/** The assignment isn't there, or the person can't do that now. */
export class SubmissionError extends MoodleError {
  override name = "SubmissionError";
  constructor(message: string) {
    super(message, "submission");
  }
}

/** An assignment as the student's page shows it. */
export interface StudentAssignment {
  description: string;
  descriptionFiles: { name: string; url: string }[];
  dates: { label: string; value: string }[];
  status: { label: string; value: string }[];
  submissionState?: string;
  graded: boolean;
  submittedFiles: { name: string; url: string }[];
  feedback: { label: string; value: string }[];
  /** The files the teacher attached to the feedback, for `downloadFile`. */
  feedbackFiles: { name: string; url: string }[];
  canEdit: boolean;
  canSubmit: boolean;
  /**
   * With group submissions, the submission is the group's: its name, and its id where the
   * participants page shows the group to the person (`participants(courseId, { group: id })` gives
   * its members); only the name for Moodle's "Default group" (the person is in no group).
   */
  group?: { id?: number; name: string };
  /**
   * The assignment's advanced grading, as the page shows it to the student: a rubric's criteria with
   * every level and its points, or a marking guide's with their maximum; once graded, the level chosen
   * or the score given for each, with the marker's remark. Absent for a simple grade, and when Moodle
   * shows the student no grading form (a rubric set not to be previewed, before it's graded).
   */
  grading?: StudentGrading;
}

/** An assignment's rubric or marking guide as its student sees it (`StudentAssignment.grading`). */
export interface StudentGrading {
  method: "rubric" | "guide";
  criteria: StudentGradingCriterion[];
}

/** A criterion of the student's view of a rubric or marking guide; what's chosen comes once graded. */
export interface StudentGradingCriterion {
  id: number;
  /** A rubric criterion's description; a guide criterion's short name. */
  description: string;
  /** A guide criterion's description for students. */
  details?: string;
  /** A rubric criterion's levels, in order, with their points. */
  levels?: { id: number; definition: string; score: number }[];
  /** A guide criterion's maximum score. */
  maxScore?: number;
  /** Once graded: a rubric's chosen level (its id in `levels`). */
  levelId?: number;
  /** Once graded: the score for the criterion (the chosen level's points, or a guide's score). */
  score?: number;
  /** Once graded: the marker's remark on the criterion, when there's one. */
  remark?: string;
}

export function readStudentAssignment(page: Page): Promise<StudentAssignment> {
  return inPage(
    page,
    () => {
      interface El {
        id: string;
        innerText: string;
        textContent: string | null;
        className: string;
        href: string;
        value: string;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        closest(s: string): El | null;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const text = (el: El | null | undefined) =>
        (el?.innerText ?? "")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      const links = (selector: string) => Array.from(doc.querySelectorAll(selector)).map((a) => ({ name: text(a), url: a.href }));
      // A rubric or marking guide is drawn inside the status and feedback blocks, as tables of its own
      // (confirmed empirically, 5.2 and 4.5): their rows aren't the block's.
      const rows = (selector: string) =>
        Array.from(doc.querySelectorAll(selector))
          .filter((row) => row.closest('[class*="gradingform_"]') === null)
          .map((row) => ({ label: text(row.querySelector("th")), value: text(row.querySelector("td")) }));
      const number = (shown: string) => {
        const match = /-?\d+(?:[.,]\d+)?/.exec(shown);
        return match ? Number(match[0].replace(",", ".")) : undefined;
      };
      const plain = (el: El | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      // The grading form: its breakdown in the feedback once graded (with what was chosen), its preview
      // in the status block before (by the form's own ids and classes, confirmed empirically, 5.2 and 4.5).
      const form = doc.querySelector(".feedback .advancedgrade .gradingform_rubric, .feedback .advancedgrade .gradingform_guide") ?? doc.querySelector(".submissionstatustable .gradingform_rubric, .submissionstatustable .gradingform_guide");
      let grading: StudentGrading | undefined;
      if (form) {
        const method = /\bgradingform_rubric\b/.test(form.className) ? "rubric" : "guide";
        const criteria = Array.from(form.querySelectorAll("tr.criterion")).flatMap((row): StudentGradingCriterion[] => {
          const id = Number(/-criteria-(\d+)$/.exec(row.id)?.[1]);
          if (!id) return [];
          const remarkCell = row.querySelector("td.remark");
          // A guide's remark cell starts with a hidden label for screen readers.
          const remark = plain(remarkCell?.querySelector(":scope > div:not(.hidden)") ?? remarkCell) || undefined;
          if (method === "rubric") {
            const cells = Array.from(row.querySelectorAll("td.level"));
            const levels = cells.map((cell) => ({ id: Number(/-levels-(\d+)$/.exec(cell.id)?.[1]), definition: plain(cell.querySelector(".definition")), score: number(plain(cell.querySelector(".scorevalue"))) ?? 0 }));
            const chosen = cells.findIndex((cell) => /\bchecked\b/.test(cell.className));
            return [
              {
                id,
                description: plain(row.querySelector("td.description")),
                levels,
                ...(chosen >= 0 ? { levelId: levels[chosen]!.id, score: levels[chosen]!.score } : {}),
                ...(remark ? { remark } : {}),
              },
            ];
          }
          const details = plain(row.querySelector(".criteriondescription")) || undefined;
          const maxScore = number(plain(row.querySelector(".criteriondescriptionscore")));
          const score = row.querySelector("td.score") ? number(plain(row.querySelector("td.score"))) : undefined;
          return [
            {
              id,
              description: plain(row.querySelector(".criterionshortname")),
              ...(details ? { details } : {}),
              ...(maxScore !== undefined ? { maxScore } : {}),
              ...(score !== undefined ? { score } : {}),
              ...(remark ? { remark } : {}),
            },
          ];
        });
        grading = { method, criteria };
      }
      const stateCell = Array.from(doc.querySelectorAll(".submissionstatustable td")).find((td) => /\bsubmissionstatus[a-z]+\b/.test(td.className));
      const actions = Array.from(doc.querySelectorAll('form input[name="action"]')).map((input) => input.value);
      return {
        description: text(doc.querySelector(".activity-description, #intro")),
        descriptionFiles: links('.activity-description a[href*="pluginfile.php"], #intro a[href*="pluginfile.php"]'),
        // Moodle 5.2's dates are .date-item with a .date-item-label; 4.5's plain divs with the label in
        // a strong (core_course/activity_date, confirmed empirically, 4.5).
        dates: Array.from(doc.querySelectorAll('[data-region="activity-dates"] .date-item, [data-region="activity-dates"] > div:not(.date-item)')).map((item) => {
          const label = text(item.querySelector(".date-item-label, strong"));
          return { label: label.replace(/:$/, ""), value: text(item).slice(label.length).trim() };
        }),
        status: rows(".submissionstatustable tr"),
        submissionState: stateCell ? /\bsubmissionstatus([a-z]+)\b/.exec(stateCell.className)?.[1] : undefined,
        graded: doc.querySelector(".submissionstatustable td.submissiongraded") !== null,
        submittedFiles: links('.submissionstatustable a[href*="pluginfile.php"]'),
        feedback: rows(".feedback tr"),
        // The feedback files plugin's block: summary_assignfeedback_file_<gradeid>.
        feedbackFiles: links('.feedback [class*="summary_assignfeedback_file_"] a[href*="pluginfile.php"]'),
        canEdit: actions.includes("editsubmission"),
        canSubmit: actions.includes("submit"),
        ...(grading ? { grading } : {}),
      };
    },
    null,
  );
}

/** An assignment as the student sees it: its description and files, dates, the submission's status and files, the feedback, and whether it can be edited or submitted now. */
export async function studentAssignment(context: BrowserContext, siteUrl: string, activityId: number): Promise<StudentAssignment> {
  const page = await openSitePage(context, siteUrl, `mod/assign/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-assign-view").count()) === 0) {
      throw new SubmissionError(`Activity ${activityId} isn't an assignment you can open. Take the id of an assignment (module "assign") from the course structure.`);
    }
    const assignment = await readStudentAssignment(page);
    const group = await submissionGroup(context, siteUrl, page, assignment);
    return group ? { ...assignment, group } : assignment;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * With group submissions, the status table's first row is the group's ("Group": its name, or
 * "Default group"), before the submission status, whose cell has a class. Its label is told apart
 * by Moodle's own string in the person's language (`core_get_string`), only when there's a row
 * before the status one; its id comes from the participants page's group filter.
 */
async function submissionGroup(context: BrowserContext, siteUrl: string, page: Page, assignment: StudentAssignment): Promise<StudentAssignment["group"]> {
  const before = await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ querySelector(s: string): unknown }> } }).document;
    return Array.from(doc.querySelectorAll(".submissionstatustable tr")).findIndex((row) => row.querySelector('td[class*="submissionstatus"]') !== null);
  });
  const first = assignment.status[0];
  if (before < 1 || !first) return undefined;
  const [team, defaultTeam] = await Promise.all(["submissionteam", "defaultteam"].map((stringid) => callService<string>(context, siteUrl, "core_get_string", { stringid, component: "assign" })));
  if (first.label !== team?.trim()) return undefined;
  if (first.value === defaultTeam?.trim()) return { name: first.value };
  const courseId = await page.evaluate(() => Number(/\bcourse-(\d+)\b/.exec((globalThis as unknown as { document: { body: { className: string } } }).document.body.className)?.[1]));
  // The participants page may be closed to the person: the group's name is what the assignment says.
  const filters = await participantFilters(context, siteUrl, courseId).catch((error: unknown) => {
    if (isSessionOrBrowserFailure(error)) throw error;
    return undefined;
  });
  const group = filters?.groups.find((g) => g.name === first.value);
  // Not its members: they're others' data, which `participants(courseId, { group: id })` gives.
  return group ? { id: group.id, name: group.name } : { name: first.value };
}

/** Saves the submission's online text and adds files, as "Save changes" on the edit page does; gives the assignment afterwards. */
export async function saveSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: { onlineText?: string; files?: string[] },
): Promise<{ changed: string; assignment: StudentAssignment }> {
  if (input.onlineText === undefined && (!input.files || input.files.length === 0)) throw new SubmissionError("Give online text, files or both.");
  if (input.files) await checkLocalFiles(input.files);
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${activityId}&action=editsubmission`).catch((error: unknown) => {
    if (isSessionOrBrowserFailure(error)) throw error;
    throw new SubmissionError(`You can't edit a submission to assignment ${activityId} now (submitted already, past its cut-off date, or not yours to submit).`);
  });
  try {
    if (input.files && input.files.length > 0) {
      const draft = await formValue(page, "files_filemanager");
      if (!draft) throw new SubmissionError(`Assignment ${activityId} doesn't take file submissions.`);
      await uploadToDraft(page, draft, input.files);
    }
    const values: Record<string, FieldValue> = {};
    if (input.onlineText !== undefined) {
      if ((await formValue(page, "onlinetext_editor[format]")) === undefined) throw new SubmissionError(`Assignment ${activityId} doesn't take online text.`);
      values["onlinetext_editor[text]"] = input.onlineText;
    }
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  const saved = [input.onlineText !== undefined ? "online text" : "", input.files?.length ? `${input.files.length} file${input.files.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
  return { changed: `Saved ${saved} in assignment ${activityId}'s submission.`, assignment: await studentAssignment(context, siteUrl, activityId) };
}

/**
 * Submits the saved submission for grading, accepting the site's statement when it asks for one
 * (`acceptStatement`, once the person agrees; a bare boolean as before 0.2 too); gives the
 * assignment afterwards.
 */
export async function submitForGrading(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { acceptStatement?: boolean } | boolean = {},
): Promise<{ changed: string; assignment: StudentAssignment }> {
  const acceptStatement = typeof options === "boolean" ? options : (options.acceptStatement ?? false);
  const nothing = () => new SubmissionError(`Assignment ${activityId} has nothing to submit now (no draft, submitted already, or it doesn't ask students to click submit).`);
  // Moodle shows the confirmation whatever the submission's state (confirmed empirically on the sandbox,
  // 5.2): the assignment's own "Submit assignment" button says whether there's a draft to submit.
  if (!(await studentAssignment(context, siteUrl, activityId)).canSubmit) throw nothing();
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${activityId}&action=submit`).catch((error: unknown) => {
    if (isSessionOrBrowserFailure(error)) throw error;
    throw nothing();
  });
  try {
    const statement = page.locator('form.mform [name="submissionstatement"][type="checkbox"]');
    if ((await statement.count()) > 0) {
      if (!acceptStatement) {
        const text = await statement.first().evaluate((box) => (box as unknown as { closest(s: string): { textContent: string | null } | null }).closest(".form-check, .fitem")?.textContent ?? "");
        throw new SubmissionError(`Submitting asks to accept this statement; call again with acceptStatement once the person agrees: ${text.replace(/\s+/g, " ").trim()}`);
      }
      await setFields(page, { submissionstatement: true });
    }
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Submitted assignment ${activityId} for grading.`, assignment: await studentAssignment(context, siteUrl, activityId) };
}
