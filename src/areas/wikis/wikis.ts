// A wiki's pages, read and written as the person does in the wiki itself. mod_wiki's services
// (get_subwikis, get_subwiki_pages, get_page_contents, new_page, edit_page…) are the mobile app's
// only: none is open to AJAX (servicenotavailable, confirmed empirically on 4.5 and 5.2). So the
// pages are read from the wiki's pages: the page list (map.php, option 5), each page's links
// (map.php, option 2), its view (view.php) and history (history.php); and written as a person does:
// the new page form (create.php) and the editor (edit.php), whose lock is Moodle's own.
//
// Moodle keeps the last wiki page a person opened in their session: when it was an editor, the next
// wiki page they open releases that page's lock first, and fails ("Can't find data record") if that
// page has been deleted since (confirmed empirically, 4.5 and 5.2). So every editor the driver opens
// is left through the page's view (Moodle's own save and cancel go there too), whatever happens.
import type { BrowserContext, Page } from "playwright-core";
import { checkEmbeds, embedFiles } from "../../core/embed.js";
import { MoodleError } from "../../core/errors.js";
import { FormError, openForm, setFields, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { pageWindow, toPage, type ListPage, type PageOptions, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { readImages, readMedia, readTexts, type ImageItem, type MediaItem } from "../../core/text.js";
import { languageFormats, parseMoodleDate, type DateFormat } from "../reports/dates.js";

/** The activity isn't a wiki (`wiki`) activity the person can open, or there's no activity with that id. */
export class NotAWikiError extends MoodleError {
  override name = "NotAWikiError";
  constructor(message: string) {
    super(message, "not-a-wiki");
  }
}

/** Moodle refused something in a wiki: the person lacks the capability, the page isn't in it, or the section isn't in the page. */
export class WikiError extends MoodleError {
  override name = "WikiError";
  constructor(message: string) {
    super(message, "wiki");
  }
}

/**
 * Someone else has the page open in Moodle's editor, which locks it: Moodle doesn't let anyone else
 * save it meanwhile (only who can override locks may break it, and the driver never does). The lock
 * ends when they save or leave, or 30 seconds after their editor closes: try again later.
 */
export class WikiPageLockedError extends MoodleError {
  override name = "WikiPageLockedError";
  constructor(message: string) {
    super(message, "wiki-page-locked");
  }
}

/** A link from a wiki page to another page of its wiki, by the other page's title. */
export interface WikiLink {
  title: string;
  /** The linked page's id; left out when the page doesn't exist yet (Moodle shows the link as a new page to create). */
  pageId?: number;
}

/** One version of a wiki page, as its history lists it: each save is a new version. */
export interface WikiVersion {
  version: number;
  /** When it was saved, to the minute (as the history shows it). */
  modified?: string;
  authorId: number;
  authorName: string;
}

/** A page of a wiki, as `wikiPages` lists them. */
export interface WikiPageSummary {
  id: number;
  title: string;
  /** The pages it links to, as Moodle's map of links shows them. */
  links: WikiLink[];
  /** Its latest version's number: 0 for a page created but never saved. */
  version: number;
  /** Its latest version's date, author and author's id: left out for a page never saved. */
  modified?: string;
  authorId?: number;
  authorName?: string;
}

/** A wiki page with its content, as `wikiPage` reads it. */
export interface WikiPage extends WikiPageSummary {
  /** The subwiki it is in (the wiki's own, a group's or a participant's). */
  subwikiId?: number;
  /** Its content as Moodle renders it, as HTML (its images' URLs on the site), without the table of contents and the "[edit]" links Moodle adds. */
  html: string;
  /** Its content as text: paragraphs, line breaks and list items kept. */
  text: string;
  /** Its sections, by the headings Moodle edits them by (`editWikiPage`'s `section`). */
  sections: string[];
  /** The images in its content: their URLs download with `downloadFile`. */
  images?: ImageItem[];
  /** Videos, audio and players in its content. */
  media?: MediaItem[];
  /** Every version, newest first (with `history`). */
  history?: WikiVersion[];
}

/** Which subwiki: the person's (their group's, or their own in an individual wiki) unless given. */
export interface WikiSubwikiOptions {
  /** A group's subwiki, in a wiki with groups. */
  groupId?: number;
  /** A participant's subwiki, in an individual wiki. */
  userId?: number;
}

/** What `wikiPages` takes: which subwiki, and a page of its pages. */
export interface WikiPagesOptions extends WikiSubwikiOptions, PageOptions {}

/** What `wikiPage` takes. */
export interface WikiPageOptions {
  /** Its versions too (one more page read). */
  history?: boolean;
}

/** A new page of a wiki. */
export interface WikiPageInput extends WikiSubwikiOptions {
  title: string;
  /** Its content: HTML in a wiki of HTML pages (Moodle's default), the wiki's markup in a Creole or NWiki one. `[[Title]]` links to another page. */
  content: string;
  /** Local files (absolute paths) to embed in the content, which names each by its file name (`<img src="shot.png">`); HTML pages only. */
  embed?: string[];
}

/** A change to a wiki page's content. */
export interface WikiPageChanges {
  /** The new content (of the section, with `section`): replaces what was there. */
  content: string;
  /** Only this section of the page (a heading of it, as `sections` lists them), the content replacing that section. */
  section?: string;
  /** Local files (absolute paths) to embed in the content, which names each by its file name (`<img src="shot.png">`); HTML pages only. */
  embed?: string[];
}

/** What a change to a wiki did, the page's id and the page afterwards. */
export interface WikiPageChange {
  changed: string;
  pageId: number;
  page: WikiPage;
}

/** The error code an error page names in its "More information" link (`…/error/wiki/incorrectpageid`). */
async function errorCode(page: Page): Promise<string | undefined> {
  const href = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a')?.getAttribute("href"));
  return href ? href.split("/").pop() : undefined;
}

// What Moodle's refusals mean for a program, by their error code (mod/wiki, 4.5 and 5.2).
const HINTS: Record<string, string> = {
  cannotviewpage: "viewing a wiki's pages takes Moodle's capability mod/wiki:viewpage, and only its members see a group's or a participant's subwiki",
  nocontent: "the subwiki has no pages yet, and it isn't yours to start",
  noviewpagepermission: "viewing a wiki's pages takes Moodle's capability mod/wiki:viewpage",
  cannoteditpage: "editing a wiki's pages takes Moodle's capability mod/wiki:editpage, in a subwiki that is yours (your group's, or your own in an individual wiki)",
  noeditpermission: "editing a wiki's pages takes Moodle's capability mod/wiki:editpage",
  nocreatepermission: "creating wiki pages takes Moodle's capability mod/wiki:createpage",
  incorrectpageid: "there's no wiki page with that id: take its id from wikiPages",
  invalidsection: "the page has no section of that title: take it from the page's sections (wikiPage)",
  savingerror: "Moodle couldn't save the page",
};

/**
 * Throws the error an error page means, if `page` is one: `NotAWikiError` when Moodle found no wiki
 * with that id (or the page isn't a wiki's), `WikiError` with Moodle's message and what it means
 * otherwise. `refused` says what was refused; `capability` explains a missing permission.
 */
async function failOnRefusal(page: Page, activityId: number, refused: string, capability = ""): Promise<void> {
  const message = await moodleErrorMessage(page);
  const code = message === undefined ? undefined : await errorCode(page);
  const bodyId = await page.evaluate(() => (globalThis as unknown as { document: { body: { id: string } } }).document.body.id);
  if (code === "invalidcoursemodule" || code === "incorrectwikiid" || (message === undefined && !bodyId.startsWith("page-mod-wiki-"))) {
    throw new NotAWikiError(`Activity ${activityId} isn't a wiki you can open${message ? ` (Moodle says: ${message})` : ""}: take its id and module from the course structure.`);
  }
  if (message === undefined) return;
  const hint = code === "nopermissions" ? capability : (HINTS[code ?? ""] ?? "");
  throw new WikiError(`${refused} (Moodle says: ${message})${hint ? `: ${hint}` : ""}.`);
}

/** The course module a wiki page belongs to, from its body class (`cmid-<id>`). */
async function pageModule(page: Page): Promise<number> {
  const classes = (await page.locator("body").getAttribute("class")) ?? "";
  return Number(/(?:^|\s)cmid-(\d+)(?:\s|$)/.exec(classes)?.[1] ?? 0);
}

/** Opens a page of the wiki (`mod/wiki/<path>`), failing as `failOnRefusal` says, and checks it belongs to `activityId`'s wiki. */
async function openWikiPage(context: BrowserContext, siteUrl: string, activityId: number, path: string, refused: string, capability = ""): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/wiki/${path}`);
  try {
    await failOnRefusal(page, activityId, refused, capability);
    if ((await pageModule(page)) !== activityId) throw new WikiError(`${refused}: it isn't in wiki ${activityId}. Take the page's id from wikiPages.`);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** Where a subwiki was found: a page of it (its first page) open in its view, or Moodle's form to start it (no page yet). */
type Subwiki = { kind: "page"; firstPageId: number; subwikiId?: number } | { kind: "empty"; createUrl: string; firstTitle?: string };

/** Which wiki page `page` shows, by its body id (`page-mod-wiki-view`, `-create`, `-edit`…). */
async function shows(page: Page, script: string): Promise<boolean> {
  return (await page.locator(`body#page-mod-wiki-${script}`).count()) > 0;
}

/** The wiki page a view shows (`#wikiactionselect`'s options and the print link name it), and the subwiki its search form is for. */
function readViewIds(page: Page): Promise<{ pageId?: number; subwikiId?: number; wid?: number; firstTitle?: string }> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document;
    const base = (globalThis as unknown as { location: { href: string } }).location.href;
    const value = doc.querySelector('#wikiactionselect option[value*="view.php?pageid="]')?.getAttribute("value") ?? doc.querySelector('a[href*="/mod/wiki/prettyview.php?pageid="]')?.getAttribute("href");
    const pageId = value ? Number(new URL(value, base).searchParams.get("pageid")) : undefined;
    const subwikiId = Number(doc.querySelector('input[name="subwikiid"]')?.getAttribute("value") ?? 0) || undefined;
    // The subwiki selector (group or participant) goes to view.php with the wiki's id and its first page's title.
    const wid = Number(doc.querySelector('.wiki_right form input[name="wid"]')?.getAttribute("value") ?? 0) || undefined;
    const firstTitle = doc.querySelector('.wiki_right form input[name="title"]')?.getAttribute("value") ?? undefined;
    return { pageId: pageId || undefined, subwikiId, wid, firstTitle };
  });
}

