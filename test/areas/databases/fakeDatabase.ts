// A made-up database activity's setup pages, as Moodle 5.2 renders them (mod/data/field.php,
// templates.php, preset.php), keeping what is posted to them as Moodle keeps it.
import type { BrowserContext, Route } from "playwright-core";
import { SITE, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

export interface FakeField {
  id: number;
  type: string;
  name: string;
  description: string;
  required: boolean;
  params: Record<string, string>;
}

export interface FakeDatabase {
  /** The database's course module id. */
  cmid: number;
  fields: FakeField[];
  /** Saved templates by Moodle's name; one missing or empty is Moodle's default. */
  templates: Record<string, string>;
  /** The person lacks mod/data:managetemplates. */
  refused?: boolean;
  /** Every POST received, by path. */
  posts: { path: string; form: URLSearchParams }[];
  /** Presets applied by their full name. */
  applied: string[];
  /** The fields page as Moodle 4.5 draws it: each type's icon mod_data's font icon, titled with the type. */
  moodle45?: boolean;
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const page = (body: string, bodyId: string) => moodlePage({ userId: 3, body, bodyId });
const fatal = (message: string, bodyId: string) => page(`<div data-rel="fatalerror" class="box py-3 errorbox alert alert-danger"><p class="errormessage">${message}</p></div>`, bodyId);
const notice = (message: string, type: "success" | "danger") => `<div class="alert alert-${type} alert-block fade in alert-dismissible" role="alert">${message}<button type="button" class="btn-close"><span class="visually-hidden">Dismiss this notification</span></button></div>`;

const SIZES = ["0", "209715200", "1048576", "512000", "10240"];
const SERVICES = ["Google Maps", "Google Earth", "Geabios", "OpenStreetMap", "Multimap"];

/** A type's own controls, as its mustache template writes them. */
function typeControls(type: string, params: Record<string, string>, fields: FakeField[]): string {
  const text = (name: string, fallback = "") => `<input type="text" name="${name}" id="${name}" value="${escape(params[name] ?? fallback)}">`;
  const box = (name: string, value?: string) => `<input type="checkbox" name="${name}" id="${name}"${value ? ` value="${value}"` : ""}${params[name] ? " checked" : ""}>`;
  const sizes = (name: string) => `<select name="${name}" id="${name}">${SIZES.map((s) => `<option value="${s}"${(params[name] ?? "0") === s ? " selected" : ""}>${s}</option>`).join("")}</select>`;
  switch (type) {
    case "text":
      return box("param1", "1");
    case "textarea":
      return `${text("param2", "60")}${text("param3", "35")}${text("param5", "0")}<input type="hidden" name="param4" id="param4" value="1"/>`;
    case "menu":
    case "radiobutton":
    case "checkbox":
    case "multimenu":
      return `<textarea name="param1" id="param1">${escape(params.param1 ?? "")}</textarea>`;
    case "url":
      return `${box("param1")}${box("param3")}<input type="text" name="param2" id="forcelinkname" value="${escape(params.param2 ?? "")}">`;
    case "file":
      return sizes("param3");
    case "picture":
      return `${text("param1")}${text("param2")}${text("param4")}${text("param5")}${sizes("param3")}`;
    case "latlong": {
      const chosen = (params.param1 ?? "").split(",");
      const others = fields.filter((f) => f.type === "text").map((f) => `<option value="${f.id}"${params.param2 === String(f.id) ? " selected" : ""}>${f.name}</option>`);
      return `<select name="param1[]" id="param1" multiple="multiple">${SERVICES.map((s) => `<option${chosen.includes(s) ? " selected" : ""}>${s}</option>`).join("")}</select><select name="param2" id="param2"><option value="-1"${params.param2 === "-1" ? " selected" : ""}>Entry #</option><option value="-2"${params.param2 === "-2" ? " selected" : ""}>Latitude/Longitude</option>${others.length ? `<optgroup label="Other fields:">${others.join("")}</optgroup>` : ""}</select>`;
    }
    default:
      return "";
  }
}

function fieldForm(db: FakeDatabase, type: string, field?: FakeField): string {
  const hidden = field ? `<input type="hidden" name="fid" value="${field.id}"><input type="hidden" name="mode" value="update">` : '<input type="hidden" name="mode" value="add">';
  const required = type === "date" ? "" : `<input class="requiredfield form-check" type="checkbox" name="required" id="required"${field?.required ? " checked" : ""}>`;
  return page(
    `<div class="box py-3 generalbox"><form id="editfield" action="${SITE}mod/data/field.php" method="post"><input type="hidden" name="d" value="${db.cmid * 10}">${hidden}<input type="hidden" name="type" value="${type}"><input name="sesskey" value="s1" type="hidden">
<h3>${type}</h3><fieldset><input type="text" name="name" id="name" value="${escape(field?.name ?? "")}"><input type="text" name="description" id="description" value="${escape(field?.description ?? "")}">${required}${typeControls(type, field?.params ?? {}, db.fields)}</fieldset>
<div><input type="submit" name="cancel" value="Cancel"><input type="submit" value="Save"></div></form></div>`,
    `page-mod-data-field-${type}`,
  );
}

function fieldList(db: FakeDatabase, message = ""): string {
  if (db.fields.length === 0) return page(`${message}<div data-region="empty-message"><h5>No fields yet</h5></div>`, "page-mod-data-field-");
  const rows = db.fields
    .map((f) => {
      const link = (mode: string) => `<a href="${SITE}mod/data/field.php?d=${db.cmid * 10}&amp;fid=${f.id}&amp;sesskey=s1&amp;mode=${mode}" class="dropdown-item menu-action">${mode}</a>`;
      const image = db.moodle45 ? `<i class="icon fa fa-font fa-fw " title="${f.type}" role="img" aria-label="${f.type}"></i>` : `<img class="icon " alt="${f.type}" src="${SITE}theme/image.php/boost/datafield_${f.type}/1791993441/icon">`;
      const icon = f.type === "unknown" ? "plugin" : `${image}&nbsp;${f.type}`;
      return `<tr><td class="cell c0">${escape(f.name)}</td><td class="cell c1">${icon}</td><td class="cell c2">${f.required ? "Yes" : "No"}</td><td class="cell c3">${escape(f.description)}</td><td class="cell c4 lastcol"><div class="dropdown-menu">${f.type === "unknown" ? "" : link("display")}${link("delete")}</div></td></tr>`;
    })
    .join("");
  return page(`${message}<table class="generaltable table table-hover"><thead><tr><th>Field name</th><th>Field type</th><th>Required</th><th>Field description</th><th></th></tr></thead><tbody>${rows}</tbody></table>`, "page-mod-data-field-");
}

/** What a template shows when none was saved: Moodle generates one from the fields. */
function effective(db: FakeDatabase, name: string): string {
  const saved = db.templates[name];
  if (saved) return saved;
  if (["listtemplateheader", "listtemplatefooter", "rsstitletemplate", "csstemplate", "jstemplate"].includes(name)) return "";
  return `<div class="default-${name}">${db.fields.map((f) => `[[${f.name}]]`).join(" ")}</div>`;
}

const TEMPLATE_EDITORS: Record<string, string[]> = {
  listtemplate: ["listtemplateheader", "listtemplate", "listtemplatefooter"],
  singletemplate: ["singletemplate"],
  asearchtemplate: ["asearchtemplate"],
  addtemplate: ["addtemplate"],
  rsstemplate: ["rsstemplate", "rsstitletemplate"],
  csstemplate: ["csstemplate"],
  jstemplate: ["jstemplate"],
};

function templatesPage(db: FakeDatabase, mode: string, message = ""): string {
  if (db.fields.length === 0) return page('<div data-region="empty-message"><h5>No fields yet</h5></div>', "page-mod-data-templates");
  const editors = (TEMPLATE_EDITORS[mode] ?? []).map((name) => `<textarea id="${name}" name="${name}" data-fieldtype="editor">${escape(effective(db, name))}</textarea>`).join("");
  return page(
    `${message}<form id="edittemplateform" action="${SITE}mod/data/templates.php?id=${db.cmid}&amp;mode=${mode}" method="post"><input name="sesskey" value="s1" type="hidden"><input name="defaultform" type="hidden" value=""><input name="resetall" type="hidden" value="">${editors}<input type="checkbox" name="useeditor" id="useeditor" value="1" checked><input type="submit" value="Save"></form>`,
    "page-mod-data-templates",
  );
}

function presetsPage(db: FakeDatabase): string {
  const presets = [
    { value: "/imagegallery", name: "Image gallery", description: "Use this preset to collect images." },
    { value: "/journal", name: "Journal", description: "Use this preset for a journal." },
    { value: "7/Shared by Ana", name: "Shared by Ana", description: "" },
  ];
  const rows = presets.map((p, i) => `<tr><td><input type="radio" name="fullname" value="${p.value}" data-cmid="${db.cmid}"></td><td><a id="preset-name-${i}" href="#">${p.name}</a></td><td>${p.description}</td><td></td></tr>`).join("");
  return page(`<form method="post" action="${SITE}mod/data/field.php"><table id="presets-list" class="table generaltable"><thead><tr><th></th><th>Name</th><th>Description</th><th></th></tr></thead><tbody>${rows}</tbody></table></form>`, "page-mod-data-preset");
}

/** Keeps a field's posted values as Moodle's define_field and update do; a picture's sizes must be numbers. */
function keep(db: FakeDatabase, form: URLSearchParams): string | undefined {
  const name = (form.get("name") ?? "").trim();
  const fid = Number(form.get("fid") ?? 0);
  if (!name || db.fields.some((f) => f.name === name && f.id !== fid)) return "Please choose another name for this field";
  const type = form.get("type") ?? "";
  if (type === "picture" && ["param1", "param2", "param4", "param5"].some((p) => form.get(p) && !Number.isFinite(Number(form.get(p))))) return "<ul><li>Width in single view needs to be a numeric value.</li></ul>";
  const params: Record<string, string> = {};
  for (const [key, value] of form) {
    const param = /^(param\d+)(\[\])?$/.exec(key)?.[1];
    if (param) params[param] = params[param] && key.endsWith("[]") ? `${params[param]},${value.trim()}` : value.trim();
  }
  const field = { type, name, description: (form.get("description") ?? "").trim(), required: Boolean(form.get("required")), params };
  if (fid) Object.assign(db.fields.find((f) => f.id === fid)!, field);
  else db.fields.push({ id: Math.max(10, ...db.fields.map((f) => f.id)) + 1, ...field });
  return undefined;
}

/** Serves the database's pages at `SITE`, as the teacher; other ids are another module's (Moodle's error page). */
export async function serveDatabase(context: BrowserContext, db: FakeDatabase): Promise<FakeMoodleState> {
  const state: FakeMoodleState = { user: { id: 3, fullName: "Teacher" }, pagesServed: [] };
  await serveFakeMoodle(context, state);
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  await context.route(`${SITE}mod/data/*.php**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const form = new URLSearchParams(request.postData() ?? "");
    const param = (name: string) => url.searchParams.get(name) ?? form.get(name);
    const path = url.pathname;
    state.pagesServed?.push(path);
    const cmid = Number(param("id") ?? 0) || Number(param("d") ?? 0) / 10;
    if (cmid !== db.cmid) return html(route, fatal(`Invalid course module ID: ${cmid}`, "page-site-index"));
    const script = path.slice("/mod/data/".length, -".php".length);
    if (db.refused) return html(route, fatal("Sorry, but you do not currently have permissions to do that (Manage templates).", `page-mod-data-${script}`));
    if (request.method() === "POST") db.posts.push({ path, form });
    if (path === "/mod/data/preset.php") return html(route, presetsPage(db));
    if (path === "/mod/data/templates.php") {
      const mode = param("mode") ?? "addtemplate";
      if (request.method() === "POST" && db.fields.length > 0) {
        for (const [key, value] of form) if (key.includes("template")) db.templates[key] = value;
        return html(route, templatesPage(db, mode, notice("Template saved", "success")));
      }
      return html(route, templatesPage(db, mode));
    }
    const mode = param("mode");
    if (mode === "new") return html(route, ["text", "textarea", "number", "date", "menu", "radiobutton", "checkbox", "multimenu", "url", "file", "picture", "latlong"].includes(param("newtype") ?? "") ? fieldForm(db, param("newtype")!) : fatal("Field type is incorrect", "page-mod-data-field-x"));
    if (mode === "display") {
      const field = db.fields.find((f) => f.id === Number(param("fid")));
      if (!field || param("sesskey") !== "s1") return html(route, fatal("Incorrect sesskey", "page-mod-data-field-"));
      return html(route, fieldForm(db, field.type, field));
    }
    if ((mode === "add" || mode === "update") && request.method() === "POST") {
      const refused = keep(db, form);
      if (refused) return html(route, mode === "add" && refused.startsWith("<ul>") ? fieldForm(db, form.get("type")!).replace("<form", `${notice(refused, "danger")}<form`) : fieldList(db, notice(refused, "danger")));
      return html(route, fieldList(db, notice(mode === "add" ? "Field added" : "Field updated", "success")));
    }
    if (mode === "delete" && form.get("confirm") === "1" && form.get("sesskey") === "s1") {
      db.fields = db.fields.filter((f) => f.id !== Number(form.get("fid")));
      return html(route, fieldList(db, notice("Field deleted", "success")));
    }
    if (mode === "usepreset" && param("action") === "notmapping") {
      const preset = param("fullname") ?? "";
      if (!["0/imagegallery", "0/journal", "7/Shared by Ana"].includes(preset)) return html(route, fatal(`Preset with name ${preset} not found.`, "page-mod-data-field"));
      db.applied.push(preset);
      // The image gallery's fields: a title kept if there's one of that name and type, the rest replaced.
      const title = db.fields.find((f) => f.name === "title" && f.type === "text");
      db.fields = [title ?? { id: 90, type: "text", name: "title", description: "", required: false, params: {} }, { id: 91, type: "picture", name: "image", description: "", required: false, params: {} }];
      // Moodle redirects to the fields page with its notification; served in place here.
      return html(route, fieldList(db).replace("<table", `<span id="user-notifications">${notice("Preset applied.", "success")}</span><table`));
    }
    return html(route, fieldList(db));
  });
  return state;
}

export const newDatabase = (overrides: Partial<FakeDatabase> = {}): FakeDatabase => ({ cmid: 40, fields: [], templates: {}, posts: [], applied: [], ...overrides });
