import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { openSitePage } from "./session.js";

/** A form field's value: text, a number, a checkbox, or a multiple select's values. */
export type FieldValue = string | number | boolean | string[];

/** Moodle refused the form, or a field to set isn't in it. */
export class FormError extends Error {
  override name = "FormError";
  constructor(
    message: string,
    readonly fields: { field: string; message: string }[],
  ) {
    super(`${message} ${fields.map((f) => `${f.field}: ${f.message}`).join("; ")}`);
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
 * selects (several values for a multiple one), checkboxes and radios. Throws `FormError` naming the
 * fields the form doesn't have.
 */
export async function setFields(page: Page, values: Record<string, FieldValue>, formSelector = "form.mform"): Promise<void> {
  const missing = await page.evaluate(({ values, formSelector }) => {
    interface Field {
      type: string;
      id: string;
      value: string;
      checked: boolean;
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
    const notFound: string[] = [];
    for (const [name, value] of Object.entries(values)) {
      const all = Array.from(form?.querySelectorAll(`[name="${name}"]`) ?? []);
      // A Moodle checkbox comes with a hidden twin holding its unchecked value.
      const fields = all.length > 1 ? all.filter((field) => field.type !== "hidden") : all;
      if (fields.length === 0) {
        notFound.push(name);
        continue;
      }
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
    }
    return notFound;
  }, { values, formSelector });
  if (missing.length > 0) {
    throw new FormError("The form has no such field:", missing.map((field) => ({ field, message: "not in this form; check its name in Moodle's form" })));
  }
}

/**
 * Uploads local files to a form's draft area, as the file picker's "Upload a file" does: the
 * upload repository's id comes from the page's file picker settings, the context from `M.cfg`.
 */
export async function uploadToDraft(page: Page, draftItemId: string, filePaths: string[]): Promise<void> {
  const files = await Promise.all(
    filePaths.map(async (filePath) => ({ name: path.basename(filePath), base64: (await readFile(filePath)).toString("base64") })),
  );
  const errors = await page.evaluate(
    async ({ draftItemId, files }) => {
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
        for (const [key, value] of Object.entries({ sesskey: g.M.cfg.sesskey, repo_id: repo, itemid: draftItemId, ctx_id: String(g.M.cfg.contextid), savepath: "/", title: file.name, env: "filemanager", author: "" })) {
          body.append(key, value);
        }
        const response = await g.fetch(`${g.M.cfg.wwwroot}/repository/repository_ajax.php?action=upload`, { method: "POST", body, credentials: "same-origin" });
        const answer = await response.json().catch(() => ({ error: "the answer isn't JSON" }));
        if (answer.error) failed.push(`${file.name}: ${answer.error}`);
      }
      return failed;
    },
    { draftItemId, files },
  );
  if (errors.length > 0) throw new FormError("Uploading failed:", errors.map((message) => ({ field: "files", message })));
}

/**
 * Submits the form with one of its buttons and waits for the next page. Throws `FormError` with
 * Moodle's messages by field (`#id_error_<field>`) when the form comes back with errors.
 */
export async function submitForm(page: Page, button: string): Promise<void> {
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`form.mform [name="${button}"]`)]);
  const errors = await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document;
    return Array.from(doc.querySelectorAll('form.mform [id^="id_error_"]'))
      .map((element) => ({ field: element.id.slice("id_error_".length), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
      .filter((error) => error.message !== "");
  });
  if (errors.length > 0) throw new FormError("Moodle refused the form:", errors);
}
