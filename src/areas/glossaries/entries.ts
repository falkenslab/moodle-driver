// A glossary's entries, read and written as the person does in the glossary itself. Of mod_glossary's
// services only get_entry_by_id (and view_entry) is open to AJAX; listing, adding, changing and deleting
// are the mobile app's only (servicenotavailable, confirmed empirically on 5.2). So the entries are
// listed from the glossary's page (view.php, each entry named by its links), each read through
// get_entry_by_id, and written through the entry form (edit.php), the delete confirmation
// (deleteentry.php) and the approval link (approve.php).
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { checkEmbeds, embedFiles } from "../../core/embed.js";
import { checkLocalFiles } from "../../core/files.js";
import { FormError, draftFiles, formValue, openForm, removeFromDraft, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { pageWindow, toPage, type ListPage, type PageOptions, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { isoDate } from "../courses/list.js";
import { GlossaryError, failOnRefusal, openGlossaryPage, pageSesskey, readShownEntries, type ShownEntry } from "./glossary.js";

/** A file attached to a glossary entry: its URL downloads with `downloadFile`. */
export interface GlossaryAttachment {
  name: string;
  url: string;
  /** In bytes. */
  size: number;
  mimeType?: string;
}

/** One entry of a glossary. */
export interface GlossaryEntry {
  id: number;
  concept: string;
  /** Its definition, as HTML (its images' URLs on the site). */
  definition: string;
  /** Its aliases (keywords), as the glossary's page lists them; the "Entry list" display format shows none, so there they're empty. */
  aliases: string[];
  /**
   * The categories it is in, from the glossary's category view; left out when the glossary's display
   * format has none ("Simple, dictionary style", Moodle's default), as Moodle shows no categories there.
   */
  categoryIds?: number[];
  authorId: number;
  authorName: string;
  /** Approved: shown to everyone. An entry waiting for approval is shown only to its author and to who can approve it. */
  approved: boolean;
  attachments: GlossaryAttachment[];
  created?: string;
  modified?: string;
}

/** What `glossaryEntries` takes: which entries, and a page of them. */
export interface GlossaryEntryOptions extends PageOptions {
  /** Only the entries whose concept starts with this letter (one character). */
  letter?: string;
  /** Only the entries whose concept, aliases or definition hold these words, as the glossary's search with "Search full text" does. */
  search?: string;
  /** The entries waiting for approval, from the approval page (it takes mod/glossary:approve), instead of the glossary's. */
  pending?: boolean;
}

/** What a change to an entry did, and the entry's id. */
export interface GlossaryEntryChange {
  changed: string;
  entryId: number;
  /** The entry afterwards (not after a delete). */
  entry?: GlossaryEntry;
}

/** A new entry's fields. */
export interface GlossaryEntryInput {
  concept: string;
  /** The definition, as HTML; Moodle requires one. */
  definition: string;
  /** Other words the entry is found and linked by. */
  aliases?: string[];
  /** The categories to put it in, by id (`glossaryCategories`). */
  categoryIds?: number[];
  /** Local files (absolute paths) to attach to the entry. */
  attachments?: string[];
  /** Local files (absolute paths) to embed in the definition, which names each by its file name (`<img src="shot.png">`). */
  embed?: string[];
}

/** What `editGlossaryEntry` changes: only what's given. `attachments` replaces the entry's attachments (`[]` removes them). */
export type GlossaryEntryChanges = Partial<GlossaryEntryInput>;

/** An entry as `mod_glossary_get_entry_by_id` returns it (Moodle 5.2). */
interface RawEntry {
  id: number;
  userid: number;
  userfullname: string;
  concept: string;
  definition: string;
  attachments?: { filename: string; filepath: string; filesize: number; fileurl: string; mimetype?: string }[];
  timecreated: number;
  timemodified: number;
  approved: boolean;
}

function toEntry(raw: RawEntry, shown: ShownEntry | undefined, categories: Map<number, number[]> | undefined): GlossaryEntry {
  return {
    id: raw.id,
    concept: raw.concept,
    definition: raw.definition,
    aliases: shown?.aliases ?? [],
    ...(categories ? { categoryIds: categories.get(raw.id) ?? [] } : {}),
    authorId: raw.userid,
    authorName: raw.userfullname,
    approved: Boolean(raw.approved),
    attachments: (raw.attachments ?? []).map((file) => ({ name: `${file.filepath}${file.filename}`.replace(/^\//, ""), url: file.fileurl, size: file.filesize, ...(file.mimetype ? { mimeType: file.mimetype } : {}) })),
    created: isoDate(raw.timecreated),
    modified: isoDate(raw.timemodified),
  };
}

const glossaryUrl = (siteUrl: string, activityId: number, query: string) => new URL(`mod/glossary/view.php?id=${activityId}&${query}`, siteUrl).href;

/**
 * Which categories each entry is in, from the glossary's category view: its category menu (`#catmenu`)
 * lists the categories, and each category's page (all of it, `page=-1`) its entries. Undefined when
 * the display format has no category view (Moodle shows the standard view instead, without the menu).
 */
async function readMembership(page: Page, siteUrl: string, activityId: number): Promise<Map<number, number[]> | undefined> {
  await page.goto(glossaryUrl(siteUrl, activityId, "mode=cat&hook=-1"), { waitUntil: "domcontentloaded" });
  const categories = await readCategoryMenu(page);
  if (categories === undefined) return undefined;
  const membership = new Map<number, number[]>();
  for (const category of categories) {
    await page.goto(glossaryUrl(siteUrl, activityId, `mode=cat&hook=${category.id}&page=-1`), { waitUntil: "domcontentloaded" });
    for (const { id } of await readShownEntries(page)) if (id !== undefined) membership.set(id, [...(membership.get(id) ?? []), category.id]);
  }
  return membership;
}

/** The categories in the category view's menu (`#catmenu`), by id; undefined when the page has none. Its 0 and -1 are "All categories" and "Not categorised". */
export function readCategoryMenu(page: Page): Promise<{ id: number; name: string }[] | undefined> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { querySelectorAll(s: string): ArrayLike<{ value: string; textContent: string | null }> } | null } }).document;
    const menu = doc.querySelector('#catmenu select[name="hook"]');
    if (!menu) return undefined;
    return Array.from(menu.querySelectorAll("option"))
      .filter((option) => Number(option.value) > 0)
      .map((option) => ({ id: Number(option.value), name: (option.textContent ?? "").trim() }));
  });
}

