import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { openSitePage } from "./session.js";
import { MoodleError } from "./errors.js";

/** A form field's value: text, a number, a checkbox, or a multiple select's values. */
export type FieldValue = string | number | boolean | string[];

/** Moodle refused the form, or a field to set isn't in it. */
export class FormError extends MoodleError {
  override name = "FormError";
  constructor(
    message: string,
    readonly fields: { field: string; message: string }[],
  ) {
    super(`${message} ${fields.map((f) => `${f.field}: ${f.message}`).join("; ")}`, "form");
  }
}

/** Opens a Moodle form page and waits for its editors to be ready. */
export async function openForm(context: BrowserContext, siteUrl: string, pathAndQuery: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, pathAndQuery);
  try {
    if ((await page.locator("form.mform").count()) === 0) throw new FormError("This page has no Moodle form.", [{ field: "page", message: pathAndQuery }]);
    await page.waitForLoadState("load");
    // TinyMCE starts after load; its content must be set through it, or the save takes the old one.
    await page
      .waitForFunction(
        () => {
          const tiny = (globalThis as unknown as { tinymce?: { get(): { initialized: boolean }[] } }).tinymce;
          return !tiny || tiny.get().every((editor) => editor.initialized);
        },
        undefined,
        { timeout: 15_000 },
      )
      .catch(() => undefined);
    // Moodle enables and disables fields as others change (disabledIf) once its form dependencies
    // start, after load: a field set before then stays disabled (confirmed empirically, 5.2).
    const dependent = await page.evaluate(() => (globalThis as unknown as { document: { documentElement: { innerHTML: string } } }).document.documentElement.innerHTML.includes("M.form.initFormDependencies"));
    if (dependent) {
      await page
        .waitForFunction(
          () => {
            const g = globalThis as unknown as { M?: { form?: { dependencyManagers?: Record<string, unknown> } }; document: { querySelector(s: string): { id: string } | null } };
            const id = g.document.querySelector("form.mform")?.id ?? "";
            return Boolean(g.M?.form?.dependencyManagers?.[id]);
          },
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => undefined);
    }
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** A hidden field's value in the form (a draft area id, the course id…). */
export function formValue(page: Page, name: string): Promise<string | undefined> {
  return page.evaluate((name) => {
    const field = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector(`form.mform [name="${name}"]`);
    return field?.value;
  }, name);
}

/**
 * Sets fields by their form name: text inputs and textareas (through TinyMCE when it edits them),
 * selects (several values for a multiple one), checkboxes and radios, in the order given (a field can
 * enable the next one). Throws `FormError` naming the fields the form doesn't have, and those it has
 * disabled: Moodle wouldn't send them, and the change would be lost unnoticed.
 */
export async function setFields(page: Page, values: Record<string, FieldValue>, formSelector = "form.mform"): Promise<void> {
  const missing: string[] = [];
  const disabled: string[] = [];
  // One field at a time: Moodle enables dependent fields in handlers that run after the change event
  // (choosing whether to rescale enables a maximum grade, confirmed empirically, 5.2).
  for (const [name, value] of Object.entries(values)) {
    const outcome = await setField(page, name, value, formSelector);
    if (outcome === "missing") missing.push(name);
    if (outcome === "disabled") disabled.push(name);
  }
  if (missing.length > 0) {
    throw new FormError("The form has no such field:", missing.map((field) => ({ field, message: "not in this form; check its name in Moodle's form" })));
  }
  if (disabled.length > 0) {
    throw new FormError("The form has these fields disabled, so Moodle wouldn't save them:", disabled.map((field) => ({ field, message: "disabled; another field enables it (set that one first, in the same call)" })));
  }
}

function setField(page: Page, name: string, value: FieldValue, formSelector: string): Promise<"set" | "missing" | "disabled"> {
  return page.evaluate(({ name, value, formSelector }) => {
    interface Field {
      type: string;
      id: string;
      value: string;
      checked: boolean;
      disabled: boolean;
      multiple?: boolean;
      options?: ArrayLike<{ value: string; selected: boolean }>;
      dispatchEvent(event: unknown): void;
    }
    const g = globalThis as unknown as {
      document: { querySelector(s: string): { querySelectorAll(s: string): ArrayLike<Field> } | null };
      tinymce?: { get(id: string): { setContent(html: string): void; save(): void } | null };
      Event: new (type: string, init: { bubbles: boolean }) => unknown;
    };
    const form = g.document.querySelector(formSelector);
    const all = Array.from(form?.querySelectorAll(`[name="${name}"]`) ?? []);
    // A Moodle checkbox comes with a hidden twin holding its unchecked value.
    const fields = all.length > 1 ? all.filter((field) => field.type !== "hidden") : all;
    if (fields.length === 0) return "missing";
    // Checked now, after the fields before it: their change events may have enabled it.
    if (fields.every((field) => field.disabled)) return "disabled";
    for (const field of fields) {
      if (field.type === "checkbox") field.checked = value === true || value === 1 || value === "1";
      else if (field.type === "radio") field.checked = field.value === String(value);
      else if (field.multiple && field.options) {
        const wanted = (Array.isArray(value) ? value : [value]).map(String);
        for (const option of Array.from(field.options)) option.selected = wanted.includes(option.value);
      } else {
        field.value = String(value);
        const editor = field.id ? g.tinymce?.get(field.id) : null;
        if (editor) {
          editor.setContent(String(value));
          editor.save();
        }
      }
      field.dispatchEvent(new g.Event("change", { bubbles: true }));
    }
    return "set";
  }, { name, value, formSelector });
}

/** A local file to upload under another name or into a subfolder of the draft area (`to`: `"week1/notes.pdf"`). */
export interface DraftUpload {
  from: string;
  to: string;
}

/** A file in a form's draft area: its path in the area (`"notes.pdf"`, `"week1/notes.pdf"`) and size in bytes. */
export interface DraftFile {
  name: string;
  size: number;
}

/** A draft area's path for a folder: `"week1/"` and `"/week1"` are `"/week1/"`, nothing is `"/"`. */
function draftPath(folder: string): string {
  const parts = folder.split("/").filter((part) => part !== "");
  return parts.length === 0 ? "/" : `/${parts.join("/")}/`;
}

/** A file's folder in the draft area and its name, from its path (`"week1/notes.pdf"`). */
function splitDraftName(name: string): { filepath: string; filename: string } {
  const at = name.lastIndexOf("/");
  return { filepath: draftPath(at < 0 ? "" : name.slice(0, at)), filename: at < 0 ? name : name.slice(at + 1) };
}

/** Calls the file manager's `repository/draftfiles_ajax.php` from the form's page, with its session. */
function draftAction(page: Page, action: string, params: Record<string, string>): Promise<{ ok: boolean; body: string }> {
  return page.evaluate(
    async ({ action, params }) => {
      const g = globalThis as unknown as {
        M: { cfg: { wwwroot: string; sesskey: string } };
        fetch(url: string, init: object): Promise<{ ok: boolean; text(): Promise<string> }>;
        URLSearchParams: new (init: Record<string, string>) => unknown;
      };
      const response = await g.fetch(`${g.M.cfg.wwwroot}/repository/draftfiles_ajax.php?action=${action}`, {
        method: "POST",
        body: new g.URLSearchParams({ sesskey: g.M.cfg.sesskey, ...params }),
        credentials: "same-origin",
      });
      return { ok: response.ok, body: await response.text() };
    },
    { action, params },
  );
}

/**
 * The files in a form's draft area, subfolders included, as the file manager lists them
 * (`draftfiles_ajax.php?action=list`): what an activity holds while its form is open.
 */
export async function draftFiles(page: Page, draftItemId: string): Promise<DraftFile[]> {
  const files: DraftFile[] = [];
  const folders = ["/"];
  while (folders.length > 0) {
    const filepath = folders.shift()!;
    const { body } = await draftAction(page, "list", { itemid: draftItemId, filepath });
    let listing: { list?: { type: string; filepath: string; filename?: string; size?: number }[]; error?: string };
    try {
      listing = JSON.parse(body) as typeof listing;
    } catch {
      throw new FormError("The file area can't be read:", [{ field: "files", message: "Moodle's answer isn't JSON" }]);
    }
    if (listing.error) throw new FormError("The file area can't be read:", [{ field: "files", message: listing.error }]);
    for (const entry of listing.list ?? []) {
      if (entry.type === "folder") folders.push(entry.filepath);
      else files.push({ name: `${entry.filepath}${entry.filename ?? ""}`.slice(1), size: entry.size ?? 0 });
    }
  }
  return files;
}

/** Deletes a file from a form's draft area by its path in it (`"week1/notes.pdf"`); the activity changes when the form is saved. */
export async function deleteDraftFile(page: Page, draftItemId: string, name: string): Promise<void> {
  const { body } = await draftAction(page, "delete", { itemid: draftItemId, ...splitDraftName(name) });
  if (body.trim() === "false" || body.includes('"error"')) throw new FormError("Deleting a file failed:", [{ field: "files", message: `${name}: ${body.trim()}` }]);
}

/**
 * Uploads local files to a form's draft area, as the file picker's "Upload a file" does: the
 * upload repository's id comes from the page's file picker settings, the context from `M.cfg`.
 * A `DraftUpload` names the file in the area, in a subfolder when its `to` has one (created first).
 * With `overwrite`, a file of the same name is replaced; without it, Moodle keeps both, renaming the new one.
 */
export async function uploadToDraft(page: Page, draftItemId: string, filePaths: (string | DraftUpload)[], { overwrite = false }: { overwrite?: boolean } = {}): Promise<void> {
  const files = await Promise.all(
    filePaths.map(async (file) => {
      const from = typeof file === "string" ? file : file.from;
      const { filepath, filename } = splitDraftName(typeof file === "string" ? path.basename(file) : file.to);
      return { name: filename, savepath: filepath, base64: (await readFile(from)).toString("base64") };
    }),
  );
  for (const folder of new Set(files.map((file) => file.savepath).filter((savepath) => savepath !== "/"))) {
    // Each level, from the top: the file manager creates them one at a time.
    const parts = folder.split("/").filter((part) => part !== "");
    for (let i = 0; i < parts.length; i++) {
      await draftAction(page, "mkdir", { itemid: draftItemId, filepath: draftPath(parts.slice(0, i).join("/")), newdirname: parts[i]! });
    }
  }
  const errors = await page.evaluate(
    async ({ draftItemId, files, overwrite }) => {
      const g = globalThis as unknown as {
        document: { documentElement: { innerHTML: string } };
        M: { cfg: { wwwroot: string; sesskey: string; contextid: number } };
        fetch(url: string, init: object): Promise<{ json(): Promise<{ error?: string }> }>;
        FormData: new () => { append(name: string, value: unknown, filename?: string): void };
        Blob: new (parts: unknown[]) => unknown;
        atob(data: string): string;
      };
      const repo = /"id":"(\d+)","name":"(?:[^"\\]|\\.)*","type":"upload"/.exec(g.document.documentElement.innerHTML)?.[1];
      if (!repo) return ["the site has no upload repository enabled"];
      const failed: string[] = [];
      for (const file of files) {
        const body = new g.FormData();
        body.append("repo_upload_file", new g.Blob([Uint8Array.from(g.atob(file.base64), (c) => c.charCodeAt(0))]), file.name);
        const fields = { sesskey: g.M.cfg.sesskey, repo_id: repo, itemid: draftItemId, ctx_id: String(g.M.cfg.contextid), savepath: file.savepath, title: file.name, env: "filemanager", author: "" };
        for (const [key, value] of Object.entries(overwrite ? { ...fields, overwrite: "1" } : fields)) {
          body.append(key, value);
        }
        const response = await g.fetch(`${g.M.cfg.wwwroot}/repository/repository_ajax.php?action=upload`, { method: "POST", body, credentials: "same-origin" });
        const answer = await response.json().catch(() => ({ error: "the answer isn't JSON" }));
        if (answer.error) failed.push(`${file.name}: ${answer.error}`);
      }
      return failed;
    },
    { draftItemId, files, overwrite },
  );
  if (errors.length > 0) throw new FormError("Uploading failed:", errors.map((message) => ({ field: "files", message })));
}

