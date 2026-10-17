// A database activity's fields, through its fields page (`mod/data/field.php`): listed from its table,
// read from each field's edit form, created, changed and deleted by posting those forms as their
// buttons do. Each type's settings are Moodle's `param1`…`param5`, named here for what they mean.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";
import { DatabaseError, openDatabasePage, sendFromPage, type FormInput } from "./database.js";

/** The field types of Moodle's core, as Moodle names them (`datafield_<type>`). */
export const DATABASE_FIELD_TYPES = ["text", "textarea", "number", "date", "menu", "radiobutton", "checkbox", "multimenu", "url", "file", "picture", "latlong"] as const;
/** A core field type: short text, text area, number, date, dropdown list, radio buttons, checkboxes, multi-select list, URL, file, image, coordinates. */
export type DatabaseFieldType = (typeof DATABASE_FIELD_TYPES)[number];

/**
 * A field's settings beyond its name, description and whether it's required; each type takes its own
 * (`addDatabaseField` refuses the others):
 * - `menu`, `radiobutton`, `checkbox`, `multimenu`: `choices`.
 * - `text`: `autolink`. `url`: `autolink`, `linkName`, `newWindow`.
 * - `textarea`: `columns`, `rows`, `maxBytes`. `file`: `maxBytes`. `picture`: `width`, `height`, `listWidth`, `listHeight`, `maxBytes`.
 * - `latlong`: `services`, `kmlLabel`. `number` and `date`: none.
 */
export interface DatabaseFieldOptions {
  /** The choices a person picks from, in order (one per line in Moodle's form). */
  choices?: string[];
  /** Whether Moodle links the text where it appears elsewhere in the course (`text`), or makes the URL a link (`url`). */
  autolink?: boolean;
  /** The text of a URL's link instead of the URL itself. */
  linkName?: string;
  /** Whether a URL's link opens in a new window. */
  newWindow?: boolean;
  /** A text area's width, in columns, and height, in rows. */
  columns?: number;
  rows?: number;
  /** The largest file a person can add, in bytes; 0 is the site's or course's limit. A file or image field takes one of its form's sizes. */
  maxBytes?: number;
  /** An image's width and height, in pixels, in the single view and in the list view; none is its own size. */
  width?: number;
  height?: number;
  listWidth?: number;
  listHeight?: number;
  /** The map services coordinates link to, by Moodle's names ("Google Maps", "OpenStreetMap"…). */
  services?: string[];
  /** How KML files (Google Earth) label entries: their number, their coordinates, or the text of a field of the database (its id). */
  kmlLabel?: "entry" | "coordinates" | number;
}

/** A field of a database, as its edit form has it. */
export interface DatabaseField {
  id: number;
  name: string;
  /** Its type: one of `DATABASE_FIELD_TYPES`, or another plugin's name. */
  type: DatabaseFieldType | (string & {});
  description: string;
  /** Whether an entry needs it; a date field can't be required. */
  required: boolean;
  /** Its type's settings, as `DatabaseFieldOptions` names them; none for another plugin's type. */
  options: DatabaseFieldOptions;
}

/** A field to create with `addDatabaseField`. */
export interface DatabaseFieldInput {
  type: DatabaseFieldType;
  /** Unique in the database: templates name the field by it (`[[name]]`). */
  name: string;
  description?: string;
  required?: boolean;
  options?: DatabaseFieldOptions;
}

/** Changes to a field with `editDatabaseField`: what's left out stays as it is. Its type can't change. */
export interface DatabaseFieldChanges {
  name?: string;
  description?: string;
  required?: boolean;
  options?: DatabaseFieldOptions;
}

type OptionName = keyof DatabaseFieldOptions;

/** The form field (`param<n>`) each type keeps each option in. */
const PARAMS: Record<DatabaseFieldType, Partial<Record<OptionName, string>>> = {
  text: { autolink: "param1" },
  textarea: { columns: "param2", rows: "param3", maxBytes: "param5" },
  number: {},
  date: {},
  menu: { choices: "param1" },
  radiobutton: { choices: "param1" },
  checkbox: { choices: "param1" },
  multimenu: { choices: "param1" },
  url: { autolink: "param1", linkName: "param2", newWindow: "param3" },
  file: { maxBytes: "param3" },
  picture: { width: "param1", height: "param2", listWidth: "param4", listHeight: "param5", maxBytes: "param3" },
  latlong: { services: "param1", kmlLabel: "param2" },
};

const NUMBERS: OptionName[] = ["columns", "rows", "maxBytes", "width", "height", "listWidth", "listHeight"];
const BOOLEANS: OptionName[] = ["autolink", "newWindow"];
const isCoreType = (type: string): type is DatabaseFieldType => (DATABASE_FIELD_TYPES as readonly string[]).includes(type);

