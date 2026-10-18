import type { BrowserContext, Page } from "playwright-core";
import { checkLocalFiles } from "../../core/files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
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
}

export function readStudentAssignment(page: Page): Promise<StudentAssignment> {
  return inPage(
    page,
    () => {
      interface El {
        innerText: string;
        className: string;
        href: string;
        value: string;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const text = (el: El | null | undefined) =>
        (el?.innerText ?? "")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      const links = (selector: string) => Array.from(doc.querySelectorAll(selector)).map((a) => ({ name: text(a), url: a.href }));
      const rows = (selector: string) => Array.from(doc.querySelectorAll(selector)).map((row) => ({ label: text(row.querySelector("th")), value: text(row.querySelector("td")) }));
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
    if (error instanceof NotLoggedInError) throw error;
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
    if (error instanceof NotLoggedInError) throw error;
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
    if (error instanceof NotLoggedInError) throw error;
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
