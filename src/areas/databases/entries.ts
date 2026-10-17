// A database activity's entries, through its pages: Moodle's services for entries (mod_data_get_entries,
// add_entry…) are only for its mobile app, not open to the session's AJAX (`servicenotavailable`,
// confirmed empirically on the sandbox, 5.2). The list (`view.php`) gives the entries' ids, in its own
// order, search and paging; each entry's single view its author, dates and approval, from what
// Moodle's tags write; its edit form (`edit.php`) its values by field id, as Moodle keeps them, and
// takes the new ones; `export.php` and `import.php` move them as CSV.
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";
import { checkLocalFiles } from "../../core/files.js";
import { deleteDraftFile, draftFiles, formValue, openForm, setFields, submitForm, uploadToDraft, FormError } from "../../core/forms.js";
import { pageWindow, toPage, type ListPage, type PageOptions, type PageWindow, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { languageFormats, parseMoodleDate } from "../reports/dates.js";
import { DatabaseError, NotADatabaseError } from "./database.js";

/** A file of an entry's file or image field. */
export interface DatabaseEntryFile {
  name: string;
  /** Its URL on the site (`pluginfile.php/…/mod_data/content/…`), when the entry's single view shows it. */
  url?: string;
}

/**
 * A field's value in an entry, as its edit form holds it: text (a short text, a number, a dropdown
 * list's or radio buttons' choice, a URL, a text area's HTML), a date (`"2001-03-05"`), the choices
 * of checkboxes and multi-select lists, `[latitude, longitude]` for coordinates and `[url, link text]`
 * for a URL field that asks for one, or the files of a file or image field.
 */
export type DatabaseEntryValue = string | string[] | DatabaseEntryFile[];

/** A field of an entry, by its id and name. */
export interface DatabaseEntryField {
  fieldId: number;
  /** The field's name, from the form's labels; none for one the form doesn't label (a date field outside Moodle's default add entry template). */
  name?: string;
  value: DatabaseEntryValue;
}

/** An entry of a database, as `databaseEntries` reads it. */
export interface DatabaseEntry {
  id: number;
  /** Who added it: its author's user id and full name, from the single view's `##user##` (or `##userpicture##`). */
  author?: { userId: number; name?: string };
  /** When it was added and last changed, from the single view's `##timeadded##` and `##timemodified##`. */
  created?: string;
  modified?: string;
  /** False while it waits for approval, as Moodle marks it (`##approvalstatus##`, `##approvalstatusclass##` or its approve action); true otherwise. */
  approved: boolean;
  /** Each field's value, from the entry's edit form: only for entries the person can edit (all of them with `mod/data:manageentries`; their own, while Moodle lets authors change them). */
  values?: DatabaseEntryField[];
}

/** What `databaseEntries` reads: entries matching `search`, a page of them with `limit` and `offset`. */
export interface DatabaseEntryOptions extends PageOptions {
  /** Moodle's simple search: entries with this text in any field. */
  search?: string;
}

/**
 * A value to give a field with `addDatabaseEntry` or `editDatabaseEntry`: text or a number for a
 * short text, number, URL, text area (HTML), dropdown list or radio buttons; a `Date` or
 * `"YYYY-MM-DD"` for a date; the choices for checkboxes and multi-select lists; `[latitude,
 * longitude]` for coordinates (`[url, link text]` for a URL that asks for one); a local file's
 * absolute path for a file or image field, `null` to remove its file.
 */
export type DatabaseEntryInput = string | number | Date | string[] | number[] | null;

/** Values by field id (`32` or `"32"`) or name (`"Title"`); fields left out keep what they have. */
export type DatabaseEntryValues = Record<string, DatabaseEntryInput>;

/** What `exportDatabaseEntries` adds beside the fields' columns: Moodle's export options, all off by default. */
export interface DatabaseExportOptions {
  /** The author's full name, username and email (Moodle's "Include user details", which takes `mod/data:exportuserinfo`). */
  userDetails?: boolean;
  /** When each entry was added and changed. */
  times?: boolean;
  /** Whether each entry is approved, for a database that needs approval. */
  approval?: boolean;
}

/** A form control, as the page has it. */
interface Control {
  name: string;
  tag: string;
  type: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  multiple: boolean;
  options: { value: string; selected: boolean }[];
}

/** An entry's form (`edit.php`), read: its controls, the fields' names by id, Moodle's messages. */
interface EntryForm {
  fatal?: string;
  alerts: string[];
  controls: Control[];
  names: Record<string, string>;
}

/** An entry's single view, read in its region (`#data-singleview-content`). */
interface SingleView {
  fatal?: string;
  author?: { userId: number; name?: string };
  times: string[];
  approved?: boolean;
  files: DatabaseEntryFile[];
}

/** A page of the list (`view.php`), read. */
interface ListView {
  fatal?: string;
  instanceId?: number;
  perPage: number;
  pages: number;
  ids: number[];
  /** Whether the page lists entries (Moodle's list region is there). */
  listed: boolean;
}

type Read = { kind: "list"; url: string } | { kind: "single"; url: string; id: number } | { kind: "form"; url: string };

/** Fetches pages from the open page and reads each by its kind; one round trip for many pages. */
function readPages(page: Page, requests: Read[]): Promise<(ListView | SingleView | EntryForm)[]> {
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  return inPage(
    page,
    async (requests) => {
      interface El {
        id: string;
        tagName: string;
        name: string;
        type: string;
        value: string;
        checked: boolean;
        disabled: boolean;
        multiple: boolean;
        href: string;
        src: string;
        title: string;
        textContent: string | null;
        className: string;
        options: ArrayLike<{ value: string; selected: boolean }>;
        elements: ArrayLike<El>;
        parentElement: El | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        closest(s: string): El | null;
        contains(other: El): boolean;
      }
      const g = globalThis as unknown as {
        fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
        DOMParser: new () => { parseFromString(html: string, type: string): El };
      };
      const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
      const fatalOf = (doc: El) => clean(doc.querySelector('[data-rel="fatalerror"] .errormessage')?.textContent) || undefined;
      const param = (url: string, name: string) => {
        try {
          return new URL(url).searchParams.get(name);
        } catch {
          return null;
        }
      };
      const readList = (doc: El) => {
        const fatal = fatalOf(doc);
        const d = doc.querySelector('form#options input[name="d"]')?.value ?? Array.from(doc.querySelectorAll('a[href*="/mod/data/"]')).map((a) => param(a.href, "d")).find((v) => v);
        const perPage = Number(doc.querySelector('select[name="perpage"] option[selected]')?.value ?? doc.querySelector('select[name="perpage"]')?.value ?? 10);
        const numbers = Array.from(doc.querySelectorAll("[data-page-number]")).map((e) => Number(e.getAttribute("data-page-number")));
        const ids: number[] = [];
        const region = doc.querySelector("#data-listview-content");
        if (region) {
          for (const element of Array.from(region.querySelectorAll('a[href], input[name="delcheck[]"]'))) {
            const id = element.tagName === "INPUT" ? element.value : (param(element.href, "rid") ?? param(element.href, "delete") ?? param(element.href, "approve") ?? param(element.href, "disapprove"));
            if (id && Number(id) > 0 && !ids.includes(Number(id))) ids.push(Number(id));
          }
        }
        return { fatal, instanceId: d ? Number(d) : undefined, perPage, pages: Math.max(1, ...numbers), ids, listed: region !== null };
      };
      const readSingle = (doc: El, id: number) => {
        const fatal = fatalOf(doc);
        const region = doc.querySelector("#data-singleview-content");
        if (!region) return { fatal, times: [], files: [] };
        const users = Array.from(region.querySelectorAll('a[href*="/user/view.php"]'));
        const userId = Number(param(users[0]?.href ?? "", "id")) || undefined;
        const named = users.find((a) => Number(param(a.href, "id")) === userId && !a.querySelector("img, .userinitials") && clean(a.textContent));
        const actions = Array.from(region.querySelectorAll("a[href]"));
        let approved: boolean | undefined;
        if (actions.some((a) => param(a.href, "approve") === String(id)) || region.querySelector(".notapproved, .mod-data-approval-status-badge")) approved = false;
        else if (actions.some((a) => param(a.href, "disapprove") === String(id)) || region.querySelector(".approved")) approved = true;
        const files: { name: string; url: string }[] = [];
        for (const element of Array.from(region.querySelectorAll('a[href*="/mod_data/content/"], img[src*="/mod_data/content/"]'))) {
          const url = (element.href || element.src).replace(/[?#].*$/, "");
          const name = decodeURIComponent(url.split("/").pop() ?? "");
          if (name && !files.some((f) => f.url === url)) files.push({ name, url });
        }
        return {
          fatal,
          author: userId ? { userId, name: named ? clean(named.textContent) : undefined } : undefined,
          times: Array.from(region.querySelectorAll("span[title]")).map((s) => s.title),
          approved,
          files,
        };
      };
      const readForm = (doc: El) => {
        const fatal = fatalOf(doc);
        const alerts = Array.from(doc.querySelectorAll(".alert-danger"))
          .filter((a) => !a.closest('[data-rel="fatalerror"]'))
          .map((a) => {
            for (const button of Array.from(a.querySelectorAll("button"))) button.textContent = "";
            return clean(a.textContent);
          })
          .filter(Boolean);
        const form = Array.from(doc.querySelectorAll("form")).find((f) => f.querySelector('input[name="rid"]') && f.querySelector('input[name="d"]'));
        if (!form) return { fatal, alerts, controls: [], names: {} };
        const controls = Array.from(form.elements)
          .filter((c) => c.name)
          .map((c) => ({
            name: c.name,
            tag: c.tagName.toLowerCase(),
            type: c.type,
            value: c.value,
            checked: c.checked,
            disabled: c.disabled,
            multiple: c.multiple,
            options: c.tagName === "SELECT" ? Array.from(c.options).map((o) => ({ value: o.value, selected: o.selected })) : [],
          }));
        // The fields' names: the hidden label or legend Moodle's fields write, else the default add entry template's heading.
        const names: Record<string, string> = {};
        for (const c of Array.from(form.elements)) {
          const id = /^field_(\d+)/.exec(c.name)?.[1];
          if (!id || names[id]) continue;
          const label = (c.id ? form.querySelector(`label[for="${c.id}"] .accesshide`) : null) ?? c.closest("fieldset")?.querySelector("legend .accesshide") ?? null;
          let name = clean(label?.textContent);
          if (!name) {
            const block = c.closest("#defaulttemplate-addentry .mb-3");
            name = clean(block?.querySelector(".fw-bold")?.textContent);
          }
          if (name) names[id] = name;
        }
        return { fatal, alerts, controls, names };
      };
      const results = [];
      for (const request of requests) {
        const html = await (await g.fetch(request.url, { credentials: "same-origin" })).text();
        const doc = new g.DOMParser().parseFromString(html, "text/html");
        results.push(request.kind === "list" ? readList(doc) : request.kind === "single" ? readSingle(doc, request.id) : readForm(doc));
      }
      return results;
    },
    requests,
  );
}

/** Opens a page of the database (`mod/data/<path>`), checked: `NotADatabaseError` when it isn't one, `DatabaseError` with `refused` when Moodle refuses it. */
async function openEntriesPage(context: BrowserContext, siteUrl: string, activityId: number, pathAndQuery: string, refused: (message: string) => string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/data/${pathAndQuery}`);
  try {
    const bodyId = await page.evaluate(() => (globalThis as unknown as { document: { body: { id: string } } }).document.body.id);
    const message = await moodleErrorMessage(page);
    if (!bodyId.startsWith("page-mod-data-")) throw new NotADatabaseError(`Activity ${activityId} isn't a database activity you can open${message ? ` (Moodle says: ${message})` : ""}.`);
    if (message !== undefined) throw new DatabaseError(refused(message));
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

const viewRefused = (activityId: number) => (message: string) => `You can't see database ${activityId}'s entries (Moodle says: ${message}): it takes Moodle's capability mod/data:viewentry.`;

/** The list's page `index` (from 0) as the person's list shows it: `search` applied, Moodle's order and entries per page. */
// Moodle applies `search` only with `filter=1`; without it, the person's last search stays in their session.
const listPath = (activityId: number, search: string, index: number) => `view.php?id=${activityId}&mode=list&advanced=0&filter=1&search=${encodeURIComponent(search)}&page=${index}`;
const listUrl = (siteUrl: string, activityId: number, search: string, index: number) => new URL(`mod/data/${listPath(activityId, search, index)}`, siteUrl).href;

/** The entries' ids in the window, from the list's pages that hold it; the database's instance id. */
async function listIds(page: Page, siteUrl: string, activityId: number, search: string, window: PageWindow): Promise<{ ids: number[]; instanceId?: number }> {
  const first = (await readPages(page, [{ kind: "list", url: page.url() }]))[0] as ListView;
  const perPage = Math.max(first.perPage, 1);
  const ids: number[] = [];
  const end = window.count === undefined ? Infinity : window.offset + window.count;
  for (let index = Math.floor(window.offset / perPage); index < first.pages && index * perPage < end; index++) {
    const listed = index === 0 ? first : ((await readPages(page, [{ kind: "list", url: listUrl(siteUrl, activityId, search, index) }]))[0] as ListView);
    if (listed.listed && listed.ids.length === 0) throw new DatabaseError(`Database ${activityId}'s list template shows no link to its entries: Moodle's ##actionsmenu##, ##more## or ##moreurl## tells them apart (its default template has ##actionsmenu##).`);
    listed.ids.forEach((id, i) => {
      const at = index * perPage + i;
      if (at >= window.offset && at < end && !ids.includes(id)) ids.push(id);
    });
  }
  return { ids, instanceId: first.instanceId };
}

/** A field's value from its controls in the entry's form; files come as the draft area's id, to list. */
function valueOf(controls: Control[], fieldId: string): { value?: DatabaseEntryValue; draft?: string } {
  const prefix = `field_${fieldId}`;
  const own = controls.filter((c) => c.name === prefix || c.name === `${prefix}[]` || c.name.startsWith(`${prefix}_`));
  const named = (suffix: string) => own.find((c) => c.name === `${prefix}${suffix}`);
  const file = named("_file");
  if (file) return { draft: file.value };
  const day = named("_day");
  if (day) {
    const pick = (c?: Control) => c?.options.find((o) => o.selected)?.value ?? c?.value ?? "";
    return { value: `${pick(named("_year"))}-${pick(named("_month")).padStart(2, "0")}-${pick(day).padStart(2, "0")}` };
  }
  const many = own.filter((c) => c.name === `${prefix}[]`);
  if (many.length > 0) {
    return { value: many.flatMap((c) => (c.tag === "select" ? c.options.filter((o) => o.selected).map((o) => o.value) : c.type === "checkbox" && c.checked ? [c.value] : [])).filter((v) => v !== "") };
  }
  const pair = [named("_0"), named("_1")];
  if (pair[0]) return { value: pair[1] ? [pair[0].value, pair[1].value] : pair[0].value };
  const editor = own.find((c) => c.tag === "textarea");
  if (editor) return { value: editor.value };
  const single = own.filter((c) => c.name === prefix);
  if (single.length === 0) return {};
  if (single[0]!.type === "radio") return { value: single.find((c) => c.checked)?.value ?? "" };
  if (single[0]!.tag === "select") return { value: single[0]!.options.find((o) => o.selected)?.value ?? "" };
  return { value: single[0]!.value };
}

const fieldIdsOf = (controls: Control[]) => [...new Set(controls.map((c) => /^field_(\d+)/.exec(c.name)?.[1]).filter((id): id is string => id !== undefined))];

/** The time spans' titles as instants: the earliest is when the entry was added, the latest when it changed. */
function entryTimes(titles: string[], format: { format: string; locale: string; timeZone: string }): { created?: string; modified?: string } {
  const times = titles.map((title) => parseMoodleDate(title, format)?.getTime()).filter((t): t is number => t !== undefined && !Number.isNaN(t));
  if (times.length < 2) return {};
  return { created: new Date(Math.min(...times)).toISOString(), modified: new Date(Math.max(...times)).toISOString() };
}

/**
 * A database activity's entries, in its list's order (the person's sort, or the database's), each
 * with its author, when it was added and changed, whether it's approved, and its fields' values for
 * the entries the person can edit (read from their edit forms; files with their URLs). `search` is
 * Moodle's simple search. With `limit`, a page of them (see "Long lists" in the docs' concepts), read
 * from the list's pages that hold it. Moodle's services for entries are only for its mobile app: the
 * list and each entry's single view are read through what Moodle's tags write in the database's
 * templates (its default ones and presets have them). Throws `NotADatabaseError` when the id isn't a
 * database, `DatabaseError` when the person can't see its entries or its list template shows no link to them.
 */
export function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options: WithLimit<DatabaseEntryOptions>): Promise<ListPage<DatabaseEntry>>;
export function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: WithoutLimit<DatabaseEntryOptions>): Promise<DatabaseEntry[]>;
export function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: DatabaseEntryOptions): Promise<DatabaseEntry[] | ListPage<DatabaseEntry>>;
export async function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options: DatabaseEntryOptions = {}): Promise<DatabaseEntry[] | ListPage<DatabaseEntry>> {
  const window = pageWindow(options);
  const search = options.search ?? "";
  const page = await openEntriesPage(context, siteUrl, activityId, listPath(activityId, search, 0), viewRefused(activityId));
  try {
    const { ids, instanceId } = await listIds(page, siteUrl, activityId, search, window);
    if (ids.length === 0) return toPage([], options.limit);
    if (!instanceId) throw new DatabaseError(`Database ${activityId}'s page doesn't say its instance id, which its entries' pages take.`);
    const [strings, timeZone] = await Promise.all([
      languageFormats(context, siteUrl, ["strftimedaydatetime"]),
      page.evaluate(() => (globalThis as unknown as { M: { cfg: { usertimezone?: string } } }).M.cfg.usertimezone ?? "UTC"),
    ]);
    const format = { format: strings.formats.strftimedaydatetime ?? "%A, %d %B %Y, %I:%M %p", locale: strings.locale, timeZone };
    const entries: DatabaseEntry[] = [];
    for (const id of ids) {
      const [single, form] = (await readPages(page, [
        { kind: "single", id, url: new URL(`mod/data/view.php?d=${instanceId}&rid=${id}`, siteUrl).href },
        { kind: "form", url: new URL(`mod/data/edit.php?id=${activityId}&rid=${id}`, siteUrl).href },
      ])) as [SingleView, EntryForm];
      const entry: DatabaseEntry = { id, author: single.author, ...entryTimes(single.times, format), approved: single.approved ?? true };
      if (!form.fatal && form.controls.length > 0) {
        const values: DatabaseEntryField[] = [];
        for (const fieldId of fieldIdsOf(form.controls)) {
          const { value, draft } = valueOf(form.controls, fieldId);
          let read = value;
          if (draft !== undefined) {
            read = (await draftFiles(page, draft)).map((file) => ({ name: file.name, url: single.files.find((f) => f.name === file.name)?.url }));
          }
          if (read !== undefined) values.push({ fieldId: Number(fieldId), name: form.names[fieldId], value: read });
        }
        entry.values = values;
      }
      entries.push(entry);
    }
    return toPage(entries, options.limit);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The form's values as the browser would send them (no buttons), before any change. */
function formPairs(controls: Control[]): [string, string][] {
  const pairs: [string, string][] = [];
  for (const c of controls) {
    if (c.disabled || ["submit", "button", "image", "reset", "file"].includes(c.type)) continue;
    if ((c.type === "checkbox" || c.type === "radio") && !c.checked) continue;
    if (c.tag === "select") {
      const selected = c.options.filter((o) => o.selected);
      for (const o of selected.length > 0 || c.multiple ? selected : c.options.slice(0, 1)) pairs.push([c.name, o.value]);
    } else {
      pairs.push([c.name, c.value]);
    }
  }
  return pairs;
}

const invalid = (message: string) => new MoodleError(message, "invalid-input");

/** A date input as Moodle's date selectors' day, month and year. */
function dateParts(value: DatabaseEntryInput, label: string): { day: string; month: string; year: string } {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { day: String(value.getDate()), month: String(value.getMonth() + 1), year: String(value.getFullYear()) };
  const match = typeof value === "string" ? /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim()) : null;
  if (!match) throw invalid(`${label} is a date: give a Date or "YYYY-MM-DD", not ${JSON.stringify(value)}.`);
  return { year: match[1]!, month: String(Number(match[2])), day: String(Number(match[3])) };
}

/** The values given, set on the form's pairs by field; the files to upload or remove by draft area. Throws `invalid-input` for a field the form hasn't or a value it doesn't take. */
function applyValues(form: EntryForm, values: DatabaseEntryValues): { pairs: [string, string][]; files: { draft: string; file: string | null; label: string }[] } {
  let pairs = formPairs(form.controls);
  const files: { draft: string; file: string | null; label: string }[] = [];
  const ids = fieldIdsOf(form.controls);
  const known = () => ids.map((id) => (form.names[id] ? `${id} "${form.names[id]}"` : id)).join(", ");
  for (const [key, value] of Object.entries(values)) {
    const fieldId = /^\d+$/.test(key) && ids.includes(key) ? key : ids.find((id) => form.names[id] === key);
    if (!fieldId) throw invalid(`The entry form has no field "${key}": its fields are ${known() || "none"}.`);
    const label = `Field ${fieldId}${form.names[fieldId] ? ` "${form.names[fieldId]}"` : ""}`;
    const prefix = `field_${fieldId}`;
    const own = form.controls.filter((c) => c.name === prefix || c.name === `${prefix}[]` || c.name.startsWith(`${prefix}_`));
    const set = (name: string, ...given: string[]) => {
      pairs = pairs.filter(([n]) => n !== name);
      for (const v of given) pairs.push([name, v]);
    };
    const offered = (c: Control, wanted: string[]) => {
      const options = c.options.map((o) => o.value).filter((v) => v !== "");
      const missing = wanted.filter((v) => !options.includes(v));
      if (missing.length > 0) throw invalid(`${label} doesn't take ${missing.map((m) => JSON.stringify(m)).join(", ")}: it offers ${options.map((o) => JSON.stringify(o)).join(", ")}.`);
    };
    const file = own.find((c) => c.name === `${prefix}_file`);
    const day = own.find((c) => c.name === `${prefix}_day`);
    const many = own.filter((c) => c.name === `${prefix}[]`);
    const pair = own.find((c) => c.name === `${prefix}_0`);
    const editor = own.find((c) => c.tag === "textarea");
    const single = own.filter((c) => c.name === prefix);
    if (file) {
      if (value !== null && (typeof value !== "string" || !path.isAbsolute(value))) throw invalid(`${label} takes a file: give its absolute path, or null to remove it.`);
      files.push({ draft: file.value, file: value, label });
    } else if (day) {
      const parts = dateParts(value, label);
      offered(own.find((c) => c.name === `${prefix}_year`)!, [parts.year]);
      set(`${prefix}_day`, parts.day);
      set(`${prefix}_month`, parts.month);
      set(`${prefix}_year`, parts.year);
    } else if (many.length > 0) {
      const wanted = (Array.isArray(value) ? value : value === null ? [] : [value]).map(String);
      const select = many.find((c) => c.tag === "select");
      if (select) {
        offered(select, wanted);
        set(`${prefix}[]`, ...wanted);
      } else {
        const boxes = many.filter((c) => c.type === "checkbox");
        offered({ ...boxes[0]!, options: boxes.map((c) => ({ value: c.value, selected: false })) }, wanted);
        // Moodle's checkboxes go with an empty hidden value each: kept, as the browser sends them.
        set(`${prefix}[]`, ...many.filter((c) => c.type === "hidden").map((c) => c.value), ...wanted);
      }
    } else if (pair) {
      const parts = Array.isArray(value) ? value.map(String) : [value === null ? "" : String(value)];
      if (parts.length > 2 || (parts.length === 2 && !own.some((c) => c.name === `${prefix}_1`))) throw invalid(`${label} takes one value, not ${JSON.stringify(value)}.`);
      set(`${prefix}_0`, parts[0]!);
      if (parts.length === 2) set(`${prefix}_1`, parts[1]!);
    } else if (editor) {
      set(editor.name, value === null ? "" : String(value));
    } else if (single.length > 0) {
      if (Array.isArray(value) || value instanceof Date) throw invalid(`${label} takes one value, not ${JSON.stringify(value)}.`);
      const text = value === null ? "" : String(value);
      if (single[0]!.type === "radio") {
        offered({ ...single[0]!, options: single.map((c) => ({ value: c.value, selected: false })) }, text === "" ? [] : [text]);
      } else if (single[0]!.tag === "select" && text !== "") {
        offered(single[0]!, [text]);
      }
      set(prefix, ...(single[0]!.type === "radio" && text === "" ? [] : [text]));
    } else {
      throw invalid(`${label} has no input the driver knows in the entry form.`);
    }
  }
  return { pairs, files };
}

/** Posts the entry's form from the page as Moodle's Save does (multipart); where Moodle landed, and its messages. */
function postEntryForm(page: Page, url: string, pairs: [string, string][]): Promise<{ url: string; view: boolean; shown?: number; fatal?: string; alerts: string[] }> {
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  return inPage(
    page,
    async ({ url, pairs }) => {
      interface El {
        textContent: string | null;
        href: string;
        body: { id: string };
        closest(s: string): El | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as {
        fetch(url: string, init: object): Promise<{ url: string; text(): Promise<string> }>;
        FormData: new () => { append(name: string, value: string): void };
        DOMParser: new () => { parseFromString(html: string, type: string): El };
      };
      const body = new g.FormData();
      for (const [name, value] of pairs) body.append(name, value);
      const response = await g.fetch(url, { method: "POST", body, credentials: "same-origin" });
      const doc = new g.DOMParser().parseFromString(await response.text(), "text/html");
      const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
      const alerts = Array.from(doc.querySelectorAll(".alert-danger"))
        .filter((a) => !a.closest('[data-rel="fatalerror"]'))
        .map((a) => {
          for (const button of Array.from(a.querySelectorAll("button"))) button.textContent = "";
          return clean(a.textContent);
        })
        .filter(Boolean);
      // The entry Moodle shows when it lands on its single view: the first entry its links name.
      const ids = Array.from(doc.querySelectorAll("#data-singleview-content a[href]")).map((a) => {
        const params = new URL(a.href).searchParams;
        return Number(params.get("rid") ?? params.get("delete") ?? 0);
      });
      return { url: response.url, view: doc.body.id === "page-mod-data-view", shown: ids.find((id) => id > 0), fatal: clean(doc.querySelector('[data-rel="fatalerror"] .errormessage')?.textContent) || undefined, alerts };
    },
    { url, pairs },
  );
}

/** Fills and saves the entry form at `formPath` (new entry or `rid`), as the person would; the entry's id. */
async function saveEntry(context: BrowserContext, siteUrl: string, activityId: number, formPath: string, values: DatabaseEntryValues, refused: (message: string) => string, what: string): Promise<number> {
  if (values === null || typeof values !== "object" || Array.isArray(values)) throw invalid("Give the entry's values as an object by field id or name.");
  await checkLocalFiles(Object.values(values).filter((v): v is string => typeof v === "string" && path.isAbsolute(v)));
  const page = await openEntriesPage(context, siteUrl, activityId, formPath, refused);
  try {
    const [form] = (await readPages(page, [{ kind: "form", url: page.url() }])) as [EntryForm];
    if (form.controls.length === 0) throw new DatabaseError(`Moodle shows no entry form for ${what}${form.fatal ? ` (Moodle says: ${form.fatal})` : ""}.`);
    const { pairs, files } = applyValues(form, values);
    for (const { draft, file, label } of files) {
      try {
        for (const existing of await draftFiles(page, draft)) await deleteDraftFile(page, draft, existing.name);
        if (file !== null) await uploadToDraft(page, draft, [file]);
      } catch (error) {
        if (error instanceof FormError) throw new DatabaseError(`${label}: ${error.message}`);
        throw error;
      }
    }
    pairs.push(["saveandview", "1"]);
    const outcome = await postEntryForm(page, new URL("mod/data/edit.php", siteUrl).href, pairs);
    // Saved, Moodle redirects to the entry's single view (view.php?d=…&rid=…).
    const rid = Number(new URL(outcome.url).searchParams.get("rid"));
    if (outcome.url.includes("/mod/data/view.php") && rid > 0) return rid;
    if (outcome.view && !outcome.fatal && outcome.alerts.length === 0 && outcome.shown) return outcome.shown;
    if (outcome.fatal) throw new DatabaseError(refused(outcome.fatal));
    throw new DatabaseError(`Moodle didn't save ${what}${outcome.alerts.length > 0 ? `: ${outcome.alerts.join("; ")}` : "."}`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Adds an entry to a database activity through its "Add entry" form, as the person would: `values` by
 * field id or name (see `DatabaseEntryInput`); fields left out stay as the form has them (a date
 * field's form starts at today, and Moodle saves it). Local files go up to the field's draft area,
 * as the file picker does. Returns the new entry's id. Throws `MoodleError` (`invalid-input`) for a
 * field the form hasn't or a value it doesn't take, before anything is saved; `DatabaseError` when
 * Moodle refuses the person (it takes `mod/data:writeentry`, within the database's dates and entry
 * limits) or the entry (a required field without a value…, with Moodle's messages); `NotADatabaseError`.
 */
export async function addDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, values: DatabaseEntryValues): Promise<{ changed: string; entryId: number }> {
  const entryId = await saveEntry(context, siteUrl, activityId, `edit.php?id=${activityId}`, values, (message) => `You can't add entries to database ${activityId} (Moodle says: ${message}): it takes Moodle's capability mod/data:writeentry, within the database's dates and its limit of entries.`, `the new entry of database ${activityId}`);
  return { changed: `Added entry ${entryId} to database ${activityId}.`, entryId };
}

/**
 * Changes an entry of a database activity through its edit form: what `values` leaves out stays as it
 * is (files included). Returns the entry's id. Throws `MoodleError` (`invalid-input`) as
 * `addDatabaseEntry` does; `DatabaseError` when Moodle doesn't let the person edit it (someone
 * else's takes `mod/data:manageentries`; authors change theirs while Moodle lets them: not once
 * approved, unless the database allows it) or refuses the values; `NotADatabaseError`.
 */
export async function editDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, values: DatabaseEntryValues): Promise<{ changed: string; entryId: number }> {
  if (!Number.isInteger(entryId) || entryId <= 0) throw invalid(`An entry's id is a whole number, not ${entryId}.`);
  await saveEntry(context, siteUrl, activityId, `edit.php?id=${activityId}&rid=${entryId}`, values, (message) => `You can't edit entry ${entryId} of database ${activityId} (Moodle says: ${message}): someone else's entry takes Moodle's capability mod/data:manageentries, and authors change theirs only while Moodle lets them.`, `entry ${entryId} of database ${activityId}`);
  return { changed: `Changed entry ${entryId} of database ${activityId}.`, entryId };
}

/** Sends one of the list's actions on an entry (`view.php`, with the sesskey), as its links do; whether Moodle says it did it. */
async function entryAction(context: BrowserContext, siteUrl: string, activityId: number, params: Record<string, string>, method: "GET" | "POST"): Promise<boolean> {
  const page = await openEntriesPage(context, siteUrl, activityId, `view.php?id=${activityId}`, viewRefused(activityId));
  try {
    return await inPage(
      page,
      async ({ url, params, method }) => {
        const g = globalThis as unknown as {
          M: { cfg: { sesskey: string } };
          fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
          URLSearchParams: new (init: Record<string, string>) => { toString(): string };
          DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): unknown } };
        };
        const query = new g.URLSearchParams({ ...params, sesskey: g.M.cfg.sesskey }).toString();
        const response = method === "GET" ? await g.fetch(`${url}?${query}`, { credentials: "same-origin" }) : await g.fetch(url, { method: "POST", body: new g.URLSearchParams({ ...params, sesskey: g.M.cfg.sesskey }), credentials: "same-origin" });
        const doc = new g.DOMParser().parseFromString(await response.text(), "text/html");
        return doc.querySelector(".alert-success") !== null;
      },
      { url: new URL("mod/data/view.php", siteUrl).href, params, method },
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Deletes an entry of a database activity, as its Delete action confirmed does: its values and files
 * go with it. Throws `DatabaseError` when Moodle doesn't delete it: the database has no such entry,
 * or the person can't (someone else's takes `mod/data:manageentries`; authors delete theirs while
 * Moodle lets them change it); `NotADatabaseError`.
 */
export async function deleteDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<{ changed: string }> {
  if (!Number.isInteger(entryId) || entryId <= 0) throw invalid(`An entry's id is a whole number, not ${entryId}.`);
  const done = await entryAction(context, siteUrl, activityId, { id: String(activityId), delete: String(entryId), confirm: "1" }, "POST");
  if (!done) throw new DatabaseError(`Moodle didn't delete entry ${entryId} of database ${activityId}: the database has no such entry, or you can't delete it (someone else's takes Moodle's capability mod/data:manageentries; authors delete theirs only while Moodle lets them change it).`);
  return { changed: `Deleted entry ${entryId} of database ${activityId}.` };
}

/**
 * Approves an entry of a database activity, or takes its approval back, as its Approve and Undo
 * approval actions do: an entry waiting for approval shows only to its author and to those who can
 * approve. Throws `DatabaseError` when Moodle doesn't do it: the person lacks `mod/data:approve`, or
 * the database has no such entry; `NotADatabaseError`.
 */
export async function setDatabaseEntryApproved(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, approved: boolean): Promise<{ changed: string; approved: boolean }> {
  if (!Number.isInteger(entryId) || entryId <= 0) throw invalid(`An entry's id is a whole number, not ${entryId}.`);
  const done = await entryAction(context, siteUrl, activityId, { id: String(activityId), [approved ? "approve" : "disapprove"]: String(entryId) }, "GET");
  if (!done) throw new DatabaseError(`Moodle didn't ${approved ? "approve" : "take back the approval of"} entry ${entryId} of database ${activityId}: it takes Moodle's capability mod/data:approve, and an entry of that database.`);
  return { changed: `${approved ? "Approved" : "Took back the approval of"} entry ${entryId} of database ${activityId}.`, approved };
}

/** How many records a CSV text holds after its header, quoted line breaks and all. */
export function csvRecords(csv: string): number {
  let rows = 0;
  let quoted = false;
  let content = false;
  for (const char of csv) {
    if (char === '"') quoted = !quoted;
    if (char === "\n" && !quoted) {
      if (content) rows++;
      content = false;
    } else if (char !== "\r") content = true;
  }
  if (content) rows++;
  return Math.max(rows - 1, 0);
}

/**
 * Exports a database activity's entries to a CSV file (`file`, an absolute path, replaced if it's
 * there), as its "Export entries" page does with a comma: a column per field that Moodle exports (not
 * images and files, which go only in its zip), by the field's name, and `options`' columns. Every
 * entry of the person's group, approved or not. Returns where it wrote it and how many entries.
 * Throws `DatabaseError` when Moodle refuses the export (it takes `mod/data:viewalluserpresets`,
 * which teachers have) or the database has no fields; `NotADatabaseError`.
 */
export async function exportDatabaseEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options: DatabaseExportOptions = {}): Promise<{ file: string; entries: number }> {
  if (!path.isAbsolute(file)) throw invalid(`Give the file as an absolute path: "${file}".`);
  const view = await openEntriesPage(context, siteUrl, activityId, `view.php?id=${activityId}`, viewRefused(activityId));
  let instanceId: number | undefined;
  try {
    instanceId = ((await readPages(view, [{ kind: "list", url: view.url() }]))[0] as ListView).instanceId;
  } finally {
    await view.close().catch(() => undefined);
  }
  if (!instanceId) throw new DatabaseError(`Database ${activityId}'s page doesn't say its instance id, which its export page takes.`);
  const refused = (message: string) => `You can't export database ${activityId}'s entries (Moodle says: ${message}): it takes Moodle's capability mod/data:viewalluserpresets, which teachers have.`;
  const page = await openEntriesPage(context, siteUrl, activityId, `export.php?d=${instanceId}`, refused);
  try {
    if (!page.url().includes("/mod/data/export.php")) throw new DatabaseError(`Database ${activityId} has no fields yet: there's nothing to export.`);
    const answer = await inPage(
      page,
      async ({ options }) => {
        interface Control {
          name: string;
          type: string;
          checked: boolean;
        }
        const g = globalThis as unknown as {
          document: { querySelector(s: string): { action: string; elements: ArrayLike<Control> } | null };
          fetch(url: string, init: object): Promise<{ headers: { get(name: string): string | null }; text(): Promise<string> }>;
          FormData: new (form: unknown) => { set(name: string, value: string): void; delete(name: string): void; has(name: string): boolean };
        };
        const form = g.document.querySelector("form.mform");
        if (!form) return { ok: false, text: "the page has no export form" };
        const body = new g.FormData(form);
        const names = Array.from(form.elements).map((c) => c.name);
        body.set("exporttype", "csv");
        body.set("delimiter_name", "comma");
        body.delete("cancel");
        body.delete("includefiles");
        for (const [name, wanted] of Object.entries(options)) {
          if (!names.includes(name)) continue;
          if (wanted) body.set(name, "1");
          else body.delete(name);
        }
        const response = await g.fetch(form.action, { method: "POST", body, credentials: "same-origin" });
        const type = response.headers.get("content-type") ?? "";
        return { ok: !type.includes("text/html"), text: await response.text(), offered: names };
      },
      { options: { exportuser: options.userDetails === true, exporttime: options.times === true, exportapproval: options.approval === true } },
    );
    if (!answer.ok) throw new DatabaseError(`Moodle didn't export database ${activityId}'s entries: ${answer.text.startsWith("the page") ? answer.text : "it answered with a page, not a file"}.`);
    if (options.userDetails && !answer.offered?.includes("exportuser")) throw new DatabaseError(`Moodle doesn't let you export the authors' details of database ${activityId}: it takes Moodle's capability mod/data:exportuserinfo.`);
    await writeFile(file, answer.text, "utf8");
    return { file, entries: csvRecords(answer.text) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Imports entries into a database activity from a CSV file (an absolute path), as its "Import entries"
 * page does: a header row with the fields' names (as `exportDatabaseEntries` writes it; its user,
 * time and approval columns are taken or skipped as Moodle does: a `Username` column makes that user
 * the author), `delimiter` between values (a comma unless given), UTF-8. Returns how many entries
 * Moodle added. Throws `DatabaseError` when Moodle refuses the person (it takes
 * `mod/data:manageentries`) or the file (a column that isn't a field…, with Moodle's message);
 * `NotADatabaseError`.
 */
export async function importDatabaseEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, { delimiter = "comma" }: { delimiter?: "comma" | "semicolon" | "tab" | "colon" } = {}): Promise<{ changed: string; added: number }> {
  await checkLocalFiles([file]);
  const refused = (message: string) => `You can't import entries into database ${activityId} (Moodle says: ${message}): it takes Moodle's capability mod/data:manageentries.`;
  const opened = await openEntriesPage(context, siteUrl, activityId, `import.php?id=${activityId}`, refused);
  await opened.close().catch(() => undefined);
  const page = await openForm(context, siteUrl, `mod/data/import.php?id=${activityId}`);
  try {
    const draft = await formValue(page, "recordsfile");
    if (!draft) throw new DatabaseError(`Database ${activityId}'s import page has no file to upload to.`);
    await uploadToDraft(page, draft, [file]);
    await setFields(page, { fielddelimiter: delimiter, encoding: "UTF-8" });
    await submitForm(page, "submitbutton");
    const fatal = await moodleErrorMessage(page);
    if (fatal) throw new DatabaseError(`Moodle didn't import ${path.basename(file)} into database ${activityId}: ${fatal}`);
    // Through inPage: it has a helper function (see the conventions on page.evaluate).
    const outcome = await inPage(
      page,
      () => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }).document;
        const text = (s: string) => (doc.querySelector(s)?.textContent ?? "").replace(/\s+/g, " ").trim();
        return { success: text(".alert-success"), error: text(".alert-danger") };
      },
      null,
    );
    // Moodle's notification starts with the count: "2 entries saved".
    const added = Number(/^\d+/.exec(outcome.success)?.[0] ?? NaN);
    if (!outcome.success || Number.isNaN(added)) throw new DatabaseError(`Moodle didn't import ${path.basename(file)} into database ${activityId}${outcome.error ? `: ${outcome.error}` : "."}`);
    return { changed: `Imported ${added} entr${added === 1 ? "y" : "ies"} into database ${activityId} from ${path.basename(file)}.`, added };
  } finally {
    await page.close().catch(() => undefined);
  }
}
