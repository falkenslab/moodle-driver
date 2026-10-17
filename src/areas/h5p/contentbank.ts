// A course's content bank: the H5P content teachers keep there, listed from its page
// (contentbank/index.php), uploaded through its upload form (a dynamic form), renamed and deleted
// with its AJAX services, and downloaded from each content's page.
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { checkLocalFiles, downloadFile, type DownloadedFile } from "../../core/files.js";
import { uploadToDraft } from "../../core/forms.js";
import { fetchSitePage, moodleErrorMessage, openSitePage, readMoodleConfig } from "../../core/session.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";
import { isoDate } from "../courses/list.js";

/** Moodle refused something in a content bank: the person lacks the capability, or the content isn't there. */
export class ContentBankError extends MoodleError {
  override name = "ContentBankError";
  constructor(message: string) {
    super(message, "content-bank");
  }
}

/** One content of a course's content bank (`contentBank`). */
export interface BankContent {
  /** Moodle's id for the content (its page is `contentbank/view.php?id=<id>`). */
  id: number;
  name: string;
  /** Moodle's content type, from the file's extension: `"h5p"` (the only one Moodle has). */
  type: string;
  /** The H5P library and its version, from its icon: missing when the library has no icon, or the package isn't deployed yet. */
  contentType?: { library: string; version: string };
  authorName: string;
  modified?: string;
  /** The file's size, in bytes. */
  size: number;
  /** How many activities use the content (link to its file). */
  uses: number;
  /** Unlisted: kept out of the bank's list for those who can't see unlisted content. */
  unlisted: boolean;
  /** The content's file (`pluginfile.php/<context>/contentbank/public/<id>/<file>`), as its page gives it. */
  fileUrl?: string;
}

/** What `uploadToContentBank` did, and the content it made. */
export interface BankContentUpload {
  changed: string;
  content: BankContent;
}

/** The content bank's form for uploading a file (and replacing one). */
const UPLOAD_FORM = "core_contentbank\\form\\upload_files";

/** The course's context id, which the content bank goes by (`M.cfg.contextid` on the course's page). */
async function courseContextId(context: BrowserContext, siteUrl: string, courseId: number): Promise<number> {
  const { html } = await fetchSitePage(context, siteUrl, `course/view.php?id=${courseId}`, { follow: false });
  const id = Number(readMoodleConfig(html)?.contextid);
  if (!id || !new RegExp(`<body\\b[^>]*\\bclass="[^"]*\\bcourse-${courseId}\\b`).test(html)) throw new ContentBankError(`Course ${courseId} doesn't exist, or you can't open it.`);
  return id;
}

/** Opens the course's content bank page, failing when Moodle refuses it (no `moodle/contentbank:access`). */
async function openBank(context: BrowserContext, siteUrl: string, courseId: number, contextId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `contentbank/index.php?contextid=${contextId}`);
  if ((await page.locator('[data-region="contentbank"]').count()) > 0) return page;
  const message = await moodleErrorMessage(page);
  await page.close().catch(() => undefined);
  throw new ContentBankError(`You can't open course ${courseId}'s content bank${message ? ` (Moodle says: ${message})` : ""}: it takes Moodle's capability moodle/contentbank:access, which teachers have.`);
}

/** A row of the bank's list, before its content's page is read: the modification time in seconds. */
export type BankRow = Omit<BankContent, "type" | "fileUrl" | "modified"> & { modified: number };

/** The bank's rows (`.cb-listitem`), by their data attributes and their link to the content's page. */
export function readBankRows(page: Page): Promise<BankRow[]> {
  return page.evaluate(() => {
    interface El {
      className: string;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    return Array.from(doc.querySelectorAll('[data-region="contentbank"] .cb-listitem')).map((row) => {
      const icon = /url\('([^']*)'\)/.exec(row.querySelector(".cb-thumbnail")?.getAttribute("style") ?? "")?.[1] ?? "";
      const library = /\/core_h5p\/libraries\/\d+\/([^/]+)-(\d+\.\d+)\/icon\./.exec(icon);
      return {
        id: Number(/[?&]id=(\d+)/.exec(row.querySelector("a.cb-link")?.getAttribute("href") ?? "")?.[1] ?? 0),
        name: row.getAttribute("data-name") ?? "",
        ...(library ? { contentType: { library: library[1]!, version: library[2]! } } : {}),
        authorName: row.getAttribute("data-author") ?? "",
        modified: Number(row.getAttribute("data-timemodified") ?? 0),
        size: Number(row.getAttribute("data-bytes") ?? 0),
        uses: Number(row.getAttribute("data-uses") ?? 0),
        unlisted: /\bcb-unlisted\b/.test(row.className),
      };
    });
  });
}