/** Each entry's details through `mod_glossary_get_entry_by_id`, ten at a time, with the context of the glossary it is in. */
async function fetchEntries(context: BrowserContext, siteUrl: string, ids: number[]): Promise<{ entry: RawEntry; contextId: number }[]> {
  const raws: { entry: RawEntry; contextId: number }[] = [];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = await Promise.all(ids.slice(i, i + 10).map((id) => callService<{ entry: RawEntry; ratinginfo?: { contextid?: number } }>(context, siteUrl, "mod_glossary_get_entry_by_id", { id })));
    raws.push(...batch.map((answer) => ({ entry: answer.entry, contextId: Number(answer.ratinginfo?.contextid ?? 0) })));
  }
  return raws;
}

/**
 * The entries the list asks for, `count` of them from `offset` (all without `count`), as the glossary's
 * page shows them; `page` is already at the first page `listPath` names.
 */
async function listShown(page: Page, siteUrl: string, activityId: number, query: string, offset: number, count: number | undefined): Promise<ShownEntry[]> {
  if (count === undefined && offset === 0) return readShownEntries(page);
  // Moodle shows the glossary's "entries per page" from `offset`: as many pages as the window needs.
  const shown: ShownEntry[] = [];
  let at = offset;
  for (;;) {
    const entries = await readShownEntries(page);
    shown.push(...entries);
    at += entries.length;
    if (entries.length === 0 || (count !== undefined && shown.length >= count)) break;
    await page.goto(glossaryUrl(siteUrl, activityId, `${query}&offset=${at}`), { waitUntil: "domcontentloaded" });
  }
  return count === undefined ? shown : shown.slice(0, count);
}

