// What every page of a database activity's setup shares: the errors, opening a page of it with the
// module and the capability checked, and the plain HTML forms its fields, templates and presets pages
// post (not Moodle forms: no `form.mform`), sent from the page as their buttons send them.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/** The activity isn't a database (`data`) activity, or there's no activity with that id. */
export class NotADatabaseError extends MoodleError {
  override name = "NotADatabaseError";
  constructor(message: string) {
    super(message, "not-a-database");
  }
}

/** Moodle refused a database's setup: the person can't manage it, or it didn't take a field, template or preset. */
export class DatabaseError extends MoodleError {
  override name = "DatabaseError";
  constructor(message: string) {
    super(message, "database");
  }
}

/**
 * Opens a page of a database activity's setup (`mod/data/<path>`, with `id=<activityId>`), checked:
 * throws `NotADatabaseError` when the id isn't a database (Moodle answers with its error page, outside
 * the module), `DatabaseError` when Moodle refuses the person its setup pages (they take
 * `mod/data:managetemplates`, which editing teachers have).
 */
export async function openDatabasePage(context: BrowserContext, siteUrl: string, activityId: number, path: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/data/${path}${path.includes("?") ? "&" : "?"}id=${activityId}`);
  try {
    const bodyId = await page.evaluate(() => (globalThis as unknown as { document: { body: { id: string } } }).document.body.id);
    const refused = await moodleErrorMessage(page);
    if (!bodyId.startsWith("page-mod-data-")) throw new NotADatabaseError(`Activity ${activityId} isn't a database activity you can open${refused ? ` (Moodle says: ${refused})` : ""}.`);
    if (refused !== undefined) {
      throw new DatabaseError(`You can't manage database ${activityId}'s fields, templates and presets (Moodle says: ${refused}): it takes Moodle's capability mod/data:managetemplates, which editing teachers have in their courses.`);
    }
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** What Moodle answered to a post or a link of the setup pages: whether it says it did it, and its message when it didn't. */
export interface PostOutcome {
  ok: boolean;
  /** Moodle's message when it refused (its notification or error box). */
  message?: string;
  /** Fields the form doesn't have, or values its lists don't offer: nothing was sent. */
  unknown: string[];
}

/** A value for a field of a setup form: text, a checkbox, a multiple list's values. */
export type FormInput = string | boolean | string[];

/**
 * Sends a request from the page and reads Moodle's answer: a success notification is done, an error
 * notification or Moodle's error box is its refusal. With `form`, the page at `url` is fetched, its
 * form (`form` is its selector) filled with `values` by field name, and posted with every other field
 * as it is, as its Save button posts it; without, `values` are posted to `url` as they are (a GET when
 * there are none).
 */
export function sendFromPage(page: Page, request: { url: string; form?: string; values: Record<string, FormInput> }): Promise<PostOutcome> {
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  return inPage(
    page,
    async ({ url, form: selector, values }) => {
      interface Option {
        value: string;
        selected: boolean;
      }
      interface Control {
        name: string;
        type: string;
        value: string;
        checked: boolean;
        options: ArrayLike<Option>;
      }
      interface Element extends Control {
        textContent: string | null;
        action: string;
        elements: ArrayLike<Control>;
        querySelectorAll(s: string): ArrayLike<{ remove(): void }>;
      }
      interface Doc {
        querySelector(s: string): Element | null;
      }
      const g = globalThis as unknown as {
        fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
        DOMParser: new () => { parseFromString(html: string, type: string): Doc };
        FormData: new (form: unknown) => Iterable<[string, unknown]>;
        URLSearchParams: new (init?: unknown) => { append(name: string, value: string): void; toString(): string };
      };
      const parse = (html: string) => new g.DOMParser().parseFromString(html, "text/html");
      // An element's text without its buttons (a notification's "Dismiss").
      const text = (doc: Doc, s: string) => {
        const element = doc.querySelector(s);
        if (!element) return "";
        for (const button of Array.from(element.querySelectorAll("button"))) button.remove();
        return (element.textContent ?? "").replace(/\s+/g, " ").trim();
      };
      let response: string;
      if (selector) {
        const doc = parse(await (await g.fetch(url, { credentials: "same-origin" })).text());
        const form = doc.querySelector(selector);
        if (!form) return { ok: false, message: text(doc, '[data-rel="fatalerror"] .errormessage') || text(doc, ".alert-danger") || "the page has no form to send.", unknown: [] };
        const controls = Array.from(form.elements);
        const unknown: string[] = [];
        for (const [name, value] of Object.entries(values)) {
          const control = controls.find((c) => c.name === name || c.name === `${name}[]`);
          if (!control) {
            unknown.push(name);
          } else if (control.type === "checkbox") {
            control.checked = value === true;
          } else if (control.type === "select-multiple" || control.type === "select-one") {
            const wanted = Array.isArray(value) ? value : [String(value)];
            const options = Array.from(control.options);
            const missing = wanted.filter((v) => !options.some((o) => o.value === v));
            if (missing.length > 0) unknown.push(`${name}: ${missing.join(", ")} (it offers ${options.map((o) => o.value).join(", ")})`);
            else for (const option of options) option.selected = wanted.includes(option.value);
          } else {
            control.value = Array.isArray(value) ? value.join("\n") : String(value);
          }
        }
        if (unknown.length > 0) return { ok: false, unknown };
        const body = new g.URLSearchParams();
        for (const [name, value] of new g.FormData(form)) body.append(name, String(value));
        response = await (await g.fetch(form.action, { method: "POST", body, credentials: "same-origin" })).text();
      } else {
        const entries = Object.entries(values).map(([name, value]) => [name, String(value)]);
        response = await (await g.fetch(url, entries.length > 0 ? { method: "POST", body: new g.URLSearchParams(entries), credentials: "same-origin" } : { credentials: "same-origin" })).text();
      }
      const doc = parse(response);
      const refused = text(doc, '[data-rel="fatalerror"] .errormessage') || text(doc, ".alert-danger");
      if (refused) return { ok: false, message: refused, unknown: [] };
      return { ok: doc.querySelector(".alert-success") !== null, unknown: [] };
    },
    request,
  );
}