/** What a content's page (`contentbank/view.php`) tells: its own name, its file, and the file's download link when the person may download it. */
export interface ContentPage {
  /** The name as stored (an unlisted content's list name has Moodle's "(Unlisted)" added), from its menu; missing when the person can't rename or delete it. */
  name?: string;
  fileUrl?: string;
  downloadUrl?: string;
}

/** Reads a content's page from its HTML: the menu's data attributes and the file URLs it links (the download link, the player's `url`). */
export function readContentPage(html: string, contentId: number): ContentPage | undefined {
  if (!/class="core_contentbank_viewcontent"/.test(html)) return undefined;
  // The rename and delete items carry the stored name; the copy item's is "Copy of …".
  const name = new RegExp(`data-action="(?:renamecontent|deletecontent)"\\s+data-contentname="([^"]*)"[^>]*data-contentid="${contentId}"`).exec(html)?.[1];
  const file = new RegExp(`/pluginfile\\.php/\\d+/contentbank/public/${contentId}/`);
  const downloadUrl = Array.from(html.matchAll(/href="([^"]+)"/g), (m) => decodeEntities(m[1]!)).find((href) => file.test(href));
  const embedded = /\/h5p\/embed\.php\?url=([^&"]+)/.exec(html)?.[1];
  const playerUrl = embedded ? decodeURIComponent(decodeEntities(embedded)) : undefined;
  return {
    ...(name !== undefined ? { name: decodeEntities(name) } : {}),
    ...(downloadUrl ?? (playerUrl && file.test(playerUrl) ? playerUrl : undefined) ? { fileUrl: downloadUrl ?? playerUrl } : {}),
    ...(downloadUrl ? { downloadUrl } : {}),
  };
}

/** Fetches a content's page: undefined when Moodle refuses it or there's no content with that id. */
async function contentPage(context: BrowserContext, siteUrl: string, contentId: number): Promise<ContentPage | undefined> {
  const { html } = await fetchSitePage(context, siteUrl, `contentbank/view.php?id=${contentId}`, { follow: false });
  return readContentPage(html, contentId);
}

/**
 * A course's content bank: each content with its name, type, author, last modification, size, the
 * activities using it and its file URL. One page for the list, and one request per content for its
 * file (each content's page, which Moodle logs as viewed). Throws `ContentBankError` when the person
 * can't open the bank (moodle/contentbank:access, which teachers have and students don't).
 */
export async function contentBank(context: BrowserContext, siteUrl: string, courseId: number): Promise<BankContent[]> {
  const contextId = await courseContextId(context, siteUrl, courseId);
  const page = await openBank(context, siteUrl, courseId, contextId);
  let rows: BankRow[];
  try {
    rows = await readBankRows(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  const contents: BankContent[] = [];
  for (const row of rows.filter((r) => r.id > 0)) {
    const facts = await contentPage(context, siteUrl, row.id);
    const fileName = facts?.fileUrl ? decodeURIComponent(new URL(facts.fileUrl).pathname.split("/").pop() ?? "") : row.name;
    contents.push({
      id: row.id,
      name: facts?.name ?? row.name,
      type: path.extname(fileName).slice(1).toLowerCase(),
      ...(row.contentType ? { contentType: row.contentType } : {}),
      authorName: row.authorName,
      ...(isoDate(row.modified) ? { modified: isoDate(row.modified) } : {}),
      size: row.size,
      uses: row.uses,
      unlisted: row.unlisted,
      ...(facts?.fileUrl ? { fileUrl: facts.fileUrl } : {}),
    });
  }
  return contents;
}

/** Moodle's refusal of the upload form's service: what it takes, in the error. */
function uploadRefused(courseId: number) {
  return (error: unknown): never => {
    if (error instanceof MoodleServiceError) throw new ContentBankError(`You can't upload to course ${courseId}'s content bank (Moodle says: ${error.message}): it takes Moodle's capability moodle/contentbank:upload, and the content type's own (contenttype/h5p:upload), which teachers have.`);
    throw error;
  };
}

/**
 * Uploads a local file (an `.h5p` package) to a course's content bank, as its "Upload" button does,
 * and gives the content it made, named after the file. Moodle deploys an H5P package when it's
 * first shown; one that needs H5P libraries the site doesn't have shows only to whoever may install
 * them (moodle/h5p:updatelibraries, the admin). Throws `ContentBankError` when the person can't
 * upload there (moodle/contentbank:upload) or Moodle refuses the file, and a `MoodleError`
 * (`invalid-input`) for a file of a type the bank doesn't take.
 */
export async function uploadToContentBank(context: BrowserContext, siteUrl: string, courseId: number, file: string): Promise<BankContentUpload> {
  await checkLocalFiles([file]);
  const contextId = await courseContextId(context, siteUrl, courseId);
  const page = await openBank(context, siteUrl, courseId, contextId);
  let contentId: number;
  try {
    const rendered = await callService<{ html: string; javascript: string }>(context, siteUrl, "core_form_dynamic_form", { form: UPLOAD_FORM, formdata: `contextid=${contextId}` }).catch(uploadRefused(courseId));
    // The file picker's settings name the types the bank takes, from its enabled content types.
    const accepted = (/"accepted_types":(\[[^\]]*\])/.exec(rendered.javascript)?.[1] ?? "[]").match(/\.[A-Za-z0-9]+/g) ?? [];
    const extension = path.extname(file).toLowerCase();
    if (accepted.length > 0 && !accepted.some((type) => type.toLowerCase() === extension)) {
      throw new MoodleError(`Course ${courseId}'s content bank takes ${accepted.join(", ")} files, not "${path.basename(file)}".`, "invalid-input");
    }
    // The form and its scripts' settings, in the bank's page: uploading to the form's draft area
    // reads the upload repository's id from them, and the page's sesskey.
    const draftItemId = await page.evaluate(
      ({ html, javascript }) => {
        const doc = (globalThis as unknown as { document: { createElement(t: string): { id: string; hidden: boolean; type: string; innerHTML: string; textContent: string; querySelector(s: string): { value: string } | null }; body: { append(e: unknown): void } } }).document;
        const holder = doc.createElement("div");
        holder.id = "driver-content-upload";
        holder.hidden = true;
        holder.innerHTML = html;
        const settings = doc.createElement("script");
        settings.type = "text/plain";
        settings.textContent = javascript;
        doc.body.append(holder);
        doc.body.append(settings);
        return holder.querySelector('form [name="file"]')?.value ?? "";
      },
      { html: rendered.html, javascript: rendered.javascript },
    );
    if (!draftItemId) throw new MoodleError("The content bank's upload form has no file field: the page isn't what the driver expects.", "unexpected-page");
    await uploadToDraft(page, draftItemId, [file]);
    const formdata = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown };
        FormData: new (form: unknown) => Iterable<[string, string]>;
        URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
      };
      return new g.URLSearchParams(new g.FormData(g.document.querySelector("#driver-content-upload form"))).toString();
    });
    const answer = await callService<{ submitted: boolean; data?: string }>(context, siteUrl, "core_form_dynamic_form", { form: UPLOAD_FORM, formdata }).catch(uploadRefused(courseId));
    // Moodle answers with the page to go to: the new content's, or the bank's with an error code.
    const returnUrl = answer.submitted && answer.data ? ((JSON.parse(answer.data) as { returnurl?: string } | null)?.returnurl ?? "") : "";
    const next = returnUrl ? new URL(returnUrl) : undefined;
    const refused = next?.searchParams.get("errormsg");
    if (refused || !next?.pathname.endsWith("/contentbank/view.php")) {
      throw new ContentBankError(`Moodle didn't take "${path.basename(file)}" into course ${courseId}'s content bank${refused ? ` (its error code: ${refused})` : ""}: check it's a valid package.`);
    }
    contentId = Number(next.searchParams.get("id"));
  } finally {
    await page.close().catch(() => undefined);
  }
  const content = (await contentBank(context, siteUrl, courseId)).find((c) => c.id === contentId);
  if (!content) throw new ContentBankError(`Content ${contentId} was uploaded, but it doesn't appear in course ${courseId}'s content bank.`);
  return { changed: `Uploaded "${path.basename(file)}" to course ${courseId}'s content bank as content ${contentId}.`, content };
}

