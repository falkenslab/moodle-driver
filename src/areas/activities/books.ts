// A book's chapters, read and written as a teacher does in the book itself: its table of contents
// (the fake block of mod/book's pages), the chapter form (mod/book/edit.php) and the table of
// contents' move, show/hide and delete links (move.php, show.php, delete.php). No service lists or
// writes chapters (`mod_book` has only view_book and get_books_by_courses, confirmed on 5.2).
import type { BrowserContext, Page } from "playwright-core";
import { checkEmbeds, embedFiles } from "../../core/embed.js";
import { formValue, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { readImages, type ImageItem } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

/** The activity isn't a book the person can read or edit, or the chapter isn't in it. */
export class BookError extends MoodleError {
  override name = "BookError";
  constructor(message: string) {
    super(message, "book");
  }
}

/** One chapter of a book, in the book's order. */
export interface BookChapter {
  id: number;
  title: string;
  /** A subchapter of the chapter before it. */
  subchapter: boolean;
  /** Hidden from students (a chapter's subchapters are hidden with it); students' lists leave hidden chapters out. */
  hidden: boolean;
  /** Its place in the book, from 1, subchapters counted. */
  position: number;
  /** With `content`, the chapter's HTML as the book shows it (its images' URLs on the site). */
  content?: string;
  /** With `content`, the images in the chapter, when it has any: their URLs download with `downloadFile`. */
  images?: ImageItem[];
}

/** What a change to a book's chapters did, the chapter's id, and the book's chapters afterwards. */
export interface BookChapterChange {
  changed: string;
  chapterId: number;
  chapters: BookChapter[];
}

/** A chapter as the table of contents lists it: its id is unknown on the chapter the page shows. */
interface TocEntry {
  id?: number;
  title: string;
  subchapter: boolean;
  hidden: boolean;
}

/**
 * The chapters in the table of contents of a book's page (`.block_book_toc`), in order. Its links
 * name each chapter (`view.php?…&chapterid=`) but the one the page shows, in bold; a subchapter is a
 * list item inside a chapter's; a hidden chapter is dimmed (`dimmed_text`); with the book numbered,
 * Moodle puts the number before each title ("1.1. ", "x. "), which is taken off.
 */
export function readToc(page: Page): Promise<TocEntry[]> {
  return inPage(
    page,
    () => {
      interface El {
        tagName: string;
        textContent: string | null;
        children: ArrayLike<El>;
        classList: { contains(c: string): boolean };
        parentElement: El | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        closest(s: string): El | null;
        contains(other: El): boolean;
      }
      const toc = (globalThis as unknown as { document: El }).document.querySelector(".block_book_toc .book_toc");
      if (!toc) return [];
      const numbered = toc.classList.contains("book_toc_numbered");
      const entries: TocEntry[] = [];
      for (const item of Array.from(toc.querySelectorAll("li"))) {
        // The item's own entry, not its subchapters': a link or the bold current chapter, directly in it or in its row (editing mode).
        const own = Array.from(item.children).flatMap((child) => (child.tagName === "DIV" ? Array.from(child.children) : [child]));
        const entry = own.find((el) => el.tagName === "STRONG" || (el.tagName === "A" && /[?&]chapterid=\d+/.test(el.getAttribute("href") ?? "")));
        if (!entry) continue;
        const id = /[?&]chapterid=(\d+)/.exec(entry.tagName === "A" ? (entry.getAttribute("href") ?? "") : "")?.[1];
        let title = (entry.textContent ?? "").replace(/\s+/g, " ").trim();
        if (numbered) title = title.replace(/^(?:(?:\d+|x)\.){1,2}\s+/, "");
        const hidden = entry.classList.contains("dimmed_text") || entry.querySelector(".dimmed_text") !== null;
        const parent = item.parentElement?.closest("li");
        entries.push({ ...(id ? { id: Number(id) } : {}), title, subchapter: Boolean(parent && toc.contains(parent)), hidden });
      }
      return entries;
    },
    null,
  );
}

/** The chapter id in the "Print this chapter" link of a book's page: the chapter it shows. */
function shownChapterId(page: Page): Promise<number | undefined> {
  return page.evaluate(() => {
    const links = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null }> } }).document.querySelectorAll(
      'a[href*="tool/print/index.php"][href*="chapterid="]',
    );
    const id = /[?&]chapterid=(\d+)/.exec(Array.from(links)[0]?.getAttribute("href") ?? "")?.[1];
    return id ? Number(id) : undefined;
  });
}