/**
 * Removes files by their path in a form's draft area (`"notes.pdf"`, `"week1/notes.pdf"`), as the
 * file manager's delete does; the files the area had stay until the form is saved. Throws `FormError`
 * naming the files the area doesn't have, before removing any.
 */
export async function removeFromDraft(page: Page, draftItemId: string, names: string[]): Promise<void> {
  const present = (await draftFiles(page, draftItemId)).map((file) => file.name);
  const missing = names.filter((name) => !present.includes(name));
  if (missing.length > 0) throw new FormError("Removing files failed:", missing.map((name) => ({ field: "files", message: `${name}: not among the files (${present.join(", ") || "none"})` })));
  for (const name of names) await deleteDraftFile(page, draftItemId, name);
}

/**
 * Submits the form with one of its buttons and waits for the next page. Throws `FormError` with
 * Moodle's messages by field (`#id_error_<field>`) when the form comes back with errors.
 */
export async function submitForm(page: Page, button: string): Promise<void> {
  // The navigation's timeout, not the click's: saving can take Moodle long (regrading after a new
  // maximum grade took over 30 seconds, confirmed empirically on the sandbox, 5.2).
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`form.mform [name="${button}"]`, { noWaitAfter: true })]);
  const errors = await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document;
    return Array.from(doc.querySelectorAll('form.mform [id^="id_error_"]'))
      .map((element) => ({ field: element.id.slice("id_error_".length), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
      .filter((error) => error.message !== "");
  });
  if (errors.length > 0) throw new FormError("Moodle refused the form:", errors);
}