/** A field's options as its form's values (`param<n>`), checked against what the type takes. */
export function optionParams(type: DatabaseFieldType, options: DatabaseFieldOptions): Record<string, FormInput> {
  const invalid = (message: string) => new MoodleError(message, "invalid-input");
  const params: Record<string, FormInput> = {};
  for (const [name, value] of Object.entries(options) as [OptionName, unknown][]) {
    if (value === undefined) continue;
    const param = PARAMS[type][name];
    if (!param) {
      const takes = Object.keys(PARAMS[type]);
      throw invalid(`A ${type} field doesn't take the option "${name}": it takes ${takes.length > 0 ? takes.join(", ") : "none"}.`);
    }
    if (NUMBERS.includes(name)) {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) throw invalid(`The option "${name}" must be a whole number, 0 or more.`);
      params[param] = String(value);
    } else if (BOOLEANS.includes(name)) {
      if (typeof value !== "boolean") throw invalid(`The option "${name}" must be true or false.`);
      params[param] = value;
    } else if (name === "choices") {
      const choices = Array.isArray(value) ? value.map((choice) => String(choice).trim()).filter(Boolean) : [];
      if (choices.length === 0) throw invalid(`A ${type} field needs its choices: one at least.`);
      params[param] = choices.join("\n");
    } else if (name === "services") {
      if (!Array.isArray(value)) throw invalid('The option "services" must be a list of map services\' names.');
      params[param] = value.map(String);
    } else if (name === "kmlLabel") {
      if (value !== "entry" && value !== "coordinates" && !(typeof value === "number" && Number.isInteger(value) && value > 0)) throw invalid('The option "kmlLabel" must be "entry", "coordinates" or a field\'s id.');
      params[param] = value === "entry" ? "-1" : value === "coordinates" ? "-2" : String(value);
    } else {
      params[param] = String(value);
    }
  }
  return params;
}

/** A field's options from its form's values; none for a type that isn't Moodle's core. */
export function paramOptions(type: string, params: Record<string, FormInput>): DatabaseFieldOptions {
  if (!isCoreType(type)) return {};
  const options: DatabaseFieldOptions = {};
  for (const [name, param] of Object.entries(PARAMS[type]) as [OptionName, string][]) {
    const value = params[param];
    if (value === undefined) continue;
    if (NUMBERS.includes(name)) {
      if (value !== "" && Number.isFinite(Number(value))) (options as Record<string, number>)[name] = Number(value);
    } else if (BOOLEANS.includes(name)) {
      (options as Record<string, boolean>)[name] = value === true;
    } else if (name === "choices") {
      options.choices = String(value)
        .split("\n")
        .map((choice) => choice.trim())
        .filter(Boolean);
    } else if (name === "services") {
      options.services = Array.isArray(value) ? value : [];
    } else if (name === "kmlLabel") {
      options.kmlLabel = value === "-1" ? "entry" : value === "-2" ? "coordinates" : Number(value);
    } else if (name === "linkName") {
      if (value !== "") options.linkName = String(value);
    }
  }
  return options;
}

/** A row of the fields page's table: the field's id (from its delete link), name and type (its icon's plugin). */
interface ListedField {
  id: number;
  name: string;
  type: string;
  editable: boolean;
}

function listedFields(page: Page): Promise<ListedField[]> {
  return page.evaluate(() => {
    interface Row {
      cells: ArrayLike<{ textContent: string | null }>;
      querySelector(s: string): { href: string; src: string } | null;
    }
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<Row> } }).document;
    const listed: { id: number; name: string; type: string; editable: boolean }[] = [];
    for (const row of Array.from(doc.querySelectorAll("table.generaltable tbody tr"))) {
      const remove = row.querySelector('a[href*="mode=delete"]');
      if (!remove) continue;
      listed.push({
        id: Number(new URL(remove.href).searchParams.get("fid")),
        name: (row.cells[0]?.textContent ?? "").trim(),
        // The type's icon comes from its plugin: theme/image.php/<theme>/datafield_<type>/<rev>/icon.
        type: /\/datafield_(\w+)\//.exec(row.querySelector("img.icon")?.src ?? "")?.[1] ?? "unknown",
        // A field whose type's plugin is missing has no edit link.
        editable: row.querySelector('a[href*="mode=display"]') !== null,
      });
    }
    return listed;
  });
}

