// A database activity's templates (`mod/data/templates.php`) and presets (`mod/data/preset.php`):
// templates read from each template page's editors and saved by posting them as its Save does, without
// its HTML editor in between (it would rewrite the HTML); presets listed from the presets page and
// applied as its "Use this preset" does.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";
import { DatabaseError, openDatabasePage, sendFromPage } from "./database.js";
import { databaseFields, type DatabaseField } from "./fields.js";

/**
 * A database's templates, as Moodle's templates page calls them: the list view (`listHeader`, `list`
 * repeated per entry, `listFooter`), the single view, the add entry form, the advanced search, the RSS
 * feed (`rssTitle`, `rss`), and the database's CSS and JavaScript.
 */
export const DATABASE_TEMPLATES = ["list", "listHeader", "listFooter", "single", "add", "search", "rss", "rssTitle", "css", "js"] as const;
/** One of `DATABASE_TEMPLATES`. */
export type DatabaseTemplate = (typeof DATABASE_TEMPLATES)[number];
/** Every template's content (HTML, or CSS and JavaScript), Moodle's default where none was saved. */
export type DatabaseTemplates = Record<DatabaseTemplate, string>;

/** Each template's name in Moodle (its editor's and its column's) and the page (`mode`) that edits it. */
const MOODLE_TEMPLATES: Record<DatabaseTemplate, { name: string; mode: string }> = {
  list: { name: "listtemplate", mode: "listtemplate" },
  listHeader: { name: "listtemplateheader", mode: "listtemplate" },
  listFooter: { name: "listtemplatefooter", mode: "listtemplate" },
  single: { name: "singletemplate", mode: "singletemplate" },
  add: { name: "addtemplate", mode: "addtemplate" },
  search: { name: "asearchtemplate", mode: "asearchtemplate" },
  rss: { name: "rsstemplate", mode: "rsstemplate" },
  rssTitle: { name: "rsstitletemplate", mode: "rsstemplate" },
  css: { name: "csstemplate", mode: "csstemplate" },
  js: { name: "jstemplate", mode: "jstemplate" },
};

/** The templates page of a database with fields: Moodle shows no templates before the first field. */
async function openTemplatesPage(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openDatabasePage(context, siteUrl, activityId, "templates.php?mode=listtemplate");
  if ((await page.locator("form#edittemplateform").count()) === 0) {
    await page.close().catch(() => undefined);
    throw new DatabaseError(`Database ${activityId} has no fields yet: Moodle has no templates for it until it has one (addDatabaseField, or applyDatabasePreset).`);
  }
  return page;
}

/** Every template page's editors, fetched from the open templates page, by their names. */
async function templatesOn(page: Page, siteUrl: string, activityId: number): Promise<DatabaseTemplates> {
  const modes = [...new Set(Object.values(MOODLE_TEMPLATES).map((t) => t.mode))];
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  const editors = await inPage(
    page,
    async ({ siteUrl, activityId, modes }) => {
      const g = globalThis as unknown as {
        fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
        DOMParser: new () => { parseFromString(html: string, type: string): { querySelectorAll(s: string): ArrayLike<{ name: string; value: string }> } };
      };
      const read = async (mode: string) => {
        const html = await (await g.fetch(new URL(`mod/data/templates.php?id=${activityId}&mode=${mode}`, siteUrl).href, { credentials: "same-origin" })).text();
        return Array.from(new g.DOMParser().parseFromString(html, "text/html").querySelectorAll("form#edittemplateform textarea")).map((t) => [t.name, t.value] as [string, string]);
      };
      return Object.fromEntries((await Promise.all(modes.map(read))).flat());
    },
    { siteUrl, activityId, modes },
  );
  const templates = {} as DatabaseTemplates;
  for (const template of DATABASE_TEMPLATES) {
    const value = editors[MOODLE_TEMPLATES[template].name];
    if (value === undefined) throw new DatabaseError(`Database ${activityId}'s templates page has no editor for its ${template} template (${MOODLE_TEMPLATES[template].name}).`);
    templates[template] = value;
  }
  return templates;
}

/**
 * A database activity's templates (`DATABASE_TEMPLATES`), as its templates page shows them: what was
 * saved, or Moodle's default for the fields it has where nothing was (an empty header, footer or RSS
 * title, CSS or JavaScript stays empty). Throws `DatabaseError` when the database has no fields yet
 * (Moodle has no templates before the first) or the person can't manage it, `NotADatabaseError` when
 * the id isn't a database.
 */
