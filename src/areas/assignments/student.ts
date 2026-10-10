import type { BrowserContext, Page } from "playwright-core";
import { checkLocalFiles } from "../../core/files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

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
  canEdit: boolean;
  canSubmit: boolean;
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
        dates: Array.from(doc.querySelectorAll('[data-region="activity-dates"] .date-item')).map((item) => {
          const label = text(item.querySelector(".date-item-label"));
          return { label: label.replace(/:$/, ""), value: text(item).slice(label.length).trim() };
        }),
        status: rows(".submissionstatustable tr"),
        submissionState: stateCell ? /\bsubmissionstatus([a-z]+)\b/.exec(stateCell.className)?.[1] : undefined,
        graded: doc.querySelector(".submissionstatustable td.submissiongraded") !== null,
        submittedFiles: links('.submissionstatustable a[href*="pluginfile.php"]'),
        feedback: rows(".feedback tr"),
        canEdit: actions.includes("editsubmission"),
        canSubmit: actions.includes("submit"),
      };
    },
    null,
  );
}

export async function studentAssignment(context: BrowserContext, siteUrl: string, activityId: number): Promise<StudentAssignment> {
  const page = await openSitePage(context, siteUrl, `mod/assign/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-assign-view").count()) === 0) {
      throw new SubmissionError(`Activity ${activityId} isn't an assignment you can open. Take the id of an assignment (module "assign") from the course structure.`);
    }
    return await readStudentAssignment(page);
  } finally {
    await page.close().catch(() => undefined);
  }
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
  const page = await openForm(context, siteUrl, `mod/assign/view.php?id=${activityId}&action=submit`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new SubmissionError(`Assignment ${activityId} has nothing to submit now (no draft, submitted already, or it doesn't ask students to click submit).`);
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