/** Each field's edit form, fetched from the page, read by its fields' names. */
async function readFieldForms(page: Page, siteUrl: string, activityId: number, listed: ListedField[]): Promise<DatabaseField[]> {
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  const forms = await inPage(
    page,
    async ({ siteUrl, activityId, ids }) => {
      interface Control {
        name: string;
        type: string;
        value: string;
        checked: boolean;
        options: ArrayLike<{ value: string; selected: boolean }>;
      }
      const g = globalThis as unknown as {
        M: { cfg: { sesskey: string } };
        fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
        DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): { elements: ArrayLike<Control> } | null } };
      };
      const read = async (id: number) => {
        const url = new URL(`mod/data/field.php?id=${activityId}&fid=${id}&mode=display&sesskey=${g.M.cfg.sesskey}`, siteUrl).href;
        const form = new g.DOMParser().parseFromString(await (await g.fetch(url, { credentials: "same-origin" })).text(), "text/html").querySelector("form#editfield");
        if (!form) return undefined;
        const values: Record<string, string | boolean | string[]> = {};
        for (const control of Array.from(form.elements)) {
          if (!control.name || control.type === "submit" || ["d", "id", "fid", "mode", "sesskey"].includes(control.name)) continue;
          const name = control.name.replace(/\[\]$/, "");
          if (control.type === "checkbox") values[name] = control.checked;
          else if (control.type === "select-multiple")
            values[name] = Array.from(control.options)
              .filter((o) => o.selected)
              .map((o) => o.value);
          else values[name] = control.value;
        }
        return values;
      };
      return Promise.all(ids.map(read));
    },
    { siteUrl, activityId, ids: listed.filter((field) => field.editable).map((field) => field.id) },
  );
  let next = 0;
  return listed.map((field) => {
    const values = field.editable ? forms[next++] : undefined;
    if (!values) return { id: field.id, name: field.name, type: field.type, description: "", required: false, options: {} };
    const { type, name, description, required, ...params } = values;
    const fieldType = typeof type === "string" && type ? type : field.type;
    return { id: field.id, name: String(name ?? field.name), type: fieldType, description: String(description ?? ""), required: required === true, options: paramOptions(fieldType, params) };
  });
}

/** The database's fields read on its open fields page. */
async function fieldsOn(page: Page, siteUrl: string, activityId: number): Promise<DatabaseField[]> {
  return readFieldForms(page, siteUrl, activityId, await listedFields(page));
}

/**
 * A database activity's fields, in the fields page's order: each one's id, name, type, description,
 * whether it's required and its type's settings (`DatabaseFieldOptions`), read from its edit form.
 * Throws `NotADatabaseError` when the id isn't a database, `DatabaseError` when the person can't
 * manage it (it takes `mod/data:managetemplates`, which editing teachers have).
 */