export async function databaseTemplates(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabaseTemplates> {
  const page = await openTemplatesPage(context, siteUrl, activityId);
  try {
    return await templatesOn(page, siteUrl, activityId);
  } finally {
    await page.close().catch(() => undefined);
  }
}

const normalized = (text: string) => text.replace(/\r\n?/g, "\n").trim();

/**
 * Saves one of a database's templates (`DATABASE_TEMPLATES`) as it is, without Moodle's HTML editor
 * in between, as its templates page's Save does; `null` resets it to Moodle's default (for the list
 * template alone: its header and footer stay). Fields go in as `[[name]]`, Moodle's other tags as
 * `##tag##` (the templates page lists them). Returns every template afterwards. Throws
 * `MoodleError` (`invalid-input`) for a template that isn't one of `DATABASE_TEMPLATES`;
 * `DatabaseError` when the database has no fields yet, Moodle doesn't keep the template (an add
 * entry template with a field's tag twice) or the person can't manage it; `NotADatabaseError` when
 * the id isn't a database.
 */
export async function setDatabaseTemplate(context: BrowserContext, siteUrl: string, activityId: number, template: DatabaseTemplate, html: string | null): Promise<{ changed: string; templates: DatabaseTemplates }> {
  const moodle = MOODLE_TEMPLATES[template];
  if (!(DATABASE_TEMPLATES as readonly string[]).includes(template) || !moodle) throw new MoodleError(`"${String(template)}" isn't a database template: one of ${DATABASE_TEMPLATES.join(", ")}.`, "invalid-input");
  const page = await openTemplatesPage(context, siteUrl, activityId);
  try {
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    // An empty template is Moodle's default: resetting one is saving it empty.
    const outcome = await sendFromPage(page, { url: new URL(`mod/data/templates.php?id=${activityId}&mode=${moodle.mode}`, siteUrl).href, values: { sesskey, [moodle.name]: html ?? "" } });
    if (!outcome.ok) throw new DatabaseError(`Moodle didn't save database ${activityId}'s ${template} template${outcome.message ? `: ${outcome.message}` : "."}`);
    const templates = await templatesOn(page, siteUrl, activityId);
    // Moodle says it saved even when it kept the old one (an add entry template with a tag twice).
    if (html !== null && normalized(templates[template]) !== normalized(html)) {
      throw new DatabaseError(`Moodle didn't keep database ${activityId}'s ${template} template${template === "add" ? ": an add entry template can't have a field's tag twice" : ""}.`);
    }
    return { changed: html === null ? `Reset database ${activityId}'s ${template} template to Moodle's default.` : `Saved database ${activityId}'s ${template} template.`, templates };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A preset a database can be given: Moodle's own (image gallery, journal…) and those saved on the site. */
export interface DatabasePreset {
  /** What `applyDatabasePreset` takes: Moodle's `<user id>/<short name>`, 0 for the site's own presets. */
  id: string;
  name: string;
  description: string;
  /** Who saved it, for a preset saved by a person; none for Moodle's own. */
  userId?: number;
}

/**
 * The presets a database activity can be given, from its presets page: Moodle's own and those saved
 * on the site that the person can see. Throws `DatabaseError` when the person can't manage the
 * database, `NotADatabaseError` when the id isn't one.
 */
export async function databasePresets(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabasePreset[]> {
  const page = await openDatabasePage(context, siteUrl, activityId, "preset.php");
  try {
    return await page.evaluate(() => {
      interface Row {
        cells: ArrayLike<{ textContent: string | null }>;
        querySelector(s: string): { value: string; textContent: string | null } | null;
      }
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<Row> } }).document;
      const presets: { id: string; name: string; description: string; userId?: number }[] = [];
      for (const row of Array.from(doc.querySelectorAll("#presets-list tbody tr"))) {
        // The radio's value is "<user id>/<short name>", the user id empty for Moodle's own presets ("/journal").
        const value = row.querySelector('input[name="fullname"]')?.value;
        if (!value) continue;
        const [user = "", ...rest] = value.split("/");
        const userId = Number(user) || 0;
        presets.push({
          id: `${userId}/${rest.join("/")}`,
          name: (row.querySelector('a[id^="preset-name-"]')?.textContent ?? "").trim(),
          description: (row.cells[2]?.textContent ?? "").replace(/\s+/g, " ").trim(),
          ...(userId ? { userId } : {}),
        });
      }
      return presets;
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Gives a database activity one of the site's presets (`databasePresets`), as "Use this preset" and
 * "Apply preset" do: the preset's fields are added, a field with the same name and type is kept with
 * what entries have in it, and every other field is deleted with its content; its templates replace
 * the database's, and its other settings stay. Returns the fields afterwards. Throws `MoodleError`
 * (`not-found`) for a preset the presets page doesn't list, `DatabaseError` when Moodle doesn't apply
 * it or the person can't manage the database, `NotADatabaseError` when the id isn't a database.
 */
export async function applyDatabasePreset(context: BrowserContext, siteUrl: string, activityId: number, presetId: string): Promise<{ changed: string; fields: DatabaseField[] }> {
  const presets = await databasePresets(context, siteUrl, activityId);
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) throw new MoodleError(`Database ${activityId} has no preset "${presetId}" to use: its presets are ${presets.map((p) => `${p.id} (${p.name})`).join(", ") || "none"}.`, "not-found");
  const page = await openDatabasePage(context, siteUrl, activityId, "field.php");
  try {
    // "Apply preset" in Moodle's mapping dialogue: a link, without mapping the fields by hand.
    const outcome = await sendFromPage(page, { url: new URL(`mod/data/field.php?id=${activityId}&mode=usepreset&fullname=${encodeURIComponent(preset.id)}&action=notmapping`, siteUrl).href, values: {} });
    if (!outcome.ok) throw new DatabaseError(`Moodle didn't apply the preset "${preset.name}" to database ${activityId}${outcome.message ? `: ${outcome.message}` : "."}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const fields = await databaseFields(context, siteUrl, activityId);
  return { changed: `Applied the preset "${preset.name}" to database ${activityId}: ${fields.length} field${fields.length === 1 ? "" : "s"} now.`, fields };
}