/**
 * The values of a Moodle date selector's parts (`name[day]`, `[month]`, `[year]`, `[hour]`,
 * `[minute]`) for `date`, in the person's time zone (`M.cfg.usertimezone`), which is how Moodle
 * reads them. Its "enable" checkbox, when it has one, is the caller's to set first. `timeZone` is for a
 * form without Moodle's page around it (a fragment), which has no `M.cfg`: `readPageConfig()` gives it.
 */
export async function dateSelectorValues(page: Page, name: string, date: Date, timeZone?: string): Promise<Record<string, FieldValue>> {
  timeZone ??= await page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { usertimezone?: string } } }).M?.cfg?.usertimezone ?? "UTC");
  return dateSelectorParts(name, date, timeZone);
}

/** The parts of a Moodle date selector (`name[day]`…) for `date` in `timeZone`, as `dateSelectorValues` gives them for a page. */
export function dateSelectorParts(name: string, date: Date, timeZone: string): Record<string, number> {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  } catch {
    throw new FormError(`The person's time zone in Moodle ("${timeZone}") isn't one the driver knows, so a date can't be set.`, [{ field: name, message: "unknown time zone" }]);
  }
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { [`${name}[day]`]: part("day"), [`${name}[month]`]: part("month"), [`${name}[year]`]: part("year"), [`${name}[hour]`]: part("hour"), [`${name}[minute]`]: part("minute") };
}

