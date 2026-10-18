// A made-up database activity's entries pages, as Moodle 5.2 renders them with its default templates
// (mod/data/view.php's list and single view, edit.php, export.php, import.php), keeping what is
// posted to them as Moodle keeps it.
import type { BrowserContext, Route } from "playwright-core";
import { SITE, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

export interface FakeEntry {
  id: number;
  userId: number;
  author: string;
  /** Moodle's userdate() of when it was added and changed, as the time tags' titles show them. */
  added: string;
  modified: string;
  approved: boolean;
  /** Field values by field id: text, a date as "YYYY-MM-DD", checkboxes' choices, a picture's file name. */
  values: Record<number, string | string[]>;
  /** The person can edit it (their own, or they manage entries). */
  editable: boolean;
}

export interface FakeEntries {
  /** The database's course module id; its instance id is ten times it. */
  cmid: number;
  entries: FakeEntry[];
  /** Entries per page in the person's list. */
  perPage: number;
  /** The person can add entries, approve them, delete others', export them, import them. */
  can: { add: boolean; approve: boolean; manage: boolean; export: boolean };
  /** Every request with a body, by path: the form's values (multipart or not) by name. */
  posts: { path: string; form: [string, string][] }[];
  /** Every list page asked for, with its query. */
  lists: URLSearchParams[];
  /** Files uploaded to draft areas: "<itemid>:<name>". */
  uploads: string[];
  /** The add entry template's headings as Moodle 4.5 writes them (Bootstrap 4's font-weight-bold). */
  moodle45?: boolean;
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const page = (body: string, bodyId: string) => moodlePage({ userId: 3, body, bodyId, contextId: 77 });
const fatal = (message: string, bodyId: string) => page(`<div data-rel="fatalerror" class="box py-3 errorbox alert alert-danger"><p class="errormessage">${message}</p></div>`, bodyId);
const notice = (message: string, type: "success" | "danger") => `<div class="alert alert-${type} alert-block fade in alert-dismissible" role="alert">${message}<button type="button" class="btn-close"><span class="visually-hidden">Dismiss this notification</span></button></div>`;
// Field ids: 11 Title (text), 12 Colour (menu), 13 Born (date), 14 Tags (checkbox), 15 Photo (picture).
const TITLE = 11;
const COLOUR = 12;
const BORN = 13;
const TAGS = 14;
const PHOTO = 15;

/** What ##actionsmenu## writes for an entry: show more, edit and delete when the person can, approve or undo. */
function actionsMenu(db: FakeEntries, entry: FakeEntry, list: boolean): string {
  const d = db.cmid * 10;
  const links = [list ? `<a href="${SITE}mod/data/view.php?d=${d}&amp;rid=${entry.id}&amp;filter=1">Show more</a>` : ""];
  if (entry.editable) links.push(`<a href="${SITE}mod/data/edit.php?d=${d}&amp;rid=${entry.id}">Edit</a><a href="${SITE}mod/data/view.php?d=${d}&amp;delete=${entry.id}&amp;mode=single">Delete</a>`);
  if (db.can.approve) links.push(`<a href="${SITE}mod/data/view.php?d=${d}&amp;${entry.approved ? "disapprove" : "approve"}=${entry.id}&amp;sesskey=s1">Approve</a>`);
  return `<div class="action-menu entry-actionsmenu"><div class="dropdown-menu">${links.join("")}</div></div>`;
}

/** An entry as the default list or single template renders it. */
function rendered(db: FakeEntries, entry: FakeEntry, list: boolean): string {
  const user = `${SITE}user/view.php?id=${entry.userId}&amp;course=2`;
  const photo = entry.values[PHOTO] ? `<img src="${SITE}pluginfile.php/77/mod_data/content/${entry.id}0/${entry.values[PHOTO]}" alt="">` : "";
  return `<div class="defaulttemplate-listentry"><a href="${user}"><span class="userinitials">AB</span></a><a href="${user}">${escape(entry.author)}</a><span class="data-timeinfo"><span title="${entry.added}">x</span></span><span class="data-timeinfo"><span title="${entry.modified}">y</span></span>
<div>${actionsMenu(db, entry, list)}</div><div class="${entry.approved ? "approved" : "notapproved"}">${entry.approved ? "" : '<div class="mod-data-approval-status-badge">Pending approval</div>'}</div>
<div>Title ${escape(String(entry.values[TITLE] ?? ""))} Colour ${escape(String(entry.values[COLOUR] ?? ""))} ${photo}</div></div>`;
}

function listPage(db: FakeEntries, query: URLSearchParams, message = ""): string {
  const search = query.get("filter") === "1" ? (query.get("search") ?? "") : "";
  const found = db.entries.filter((e) => !search || Object.values(e.values).some((v) => String(v).includes(search)));
  const index = Number(query.get("page") ?? 0);
  const shown = found.slice(index * db.perPage, (index + 1) * db.perPage);
  const pages = Math.ceil(found.length / db.perPage);
  const options = [2, 3, 10].map((n) => `<option${n === db.perPage ? ' selected="selected"' : ""} value="${n}">${n}</option>`).join("");
  const preferences = `<form id="options" action="view.php" method="get"><input type="hidden" name="d" value="${db.cmid * 10}" /><select id="pref_perpage" name="perpage">${options}</select></form>`;
  const paging = pages > 1 ? `<nav class="pagination"><ul class="pagination">${Array.from({ length: pages }, (_, i) => `<li class="page-item" data-page-number="${i + 1}"><a href="${SITE}mod/data/view.php?d=${db.cmid * 10}&amp;page=${i}" class="page-link">${i + 1}</a></li>`).join("")}</ul></nav>` : "";
  const list = shown.length > 0 ? `<form action="${SITE}mod/data/view.php?d=${db.cmid * 10}&amp;sesskey=s1" method="post"><div id="data-listview-content" class="box py-3">${shown.map((e) => rendered(db, e, true)).join("")}</div>${paging}</form>` : "<p>No entries</p>";
  const add = `<a href="${SITE}mod/data/edit.php?d=${db.cmid * 10}">Add entry</a>`;
  return page(`${message}${add}${db.entries.length > 0 ? preferences : ""}${list}`, "page-mod-data-view");
}

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);
const YEARS = Array.from({ length: 151 }, (_, i) => 1900 + i);

/** The add or edit entry form, as edit.php writes it with the default add entry template. */
function entryForm(db: FakeEntries, entry: FakeEntry | undefined, message = ""): string {
  const values = entry?.values ?? {};
  const [year, month, day] = String(values[BORN] ?? "2026-10-17").split("-").map(Number);
  const select = (name: string, options: number[], selected: number) => `<select name="${name}">${options.map((o) => `<option value="${o}"${o === selected ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  const tags = (values[TAGS] as string[] | undefined) ?? [];
  const block = (name: string, input: string) => `<div class="mb-3 pt-3"><div class="${db.moodle45 ? "font-weight-bold" : "fw-bold"}">${name}</div><div title="">${input}</div></div>`;
  const draft = entry ? `${entry.id}00` : "900";
  const fields = [
    block("Title", `<label for="field_${TITLE}"><span class="accesshide">Title</span></label><input type="text" name="field_${TITLE}" id="field_${TITLE}" value="${escape(String(values[TITLE] ?? ""))}" />`),
    block("Colour", `<label for="field_${COLOUR}"><span class="accesshide">Colour</span></label><select id="field_${COLOUR}" name="field_${COLOUR}"><option value="">Choose...</option>${["Red", "Blue"].map((c) => `<option value="${c}"${values[COLOUR] === c ? ' selected="selected"' : ""}>${c}</option>`).join("")}</select>`),
    block("Born", `<label for="ts_1" class="visually-hidden">Day</label>${select(`field_${BORN}_day`, DAYS, day!)}${select(`field_${BORN}_month`, DAYS.slice(0, 12), month!)}${select(`field_${BORN}_year`, YEARS, year!)}`),
    block("Tags", `<fieldset><legend><span class="accesshide">Tags</span></legend>${["a", "b"].map((t, i) => `<input type="hidden" name="field_${TAGS}[]" value="" /><input type="checkbox" id="field_${TAGS}_${i}" name="field_${TAGS}[]" value="${t}"${tags.includes(t) ? " checked" : ""} /><label for="field_${TAGS}_${i}">${t}</label>`).join("")}</fieldset>`),
    block("Photo", `<fieldset><legend><span class="accesshide">Photo</span></legend><div class="filemanager"></div><input type="hidden" name="field_${PHOTO}_file" value="${draft}" /><input type="text" name="field_${PHOTO}_alttext" id="field_${PHOTO}_alttext" value="" /></fieldset>`),
  ];
  // The file picker's settings, with the upload repository, as the page's JavaScript gets them.
  const picker = `<script>var fp = {"repositories":{"4":{"id":"4","name":"Upload a file","type":"upload"}}};</script>`;
  return page(
    `${picker}${message}<form enctype="multipart/form-data" action="edit.php" method="post"><div><input name="d" value="${db.cmid * 10}" type="hidden" /><input name="rid" value="${entry?.id ?? 0}" type="hidden" /><input name="sesskey" value="s1" type="hidden" /><div id="defaulttemplate-addentry">${fields.join("")}</div><input type="submit" name="saveandadd" value="Save and add another" /><input type="submit" name="saveandview" value="Save" /></div></form>`,
    "page-mod-data-edit",
  );
}

/** A multipart or urlencoded body's values, in order. */
function bodyValues(contentType: string, body: string): [string, string][] {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  if (!boundary) return [...new URLSearchParams(body)];
  return body
    .split(`--${boundary}`)
    .map((part) => /name="([^"]+)"(?:; filename="[^"]*")?\r\n(?:[^\r]+\r\n)*\r\n([\s\S]*)\r\n$/.exec(part))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1]!, m[2]!]);
}