const isEditPage = async (page: Page) => (await page.locator("body#page-mod-book-edit form.mform").count()) > 0;

/**
 * The book's chapters, read where the person can: an editor in the chapter form's page (which shows
 * no chapter, so its table of contents links every one, hidden ones too), anyone else in the book's
 * own page, where hidden chapters are left out unless they may see them.
 */
async function readChapters(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ chapters: BookChapter[]; editor: boolean }> {
  const edit = await openSitePage(context, siteUrl, `mod/book/edit.php?cmid=${activityId}`);
  try {
    if (await isEditPage(edit)) return { chapters: numbered(await readToc(edit), activityId), editor: true };
  } finally {
    await edit.close().catch(() => undefined);
  }
  const view = await openSitePage(context, siteUrl, `mod/book/view.php?id=${activityId}`);
  try {
    if ((await view.locator("body#page-mod-book-view").count()) === 0) {
      throw new BookError(`Activity ${activityId} isn't a book you can read: ${(await moodleErrorMessage(view)) ?? "take its id and module from the course structure"}.`);
    }
    const entries = await readToc(view);
    const unknown = entries.findIndex((entry) => entry.id === undefined);
    if (unknown >= 0) {
      const shown = await shownChapterId(view);
      if (shown !== undefined) entries[unknown]!.id = shown;
      else {
        // No print link: another chapter's page links the one shown here.
        const other = entries.find((entry) => entry.id !== undefined);
        if (other) {
          await view.goto(new URL(`mod/book/view.php?id=${activityId}&chapterid=${other.id}`, siteUrl).href, { waitUntil: "domcontentloaded" });
          entries[unknown]!.id = (await readToc(view))[unknown]?.id;
        }
      }
    }
    return { chapters: numbered(entries, activityId), editor: false };
  } finally {
    await view.close().catch(() => undefined);
  }
}

function numbered(entries: TocEntry[], activityId: number): BookChapter[] {
  return entries.map((entry, i) => {
    if (entry.id === undefined) throw new BookError(`Book ${activityId}'s page doesn't say which chapter "${entry.title}" is.`);
    return { id: entry.id, title: entry.title, subchapter: entry.subchapter, hidden: entry.hidden, position: i + 1 };
  });
}