/** The warnings the content bank's services answer with, instead of failing. */
interface BankAnswer {
  result: boolean;
  warnings?: { item?: number; warningcode: string; message: string }[];
}

/** A service's warnings as the error a program can act on. */
function bankRefusal(contentId: number, what: string, capabilities: Record<string, string>, answer: BankAnswer): ContentBankError | MoodleError {
  const warning = answer.warnings?.[0];
  if (warning?.warningcode === "exception") return new ContentBankError(`There's no content ${contentId} you can ${what} (Moodle says: ${warning.message}): take its id from contentBank.`);
  if (warning?.warningcode === "emptynamenotallowed") return new MoodleError("A content needs a name.", "invalid-input");
  const hint = warning ? capabilities[warning.warningcode] : undefined;
  return new ContentBankError(`Moodle didn't ${what} content ${contentId}${warning ? ` (Moodle says: ${warning.message})` : ""}${hint ? `: ${hint}` : ""}.`);
}

/**
 * Renames a content of a content bank, as its page's "Rename" does (`core_contentbank_rename_content`);
 * the file keeps its name. Throws `ContentBankError` when there's no such content, or the person can't
 * manage it (moodle/contentbank:manageowncontent for their own, manageanycontent for anyone's), and a
 * `MoodleError` (`invalid-input`) for an empty name.
 */