/** The wiki's id and first page's title from Moodle's form to start a subwiki: it posts to `create.php?action=create&wid=…`, its title given and read only. */
function createPageIds(page: Page): Promise<{ wid?: number; firstTitle?: string }> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document;
    const base = (globalThis as unknown as { location: { href: string } }).location.href;
    const action = doc.querySelector('form.mform[action*="/mod/wiki/create.php"]')?.getAttribute("action");
    const wid = action ? Number(new URL(action, base).searchParams.get("wid") ?? 0) || undefined : undefined;
    const title = doc.querySelector('form.mform[action*="/mod/wiki/create.php"] input[name="pagetitle"]')?.getAttribute("value") ?? undefined;
    return { wid, firstTitle: title };
  });
}

/**
 * Finds the subwiki asked for, as the wiki's page and its group or participant selector do: the
 * person's own from the wiki's page (`view.php?id=`), another one from `view.php` with the wiki's id,
 * its first page's title and the group or participant. `page` is left at what Moodle showed.
 */
async function findSubwiki(context: BrowserContext, siteUrl: string, activityId: number, { groupId, userId }: WikiSubwikiOptions): Promise<{ page: Page; subwiki: Subwiki }> {
  const refused = `You can't see the pages of wiki ${activityId}`;
  const page = await openSitePage(context, siteUrl, `mod/wiki/view.php?id=${activityId}`);
  try {
    await failOnRefusal(page, activityId, refused, HINTS.noviewpagepermission);
    let ids: { wid?: number; firstTitle?: string } & { pageId?: number; subwikiId?: number } = (await shows(page, "create")) ? await createPageIds(page) : await readViewIds(page);
    if (groupId !== undefined || userId !== undefined) {
      if (!ids.wid || ids.firstTitle === undefined) throw new WikiError(`Wiki ${activityId} has one subwiki for everyone (a collaborative wiki without groups, or one whose groups and participants you can't choose): leave groupId and userId out.`);
      const me = await page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { userId?: number } } }).M?.cfg?.userId ?? 0);
      const uid = userId ?? me;
      // Moodle reads the one its wiki's mode and group mode use: group, uid, or groupanduser.
      const query = new URLSearchParams({ wid: String(ids.wid), title: ids.firstTitle, uid: String(uid), groupanduser: `${groupId ?? 0}-${uid}` });
      if (groupId !== undefined) query.set("group", String(groupId));
      await page.goto(new URL(`mod/wiki/view.php?${query}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      await failOnRefusal(page, activityId, `You can't see that subwiki of wiki ${activityId}`, HINTS.cannotviewpage);
      if ((await pageModule(page)) !== activityId) throw new NotAWikiError(`Activity ${activityId} isn't a wiki you can open: take its id and module from the course structure.`);
      ids = (await shows(page, "create")) ? await createPageIds(page) : await readViewIds(page);
    }
    if (await shows(page, "create")) return { page, subwiki: { kind: "empty", createUrl: page.url(), ...(ids.firstTitle !== undefined ? { firstTitle: ids.firstTitle } : {}) } };
    if (!ids.pageId) throw new WikiError(`${refused}: Moodle showed no page of it (${new URL(page.url()).pathname}).`);
    return { page, subwiki: { kind: "page", firstPageId: ids.pageId, ...(ids.subwikiId ? { subwikiId: ids.subwikiId } : {}) } };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** The links a page shows under `selector` to pages of its wiki: `view.php?pageid=` to an existing one, `create.php?…title=` to one not created yet (`wiki_newentry`). */
export function readWikiLinks(page: Page, selector: string): Promise<WikiLink[]> {
  return page.evaluate((selector) => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null; getAttribute(n: string): string | null }> } }).document;
    const base = (globalThis as unknown as { location: { href: string } }).location.href;
    const found = new Map<string, { title: string; pageId?: number }>();
    for (const link of Array.from(doc.querySelectorAll(`${selector} a[href]`))) {
      const url = new URL(link.getAttribute("href") ?? "", base);
      if (!url.pathname.includes("/mod/wiki/")) continue;
      const text = (link.textContent ?? "").replace(/\s+/g, " ").trim();
      if (url.pathname.endsWith("/view.php") && url.searchParams.get("pageid")) {
        const pageId = Number(url.searchParams.get("pageid"));
        if (!found.has(`#${pageId}`)) found.set(`#${pageId}`, { title: text, pageId });
      } else if (url.pathname.endsWith("/create.php") && url.searchParams.get("title")) {
        const title = url.searchParams.get("title") ?? text;
        if (!found.has(`new:${title}`)) found.set(`new:${title}`, { title });
      }
    }
    return Array.from(found.values());
  }, selector);
}