/** Reads each chapter's HTML and images from its page in the book (`view.php?…&chapterid=`). */
async function readContents(context: BrowserContext, siteUrl: string, activityId: number, chapters: BookChapter[]): Promise<void> {
  const page = await openSitePage(context, siteUrl, `mod/book/view.php?id=${activityId}`);
  try {
    for (const chapter of chapters) {
      await page.goto(new URL(`mod/book/view.php?id=${activityId}&chapterid=${chapter.id}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      // The chapter's text is format_text's no-overflow div, after the titles Moodle puts above it (confirmed empirically, 5.2).
      const body = page.locator("#mod_book-chapter > .no-overflow").first();
      chapter.content = (await body.count()) > 0 ? (await body.innerHTML()).trim() : "";
      const images = (await readImages(page, "#mod_book-chapter > .no-overflow"))[0] ?? [];
      if (images.length > 0) chapter.images = images;
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * A book's chapters in order: each one's id, title, whether it is a subchapter or hidden, and its
 * place; with `content`, its HTML and images too, each chapter's page read (Moodle logs a view of it).
 * A teacher sees hidden chapters; a student's list leaves them out. Throws `BookError` when the
 * activity isn't a book the person can read.
 */
export async function bookChapters(context: BrowserContext, siteUrl: string, activityId: number, { content = false }: { content?: boolean } = {}): Promise<BookChapter[]> {
  const { chapters } = await readChapters(context, siteUrl, activityId);
  if (content) await readContents(context, siteUrl, activityId, chapters);
  return chapters;
}

/** The book's chapters for a change, refused when the person can't edit the book. */
async function chaptersToEdit(context: BrowserContext, siteUrl: string, activityId: number): Promise<BookChapter[]> {
  const { chapters, editor } = await readChapters(context, siteUrl, activityId);
  if (!editor) throw new BookError(`You can't edit book ${activityId}'s chapters: editing them takes a teacher's role in the course.`);
  return chapters;
}

function chapterIn(chapters: BookChapter[], activityId: number, chapterId: number): BookChapter {
  const chapter = chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new BookError(`Book ${activityId} has no chapter ${chapterId}; it has ${chapters.map((c) => c.id).join(", ") || "none"}. Take the id from bookChapters.`);
  return chapter;
}

async function afterChange(context: BrowserContext, siteUrl: string, activityId: number, changed: string, chapterId: number): Promise<BookChapterChange> {
  return { changed, chapterId, chapters: (await readChapters(context, siteUrl, activityId)).chapters };
}

/**
 * Fills and saves the chapter form open in `page`: title, content (with `embed`'s files uploaded to
 * its editor) and whether it is a subchapter. The first chapter can't be one: Moodle freezes the
 * field there. Gives the chapter's id, from the book's page Moodle goes to after saving.
 */
async function saveChapterForm(page: Page, input: { title?: string; content?: string; subchapter?: boolean; embed?: string[] }): Promise<number | undefined> {
  const values: Record<string, FieldValue> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.content !== undefined) values["content_editor[text]"] = input.content;
  if (input.subchapter !== undefined) {
    const frozen = await page.locator('form.mform input[type="checkbox"][name="subchapter"]').first().isDisabled().catch(() => true);
    if (frozen && input.subchapter) throw new BookError("The book's first chapter can't be a subchapter.");
    if (!frozen) values.subchapter = input.subchapter;
  }
  if (input.embed) await embedFiles(page, values, input.embed);
  await setFields(page, values);
  await submitForm(page, "submitbutton");
  const id = new URL(page.url()).searchParams.get("chapterid");
  return id ? Number(id) : undefined;
}

/** Opens a chapter form of a book the person edits. */
async function openChapterForm(context: BrowserContext, siteUrl: string, activityId: number, query: string): Promise<Page> {
  const page = await openForm(context, siteUrl, `mod/book/edit.php?cmid=${activityId}&${query}`);
  if ((await formValue(page, "cmid")) !== String(activityId)) {
    await page.close().catch(() => undefined);
    throw new BookError(`Activity ${activityId} isn't a book you can edit.`);
  }
  return page;
}

/** Follows one of the table of contents' action links (move, show/hide, delete) with the person's sesskey. */
async function chapterAction(context: BrowserContext, siteUrl: string, activityId: number, action: string, params: Record<string, string>): Promise<void> {
  const page = await openSitePage(context, siteUrl, `mod/book/view.php?id=${activityId}`);
  try {
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { sesskey?: string } } }).M?.cfg?.sesskey);
    if (!sesskey) throw new MoodleError("The book's page has no session key: log in again.", "unexpected-page");
    const query = new URLSearchParams({ id: String(activityId), ...params, sesskey });
    await page.goto(new URL(`mod/book/${action}.php?${query}`, siteUrl).href, { waitUntil: "domcontentloaded" });
    const refused = await moodleErrorMessage(page);
    if (refused) throw new BookError(`Moodle refused the change to book ${activityId}: ${refused}`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Shows or hides a chapter by the table of contents' toggle (show.php), only when it isn't already so. */
async function setHidden(context: BrowserContext, siteUrl: string, activityId: number, chapter: BookChapter, hidden: boolean): Promise<boolean> {
  if (chapter.hidden === hidden) return false;
  await chapterAction(context, siteUrl, activityId, "show", { chapterid: String(chapter.id) });
  return true;
}

/** A new chapter's fields. */
export interface BookChapterInput {
  title: string;
  /** Its content (HTML); Moodle requires some. */
  content: string;
  /** A subchapter of the chapter before it (not for the first). */
  subchapter?: boolean;
  /** Hidden from students; shown by default, as Moodle adds it. */
  hidden?: boolean;
  /** The chapter it goes after; at the end of the book without it. */
  afterChapterId?: number;
  /** Local files (absolute paths) to embed in the content, which names each by its file name (`<img src="shot.png">`). */
  embed?: string[];
}

/**
 * Adds a chapter to a book through Moodle's chapter form, at the end or after another chapter, as a
 * subchapter when asked, hidden when asked, with `embed`'s local files in its content. Gives the new
 * chapter's id and the chapters afterwards. Throws `BookError` when the person can't edit the book
 * or `afterChapterId` isn't in it.
 */
export async function addBookChapter(context: BrowserContext, siteUrl: string, activityId: number, input: BookChapterInput): Promise<BookChapterChange> {
  if (input.embed) await checkEmbeds([input.content], input.embed);
  const chapters = await chaptersToEdit(context, siteUrl, activityId);
  // Moodle's form adds after the chapter at `pagenum`: 0 is before every chapter.
  const after = input.afterChapterId === undefined ? chapters.length : chapterIn(chapters, activityId, input.afterChapterId).position;
  if (input.subchapter && after === 0) throw new BookError("The book's first chapter can't be a subchapter.");
  const page = await openChapterForm(context, siteUrl, activityId, `pagenum=${after}&subchapter=${input.subchapter ? 1 : 0}`);
  let id: number | undefined;
  try {
    id = await saveChapterForm(page, { title: input.title, content: input.content, subchapter: input.subchapter ?? false, embed: input.embed });
  } finally {
    await page.close().catch(() => undefined);
  }
  let added = (await readChapters(context, siteUrl, activityId)).chapters;
  id ??= added.find((c) => !chapters.some((old) => old.id === c.id))?.id;
  if (id === undefined) throw new BookError(`The chapter form was saved, but no new chapter appears in book ${activityId}.`);
  const chapter = chapterIn(added, activityId, id);
  if (input.hidden && (await setHidden(context, siteUrl, activityId, chapter, true))) added = (await readChapters(context, siteUrl, activityId)).chapters;
  const where = input.afterChapterId === undefined ? "at the end" : `after chapter ${input.afterChapterId}`;
  return { changed: `Added ${input.subchapter ? "subchapter" : "chapter"} ${id} "${input.title}" to book ${activityId} ${where}${input.hidden ? ", hidden" : ""}.`, chapterId: id, chapters: added };
}

/**
 * Changes a chapter's title, content (with `embed`'s local files in it) or whether it is a
 * subchapter, through its form: only what's given changes. Throws `BookError` when the chapter isn't
 * in the book, or the person can't edit it.
 */
export async function editBookChapter(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  chapterId: number,
  input: { title?: string; content?: string; subchapter?: boolean; embed?: string[] },
): Promise<BookChapterChange> {
  if (input.embed) await checkEmbeds([input.content], input.embed);
  const chapter = chapterIn(await chaptersToEdit(context, siteUrl, activityId), activityId, chapterId);
  const done: string[] = [];
  if (input.title !== undefined) done.push(`renamed to "${input.title}"`);
  if (input.content !== undefined) done.push("content set");
  if (input.subchapter !== undefined && input.subchapter !== chapter.subchapter) done.push(input.subchapter ? "made a subchapter" : "made a chapter");
  if (done.length === 0) return afterChange(context, siteUrl, activityId, "Nothing to change.", chapterId);
  const page = await openChapterForm(context, siteUrl, activityId, `id=${chapterId}`);
  try {
    await saveChapterForm(page, input);
  } finally {
    await page.close().catch(() => undefined);
  }
  return afterChange(context, siteUrl, activityId, `Chapter ${chapterId} of book ${activityId} ${done.join(", ")}.`, chapterId);
}

/**
 * Moves a chapter one place up or down, as the table of contents' arrows do: a chapter moves with its
 * subchapters, past the whole chapter before or after it; a subchapter moves alone, past one chapter
 * or subchapter. Moodle may make a subchapter that ends up first a chapter. Throws `BookError` when
 * the chapter isn't in the book.
 */
export async function moveBookChapter(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number, { direction }: { direction: "up" | "down" }): Promise<BookChapterChange> {
  if (direction !== "up" && direction !== "down") throw new MoodleError(`direction is "up" or "down", not "${String(direction)}".`, "invalid-input");
  const chapters = await chaptersToEdit(context, siteUrl, activityId);
  const chapter = chapterIn(chapters, activityId, chapterId);
  // Moodle moves nothing past the ends; the block a chapter moves with is itself and its subchapters.
  let end = chapter.position;
  if (!chapter.subchapter) while (chapters[end]?.subchapter) end++;
  if ((direction === "up" && chapter.position === 1) || (direction === "down" && end === chapters.length)) {
    return { changed: `Chapter ${chapterId} is already ${direction === "up" ? "first" : "last"} in book ${activityId}; nothing moved.`, chapterId, chapters };
  }
  await chapterAction(context, siteUrl, activityId, "move", { chapterid: String(chapterId), up: direction === "up" ? "1" : "0" });
  return afterChange(context, siteUrl, activityId, `Chapter ${chapterId} of book ${activityId} moved ${direction}.`, chapterId);
}

/**
 * Shows a chapter to students or hides it from them, as the table of contents' eye does: a chapter's
 * subchapters are shown or hidden with it, and a subchapter of a hidden chapter stays hidden. Throws
 * `BookError` when the chapter isn't in the book.
 */
export async function setBookChapterVisible(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number, { visible }: { visible: boolean }): Promise<BookChapterChange> {
  const chapter = chapterIn(await chaptersToEdit(context, siteUrl, activityId), activityId, chapterId);
  const changed = await setHidden(context, siteUrl, activityId, chapter, !visible);
  return afterChange(context, siteUrl, activityId, changed ? `Chapter ${chapterId} of book ${activityId} ${visible ? "shown" : "hidden"}.` : `Chapter ${chapterId} is already ${visible ? "shown" : "hidden"}.`, chapterId);
}

/**
 * Deletes a chapter, with its files, as the table of contents' delete does; deleting a chapter (not
 * a subchapter) deletes its subchapters too. Throws `BookError` when the chapter isn't in the book.
 */
export async function deleteBookChapter(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number): Promise<BookChapterChange> {
  const chapters = await chaptersToEdit(context, siteUrl, activityId);
  const chapter = chapterIn(chapters, activityId, chapterId);
  const subchapters: number[] = [];
  if (!chapter.subchapter) for (let i = chapter.position; chapters[i]?.subchapter; i++) subchapters.push(chapters[i]!.id);
  await chapterAction(context, siteUrl, activityId, "delete", { chapterid: String(chapterId), confirm: "1" });
  const also = subchapters.length > 0 ? `, with its subchapters ${subchapters.join(", ")}` : "";
  return afterChange(context, siteUrl, activityId, `Chapter ${chapterId} "${chapter.title}" deleted from book ${activityId}${also}.`, chapterId);
}