/** The glossary's page a list starts at: all of it at once (`page=-1`) for a whole list, else from `offset`. */
const listPath = (activityId: number, query: string, offset: number, count: number | undefined) => `view.php?id=${activityId}&${query}&${count === undefined && offset === 0 ? "page=-1" : `offset=${offset}`}`;

/** The query of the glossary's page for the options: by letter (all of them by default), a search, or the approval page. */
function listQuery({ letter, search, pending }: GlossaryEntryOptions): string {
  if (letter !== undefined && [...letter].length !== 1) throw new MoodleError(`letter is one character, not "${letter}".`, "invalid-input");
  if (search !== undefined && (letter !== undefined || pending)) throw new MoodleError("search can't go with letter or pending: Moodle's search looks in the whole glossary.", "invalid-input");
  if (search !== undefined) {
    if (search.trim() === "") throw new MoodleError("search needs some words.", "invalid-input");
    return `mode=search&fullsearch=1&hook=${encodeURIComponent(search.trim())}`;
  }
  return `mode=${pending ? "approval" : "letter"}&hook=${encodeURIComponent(letter?.toUpperCase() ?? "ALL")}`;
}

/** Reads the entries shown, with their details and categories, on the glossary's page `page` already checked. */
async function completeEntries(context: BrowserContext, siteUrl: string, page: Page, activityId: number, shown: ShownEntry[]): Promise<GlossaryEntry[]> {
  const named = shown.filter((entry): entry is ShownEntry & { id: number } => entry.id !== undefined);
  if (named.length === 0) return [];
  const raws = await fetchEntries(context, siteUrl, named.map((entry) => entry.id));
  const membership = await readMembership(page, siteUrl, activityId);
  return raws.map((raw, i) => toEntry(raw.entry, named[i], membership));
}

/**
 * A glossary's entries, in the glossary's order (by concept; the approval page's by creation): each
 * one's id, concept, definition (HTML), aliases, categories, author, whether it's approved, and its
 * attachments. What the person sees: approved entries and their own waiting for approval; with
 * `pending`, the entries waiting for approval (for who can approve them). By `letter`, or a `search`
 * of concepts, aliases and definitions; paged with `limit` and `offset`. An entry the page names no id
 * for (a student's own waiting for approval, once its editing time is over) is left out. Throws
 * `NotAGlossaryError` when the activity isn't a glossary the person can open, `GlossaryError` when the
 * approval page is refused (it takes mod/glossary:approve).
 */
