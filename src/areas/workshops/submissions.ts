// A participant's work in a workshop: reading a submission, and adding or editing the person's own
// through Moodle's submission form (mod/workshop/submission.php). mod_workshop's services are the
// mobile app's only (servicenotavailable from a page's session), so it goes through the page and its
// form, read by their structure (the submission's box classes, the form's field names).
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { checkLocalFiles } from "../../core/files.js";
import { checkEmbeds, embedFiles } from "../../core/embed.js";
import { FormError, deleteDraftFile, draftFiles, formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { WorkshopError, workshopInfo } from "./workshops.js";

/** A file attached to a submission (or an example), with its URL on the site. */
export interface WorkshopAttachment {
  name: string;
  url: string;
}

/** A workshop submission as its page shows it (`workshopSubmission`). */
export interface WorkshopSubmissionContent {
  id: number;
  title: string;
  /** Its text (HTML), with the site's URLs for the files embedded in it; empty when the workshop takes files only. */
  content: string;
  /** Left out where Moodle hides authors' names from the person. */
  authorId?: number;
  author?: string;
  attachments: WorkshopAttachment[];
  /** Whether Moodle lets the person edit it now: their own, in the submission phase, within its dates. */
  editable: boolean;
}

/** The submission shown in the page (`.submission-full`) and whether the page offers to edit it; `undefined` when it shows none. */
export function readSubmissionBox(page: Page): Promise<(Omit<WorkshopSubmissionContent, "id"> & { id?: number }) | undefined> {
  return inPage(
    page,
    () => {
      interface El {
        innerHTML: string;
        textContent: string | null;
        value: string;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { document: El; location: { href: string } };
      const box = g.document.querySelector(".submission-full");
      if (!box) return undefined;
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const param = (href: string | null | undefined, name: string) => {
        const match = new RegExp(`[?&]${name}=(\\d+)`).exec(href ?? "");
        return match ? Number(match[1]) : undefined;
      };
      // The title links to the submission when the page's URL isn't the submission's own.
      const titleLink = box.querySelector('.header .title a[href*="/mod/workshop/"]');
      const id = param(titleLink?.getAttribute("href"), "id") ?? param(g.location.href, "id");
      const authorLink = box.querySelector('.header .author .fullname a[href*="/user/view.php"]');
      const content = box.querySelector(":scope > .content");
      const attachments: { name: string; url: string }[] = [];
      for (const link of Array.from(box.querySelectorAll('.attachments a[href*="/submission_attachment/"]'))) {
        const url = link.getAttribute("href") ?? "";
        if (attachments.some((a) => a.url === url)) continue;
        const path = new URL(url, g.location.href).pathname;
        const name = decodeURIComponent(path.slice(path.indexOf("/submission_attachment/") + "/submission_attachment/".length).replace(/^\d+\//, ""));
        attachments.push({ name, url });
      }
      // "Edit submission" is a button to the page with edit=on.
      const editable = Array.from(g.document.querySelectorAll('form[action*="/mod/workshop/submission.php"] input[name="edit"]')).length > 0;
      return {
        ...(id ? { id } : {}),
        title: clean(box.querySelector(".header .title")?.textContent),
        content: (content?.querySelector(":scope > .no-overflow") ?? content)?.innerHTML.trim() ?? "",
        ...(authorLink ? { authorId: param(authorLink.getAttribute("href"), "id"), author: clean(authorLink.textContent) } : {}),
        attachments,
        editable,
      };
    },
    undefined,
  );
}

/** The code of Moodle's error page (its "More information" link ends in it: `nopermissions`…), by structure. */
export function errorCode(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const link = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a[href]');
    return /\/([a-z_]+)\/?$/.exec(link?.getAttribute("href") ?? "")?.[1];
  });
}

/**
 * Opens a submission's page (the person's own without `id`), failing in Moodle's terms: without a
 * submission of their own, Moodle lets in only those who can submit.
 */
async function openSubmission(context: BrowserContext, siteUrl: string, activityId: number, id?: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/workshop/submission.php?cmid=${activityId}${id !== undefined ? `&id=${id}` : ""}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined && id === undefined && (await errorCode(page)) === "nopermissions") {
      throw new WorkshopError(`You have no submission in workshop ${activityId} and can't submit: submitting takes Moodle's mod/workshop:submit capability (a student's). Moodle said: ${refused}`);
    }
    if (refused !== undefined) throw new WorkshopError(`Moodle didn't let you open ${id !== undefined ? `submission ${id}` : "your submission"} in workshop ${activityId}: ${refused}`);
    if ((await page.locator("body#page-mod-workshop-submission").count()) === 0) {
      throw new WorkshopError(`Activity ${activityId} isn't a workshop you can open. Take the id of a workshop (module "workshop") from the course structure.`);
    }
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** Which submission to read: the person's own (neither), or another by its id or its author's. */
export interface WorkshopSubmissionRef {
  submissionId?: number;
  /** The author's user id: their submission, found in the workshop's report (a teacher's). */
  authorId?: number;
}

/**
 * A workshop submission as its page shows it: its title, its text (HTML) and attached files, its
 * author (where Moodle shows authors' names), and whether the person can edit it now. Without
 * options, the person's own submission (`undefined` when they haven't submitted); with
 * `submissionId`, that one, which Moodle shows its author, its reviewers and those who can see every
 * submission (teachers); with `authorId`, that participant's, found in the workshop's report
 * (`undefined` when they have none). Throws `WorkshopError` when Moodle doesn't let the person see it
 * or the id isn't a workshop's.
 */
export async function workshopSubmission(context: BrowserContext, siteUrl: string, activityId: number, { submissionId, authorId }: WorkshopSubmissionRef = {}): Promise<WorkshopSubmissionContent | undefined> {
  if (submissionId !== undefined && authorId !== undefined) throw new MoodleError("Give the submission by its id (submissionId) or its author's (authorId), not both.", "invalid-input");
  if (authorId !== undefined) {
    const info = await workshopInfo(context, siteUrl, activityId);
    const found = info.submissions.find((s) => s.authorId === authorId);
    if (!found) return undefined;
    submissionId = found.id;
  }
  const page = await openSubmission(context, siteUrl, activityId, submissionId);
  try {
    const read = await readSubmissionBox(page);
    if (!read) return undefined;
    const id = read.id ?? submissionId;
    if (id === undefined) throw new WorkshopError(`Workshop ${activityId}'s submission page doesn't say the submission's id: it isn't what the driver expects of Moodle's page.`);
    return { ...read, id };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The person's own submission: its title, text and attached files. */
export interface WorkshopSubmissionInput {
  /** Its title; Moodle requires one, so a new submission takes it. Editing, left out keeps the one there. */
  title?: string;
  /** Its text (HTML), where the workshop takes online text. */
  content?: string;
  /** Local files (absolute paths) to attach: they replace the files attached before, up to the workshop's number of attachments. Left out keeps them. */
  attachments?: string[];
  /** Local files (absolute paths) to embed in the content, which names each by its file name (`<img src="shot.png">`). */
  embed?: string[];
}

/**
 * Fills Moodle's submission form (a submission's or an example's, the same form) open in `page`:
 * the title, the content with `embed`'s files, and the attachments, which replace those there.
 */
export async function fillSubmissionForm(page: Page, activityId: number, input: WorkshopSubmissionInput): Promise<void> {
  const values: Record<string, FieldValue> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.content !== undefined) {
    if ((await formValue(page, "content_editor[format]")) === undefined) throw new WorkshopError(`Workshop ${activityId} takes no online text: it's off in its settings ("Online text").`);
    values["content_editor[text]"] = input.content;
  }
  if (input.attachments !== undefined) {
    const draft = await formValue(page, "attachment_filemanager");
    if (!draft) throw new WorkshopError(`Workshop ${activityId} takes no attachments: it's off in its settings ("Attachment").`);
    for (const existing of await draftFiles(page, draft)) await deleteDraftFile(page, draft, existing.name);
    if (input.attachments.length > 0) await uploadToDraft(page, draft, input.attachments);
  }
  if (input.embed) await embedFiles(page, values, input.embed);
  await setFields(page, values);
  await submitForm(page, "submitbutton");
}

/** Opens Moodle's submission form (a submission's or an example's) at `path`, or throws `refusal()` when the page has none. */
export async function openSubmissionForm(context: BrowserContext, siteUrl: string, path: string, refusal: () => WorkshopError): Promise<Page> {
  let page: Page;
  try {
    page = await openForm(context, siteUrl, path);
  } catch (error) {
    if (error instanceof FormError) throw refusal();
    throw error;
  }
  if ((await page.locator('form.mform input[name="_qf__workshop_submission_form"]').count()) === 0) {
    await page.close().catch(() => undefined);
    throw refusal();
  }
  return page;
}

/** Checks a submission's input before any page opens: local files there, embeds used by the content. */
export async function checkSubmissionInput(input: WorkshopSubmissionInput): Promise<void> {
  if (input.title !== undefined && input.title.trim() === "") throw new MoodleError("The title is empty: Moodle requires one.", "invalid-input");
  if (input.attachments) await checkLocalFiles(input.attachments);
  if (input.embed) await checkEmbeds([input.content], input.embed);
}

/**
 * Adds the person's submission to a workshop, or changes the one they have, through Moodle's
 * submission form, as "Add submission" and "Edit submission" do: only what's given changes (a new
 * one needs a title). Moodle takes submissions in the submission phase, within its dates (and in
 * the assessment phase too where the workshop takes late submissions, for a first submission only).
 * Returns a sentence of what changed, the submission's id, and the submission afterwards. Throws
 * `WorkshopError` when Moodle doesn't let the person submit (it takes `mod/workshop:submit`, a
 * student's) or not now (the phase, the dates, examples to assess first), or the workshop doesn't
 * take what's given; `FormError` when Moodle refuses the form (too many attachments, a required
 * part missing).
 */
export async function saveWorkshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: WorkshopSubmissionInput,
): Promise<{ changed: string; submissionId: number; submission: WorkshopSubmissionContent }> {
  if (input.title === undefined && input.content === undefined && input.attachments === undefined) throw new MoodleError("Give the submission's title, content or attachments.", "invalid-input");
  await checkSubmissionInput(input);
  const own = await openSubmission(context, siteUrl, activityId);
  let existing: number | undefined;
  try {
    existing = (await readSubmissionBox(own))?.id;
  } finally {
    await own.close().catch(() => undefined);
  }
  if (existing === undefined && input.title === undefined) throw new MoodleError("A new submission needs a title.", "invalid-input");
  // Moodle shows the submission without its form when the person can't edit it now.
  const page = await openSubmissionForm(
    context,
    siteUrl,
    `mod/workshop/submission.php?cmid=${activityId}&edit=on${existing !== undefined ? `&id=${existing}` : ""}`,
    () =>
      new WorkshopError(
        `Moodle doesn't let you ${existing !== undefined ? `edit your submission ${existing} to` : "submit to"} workshop ${activityId} now: submissions are only taken in the submission phase, within its dates (a first one in the assessment phase too, where late submissions are allowed), and after the examples the workshop asks to assess first.`,
      ),
  );
  try {
    await fillSubmissionForm(page, activityId, input);
  } finally {
    await page.close().catch(() => undefined);
  }
  const submission = await workshopSubmission(context, siteUrl, activityId);
  if (!submission) throw new WorkshopError(`The submission form of workshop ${activityId} was saved, but Moodle shows no submission of yours.`);
  return {
    changed: existing !== undefined ? `Submission ${submission.id} to workshop ${activityId} changed.` : `Submission ${submission.id} "${submission.title}" added to workshop ${activityId}.`,
    submissionId: submission.id,
    submission,
  };
}