export async function databaseFields(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabaseField[]> {
  const page = await openDatabasePage(context, siteUrl, activityId, "field.php");
  try {
    return await fieldsOn(page, siteUrl, activityId);
  } finally {
    await page.close().catch(() => undefined);
  }
}

function checkName(name: string | undefined): void {
  if (name !== undefined && !name.trim()) throw new MoodleError("Give the field a name: Moodle requires one.", "invalid-input");
}

function refusal(what: string, outcome: { message?: string; unknown: string[] }): DatabaseError {
  if (outcome.unknown.length > 0) return new DatabaseError(`Moodle's form to ${what} doesn't take: ${outcome.unknown.join("; ")}. Nothing was changed.`);
  return new DatabaseError(`Moodle didn't ${what}${outcome.message ? `: ${outcome.message}` : "."}`);
}

/**
 * Adds a field to a database activity through Moodle's form for its type, as "Create a field" does:
 * templates left at Moodle's default show it, and Moodle appends it to a saved single, add entry or
 * RSS template that has no `##otherfields##` (not to the list template). Returns its id and the fields afterwards.
 * Throws `MoodleError` (`invalid-input`) for a type that isn't one of `DATABASE_FIELD_TYPES`, an
 * option the type doesn't take, a choice list without choices or a required date (Moodle's form
 * offers it no such setting), before anything changes; `DatabaseError` with Moodle's reason when it
 * refuses the field (a name the database already has, an image size that isn't a number, a maximum
 * size its form doesn't offer); `NotADatabaseError` when the id isn't a database.
 */
export async function addDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, field: DatabaseFieldInput): Promise<{ changed: string; fieldId: number; fields: DatabaseField[] }> {
  if (!isCoreType(field.type)) throw new MoodleError(`"${String(field.type)}" isn't a database field type: one of ${DATABASE_FIELD_TYPES.join(", ")}.`, "invalid-input");
  checkName(field.name ?? "");
  if (field.type === "date" && field.required) throw new MoodleError("A date field can't be required: Moodle's form for it has no such setting.", "invalid-input");
  const takesChoices = PARAMS[field.type].choices !== undefined;
  if (takesChoices && !field.options?.choices?.length) throw new MoodleError(`A ${field.type} field needs its choices: one at least.`, "invalid-input");
  const params = optionParams(field.type, field.options ?? {});
  const page = await openDatabasePage(context, siteUrl, activityId, "field.php");
  try {
    const values: Record<string, FormInput> = { name: field.name.trim(), description: field.description ?? "", ...(field.type === "date" ? {} : { required: field.required === true }), ...params };
    const outcome = await sendFromPage(page, { url: new URL(`mod/data/field.php?id=${activityId}&mode=new&newtype=${field.type}`, siteUrl).href, form: "form#editfield", values });
    if (!outcome.ok) throw refusal(`add the ${field.type} field "${field.name}" to database ${activityId}`, outcome);
    await page.reload({ waitUntil: "domcontentloaded" });
    const fields = await fieldsOn(page, siteUrl, activityId);
    const added = fields.find((f) => f.name === field.name.trim());
    if (!added) throw new DatabaseError(`Moodle said it added the field "${field.name}" to database ${activityId}, but its fields page doesn't list it.`);
    return { changed: `Added the ${field.type} field "${added.name}" (${added.id}) to database ${activityId}.`, fieldId: added.id, fields };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The field among the page's, or `MoodleError` (`not-found`). */
async function listedField(page: Page, activityId: number, fieldId: number): Promise<ListedField> {
  const listed = await listedFields(page);
  const field = listed.find((f) => f.id === fieldId);
  if (!field) throw new MoodleError(`Database ${activityId} has no field ${fieldId}: its fields are ${listed.map((f) => `${f.id} "${f.name}"`).join(", ") || "none"}.`, "not-found");
  return field;
}

/**
 * Changes a database field through its edit form: what `changes` leaves out stays as it is (its
 * options one by one). Renaming it renames its tag in the templates, as Moodle does. Its type can't
 * change: delete it and add another. Returns the fields afterwards. Throws `MoodleError`
 * (`not-found`) when the database has no such field, (`invalid-input`) for an option its type
 * doesn't take; `DatabaseError` with Moodle's reason when it refuses the change;
 * `NotADatabaseError` when the id isn't a database.
 */
export async function editDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, fieldId: number, changes: DatabaseFieldChanges): Promise<{ changed: string; fields: DatabaseField[] }> {
  checkName(changes.name);
  const page = await openDatabasePage(context, siteUrl, activityId, "field.php");
  try {
    const field = await listedField(page, activityId, fieldId);
    if (!isCoreType(field.type) || !field.editable) throw new MoodleError(`Field ${fieldId} of database ${activityId} is of a type the driver doesn't edit (${field.type}).`, "invalid-input");
    if (field.type === "date" && changes.required) throw new MoodleError("A date field can't be required: Moodle's form for it has no such setting.", "invalid-input");
    const values: Record<string, FormInput> = {
      ...(changes.name !== undefined ? { name: changes.name.trim() } : {}),
      ...(changes.description !== undefined ? { description: changes.description } : {}),
      ...(changes.required !== undefined && field.type !== "date" ? { required: changes.required } : {}),
      ...optionParams(field.type, changes.options ?? {}),
    };
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    const outcome = await sendFromPage(page, { url: new URL(`mod/data/field.php?id=${activityId}&fid=${fieldId}&mode=display&sesskey=${sesskey}`, siteUrl).href, form: "form#editfield", values });
    if (!outcome.ok) throw refusal(`change field ${fieldId} "${field.name}" of database ${activityId}`, outcome);
    await page.reload({ waitUntil: "domcontentloaded" });
    const fields = await fieldsOn(page, siteUrl, activityId);
    return { changed: `Changed the ${field.type} field "${fields.find((f) => f.id === fieldId)?.name ?? field.name}" (${fieldId}) of database ${activityId}.`, fields };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Deletes a database field, as its delete action confirmed does: what entries have in it goes too, and
 * its tags leave the templates. Returns the fields afterwards. Throws `MoodleError` (`not-found`)
 * when the database has no such field, `DatabaseError` when Moodle refuses, `NotADatabaseError` when
 * the id isn't a database.
 */
export async function deleteDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, fieldId: number): Promise<{ changed: string; fields: DatabaseField[] }> {
  const page = await openDatabasePage(context, siteUrl, activityId, "field.php");
  try {
    const field = await listedField(page, activityId, fieldId);
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    const outcome = await sendFromPage(page, { url: new URL("mod/data/field.php", siteUrl).href, values: { id: String(activityId), mode: "delete", fid: String(fieldId), confirm: "1", sesskey } });
    if (!outcome.ok) throw refusal(`delete field ${fieldId} "${field.name}" of database ${activityId}`, outcome);
    await page.reload({ waitUntil: "domcontentloaded" });
    const fields = await fieldsOn(page, siteUrl, activityId);
    if (fields.some((f) => f.id === fieldId)) throw new DatabaseError(`Moodle said it deleted field ${fieldId} of database ${activityId}, but its fields page still lists it.`);
    return { changed: `Deleted the ${field.type} field "${field.name}" (${fieldId}) of database ${activityId}.`, fields };
  } finally {
    await page.close().catch(() => undefined);
  }
}
