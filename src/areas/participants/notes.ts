// Notes about a course's participants, as Moodle's notes page lists them (notes/index.php, by course
// and optionally user), its form adds and edits them (notes/edit.php) and its confirmation deletes
// them (notes/delete.php). Moodle's notes services are not AJAX services except create_notes, which
// files a site note under the front page instead of the course (unlike the form), so the pages do it all.
import type { BrowserContext, Page } from "playwright-core";
import { FormError, openForm, setFields, submitForm } from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { sliceWindow, pageWindow, toPage, type ListPage, type PageOptions, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { languageFormats, parseMoodleDate, type DateFormat } from "../reports/dates.js";

/** Moodle refused to show or change a note: the capability it takes, or Moodle's reason. */
export class NoteError extends MoodleError {
  override name = "NoteError";
  constructor(message: string) {
    super(message, "note");
  }
}

/** The site has notes turned off (Site administration > Advanced features > Enable notes): nothing about notes works until an administrator turns them on. */
export class NotesDisabledError extends MoodleError {
  override name = "NotesDisabledError";
  constructor(message = "Notes are disabled on this site: an administrator turns them on in Site administration > Advanced features > Enable notes.") {
    super(message, "notes-disabled");
  }
}

/**
 * Who sees a note: `personal`, its author only; `course`, whoever can view the course's notes
 * (teachers); `site`, whoever can view notes in any course the participant is in.
 */
export type NoteContext = "personal" | "course" | "site";

/** A note about a participant, as the notes page shows it. */
export interface ParticipantNote {
  id: number;
  /** The course it was written in (a site note may come from another course). */
  courseId: number;
  /** The participant it's about. */
  userId: number;
  userName: string;
  /** Its content (HTML). */
  content: string;
  context: NoteContext;
  authorId: number;
  authorName: string;
  /** When it was written (ISO), when the page's date could be read. */
  created?: string;
  /** When it last changed (ISO), when the page's date could be read. */
  modified?: string;
  /** Whether the person may edit and delete it (its page shows the links). */
  editable: boolean;
}

/** Which notes `notes` reads: one participant's, and a page of them. */
export interface NoteOptions extends PageOptions {
  /** Only the notes about this participant. */
  userId?: number;
}

/** What a note says and who sees it, as `addNote` and `editNote` write it. */
export interface NoteFields {
  /** Its content (HTML). */
  content: string;
  context?: NoteContext;
}

/** What a write did, and the note it wrote. */
export interface NoteChange {
  changed: string;
  noteId: number;
  /** The note afterwards, as `notes` reads it (none after deleting it). */
  note?: ParticipantNote;
}

const VIEW = "moodle/notes:view";
const MANAGE = "moodle/notes:manage";
/** Moodle's publish states by the driver's names: a personal note is a "draft", a course note "public". */
const STATES: Record<NoteContext, string> = { personal: "draft", course: "public", site: "site" };

/** The error code of Moodle's error page (its "More information" link ends in error/<component>/<code>), or undefined. */
async function errorCode(page: Page): Promise<string | undefined> {
  const href = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a')?.getAttribute("href"));
  return href ? href.split("/").pop() : undefined;
}

/** Throws what an error page means, if the page is one: notes off, a missing capability, or Moodle's reason. */
async function failOnErrorPage(page: Page, what: string, capability: string): Promise<void> {
  const message = await moodleErrorMessage(page);
  if (message === undefined) return;
  const code = await errorCode(page);
  if (code === "notesdisabled") throw new NotesDisabledError();
  if (code === "nopermissions" || code === "nopermissiontodelete") throw new NoteError(`${what} (Moodle says: ${message}): it takes Moodle's capability ${capability}.`);
  throw new NoteError(`${what}: ${message}`);
}

/** A note as the page renders it (`div.notepost`, `id="note-<id>"`), before its dates are read. */
export interface NoteRow {
  id: number;
  courseId: number;
  userId: number;
  userName: string;
  content: string;
  state: string;
  authorId: number;
  authorName: string;
  /** The text after the author's name: the date it last changed, then the date it was written in brackets. */
  dates: string;
  editable: boolean;
}

/** The notes page's notes, in its order: site notes, course notes, then the person's personal notes, each the latest first. */
export function readNotesPage(page: Page): Promise<NoteRow[]> {
  return page.evaluate(() => {
    interface El {
      id: string;
      className: string;
      innerHTML: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const rows = [];
    for (const post of Array.from(doc.querySelectorAll('div.notepost[id^="note-"]'))) {
      const id = Number(post.id.slice("note-".length));
      // The participant: their picture links to their profile in the course (user/view.php?id=&course=).
      const user = post.querySelector(".header .user");
      const userHref = user?.querySelector('a[href*="/user/view.php"]')?.getAttribute("href") ?? "";
      const userId = Number(/[?&]id=(\d+)/.exec(userHref)?.[1] ?? 0);
      let userName = "";
      for (const node of Array.from((user as unknown as { childNodes: ArrayLike<{ nodeType: number; textContent: string | null }> } | null)?.childNodes ?? [])) {
        if (node.nodeType === 3) userName += node.textContent ?? "";
      }
      // The author: the link in the info line, to their profile in the note's course.
      const info = post.querySelector(".header .info");
      const author = info?.querySelector('a[href*="/user/view.php"]');
      const authorHref = author?.getAttribute("href") ?? "";
      const infoText = (info?.textContent ?? "").replace(/\s+/g, " ");
      const authorName = (author?.textContent ?? "").replace(/\s+/g, " ").trim();
      const at = authorName ? infoText.indexOf(authorName) : -1;
      const body = post.querySelector(".content");
      const content = (body?.querySelector(".no-overflow") ?? body)?.innerHTML.trim() ?? "";
      const state = /\b(draft|public|site)notepost\b/.exec(post.className)?.[1] ?? "";
      rows.push({
        id,
        courseId: Number(/[?&]course=(\d+)/.exec(authorHref || userHref)?.[1] ?? 0),
        userId,
        userName: userName.replace(/\s+/g, " ").trim(),
        content,
        state,
        authorId: Number(/[?&]id=(\d+)/.exec(authorHref)?.[1] ?? 0),
        authorName,
        dates: at >= 0 ? infoText.slice(at + authorName.length) : infoText,
        editable: post.querySelector('.footer a[href*="/notes/edit.php"]') !== null,
      });
    }
    return rows;
  });
}

/** The first date in `text` Moodle wrote with `format`, read from each word on; undefined when none. */
export function findDate(text: string, format: DateFormat): Date | undefined {
  for (let i = 0; i < text.length; i++) {
    if (i > 0 && !/[\s(]/.test(text[i - 1]!)) continue;
    const date = parseMoodleDate(text.slice(i), format);
    if (date) return date;
  }
  return undefined;
}

/** A row as the driver returns it: Moodle's publish state by its name, its dates as instants. */
export function toNote(row: NoteRow, format: DateFormat): ParticipantNote {
  const context = (Object.keys(STATES) as NoteContext[]).find((name) => STATES[name] === row.state) ?? "course";
  // "by <author> - <modified> (Created: <created>)": the date written is in the last brackets.
  const bracket = row.dates.lastIndexOf("(");
  const modified = findDate(bracket >= 0 ? row.dates.slice(0, bracket) : row.dates, format);
  const created = bracket >= 0 ? findDate(row.dates.slice(bracket + 1), format) : undefined;
  return {
    id: row.id,
    courseId: row.courseId,
    userId: row.userId,
    userName: row.userName,
    content: row.content,
    context,
    authorId: row.authorId,
    authorName: row.authorName,
    ...(created ? { created: created.toISOString() } : {}),
    ...(modified ? { modified: modified.toISOString() } : {}),
    editable: row.editable,
  };
}

/** Every note the notes page shows the person for the course (and the participant). */
async function readNotes(context: BrowserContext, siteUrl: string, courseId: number, userId?: number): Promise<ParticipantNote[]> {
  const page = await openSitePage(context, siteUrl, `notes/index.php?course=${courseId}${userId ? `&user=${userId}` : ""}`);
  try {
    const what = `You can't view the notes of course ${courseId}`;
    await failOnErrorPage(page, what, VIEW);
    if ((await page.locator("body#page-notes-index").count()) === 0) throw new NoteError(`${what}: Moodle didn't show its notes page (is the person in the course?).`);
    const rows = await readNotesPage(page);
    if (rows.length === 0) return [];
    const [strings, timeZone] = await Promise.all([
      languageFormats(context, siteUrl, ["strftimedaydatetime"]),
      page.evaluate(() => (globalThis as unknown as { M: { cfg: { usertimezone?: string } } }).M.cfg.usertimezone ?? "UTC"),
    ]);
    const format = { format: strings.formats.strftimedaydatetime ?? "%A, %d %B %Y, %I:%M %p", locale: strings.locale, timeZone };
    return rows.map((row) => toNote(row, format));
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * The notes about a course's participants, as its notes page shows them: site notes (written in any
 * course), course notes, then the person's own personal notes (nobody else sees those), each the
 * latest first; only the notes about one participant with `userId`. Each one's participant, content,
 * context, author and dates. Paged with `limit` and `offset` (read whole, Moodle's page doesn't page).
 * Throws `NoteError` naming the capability when the person can't view the course's notes
 * (moodle/notes:view, which teachers have), `NotesDisabledError` on a site with notes off.
 */
export function notes(context: BrowserContext, siteUrl: string, courseId: number, options: WithLimit<NoteOptions>): Promise<ListPage<ParticipantNote>>;
export function notes(context: BrowserContext, siteUrl: string, courseId: number, options?: WithoutLimit<NoteOptions>): Promise<ParticipantNote[]>;
export function notes(context: BrowserContext, siteUrl: string, courseId: number, options?: NoteOptions): Promise<ParticipantNote[] | ListPage<ParticipantNote>>;
export async function notes(context: BrowserContext, siteUrl: string, courseId: number, options: NoteOptions = {}): Promise<ParticipantNote[] | ListPage<ParticipantNote>> {
  const window = pageWindow(options);
  return toPage(sliceWindow(await readNotes(context, siteUrl, courseId, options.userId), window), options.limit);
}

function noteValues({ content, context }: Partial<NoteFields>): Record<string, string> {
  const values: Record<string, string> = {};
  if (content !== undefined) {
    if (typeof content !== "string" || content.trim() === "") throw new MoodleError("Give the note its content.", "invalid-input");
    values["content_editor[text]"] = content;
  }
  if (context !== undefined) {
    if (!(context in STATES)) throw new MoodleError(`A note's context is personal, course or site, not "${String(context)}".`, "invalid-input");
    values.publishstate = STATES[context];
  }
  return values;
}

/** Fills and saves the note form, with Moodle's reason when it refuses. */
async function saveNoteForm(page: Page, values: Record<string, string>, what: string): Promise<void> {
  const editor = "content_editor[text]";
  // Moodle 4.5's form has a plain textarea, `content`, where 5.x has an editor (its HTML is kept either way).
  if (values[editor] !== undefined && (await page.locator(`form.mform [name="${editor}"]`).count()) === 0 && (await page.locator('form.mform textarea[name="content"]').count()) > 0) {
    const { [editor]: content, ...rest } = values;
    values = { ...rest, content: content! };
  }
  try {
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } catch (error) {
    if (error instanceof FormError) throw new NoteError(`${what}: Moodle refused the note: ${error.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}.`);
    throw error;
  }
  await failOnErrorPage(page, what, MANAGE);
}

/** Opens the note form, or throws what Moodle's error page says. */
async function openNoteForm(context: BrowserContext, siteUrl: string, pathAndQuery: string, what: string): Promise<Page> {
  try {
    return await openForm(context, siteUrl, pathAndQuery);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const page = await openSitePage(context, siteUrl, pathAndQuery);
    try {
      await failOnErrorPage(page, what, MANAGE);
      throw new NoteError(`${what}: Moodle didn't show the note form.`);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

/**
 * Writes a note about a participant of the course, through the notes page's form: its content
 * (HTML) and who sees it (`course` unless given; `personal` for the author only, `site` for every
 * course the participant is in). Returns its id and the note. Throws `NoteError` naming the capability
 * when the person can't (moodle/notes:manage, which teachers have) or with Moodle's reason (no such
 * participant), `NotesDisabledError` on a site with notes off.
 */
export async function addNote(context: BrowserContext, siteUrl: string, courseId: number, userId: number, fields: NoteFields): Promise<NoteChange> {
  if (fields?.content === undefined) throw new MoodleError("Give the note its content.", "invalid-input");
  const values = noteValues({ context: "course", ...fields });
  const what = `You can't write a note about user ${userId} in course ${courseId}`;
  // The form first: it says when the person can't write notes, before the list's own refusal.
  const page = await openNoteForm(context, siteUrl, `notes/edit.php?courseid=${courseId}&userid=${userId}`, what);
  let before: Set<number>;
  try {
    before = new Set((await readNotes(context, siteUrl, courseId, userId)).map((n) => n.id));
    await saveNoteForm(page, values, what);
  } finally {
    await page.close().catch(() => undefined);
  }
  const added = (await readNotes(context, siteUrl, courseId, userId)).filter((n) => !before.has(n.id)).sort((a, b) => b.id - a.id)[0];
  if (!added) throw new NoteError(`${what}: the note isn't on the notes page after saving it.`);
  return { changed: `Note ${added.id} (${values.publishstate === "draft" ? "personal" : added.context}) written about user ${userId} in course ${courseId}.`, noteId: added.id, note: added };
}

/**
 * Changes a note's content and, with `context`, who sees it, through its edit form. Moodle lets the
 * person edit course notes and their own personal notes in a course where they can manage notes, and
 * site notes with that capability on the whole site. Returns the note afterwards. Throws `NoteError`
 * naming the capability when the person can't, or when there's no such note; `NotesDisabledError` on
 * a site with notes off.
 */
export async function editNote(context: BrowserContext, siteUrl: string, noteId: number, fields: Partial<NoteFields>): Promise<NoteChange> {
  const values = noteValues(fields ?? {});
  if (Object.keys(values).length === 0) throw new MoodleError("Give the note's content or context to change.", "invalid-input");
  const what = `You can't edit note ${noteId}`;
  const page = await openNoteForm(context, siteUrl, `notes/edit.php?id=${noteId}`, what);
  let courseId: number;
  let userId: number;
  try {
    [courseId, userId] = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document;
      return [Number(doc.querySelector('form.mform input[name="courseid"]')?.value ?? 0), Number(doc.querySelector('form.mform input[name="userid"]')?.value ?? 0)];
    });
    await saveNoteForm(page, values, what);
  } finally {
    await page.close().catch(() => undefined);
  }
  const note = courseId ? (await readNotes(context, siteUrl, courseId, userId)).find((n) => n.id === noteId) : undefined;
  const done = [fields.content !== undefined && "content changed", fields.context !== undefined && `context ${fields.context}`].filter(Boolean);
  return { changed: `Note ${noteId}: ${done.join(", ")}.`, noteId, ...(note ? { note } : {}) };
}

/**
 * Deletes a note, as its delete link does after Moodle's confirmation. Throws `NoteError` naming the
 * capability when the person can't (moodle/notes:manage in the note's course), or when there's no
 * such note; `NotesDisabledError` on a site with notes off.
 */
export async function deleteNote(context: BrowserContext, siteUrl: string, noteId: number): Promise<NoteChange> {
  const what = `You can't delete note ${noteId}`;
  const page = await openSitePage(context, siteUrl, `notes/delete.php?id=${noteId}`);
  try {
    await failOnErrorPage(page, what, MANAGE);
    // The confirmation's "Continue" posts the note's id with the sesskey; "Cancel" goes back to the list.
    const confirm = page.locator(`form:has(input[name="sesskey"]):has(input[name="id"][value="${noteId}"]) [type="submit"]`);
    if ((await confirm.count()) === 0) throw new NoteError(`${what}: Moodle didn't ask to confirm it.`);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click({ noWaitAfter: true })]);
    await failOnErrorPage(page, what, MANAGE);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Deleted note ${noteId}.`, noteId };
}