export async function renameContent(context: BrowserContext, siteUrl: string, contentId: number, name: string): Promise<{ changed: string; contentId: number; name: string }> {
  if (typeof name !== "string" || name.trim() === "") throw new MoodleError("A content needs a name.", "invalid-input");
  const answer = await callService<BankAnswer>(context, siteUrl, "core_contentbank_rename_content", { contentid: contentId, name });
  if (!answer.result) {
    throw bankRefusal(contentId, "rename", { nopermissiontomanage: "it takes Moodle's capability moodle/contentbank:manageowncontent for your own content, or moodle/contentbank:manageanycontent for anyone's" }, answer);
  }
  // Moodle stores the name as plain text (PARAM_TEXT): what the page shows afterwards.
  const stored = (await contentPage(context, siteUrl, contentId))?.name ?? name;
  return { changed: `Renamed content ${contentId} to "${stored}".`, contentId, name: stored };
}

/**
 * Deletes a content from its content bank, as its page's "Delete" does (`core_contentbank_delete_content`).
 * Moodle deletes it even when activities use it (`uses`), as its page does once it has warned.
 * Throws `ContentBankError` when there's no such content, or the person can't
 * delete it (moodle/contentbank:deleteowncontent for their own, deleteanycontent for anyone's).
 */
export async function deleteContent(context: BrowserContext, siteUrl: string, contentId: number): Promise<{ changed: string; contentId: number }> {
  const answer = await callService<BankAnswer>(context, siteUrl, "core_contentbank_delete_content", { contentids: [contentId] });
  if (!answer.result) {
    throw bankRefusal(contentId, "delete", { nopermissiontodelete: "it takes Moodle's capability moodle/contentbank:deleteowncontent for your own content, or moodle/contentbank:deleteanycontent for anyone's" }, answer);
  }
  return { changed: `Deleted content ${contentId} from its content bank.`, contentId };
}

/**
 * Saves a content's file (the `.h5p` package) into `destDir`, as its page's "Download" does, never
 * overwriting (`downloadFile`). Throws `ContentBankError` when there's no such content the person can
 * open, or they can't download it (moodle/contentbank:downloadcontent, which teachers have).
 */
export async function downloadContent(context: BrowserContext, siteUrl: string, contentId: number, destDir: string): Promise<DownloadedFile> {
  if (!path.isAbsolute(destDir)) throw new MoodleError(`Give the destination folder as an absolute path: "${destDir}".`, "invalid-input");
  const facts = await contentPage(context, siteUrl, contentId);
  if (!facts) throw new ContentBankError(`There's no content ${contentId} you can open: take its id from contentBank (opening a content bank takes Moodle's capability moodle/contentbank:access).`);
  if (!facts.downloadUrl) throw new ContentBankError(`You can't download content ${contentId}: it takes Moodle's capability moodle/contentbank:downloadcontent, which teachers have.`);
  return downloadFile(context, siteUrl, facts.downloadUrl, destDir);
}