/** One row of a page's history as its table shows it: the version's link, its author's link, its time and date. */
interface HistoryRow {
  version: number;
  authorId: number;
  authorName: string;
  time: string;
  date: string;
}

/** The versions a history page lists (`history.php`), newest first: every row with a version link (`viewversion.php`). */
export function readHistoryRows(page: Page): Promise<HistoryRow[]> {
  return inPage(
    page,
    () => {
      interface El {
        textContent: string | null;
        getAttribute(n: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const base = (globalThis as unknown as { location: { href: string } }).location.href;
      const text = (el: El | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const rows: HistoryRow[] = [];
      for (const row of Array.from(doc.querySelectorAll('[role="main"] table tr'))) {
        const versionLink = row.querySelector('a[href*="/mod/wiki/viewversion.php"]');
        if (!versionLink) continue;
        const users = Array.from(row.querySelectorAll('a[href*="/user/view.php"]'));
        const user = users[users.length - 1] ?? null;
        const authorId = Number(user ? new URL(user.getAttribute("href") ?? "", base).searchParams.get("id") : 0);
        rows.push({ version: Number(text(versionLink)), authorId, authorName: text(user), time: text(row.querySelector("td.c3")), date: text(row.querySelector(".wiki_histdate")) });
      }
      return rows;
    },
    null,
  );
}

/** How the history writes its dates: the language's date and time formats (`strftimedate`, `strftimetime`) in the person's time zone. */
async function historyFormat(context: BrowserContext, siteUrl: string, page: Page): Promise<DateFormat> {
  const [strings, timeZone] = await Promise.all([
    languageFormats(context, siteUrl, ["strftimedate", "strftimetime"]),
    page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { usertimezone?: string } } }).M?.cfg?.usertimezone ?? "UTC"),
  ]);
  return { format: `${strings.formats.strftimedate ?? "%d %B %Y"} ${strings.formats.strftimetime ?? "%I:%M %p"}`, locale: strings.locale, timeZone };
}