/** Serves the database's entries pages at `SITE`; other ids are another module's (Moodle's error page). */
export async function serveEntries(context: BrowserContext, db: FakeEntries): Promise<FakeMoodleState> {
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    pagesServed: [],
    services: { core_get_strings: () => [{ stringid: "strftimedaydatetime", string: "%A, %d %B %Y, %I:%M %p" }, { stringid: "locale", string: "en_AU.UTF-8" }] },
  };
  await serveFakeMoodle(context, state);
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  const draft = new Map<string, string[]>();
  await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
    const values = bodyValues(route.request().headers()["content-type"] ?? "", route.request().postData() ?? "");
    const field = (name: string) => values.find(([n]) => n === name)?.[1] ?? "";
    db.uploads.push(`${field("itemid")}:${field("title")}`);
    draft.set(field("itemid"), [...(draft.get(field("itemid")) ?? []), field("title")]);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/${field("itemid")}/${field("title")}` }) });
  });
  await context.route(`${SITE}repository/draftfiles_ajax.php**`, (route: Route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const form = new URLSearchParams(route.request().postData() ?? "");
    const itemid = form.get("itemid") ?? "";
    // An entry's draft area starts with its picture, as file_prepare_draft_area copies it.
    if (!draft.has(itemid)) {
      const entry = db.entries.find((e) => `${e.id}00` === itemid);
      draft.set(itemid, entry?.values[PHOTO] ? [String(entry.values[PHOTO])] : []);
    }
    const files = draft.get(itemid)!;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (action === "list") return json({ list: files.map((filename) => ({ type: "file", filepath: "/", filename, size: 3 })), filecount: files.length });
    if (action === "delete") {
      draft.set(itemid, files.filter((f) => f !== form.get("filename")));
      return json({ filepath: "/" });
    }
    return json(false);
  });
  await context.route(`${SITE}mod/data/*.php**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const posted = request.method() === "POST" ? bodyValues(request.headers()["content-type"] ?? "", request.postData() ?? "") : [];
    const param = (name: string) => url.searchParams.get(name) ?? posted.find(([n]) => n === name)?.[1] ?? null;
    const path = url.pathname;
    state.pagesServed?.push(path);
    const cmid = Number(param("id") ?? 0) || Number(param("d") ?? 0) / 10;
    if (cmid !== db.cmid) return html(route, fatal(`Invalid course module ID: ${cmid}`, "page-site-index"));
    if (request.method() === "POST") db.posts.push({ path, form: posted });
    const rid = Number(param("rid") ?? 0);
    const entry = db.entries.find((e) => e.id === rid);
    if (path === "/mod/data/view.php") {
      if (rid && !param("id")) return html(route, entry ? page(`<div id="data-singleview-content">${rendered(db, entry, false)}</div>`, "page-mod-data-view") : fatal("Invalid record", "page-mod-data-view"));
      for (const [action, allowed] of [["approve", db.can.approve], ["disapprove", db.can.approve]] as const) {
        const target = db.entries.find((e) => e.id === Number(param(action)));
        if (target && allowed && param("sesskey") === "s1") {
          target.approved = action === "approve";
          return html(route, listPage(db, url.searchParams, notice(action === "approve" ? "Entry approved" : "Entry unapproved", "success")));
        }
      }
      const doomed = db.entries.find((e) => e.id === Number(param("delete")));
      if (doomed && (doomed.editable || db.can.manage) && param("confirm") === "1" && param("sesskey") === "s1") {
        db.entries = db.entries.filter((e) => e !== doomed);
        return html(route, listPage(db, url.searchParams, notice("Entry deleted", "success")));
      }
      db.lists.push(url.searchParams);
      return html(route, listPage(db, url.searchParams));
    }
    if (path === "/mod/data/edit.php") {
      if (rid && (!entry || !entry.editable)) return html(route, fatal("Sorry, you are not allowed to view this page", "page-mod-data-edit"));
      if (!rid && !db.can.add) return html(route, fatal("Sorry, you are not allowed to view this page", "page-mod-data-edit"));
      if (request.method() !== "POST") return html(route, entryForm(db, entry));
      const all = (name: string) => posted.filter(([n]) => n === name).map(([, v]) => v);
      const title = all(`field_${TITLE}`)[0] ?? "";
      if (!title) return html(route, entryForm(db, entry, notice("You must supply a value here.", "danger")));
      const pad = (n: string) => n.padStart(2, "0");
      // The draft area as the file picker left it; one nobody touched still holds the entry's picture.
      const area = draft.get(all(`field_${PHOTO}_file`)[0] ?? "");
      const photo = area ? area[0] : entry?.values[PHOTO];
      const values: FakeEntry["values"] = {
        [TITLE]: title,
        [COLOUR]: all(`field_${COLOUR}`)[0] ?? "",
        [BORN]: `${all(`field_${BORN}_year`)[0]}-${pad(all(`field_${BORN}_month`)[0] ?? "")}-${pad(all(`field_${BORN}_day`)[0] ?? "")}`,
        [TAGS]: all(`field_${TAGS}[]`).filter(Boolean),
      };
      if (photo) values[PHOTO] = photo;
      const saved = entry ?? { id: Math.max(20, ...db.entries.map((e) => e.id)) + 1, userId: 3, author: "Teacher", added: "Saturday, 17 October 2026, 6:00 PM", modified: "", approved: db.can.approve, values: {}, editable: true };
      saved.values = values;
      saved.modified = "Saturday, 17 October 2026, 7:30 PM";
      if (!entry) db.entries.push(saved);
      // Moodle redirects to the entry's single view; served in place here (Playwright doesn't route the request after a redirect it fulfilled).
      return html(route, page(`<div id="data-singleview-content">${rendered(db, saved, false)}</div>`, "page-mod-data-view"));
    }
    if (path === "/mod/data/export.php") {
      if (!db.can.export) return html(route, fatal("Sorry, but you do not currently have permissions to do that (View presets from all users).", "page-mod-data-export"));
      if (request.method() === "POST") {
        const rows = [["Title", "Colour", ...(param("exporttime") ? ["Time added"] : [])], ...db.entries.map((e) => [String(e.values[TITLE]), String(e.values[COLOUR] ?? ""), ...(param("exporttime") ? [e.added] : [])])];
        const csv = rows.map((row) => row.map((cell) => (/[",\n ]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(",")).join("\n");
        return route.fulfill({ status: 200, contentType: "text/csv; charset=UTF-8", headers: { "content-disposition": 'attachment; filename="db.csv"' }, body: `${csv}\n` });
      }
      return html(
        route,
        page(
          `<form class="mform" action="${SITE}mod/data/export.php" method="post"><input type="hidden" name="d" value="${db.cmid * 10}"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_data_export_form" value="1"><input type="radio" name="exporttype" value="csv" checked><input type="radio" name="exporttype" value="ods"><select name="delimiter_name"><option value="comma" selected>,</option><option value="tab">tab</option></select><input type="hidden" name="field_${TITLE}" value="0"><input type="checkbox" name="field_${TITLE}" value="1" checked><input type="checkbox" name="exporttime" value="1"><input type="checkbox" name="exportapproval" value="1"><input type="checkbox" name="includefiles" value="1" checked><input type="submit" name="submitbutton" value="Export entries"><input type="submit" name="cancel" value="Cancel"></form>`,
          "page-mod-data-export",
        ),
      );
    }
    if (path === "/mod/data/import.php") {
      if (!db.can.manage) return html(route, fatal("Sorry, but you do not currently have permissions to do that (Manage entries).", "page-mod-data-import"));
      if (request.method() === "POST") {
        const file = draft.get(param("recordsfile") ?? "") ?? [];
        return html(route, page(file.length > 0 ? `<div>Added entry</div>${notice(`${file.length} entries saved`, "success")}` : notice("No entries saved", "danger"), "page-mod-data-import"));
      }
      const picker = `<script>var fp = {"repositories":{"4":{"id":"4","name":"Upload a file","type":"upload"}}};</script>`;
      return html(
        route,
        page(
          `${picker}<form class="mform" id="mform1" action="${SITE}mod/data/import.php" method="post"><input type="hidden" name="d" value="${db.cmid * 10}"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="recordsfile" value="555"><select name="fielddelimiter" id="id_fielddelimiter"><option value="comma" selected>,</option><option value="semicolon">;</option></select><select name="encoding" id="id_encoding"><option value="UTF-8" selected>UTF-8</option></select><input type="submit" name="submitbutton" id="id_submitbutton" value="Submit"></form>`,
          "page-mod-data-import",
        ),
      );
    }
    return html(route, fatal("Not served by the fake", "page-mod-data-x"));
  });
  return state;
}

/** A database with two entries: Ana's, waiting for approval, and the teacher's, editable. */
export function newEntries(overrides: Partial<FakeEntries> = {}): FakeEntries {
  return {
    cmid: 40,
    perPage: 10,
    can: { add: true, approve: true, manage: true, export: true },
    posts: [],
    lists: [],
    uploads: [],
    entries: [
      { id: 21, userId: 5, author: "Ana Ruiz", added: "Friday, 16 October 2026, 9:15 AM", modified: "Saturday, 17 October 2026, 10:05 AM", approved: false, values: { [TITLE]: "First", [COLOUR]: "Blue", [BORN]: "2001-03-05", [TAGS]: ["b"], [PHOTO]: "cat.png" }, editable: true },
      { id: 22, userId: 3, author: "Teacher", added: "Saturday, 17 October 2026, 11:00 AM", modified: "Saturday, 17 October 2026, 11:00 AM", approved: true, values: { [TITLE]: "Second", [COLOUR]: "Red", [BORN]: "2026-10-17", [TAGS]: [] }, editable: false },
    ],
    ...overrides,
  };
}

export const FIELD = { TITLE, COLOUR, BORN, TAGS, PHOTO };