export function glossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options: WithLimit<GlossaryEntryOptions>): Promise<ListPage<GlossaryEntry>>;
export function glossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: WithoutLimit<GlossaryEntryOptions>): Promise<GlossaryEntry[]>;
export function glossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: GlossaryEntryOptions): Promise<GlossaryEntry[] | ListPage<GlossaryEntry>>;
export async function glossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options: GlossaryEntryOptions = {}): Promise<GlossaryEntry[] | ListPage<GlossaryEntry>> {
  const { offset, count } = pageWindow(options);
  const query = listQuery(options);
  const page = await openGlossaryPage(context, siteUrl, activityId, listPath(activityId, query, offset, count), `You can't see glossary ${activityId}'s entries waiting for approval`, "approving entries takes Moodle's capability mod/glossary:approve, which teachers have");
  try {
    const shown = await listShown(page, siteUrl, activityId, query, offset, count);
    return toPage(await completeEntries(context, siteUrl, page, activityId, shown), options.limit);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The module context of a glossary's page, from its body class (`context-<id>`). */
async function pageContextId(page: Page): Promise<number> {
  const classes = (await page.locator("body").getAttribute("class")) ?? "";
  return Number(/(?:^|\s)context-(\d+)(?:\s|$)/.exec(classes)?.[1] ?? 0);
}

/**
 * One entry of the glossary, read as `glossaryEntries` reads them, from its own view in the glossary
 * (`mode=entry`, which shows an entry of any glossary: the entry's context is checked against the
 * glossary's). Refused when the glossary doesn't show it to the person.
 */
async function readEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<GlossaryEntry> {
  const page = await openGlossaryPage(context, siteUrl, activityId, `view.php?id=${activityId}&mode=entry&hook=${entryId}`, `You can't see entry ${entryId} of glossary ${activityId}`, "");
  try {
    const missing = () => new GlossaryError(`Glossary ${activityId} shows you no entry ${entryId}: take its id from glossaryEntries (an entry waiting for approval is shown only to its author and to who can approve it).`);
    // The view shows that entry alone: one the page names no id for is it too.
    const posts = await readShownEntries(page);
    let shown = posts.find((entry) => entry.id === entryId) ?? (posts.length === 1 && posts[0]!.id === undefined ? posts[0] : undefined);
    if (!shown) {
      // Moodle's entry view prints someone else's waiting entry to nobody, its approvers included
      // (confirmed empirically, 5.2): they see it on the approval page.
      await page.goto(glossaryUrl(siteUrl, activityId, "mode=approval&hook=ALL&page=-1"), { waitUntil: "domcontentloaded" });
      if ((await moodleErrorMessage(page)) === undefined) shown = (await readShownEntries(page)).find((entry) => entry.id === entryId);
    }
    if (!shown) throw missing();
    const [raw] = await fetchEntries(context, siteUrl, [entryId]);
    if (raw!.contextId !== (await pageContextId(page))) throw missing();
    return toEntry(raw!.entry, shown, await readMembership(page, siteUrl, activityId));
  } finally {
    await page.close().catch(() => undefined);
  }
}

const WRITE = "adding entries takes Moodle's capability mod/glossary:write: the glossary doesn't take entries from you";
const MANAGE = "changing someone else's entry takes Moodle's capability mod/glossary:manageentries, which teachers have";

/**
 * Opens the entry form (a new entry's, or `entryId`'s), refused as Moodle refuses it: the form page
 * is opened again for Moodle's message only when it has no form.
 */
async function openEntryForm(context: BrowserContext, siteUrl: string, activityId: number, entryId: number | undefined): Promise<Page> {
  const path = `mod/glossary/edit.php?cmid=${activityId}${entryId === undefined ? "" : `&id=${entryId}`}`;
  try {
    const page = await openForm(context, siteUrl, path);
    if ((await formValue(page, "cmid")) === String(activityId)) return page;
    await page.close().catch(() => undefined);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
  }
  const page = await openSitePage(context, siteUrl, path);
  try {
    const what = entryId === undefined ? `You can't add entries to glossary ${activityId}` : `You can't change entry ${entryId} of glossary ${activityId}`;
    await failOnRefusal(page, activityId, what, entryId === undefined ? WRITE : MANAGE);
    throw new GlossaryError(`${what}: its entry form isn't there.`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The categories the entry form offers (`categories[]`), by id: none when the glossary has none. */
function formCategories(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll('form.mform select[name="categories[]"] option'))
      .map((option) => Number(option.value))
      .filter((id) => id > 0),
  );
}

function checkInput(input: GlossaryEntryChanges): void {
  if (input.concept !== undefined && input.concept.trim() === "") throw new MoodleError("An entry needs a concept.", "invalid-input");
  if (input.definition !== undefined && input.definition.trim() === "") throw new MoodleError("An entry needs a definition: Moodle requires one.", "invalid-input");
  for (const alias of input.aliases ?? []) {
    if (/[\r\n]/.test(alias)) throw new MoodleError(`An alias is one line: "${alias}".`, "invalid-input");
  }
}

/**
 * Fills and saves the entry form open in `page` with what's given: concept, definition (with `embed`'s
 * files in its editor), aliases (one per line), categories, and attachments (replacing the draft's).
 * Gives the entry's id, from the entry's page Moodle goes to (`view.php?…&mode=entry&hook=<id>`).
 */
async function saveEntryForm(page: Page, activityId: number, input: GlossaryEntryChanges): Promise<number> {
  const values: Record<string, FieldValue> = {};
  if (input.concept !== undefined) values.concept = input.concept;
  if (input.definition !== undefined) values["definition_editor[text]"] = input.definition;
  if (input.aliases !== undefined) values.aliases = input.aliases.map((alias) => alias.trim()).filter((alias) => alias !== "").join("\n");
  if (input.categoryIds !== undefined) {
    const offered = await formCategories(page);
    const unknown = input.categoryIds.filter((id) => !offered.includes(id));
    if (unknown.length > 0) throw new GlossaryError(`Glossary ${activityId} has no categories ${unknown.join(", ")}; it has ${offered.join(", ") || "none"}. Take their ids from glossaryCategories.`);
    if (offered.length > 0) values["categories[]"] = input.categoryIds.map(String);
  }
  if (input.embed) await embedFiles(page, values, input.embed);
  if (input.attachments !== undefined) {
    const draft = await formValue(page, "attachment_filemanager");
    if (!draft) throw new GlossaryError(`Glossary ${activityId}'s entry form takes no attachments.`);
    const present = (await draftFiles(page, draft)).map((file) => file.name);
    if (present.length > 0) await removeFromDraft(page, draft, present);
    if (input.attachments.length > 0) await uploadToDraft(page, draft, input.attachments);
  }
  await setFields(page, values);
  await submitForm(page, "submitbutton");
  const url = new URL(page.url());
  const hook = url.searchParams.get("hook");
  if (url.searchParams.get("mode") !== "entry" || !hook) throw new GlossaryError(`Glossary ${activityId}'s entry form was sent, but Moodle didn't show the entry (it went to ${url.pathname}).`);
  return Number(hook);
}

/**
 * Adds an entry to a glossary as the person, through Moodle's entry form: its concept, definition
 * (with `embed`'s local files in it), aliases, categories and attached local files. A student's entry
 * waits for a teacher's approval when the glossary asks for it. Gives the entry's id and the entry.
 * Throws `GlossaryError` when the glossary doesn't take entries from the person (mod/glossary:write)
 * or a category isn't in it, `FormError` with Moodle's reasons when it refuses the entry (a concept
 * already there, where duplicates aren't allowed).
 */
export async function addGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, input: GlossaryEntryInput): Promise<GlossaryEntryChange> {
  checkInput(input);
  if (input.concept === undefined || input.definition === undefined) throw new MoodleError("A new entry needs a concept and a definition.", "invalid-input");
  if (input.embed) await checkEmbeds([input.definition], input.embed);
  if (input.attachments) await checkLocalFiles(input.attachments);
  const page = await openEntryForm(context, siteUrl, activityId, undefined);
  let entryId: number;
  try {
    entryId = await saveEntryForm(page, activityId, input);
  } finally {
    await page.close().catch(() => undefined);
  }
  const entry = await readEntry(context, siteUrl, activityId, entryId);
  return { changed: `Added entry ${entryId} "${entry.concept}" to glossary ${activityId}${entry.approved ? "" : ", waiting for approval"}.`, entryId, entry };
}

/**
 * Changes an entry through its form: only what's given (`attachments` replaces its attachments, `[]`
 * removes them). A student changes their own entries while the site's editing time lasts (or always,
 * when the glossary lets them); a teacher changes anyone's. An entry saved by someone who can approve
 * it comes out approved, as Moodle saves it (confirmed empirically, 5.2). Throws `GlossaryError` when Moodle refuses
 * (someone else's entry, the editing time over, no such entry in the glossary), `FormError` with
 * Moodle's reasons when it refuses the changes.
 */
export async function editGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, changes: GlossaryEntryChanges): Promise<GlossaryEntryChange> {
  checkInput(changes);
  if (changes.embed) await checkEmbeds([changes.definition], changes.embed);
  if (changes.attachments) await checkLocalFiles(changes.attachments);
  const done: string[] = [];
  if (changes.concept !== undefined) done.push(`concept set to "${changes.concept}"`);
  if (changes.definition !== undefined) done.push("definition set");
  if (changes.aliases !== undefined) done.push(`aliases set to ${changes.aliases.length > 0 ? changes.aliases.map((a) => `"${a}"`).join(", ") : "none"}`);
  if (changes.categoryIds !== undefined) done.push(`categories set to ${changes.categoryIds.join(", ") || "none"}`);
  if (changes.attachments !== undefined) done.push(`${changes.attachments.length} attachment(s) set`);
  if (done.length === 0) return { changed: "Nothing to change.", entryId, entry: await readEntry(context, siteUrl, activityId, entryId) };
  const page = await openEntryForm(context, siteUrl, activityId, entryId);
  try {
    await saveEntryForm(page, activityId, changes);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Entry ${entryId} of glossary ${activityId}: ${done.join(", ")}.`, entryId, entry: await readEntry(context, siteUrl, activityId, entryId) };
}

/**
 * Deletes an entry, with its files, as its delete link does after Moodle's confirmation. A student
 * deletes their own entries while the site's editing time lasts; a teacher, anyone's. Throws
 * `GlossaryError` when Moodle refuses (someone else's entry, the editing time over, no such entry).
 */
export async function deleteGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<GlossaryEntryChange> {
  const what = `You can't delete entry ${entryId} of glossary ${activityId}`;
  const page = await openGlossaryPage(context, siteUrl, activityId, `deleteentry.php?id=${activityId}&entry=${entryId}&prevmode=letter`, what, MANAGE);
  try {
    const confirm = page.locator('form[action*="deleteentry.php"] [type="submit"]');
    if ((await confirm.count()) === 0) throw new GlossaryError(`${what}: Moodle didn't ask to confirm it.`);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click({ noWaitAfter: true })]);
    await failOnRefusal(page, activityId, what, MANAGE);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Deleted entry ${entryId} from glossary ${activityId}.`, entryId };
}

/**
 * Approves an entry waiting for approval, or takes an approval back (the entry then waits again,
 * hidden from everyone but its author and who can approve), as the approve and "Undo approval" links
 * do. Throws `GlossaryError` when the person can't approve (mod/glossary:approve, which teachers have)
 * or the glossary shows them no such entry.
 */
export async function setGlossaryEntryApproved(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, approved: boolean): Promise<GlossaryEntryChange> {
  if (typeof approved !== "boolean") throw new MoodleError("approved is true or false.", "invalid-input");
  const before = await readEntry(context, siteUrl, activityId, entryId);
  if (before.approved === approved) return { changed: `Entry ${entryId} is already ${approved ? "approved" : "waiting for approval"}.`, entryId, entry: before };
  const what = `You can't ${approved ? "approve" : "take back the approval of"} entry ${entryId} of glossary ${activityId}`;
  const page = await openGlossaryPage(context, siteUrl, activityId, `view.php?id=${activityId}&mode=entry&hook=${entryId}`, what, "");
  try {
    const query = new URLSearchParams({ eid: String(entryId), newstate: approved ? "1" : "0", mode: "approval", hook: "ALL", sesskey: await pageSesskey(page) });
    await page.goto(new URL(`mod/glossary/approve.php?${query}`, siteUrl).href, { waitUntil: "domcontentloaded" });
    await failOnRefusal(page, activityId, what, "approving entries takes Moodle's capability mod/glossary:approve, which teachers have");
  } finally {
    await page.close().catch(() => undefined);
  }
  const entry = await readEntry(context, siteUrl, activityId, entryId);
  return { changed: `Entry ${entryId} of glossary ${activityId} ${approved ? "approved" : "waiting for approval again"}.`, entryId, entry };
}