const toVersion = (row: HistoryRow, format: DateFormat): WikiVersion => {
  const modified = parseMoodleDate(`${row.date} ${row.time}`, format)?.toISOString();
  return { version: row.version, ...(modified ? { modified } : {}), authorId: row.authorId, authorName: row.authorName };
};

/** A page's versions from its history (`history.php`, every one with `all`, else the newest page of them), newest first, in `page`. */
async function readHistory(context: BrowserContext, siteUrl: string, page: Page, activityId: number, pageId: number, all: boolean, format?: DateFormat): Promise<WikiVersion[]> {
  await page.goto(new URL(`mod/wiki/history.php?pageid=${pageId}${all ? "&allversion=1" : ""}`, siteUrl).href, { waitUntil: "domcontentloaded" });
  await failOnRefusal(page, activityId, `You can't see the history of page ${pageId} of wiki ${activityId}`, HINTS.noviewpagepermission);
  const rows = await readHistoryRows(page);
  if (rows.length === 0) return [];
  format ??= await historyFormat(context, siteUrl, page);
  return rows.map((row) => toVersion(row, format));
}

/** The latest version's fields of a summary: version 0 and no author for a page never saved. */
const latest = (versions: WikiVersion[]): Pick<WikiPageSummary, "version" | "modified" | "authorId" | "authorName"> => {
  const last = versions[0];
  return last ? { version: last.version, ...(last.modified ? { modified: last.modified } : {}), authorId: last.authorId, authorName: last.authorName } : { version: 0 };
};