/** The date a Moodle date selector holds (`name[day]`… in the person's time zone), or undefined when it's off. */
export async function dateSelectorDate(page: Page, name: string): Promise<Date | undefined> {
  const read = await page.evaluate((name) => {
    const g = globalThis as unknown as { M?: { cfg?: { usertimezone?: string } }; document: { querySelector(s: string): { value: string; checked: boolean; type: string } | null } };
    const enabled = g.document.querySelector(`form.mform [name="${name}[enabled]"][type="checkbox"]`);
    if (enabled && !enabled.checked) return undefined;
    // Anonymous callbacks only: see the conventions on page.evaluate.
    const [year, month, day, hour, minute] = ["year", "month", "day", "hour", "minute"].map((p) => Number(g.document.querySelector(`form.mform [name="${name}[${p}]"]`)?.value) || 0);
    return { timeZone: g.M?.cfg?.usertimezone ?? "UTC", year: year!, month: month!, day: day!, hour: hour!, minute: minute! };
  }, name);
  if (!read || !read.year) return undefined;
  // The wall time in that zone: start from it as if UTC, then take away the zone's offset at that moment (twice, across a DST change).
  const wall = Date.UTC(read.year, read.month - 1, read.day, read.hour, read.minute);
  let time = wall;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: read.timeZone, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(time));
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const shown = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
    time += wall - shown;
  }
  return new Date(time);
}
