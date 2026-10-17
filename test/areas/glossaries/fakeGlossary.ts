// A made-up glossary activity, as Moodle 5.2 renders its pages (mod/glossary/view.php in its modes,
// edit.php, deleteentry.php, approve.php, editcategories.php, export.php, import.php) and answers
// mod_glossary_get_entry_by_id, keeping what is posted to them as Moodle keeps it.
import type { BrowserContext, Route } from "playwright-core";
import { SITE, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

export interface FakeEntry {
  id: number;
  concept: string;
  definition: string;
  aliases: string[];
  categories: number[];
  userId: number;
  userName: string;
  approved: boolean;
  attachments: string[];
}

export interface FakeGlossary {
  /** The glossary's course module id; its module context is 10 times it. */
  cmid: number;
  /** "dictionary" has no category view, as Moodle's. */
  format: "dictionary" | "encyclopedia";
  perPage: number;
  categories: { id: number; name: string }[];
  entries: FakeEntry[];
  /** The person: a teacher approves, manages, exports and imports; a student only writes their own. */
  user: { id: number; name: string; teacher: boolean };
  /** Every POST received, by path. */
  posts: { path: string; form: URLSearchParams }[];
  /** Files in draft areas, by item id. */
  drafts: Record<string, string[]>;
}

const CMID_CONTEXT = (cmid: number) => cmid * 10;
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function page(g: FakeGlossary, body: string, script: string): string {
  return moodlePage({ userId: g.user.id, body, bodyId: `page-mod-glossary-${script}`, bodyClass: `path-mod-glossary context-${CMID_CONTEXT(g.cmid)} cmid-${g.cmid}` });
}

function fatal(g: FakeGlossary, message: string, code: string, script: string): string {
  return page(g, `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/glossary/${code}">More information about this error</a></p></div>`, script);
}

const visible = (g: FakeGlossary, e: FakeEntry) => e.approved || e.userId === g.user.id;
const canChange = (g: FakeGlossary, e: FakeEntry) => g.user.teacher || e.userId === g.user.id;

/** An entry as the format prints it: the entry link only for approved entries (or approvers), the edit and delete links for who may. */
function post(g: FakeGlossary, e: FakeEntry, mode: string, linkless = false): string {
  const aliases = e.aliases.length > 0 ? `<div class="row aliases"><label for="keyword-${e.id}">Keyword(s):</label><select id="keyword-${e.id}">${e.aliases.map((a, i) => `<option value="${i}">${escape(a)}</option>`).join("")}</select></div>` : "";
  const link = e.approved || g.user.teacher ? `<a class="icon" href="${SITE}mod/glossary/showentry.php?eid=${e.id}"><i class="icon fa fa-link"></i></a>` : "";
  const approve = mode === "approval" ? `<div class="text-end"><a href="approve.php?eid=${e.id}&amp;mode=approval&amp;sesskey=s1"><i class="icon fa fa-thumbs-up"></i></a></div>` : "";
  const edit = canChange(g, e) && !linkless ? `<a class="icon" href="deleteentry.php?id=${g.cmid}&amp;mode=delete&amp;entry=${e.id}&amp;prevmode=${mode}&amp;hook=ALL"><i class="icon fa fa-trash-can"></i></a><a class="icon" href="edit.php?cmid=${g.cmid}&amp;id=${e.id}&amp;mode=${mode}&amp;hook=ALL"><i class="icon fa fa-pen"></i></a>` : "";
  return `<div class="glossarypost ${g.format}"><div class="entry">${approve}<div class="concept"><h3>${escape(e.concept)}</h3></div><div class="no-overflow">${e.definition}</div></div><div class="entrylowersection">${aliases}<div class="text-end"><span class="commands">${linkless ? "" : link}${edit}</span></div><hr></div></div>`;
}

function viewPage(g: FakeGlossary, q: URLSearchParams, linkless: number[]): string {
  let mode = q.get("mode") ?? "letter";
  const hook = q.get("hook") ?? "ALL";
  if (mode === "approval" && !g.user.teacher) return fatal(g, "Sorry, but you do not currently have permissions to do that (Approve and undo approved entries).", "nopermissions", "view");
  // The dictionary format has no category view: Moodle shows the standard one.
  if (mode === "cat" && g.format === "dictionary") mode = "letter";
  const sorted = [...g.entries].sort((a, b) => a.concept.localeCompare(b.concept));
  let entries: FakeEntry[];
  if (mode === "approval") entries = sorted.filter((e) => !e.approved);
  // Moodle prints someone else's waiting entry to nobody here, its approvers included.
  else if (mode === "entry") entries = sorted.filter((e) => e.id === Number(hook) && visible(g, e));
  else if (mode === "search") entries = sorted.filter((e) => visible(g, e) && [e.concept, e.definition, ...e.aliases].some((t) => t.toLowerCase().includes(hook.toLowerCase())));
  else if (mode === "cat") entries = sorted.filter((e) => visible(g, e) && (Number(hook) === -1 ? e.categories.length === 0 : e.categories.includes(Number(hook))));
  else entries = sorted.filter((e) => visible(g, e) && (hook === "ALL" || e.concept.toUpperCase().startsWith(hook)));
  const pageNumber = Number(q.get("page") ?? 0);
  const offset = Number(q.get("offset") ?? 0);
  const shown = pageNumber < 0 || mode === "entry" ? entries : entries.slice(offset, offset + g.perPage);
  const menu =
    mode === "cat"
      ? `<form method="get" action="${SITE}mod/glossary/view.php" id="catmenu"><select class="form-select singleselect" name="hook"><option value="0">All categories</option><option value="-1">Not categorised</option>${g.categories.map((c) => `<option value="${c.id}">${escape(c.name)}</option>`).join("")}</select></form>`
      : "";
  const body = shown.length > 0 ? shown.map((e) => post(g, e, mode, linkless.includes(e.id))).join("") : '<div class="box generalbox">No entries found in this section</div>';
  return page(g, `<div role="main"><div class="entrybox">${menu}<hr></div>${body}</div>`, "view");
}

function entryForm(g: FakeGlossary, entry: FakeEntry | undefined, nextId: number): string {
  const draft = String(700 + (entry?.id ?? nextId));
  g.drafts[draft] = [...(entry?.attachments ?? [])];
  const categories = g.categories.length > 0 ? `<input type="hidden" name="categories" value="_qf__force_multiselect_submission"><select name="categories[]" id="id_categories" multiple size="5"><option value="0">Not categorised</option>${g.categories.map((c) => `<option value="${c.id}"${entry?.categories.includes(c.id) ? " selected" : ""}>${escape(c.name)}</option>`).join("")}</select>` : "";
  // The fake posts to the entry's view, where Moodle redirects after saving.
  return page(
    g,
    `<form class="mform" method="post" action="${SITE}mod/glossary/view.php?id=${g.cmid}&amp;mode=entry&amp;hook=${entry?.id ?? nextId}">
<input type="hidden" name="id" value="${entry?.id ?? ""}"><input type="hidden" name="cmid" value="${g.cmid}"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_glossary_entry_form" value="1">
<input type="text" name="concept" id="id_concept" value="${escape(entry?.concept ?? "")}">
<textarea name="definition_editor[text]" id="id_definition_editor">${escape(entry?.definition ?? "")}</textarea><input type="hidden" name="definition_editor[itemid]" value="${Number(draft) + 1000}">
${categories}<textarea name="aliases" id="id_aliases">${escape(entry?.aliases.join("\n") ?? "")}</textarea>
<input type="hidden" name="attachment_filemanager" value="${draft}">
<input type="submit" name="submitbutton" value="Save changes"><input type="submit" name="cancel" value="Cancel"></form>
<script>var filepicker = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`,
    "edit",
  );
}

/** Keeps a posted entry form as glossary_edit_entry does; a concept already there is refused, as the form's validation does. */
function keepEntry(g: FakeGlossary, form: URLSearchParams, id: number): string | undefined {
  const concept = (form.get("concept") ?? "").trim();
  if (g.entries.some((e) => e.concept.toLowerCase() === concept.toLowerCase() && e.id !== Number(form.get("id") || 0))) return "This concept already exists. No duplicates allowed in this glossary.";
  const values = {
    concept,
    definition: form.get("definition_editor[text]") ?? "",
    aliases: (form.get("aliases") ?? "").split(/\r?\n/).map((a) => a.trim()).filter(Boolean),
    categories: form.getAll("categories[]").map(Number).filter((c) => c > 0),
    attachments: [...(g.drafts[form.get("attachment_filemanager") ?? ""] ?? [])],
  };
  const existing = g.entries.find((e) => e.id === Number(form.get("id") || 0));
  if (existing) Object.assign(existing, values);
  else g.entries.push({ id, userId: g.user.id, userName: g.user.name, approved: g.user.teacher, ...values });
  return undefined;
}

/** Serves the glossary's pages at `SITE`, as `g.user`; other course module ids are Moodle's invalidcoursemodule. */
export async function serveGlossary(context: BrowserContext, g: FakeGlossary, { linkless = [] as number[] } = {}): Promise<FakeMoodleState> {
  const state: FakeMoodleState = {
    user: { id: g.user.id, fullName: g.user.name },
    pagesServed: [],
    serviceCalls: [],
    services: {
      mod_glossary_get_entry_by_id: ({ id }) => {
        const e = g.entries.find((entry) => entry.id === id);
        if (!e) throw new Error(`no entry ${String(id)}`);
        const attachments = e.attachments.map((name) => ({ filename: name, filepath: "/", filesize: 4, fileurl: `${SITE}pluginfile.php/${CMID_CONTEXT(g.cmid)}/mod_glossary/attachment/${e.id}/${name}`, mimetype: "text/plain" }));
        return { entry: { id: e.id, glossaryid: 3, userid: e.userId, userfullname: e.userName, concept: e.concept, definition: e.definition, attachments, timecreated: 1792256355, timemodified: 1792256355, approved: e.approved }, ratinginfo: { contextid: CMID_CONTEXT(g.cmid) }, warnings: [] };
      },
    },
  };
  await serveFakeMoodle(context, state);
  let nextId = 100;
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  await context.route(`${SITE}mod/glossary/*.php**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const form = new URLSearchParams(request.postData() ?? "");
    const q = url.searchParams;
    const script = url.pathname.slice("/mod/glossary/".length, -".php".length);
    state.pagesServed?.push(url.pathname);
    if (request.method() === "POST") g.posts.push({ path: url.pathname, form });
    const cmid = Number(q.get("cmid") ?? q.get("id") ?? form.get("id") ?? 0);
    const entry = (id: number) => g.entries.find((e) => e.id === id);
    if (script === "approve") {
      const e = entry(Number(q.get("eid")));
      if (!g.user.teacher) return html(route, fatal(g, "Sorry, but you do not currently have permissions to do that (Approve and undo approved entries).", "nopermissions", "approve"));
      if (e && q.get("sesskey") === "s1") e.approved = q.get("newstate") === "1";
      return html(route, viewPage(g, new URLSearchParams("mode=approval&hook=ALL"), linkless));
    }
    if (cmid !== g.cmid && !(script === "editcategories" && request.method() === "POST")) return html(route, fatal(g, "Invalid course module ID", "invalidcoursemodule", script));
    if (script === "view" && request.method() === "POST") {
      const id = Number(form.get("id") || 0) || nextId++;
      const refused = keepEntry(g, form, id);
      if (refused) return html(route, entryForm(g, entry(id), id).replace('<input type="text" name="concept"', `<div class="invalid-feedback" id="id_error_concept">${refused}</div><input type="text" name="concept"`));
      return html(route, viewPage(g, new URLSearchParams(`mode=entry&hook=${id}`), linkless));
    }
    if (script === "view") return html(route, viewPage(g, q, linkless));
    if (script === "edit") {
      const id = Number(q.get("id") ?? 0);
      const e = id ? entry(id) : undefined;
      if (id && !e) return html(route, fatal(g, "Incorrect entry", "invalidentry", "edit"));
      if (e && !canChange(g, e)) return html(route, fatal(g, "You cannot edit other people's entries.", "errcannoteditothers", "edit"));
      return html(route, entryForm(g, e, nextId));
    }
    if (script === "deleteentry") {
      const e = entry(Number(q.get("entry") ?? form.get("entry")));
      if (!e) return html(route, fatal(g, "Incorrect entry", "invalidentry", "deleteentry"));
      if (!canChange(g, e)) return html(route, fatal(g, "You are not allowed to delete this entry.", "nopermissiontodelentry", "deleteentry"));
      if (request.method() === "POST" && form.get("confirm") === "1" && form.get("sesskey") === "s1") {
        g.entries = g.entries.filter((other) => other !== e);
        return html(route, viewPage(g, new URLSearchParams(), linkless));
      }
      return html(route, page(g, `<div role="main"><p><b>${escape(e.concept)}</b></p><form method="get" action="view.php"><button type="submit">Cancel</button></form><form method="post" action="deleteentry.php"><input type="hidden" name="id" value="${g.cmid}"><input type="hidden" name="entry" value="${e.id}"><input type="hidden" name="confirm" value="1"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="prevmode" value="letter"><button type="submit" class="btn btn-primary">Continue</button></form></div>`, "deleteentry"));
    }
    if (!g.user.teacher) return html(route, fatal(g, "Sorry, but you do not currently have permissions to do that.", "nopermissions", script));
    if (script === "editcategories") {
      if (request.method() === "POST" && form.get("action") === "add" && form.get("sesskey") === "s1") g.categories.push({ id: 50 + g.categories.length, name: form.get("name") ?? "" });
      const rows = [...g.categories].sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<tr><td><span class="bold">${escape(c.name)}</span> <span>(0 Entries)</span></td><td class="action"><a href="editcategories.php?id=${g.cmid}&amp;action=delete&amp;mode=cat&amp;hook=${c.id}">x</a> <a href="editcategories.php?id=${g.cmid}&amp;action=edit&amp;mode=cat&amp;hook=${c.id}">e</a></td></tr>`);
      return html(route, page(g, `<div role="main"><table>${rows.join("")}</table></div>`, "editcategories"));
    }
    if (script === "export") return html(route, page(g, `<div role="main"><form action="${SITE}pluginfile.php/${CMID_CONTEXT(g.cmid)}/mod_glossary/export/0/0/export.xml?forcedownload=1" method="post"><input type="submit" value="Export entries to file"></form></div>`, "export"));
    if (script === "import" && request.method() === "POST") {
      const files = g.drafts[form.get("file") ?? ""] ?? [];
      if (files.length === 0) return html(route, page(g, '<div class="box">Error parsing the XML file</div>', "import"));
      const categories = form.get("catsincl") === "1" ? '<tr><td>Imported categories:</td><td>1</td></tr>' : "";
      return html(route, page(g, `<div class="box glossarydisplay"><table class="glossaryimportexport"><tr><td>Total entries:</td><td>3</td></tr><tr><td>Imported entries:</td><td>2 <small>(Rejected entries: 1)</small></td></tr>${categories}</table><hr><table class="glossaryimportexport"><tr><td>Alpha</td><td>Duplicate entry</td></tr></table></div>`, "import"));
    }
    if (script === "import") {
      g.drafts["555"] = [];
      return html(route, page(g, `<form class="mform" method="post" action="${SITE}mod/glossary/import.php"><input type="hidden" name="id" value="${g.cmid}"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="file" id="id_file" value="555"><select name="dest" id="id_dest"><option value="current">Current glossary</option><option value="newglossary">New glossary</option></select><input type="checkbox" name="catsincl" value="1" id="id_catsincl"><input type="submit" name="submitbutton" value="Submit"></form><script>var filepicker = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`, "import"));
    }
    return html(route, fatal(g, "Not served", "unknown", script));
  });
  await context.route(`${SITE}pluginfile.php/**`, (route) => route.fulfill({ status: 200, contentType: "text/xml", headers: { "content-disposition": 'attachment; filename="export.xml"' }, body: "<GLOSSARY></GLOSSARY>" }));
  // The file manager and picker: uploads into a draft area, listing and deleting its files.
  await context.route(`${SITE}repository/repository_ajax.php**`, (route) => {
    const body = route.request().postData() ?? "";
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1] ?? "";
    (g.drafts[field("itemid")] ??= []).push(field("title"));
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/${field("itemid")}/${field("title")}` }) });
  });
  await context.route(`${SITE}repository/draftfiles_ajax.php**`, (route) => {
    const action = new URL(route.request().url()).searchParams.get("action");
    const form = new URLSearchParams(route.request().postData() ?? "");
    const files = (g.drafts[form.get("itemid") ?? ""] ??= []);
    if (action === "delete") {
      files.splice(files.indexOf(form.get("filename") ?? ""), 1);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ filepath: "/" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ list: files.map((name) => ({ type: "file", filepath: "/", filename: name, size: 4 })) }) });
  });
  return state;
}

export const newGlossary = (overrides: Partial<FakeGlossary> = {}): FakeGlossary => ({
  cmid: 30,
  format: "encyclopedia",
  perPage: 2,
  categories: [{ id: 7, name: "Animals" }],
  entries: [
    { id: 11, concept: "Alpha", definition: "<p>First</p>", aliases: ["a", "uno"], categories: [7], userId: 3, userName: "Teacher", approved: true, attachments: ["notes.txt"] },
    { id: 12, concept: "Beta", definition: "<p>Second</p>", aliases: [], categories: [], userId: 5, userName: "Student", approved: false, attachments: [] },
    { id: 13, concept: "Gamma", definition: "<p>Third</p>", aliases: [], categories: [], userId: 6, userName: "Other", approved: true, attachments: [] },
  ],
  user: { id: 3, name: "Teacher", teacher: true },
  posts: [],
  drafts: {},
  ...overrides,
});