/** The pages of the subwiki a page belongs to, by title, from its map's page list (`map.php?option=5`). */
async function readPageList(siteUrl: string, page: Page, activityId: number, pageId: number): Promise<{ id: number; title: string }[]> {
  await page.goto(new URL(`mod/wiki/map.php?pageid=${pageId}&option=5`, siteUrl).href, { waitUntil: "domcontentloaded" });
  await failOnRefusal(page, activityId, `You can't see the pages of wiki ${activityId}`, HINTS.noviewpagepermission);
  return (await readWikiLinks(page, '[role="main"] table.generalbox')).filter((link): link is { title: string; pageId: number } => link.pageId !== undefined).map((link) => ({ id: link.pageId, title: link.title }));
}

/** A page's summary: its links from its map (`map.php?option=2`, "This page goes to") and its latest version from its history. */
async function readSummary(context: BrowserContext, siteUrl: string, activityId: number, listed: { id: number; title: string }, format: DateFormat | undefined): Promise<WikiPageSummary> {
  const page = await openWikiPage(context, siteUrl, activityId, `map.php?pageid=${listed.id}&option=2`, `You can't see page ${listed.id} of wiki ${activityId}`, HINTS.noviewpagepermission);
  try {
    const links = await readWikiLinks(page, '[role="main"] table.wiki_navigation_to');
    const versions = await readHistory(context, siteUrl, page, activityId, listed.id, false, format);
    return { id: listed.id, title: listed.title, links, ...latest(versions) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * The pages of a wiki's subwiki, by title: each one's id, title, the pages it links to (those not
 * created yet without an id), and its latest version (number, date, author). The person's subwiki
 * (the wiki's own in a collaborative wiki, their group's, or their own in an individual one) unless
 * `groupId` or `userId` choose another, as the wiki's group or participant menu does (choosing a
 * group makes it the person's current group in the course, as the menu does). Empty while the
 * subwiki has no pages. Paged with `limit` and `offset`. Throws `NotAWikiError` when the activity
 * isn't a wiki the person can open, `WikiError` when Moodle refuses the subwiki.
 */
export function wikiPages(context: BrowserContext, siteUrl: string, activityId: number, options: WithLimit<WikiPagesOptions>): Promise<ListPage<WikiPageSummary>>;
export function wikiPages(context: BrowserContext, siteUrl: string, activityId: number, options?: WithoutLimit<WikiPagesOptions>): Promise<WikiPageSummary[]>;
export function wikiPages(context: BrowserContext, siteUrl: string, activityId: number, options?: WikiPagesOptions): Promise<WikiPageSummary[] | ListPage<WikiPageSummary>>;
export async function wikiPages(context: BrowserContext, siteUrl: string, activityId: number, options: WikiPagesOptions = {}): Promise<WikiPageSummary[] | ListPage<WikiPageSummary>> {
  const { offset, count } = pageWindow(options);
  const { page, subwiki } = await findSubwiki(context, siteUrl, activityId, options);
  let listed: { id: number; title: string }[];
  let format: DateFormat | undefined;
  try {
    if (subwiki.kind === "empty") return toPage([], options.limit);
    listed = (await readPageList(siteUrl, page, activityId, subwiki.firstPageId)).slice(offset, count === undefined ? undefined : offset + count);
    if (listed.length > 0) format = await historyFormat(context, siteUrl, page);
  } finally {
    await page.close().catch(() => undefined);
  }
  // Only the pages returned are read (the one past the window only tells there are more), a few at a time, each in its own tab.
  const shown = options.limit === undefined ? listed : listed.slice(0, options.limit);
  const summaries: WikiPageSummary[] = [];
  for (let i = 0; i < shown.length; i += 4) summaries.push(...(await Promise.all(shown.slice(i, i + 4).map((item) => readSummary(context, siteUrl, activityId, item, format)))));
  return options.limit === undefined ? summaries : { items: summaries, more: listed.length > options.limit };
}

/** The view's content, marked for the readers: its box after the title, without the table of contents, the "[edit]" links and their anchors. */
function markContent(page: Page): Promise<{ title: string; sections: string[]; html: string } | undefined> {
  return inPage(
    page,
    () => {
      interface El {
        className: string;
        textContent: string | null;
        innerHTML: string;
        nextElementSibling: El | null;
        children: ArrayLike<El>;
        getAttribute(n: string): string | null;
        setAttribute(n: string, v: string): void;
        remove(): void;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const base = (globalThis as unknown as { location: { href: string } }).location.href;
      const heading = doc.querySelector('[role="main"] .wiki_headingtitle');
      if (!heading) return undefined;
      let box: El | null = null;
      for (let next = heading.nextElementSibling; next; next = next.nextElementSibling) {
        const inner = Array.from(next.children).find((child) => /(^|\s)no-overflow(\s|$)/.test(child.className));
        if (/(^|\s)generalbox(\s|$)/.test(next.className) && inner) box = inner;
      }
      if (!box) return undefined;
      const sections = Array.from(box.querySelectorAll(".wiki-toc .wiki-toc-section")).map((entry) => {
        const edit = entry.querySelector("a.wiki_edit_section");
        const named = edit ? new URL(edit.getAttribute("href") ?? "", base).searchParams.get("section") : null;
        return named ?? (entry.querySelector('a[href^="#toc-"]')?.textContent ?? "").trim();
      });
      for (const furniture of Array.from(box.querySelectorAll('.wiki-toc, a.wiki_edit_section, a[name^="toc-"]'))) furniture.remove();
      box.setAttribute("data-driver-wiki-content", "1");
      return { title: (heading.querySelector("h3, h2")?.textContent ?? "").trim(), sections, html: box.innerHTML.trim() };
    },
    null,
  );
}

const CONTENT = "[data-driver-wiki-content]";

/** A wiki page read in `page` (left at its history): its view, then its history. */
async function readPage(context: BrowserContext, siteUrl: string, page: Page, activityId: number, pageId: number, history: boolean): Promise<WikiPage> {
  await page.goto(new URL(`mod/wiki/view.php?pageid=${pageId}`, siteUrl).href, { waitUntil: "domcontentloaded" });
  const refused = `You can't see page ${pageId} of wiki ${activityId}`;
  await failOnRefusal(page, activityId, refused, HINTS.noviewpagepermission);
  if ((await pageModule(page)) !== activityId) throw new WikiError(`${refused}: it isn't in wiki ${activityId}. Take the page's id from wikiPages.`);
  const content = await markContent(page);
  if (!content) throw new WikiError(`${refused}: Moodle's page didn't show its content where the driver expects it.`);
  const { subwikiId } = await readViewIds(page);
  const [text] = await readTexts(page, CONTENT);
  const [images] = await readImages(page, CONTENT);
  const media = await readMedia(page, CONTENT);
  const links = await readWikiLinks(page, CONTENT);
  const versions = await readHistory(context, siteUrl, page, activityId, pageId, history);
  return {
    id: pageId,
    title: content.title,
    ...(subwikiId ? { subwikiId } : {}),
    links,
    ...latest(versions),
    html: content.html,
    text: text ?? "",
    sections: content.sections,
    ...(images && images.length > 0 ? { images } : {}),
    ...(media.length > 0 ? { media } : {}),
    ...(history ? { history: versions } : {}),
  };
}

/**
 * A wiki page: its title, content (HTML as Moodle renders it, its text, images and media), sections,
 * the pages it links to and its latest version; with `history`, every version (number, date, author),
 * newest first. Throws `NotAWikiError` when the activity isn't a wiki the person can open,
 * `WikiError` when the page isn't in it or Moodle doesn't show it to the person.
 */
export async function wikiPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, { history = false }: WikiPageOptions = {}): Promise<WikiPage> {
  const page = await openSitePage(context, siteUrl, `mod/wiki/view.php?pageid=${pageId}`);
  try {
    return await readPage(context, siteUrl, page, activityId, pageId, history);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Checks the content (and the files it embeds) before anything is sent. */
async function checkContent(content: unknown, embed: string[] | undefined): Promise<void> {
  if (typeof content !== "string" || content.trim() === "") throw new MoodleError("A wiki page needs some content.", "invalid-input");
  if (embed) await checkEmbeds([content], embed);
}

/**
 * Writes `content` in the editor of a page (`edit.php`, of a section with `section`) and saves it as
 * its Save button does. The editor takes Moodle's lock on the page: when someone else holds it
 * Moodle shows no editor, and this throws `WikiPageLockedError` (it never overrides a lock). The
 * editor is always left through the page's view: saved, Moodle goes there; otherwise the driver does,
 * which releases the lock as leaving the editor in Moodle does.
 */
async function saveContent(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, { content, section, embed }: WikiPageChanges): Promise<void> {
  const path = `mod/wiki/edit.php?pageid=${pageId}${section !== undefined ? `&section=${encodeURIComponent(section)}` : ""}`;
  const what = `You can't edit page ${pageId} of wiki ${activityId}`;
  let page: Page;
  try {
    page = await openForm(context, siteUrl, path);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    // An error page has no form: opened again for Moodle's message.
    page = await openSitePage(context, siteUrl, path);
  }
  let saved = false;
  try {
    await failOnRefusal(page, activityId, what, HINTS.noeditpermission);
    if ((await pageModule(page)) !== activityId) throw new WikiError(`${what}: it isn't in wiki ${activityId}. Take the page's id from wikiPages.`);
    const editor = page.locator("form#mform1");
    if ((await editor.count()) === 0) {
      // Moodle prints its lock notice in a centred box instead of the editor (and, to who may, an "Override locks" button).
      if ((await page.locator('[role="main"] .generalbox.boxaligncenter, form[action*="overridelocks.php"]').count()) > 0) {
        throw new WikiPageLockedError(`Page ${pageId} of wiki ${activityId}${section !== undefined ? ` (section "${section}")` : ""} is being edited by someone else right now, so Moodle locks it (it doesn't say who): try again in a minute, once they've saved it or left its editor.`);
      }
      throw new WikiError(`${what}: Moodle showed no editor for it.`);
    }
    const html = (await page.locator('#mform1 [name="newcontent_editor[text]"]').count()) > 0;
    const values: Record<string, FieldValue> = html ? { "newcontent_editor[text]": content } : { newcontent: content };
    if (embed && embed.length > 0) {
      if (!html) throw new MoodleError(`Page ${pageId} of wiki ${activityId} is written in the wiki's markup (Creole or NWiki), not HTML: files can be embedded only in HTML pages.`, "not-available");
      await embedFiles(page, values, embed);
    }
    await setFields(page, values, "#mform1");
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("#mform1 #save", { noWaitAfter: true })]);
    await failOnRefusal(page, activityId, `Moodle didn't save page ${pageId} of wiki ${activityId}`, HINTS.noeditpermission);
    if (!(await shows(page, "view")) || (await readViewIds(page)).pageId !== pageId) throw new WikiError(`Page ${pageId} of wiki ${activityId} was sent, but Moodle didn't show the page afterwards (it went to ${new URL(page.url()).pathname}).`);
    saved = true;
  } finally {
    if (!saved) await page.goto(new URL(`mod/wiki/view.php?pageid=${pageId}`, siteUrl).href, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    await page.close().catch(() => undefined);
  }
}

/**
 * Creates a page in a wiki's subwiki as the person, with its content (`embed`'s local files in it),
 * as following a link to a new page and saving its editor do: the person's subwiki unless `groupId`
 * or `userId` choose another (as `wikiPages`). A subwiki with no pages yet starts with the wiki's
 * first page, as Moodle starts it: its title must be the wiki's first page title. The page takes the
 * wiki's default format. Gives the page's id and the page. Throws `WikiError` when a page of that
 * title is already there (edit it with `editWikiPage`), the first page's title isn't the wiki's, or
 * Moodle refuses (mod/wiki:createpage, mod/wiki:editpage, someone else's subwiki).
 */
export async function createWikiPage(context: BrowserContext, siteUrl: string, activityId: number, input: WikiPageInput): Promise<WikiPageChange> {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title === "") throw new MoodleError("A wiki page needs a title.", "invalid-input");
  await checkContent(input.content, input.embed);
  const { page, subwiki } = await findSubwiki(context, siteUrl, activityId, input);
  let pageId: number;
  try {
    let createUrl: string;
    if (subwiki.kind === "empty") {
      createUrl = subwiki.createUrl;
      const first = subwiki.firstTitle ?? "";
      if (first.trim() !== title) throw new WikiError(`The subwiki has no pages yet: Moodle starts it with the wiki's first page, "${first}". Create that one first, then link to the others from it.`);
    } else {
      const existing = (await readPageList(siteUrl, page, activityId, subwiki.firstPageId)).find((listed) => listed.title.toLowerCase() === title.toLowerCase());
      if (existing) throw new WikiError(`Wiki ${activityId} already has a page "${existing.title}" (${existing.id}) there: change it with editWikiPage.`);
      if (!subwiki.subwikiId) throw new WikiError(`Wiki ${activityId}'s page didn't name its subwiki, so the driver can't add a page to it.`);
      // The link Moodle gives a page not created yet.
      createUrl = new URL(`mod/wiki/create.php?swid=${subwiki.subwikiId}&title=${encodeURIComponent(title)}&action=new`, siteUrl).href;
    }
    await page.goto(createUrl, { waitUntil: "domcontentloaded" });
    const what = `You can't create pages in wiki ${activityId}`;
    await failOnRefusal(page, activityId, what, HINTS.nocreatepermission);
    // Moodle goes straight to the editor when the wiki forces its format; else it asks the format first.
    if (!(await shows(page, "edit"))) {
      const button = page.locator('form.mform[action*="create.php"] #id_submitbutton');
      if ((await button.count()) === 0) throw new WikiError(`${what}: Moodle showed no form to create the page.`);
      await page.waitForLoadState("load");
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), button.click({ noWaitAfter: true })]);
      await failOnRefusal(page, activityId, what, HINTS.nocreatepermission);
    }
    // The editor posts to its page: `edit.php?pageid=…`.
    const action = (await shows(page, "edit")) ? await page.locator("form#mform1").getAttribute("action").catch(() => null) : null;
    pageId = Number(action ? new URL(action, siteUrl).searchParams.get("pageid") : 0);
    if (!pageId) throw new WikiError(`${what}: Moodle didn't open the new page's editor (it went to ${new URL(page.url()).pathname}).`);
    // Leaves the editor Moodle opened through the page's view, before the driver's own opens it again.
    await page.goto(new URL(`mod/wiki/view.php?pageid=${pageId}`, siteUrl).href, { waitUntil: "domcontentloaded" });
  } finally {
    await page.close().catch(() => undefined);
  }
  await saveContent(context, siteUrl, activityId, pageId, { content: input.content, ...(input.embed ? { embed: input.embed } : {}) });
  const created = await wikiPage(context, siteUrl, activityId, pageId);
  return { changed: `Created page ${pageId} "${created.title}" in wiki ${activityId}.`, pageId, page: created };
}

/**
 * Changes a wiki page's content as its editor does, the whole page or one of its sections (a heading,
 * as `wikiPage`'s `sections` lists them), with `embed`'s local files in it: a new version, by the
 * person. Throws `WikiPageLockedError` when someone else has the page open in its editor (the driver
 * never overrides their lock), `WikiError` when the page isn't in the wiki, the section isn't in the
 * page, or Moodle refuses (mod/wiki:editpage, someone else's subwiki).
 */
export async function editWikiPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, changes: WikiPageChanges): Promise<WikiPageChange> {
  await checkContent(changes.content, changes.embed);
  if (changes.section !== undefined && (typeof changes.section !== "string" || changes.section.trim() === "")) throw new MoodleError("section is the title of one of the page's sections: leave it out to change the whole page.", "invalid-input");
  await saveContent(context, siteUrl, activityId, pageId, changes);
  const page = await wikiPage(context, siteUrl, activityId, pageId);
  return { changed: `Saved ${changes.section !== undefined ? `section "${changes.section}" of ` : ""}page ${pageId} "${page.title}" of wiki ${activityId}, version ${page.version}.`, pageId, page };
}
