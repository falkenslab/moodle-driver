// A course's external tools (LTI), read and managed as its "LTI External tools" page does
// (`mod/lti/coursetools.php`, a report builder table; more rows through its table service), a course
// tool added through the course tool form (`mod/lti/coursetooledit.php`) and its URL read back from
// that form, shown in or hidden from the activity chooser and deleted through the services the page's
// toggles and delete action call (`mod_lti_toggle_showinactivitychooser`,
// `mod_lti_delete_course_tool_type`). An activity made from a tool is `createActivity` with its
// `toolId`. Moodle 5.2 has no dynamic registration at course level: only administrators register
// tools that way (Site administration > Plugins > External tool > Manage tools).
import type { BrowserContext, Page } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";
import { FormError, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { siteFetch } from "../../core/http.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, fetchSitePage, htmlSessionFacts, isLoggedIn, moodleErrorMessage, openSitePage } from "../../core/session.js";

/** A course's external tools can't be read or changed as asked: a missing capability, a tool that isn't the course's, an activity that isn't an external tool. */
export class ExternalToolError extends MoodleError {
  override name = "ExternalToolError";
  constructor(message: string) {
    super(message, "external-tool");
  }
}

/** The capability each kind of work takes, as Moodle checks it. */
const CAPABILITY = { list: "mod/lti:addpreconfiguredinstance", add: "mod/lti:addcoursetool", view: "mod/lti:view" };

/** An external tool a course may use: one an administrator set up for the site, or the course's own. Its secret is never read. */
export interface ExternalTool {
  /** The tool's id (Moodle's tool type id): what `createActivity` takes as `toolId`. */
  id: number;
  name: string;
  /** Its description (plain text), "" without one. */
  description: string;
  /**
   * "site" for a tool an administrator set up (teachers can't change it), "course" for one added to
   * this course. Undefined for whom can't add course tools: Moodle locks every row for them alike.
   */
  scope?: "site" | "course";
  /** A course tool's URL, as its form holds it; a site tool's isn't shown to teachers. */
  url?: string;
  /** Whether teachers find it in the activity chooser; `createActivity` still makes an activity from one that isn't (confirmed empirically, 5.2). */
  shownInActivityChooser: boolean;
}

/** What `addExternalTool` sets up: an LTI 1.0/1.1 tool by its URL, with its consumer key and shared secret when it has them. */
export interface NewExternalTool {
  name: string;
  /** The tool's launch URL (or a cartridge's, which Moodle reads the tool from). */
  url: string;
  description?: string;
  /** The consumer key the tool's provider gave. */
  key?: string;
  /** The shared secret the tool's provider gave: Moodle stores it; nothing returns it. */
  secret?: string;
  /** Any other field of Moodle's course tool form, by its name (`lti_ltiversion`, `lti_launchcontainer`, `lti_sendname`…); these win. */
  settings?: Record<string, FieldValue>;
}

/** A row of the course's tools table. */
export interface ExternalToolRow {
  id: number;
  name: string;
  description: string;
  shownInActivityChooser: boolean;
  /** Whether the row has an edit link: a course tool the person may change. */
  editable: boolean;
  /** Whether its chooser toggle is enabled: the person may add and change course tools. */
  canChange: boolean;
}

/**
 * The rows of the tools table (the page, or the HTML its table service sends), read by the columns'
 * sort keys, the chooser toggle's data attributes and the edit link (Moodle 5.2): a site tool's row,
 * and every row for whom can't add course tools, has a lock instead of the actions menu.
 */
export function readExternalToolRows(page: Page, html?: string): Promise<ExternalToolRow[]> {
  return inPage(
    page,
    (html: string | null) => {
      interface El {
        textContent: string | null;
        className: string;
        innerHTML: string;
        content: El;
        disabled: boolean;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El & { createElement(tag: string): El } }).document;
      let root: El = doc;
      if (html !== null) {
        const template = doc.createElement("template");
        template.innerHTML = html;
        root = template.content;
      }
      const table = root.querySelector('table[data-region="reportbuilder-table"]');
      if (!table) return [];
      const headers = Array.from(table.querySelectorAll("thead th"));
      const column = (key: string) => headers.findIndex((th) => (th.querySelector("a[data-sortby]")?.getAttribute("data-sortby") ?? "").endsWith(`_${key}`));
      const name = column("name");
      const description = column("description");
      const text = (el: El | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      return Array.from(table.querySelectorAll("tbody tr")).flatMap((row) => {
        if (/\bemptyrow\b/.test(row.className)) return [];
        const toggle = row.querySelector('[data-action="showinactivitychooser-toggle"]');
        const id = Number(toggle?.getAttribute("data-id"));
        if (!toggle || !id) return [];
        const cells = Array.from(row.querySelectorAll(":scope > td"));
        return [
          {
            id,
            name: text(cells[name]),
            description: text(cells[description]),
            shownInActivityChooser: toggle.getAttribute("data-state") === "1",
            editable: row.querySelector('a[href*="/mod/lti/coursetooledit.php"]') !== null,
            canChange: !toggle.disabled,
          },
        ];
      });
    },
    html ?? null,
  );
}

/** Every row of a course's tools table: the page shows ten; the rest comes from its table service, as its paging does. */
async function toolRows(context: BrowserContext, siteUrl: string, courseId: number): Promise<ExternalToolRow[]> {
  const page = await openSitePage(context, siteUrl, `mod/lti/coursetools.php?id=${courseId}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new ExternalToolError(`You can't see the external tools of course ${courseId} (it takes ${CAPABILITY.list}): ${refused}`);
    if ((await page.locator("body#page-mod-lti-coursetools").count()) === 0) throw new ExternalToolError(`Course ${courseId}'s external tools page didn't open: the course may not exist.`);
    const rows = await readExternalToolRows(page);
    // Helpers inside: through inPage (see the conventions on page.evaluate).
    const table = await inPage(page, () => {
      const el = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-region="core_table/dynamic"]');
      if (!el) return undefined;
      const get = (name: string) => el.getAttribute(`data-table-${name}`) ?? "";
      return { component: get("component"), handler: get("handler"), uniqueid: get("uniqueid"), filters: get("filters"), sortdata: get("sort-data"), total: Number(get("total-rows")) || 0 };
    }, null);
    if (!table || rows.length >= table.total) return rows;
    const filters = JSON.parse(table.filters || "{}") as { jointype?: number; filters?: Record<string, { name: string; jointype: number; values: unknown[] }> };
    const { html } = await callService<{ html: string }>(context, siteUrl, "core_table_get_dynamic_table_content", {
      component: table.component,
      handler: table.handler,
      uniqueid: table.uniqueid,
      sortdata: JSON.parse(table.sortdata || "[]"),
      filters: Object.values(filters.filters ?? {}),
      jointype: filters.jointype ?? 2,
      firstinitial: "",
      lastinitial: "",
      pagenumber: 1,
      pagesize: table.total,
      hiddencolumns: [],
      resetpreferences: false,
    });
    return await readExternalToolRows(page, html);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A course tool's URL, from its edit form fetched without a tab; the form's other fields (the secret among them) are left alone. */
async function toolUrl(context: BrowserContext, siteUrl: string, courseId: number, toolId: number): Promise<string | undefined> {
  const { html } = await fetchSitePage(context, siteUrl, `mod/lti/coursetooledit.php?course=${courseId}&typeid=${toolId}`, { follow: false });
  // The field's tag, then its value attribute, decoded: only lti_toolurl is read.
  const tag = /<input\b[^>]*\bname="lti_toolurl"[^>]*>/.exec(html)?.[0];
  const value = tag ? /\bvalue="([^"]*)"/.exec(tag)?.[1] : undefined;
  return value === undefined ? undefined : value.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function toolOf(row: ExternalToolRow, url: string | undefined): ExternalTool {
  const scope = row.editable ? "course" : row.canChange ? "site" : undefined;
  return { id: row.id, name: row.name, description: row.description, ...(scope ? { scope } : {}), ...(url !== undefined ? { url } : {}), shownInActivityChooser: row.shownInActivityChooser };
}

/**
 * The external tools a course may use, as its "LTI External tools" page lists them: the site's
 * preconfigured tools and the course's own, by name. Teachers only (it takes
 * `mod/lti:addpreconfiguredinstance`); a course tool's URL comes from its form, one page each.
 */
export async function externalTools(context: BrowserContext, siteUrl: string, courseId: number): Promise<ExternalTool[]> {
  const rows = await toolRows(context, siteUrl, courseId);
  const tools: ExternalTool[] = [];
  for (const row of rows) tools.push(toolOf(row, row.editable ? await toolUrl(context, siteUrl, courseId, row.id) : undefined));
  return tools;
}

/** A row of the course's tools that is a course tool the person may change, or the error saying why not. */
async function courseToolRow(context: BrowserContext, siteUrl: string, courseId: number, toolId: number): Promise<ExternalToolRow> {
  const row = (await toolRows(context, siteUrl, courseId)).find((r) => r.id === toolId);
  if (!row) throw new ExternalToolError(`Course ${courseId} has no external tool ${toolId}. Take its id from externalTools.`);
  if (!row.canChange) throw new ExternalToolError(`You can't change course ${courseId}'s external tools (it takes ${CAPABILITY.add}).`);
  return row;
}

/** Turns a service's refusal for lack of a capability into an `ExternalToolError` naming it. */
function refusal(error: unknown, what: string): unknown {
  if (error instanceof MoodleServiceError && (error.errorcode === "nopermissions" || error.errorcode === "requireloginerror")) return new ExternalToolError(`${what} (it takes ${CAPABILITY.add}).`);
  return error;
}

/**
 * Adds an external tool to a course through Moodle's course tool form, by its URL, as an LTI 1.0/1.1
 * tool unless `settings` says otherwise (an LTI 1.3 tool needs its keys, which `settings` takes by
 * field name). Moodle shows it in the activity chooser. Moodle fetches the URL when it saves, to see
 * whether it's a cartridge (an XML description of the tool); one its network settings block is saved
 * as given (confirmed empirically, 5.2). Teachers only (`mod/lti:addcoursetool`).
 */
export async function addExternalTool(context: BrowserContext, siteUrl: string, courseId: number, tool: NewExternalTool): Promise<{ changed: string; tool: ExternalTool }> {
  if (tool.name.trim() === "") throw new MoodleError("An external tool needs a name.", "invalid-input");
  if (!/^https?:\/\/[^\s/]+/i.test(tool.url)) throw new MoodleError(`"${tool.url}" isn't a tool URL: give its http(s) address.`, "invalid-input");
  let page: Page;
  try {
    page = await openForm(context, siteUrl, `mod/lti/coursetooledit.php?course=${courseId}`);
  } catch (error) {
    if (error instanceof FormError) throw new ExternalToolError(`You can't add external tools to course ${courseId} (it takes ${CAPABILITY.add}).`);
    throw error;
  }
  let before: Set<number>;
  try {
    // The form first: its refusal names what adding takes; the tools before tell the new one afterwards.
    before = new Set((await toolRows(context, siteUrl, courseId)).map((row) => row.id));
    const values: Record<string, FieldValue> = { lti_typename: tool.name, lti_toolurl: tool.url };
    if (tool.description !== undefined) values.lti_description = tool.description;
    if (tool.key !== undefined) values.lti_resourcekey = tool.key;
    if (tool.secret !== undefined) values.lti_password = tool.secret;
    await setFields(page, { ...values, ...tool.settings });
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  const added = (await toolRows(context, siteUrl, courseId)).find((row) => !before.has(row.id));
  if (!added) throw new ExternalToolError(`The form was saved, but no new external tool appears in course ${courseId}.`);
  return { changed: `Added external tool ${added.id} "${added.name}" to course ${courseId}.`, tool: toolOf(added, await toolUrl(context, siteUrl, courseId, added.id)) };
}

/**
 * Shows an external tool in the course's activity chooser, or hides it from there, as the course's
 * tools page's toggle does; a site tool's setting changes for this course only. Teachers only
 * (`mod/lti:addcoursetool`).
 */
export async function setExternalToolInChooser(context: BrowserContext, siteUrl: string, courseId: number, toolId: number, shown: boolean): Promise<{ changed: string; tool: ExternalTool }> {
  const row = await courseToolRow(context, siteUrl, courseId, toolId);
  try {
    await callService(context, siteUrl, "mod_lti_toggle_showinactivitychooser", { tooltypeid: toolId, courseid: courseId, showinactivitychooser: shown });
  } catch (error) {
    throw refusal(error, `You can't change course ${courseId}'s external tools`);
  }
  const after = (await toolRows(context, siteUrl, courseId)).find((r) => r.id === toolId) ?? { ...row, shownInActivityChooser: shown };
  return {
    changed: `External tool ${toolId} "${after.name}" ${shown ? "shown in" : "hidden from"} course ${courseId}'s activity chooser.`,
    tool: toolOf(after, after.editable ? await toolUrl(context, siteUrl, courseId, toolId) : undefined),
  };
}

/**
 * Deletes one of the course's own external tools, as its tools page's delete action does. The
 * activities made from it stay, but can't be launched any more (Moodle warns with how many use it).
 * A site tool is the administrator's: it can't be deleted here. Teachers only (`mod/lti:addcoursetool`).
 */
export async function deleteExternalTool(context: BrowserContext, siteUrl: string, courseId: number, toolId: number): Promise<{ changed: string }> {
  const row = await courseToolRow(context, siteUrl, courseId, toolId);
  if (!row.editable) throw new ExternalToolError(`External tool ${toolId} "${row.name}" is a site tool: only an administrator deletes it.`);
  try {
    await callService(context, siteUrl, "mod_lti_delete_course_tool_type", { tooltypeid: toolId });
  } catch (error) {
    throw refusal(error, `You can't delete course ${courseId}'s external tools`);
  }
  return { changed: `Deleted external tool ${toolId} "${row.name}" from course ${courseId}.` };
}

/**
 * The URL that launches an external tool activity for the person (`mod/lti/launch.php`), for the
 * person to open in their browser: opening it logs the view and sends the person to the tool.
 * Moodle's launch page is read once over HTTP to check the person may launch it (`mod/lti:view`) and
 * that it is an external tool; its form, which would send the person's launch to the tool, is never
 * submitted, so nothing reaches the tool.
 */
export async function externalToolLaunchUrl(context: BrowserContext, siteUrl: string, activityId: number): Promise<string> {
  // triggerview=0: reading the page logs no view; the person's own opening does.
  const response = await siteFetch(context, new URL(`mod/lti/launch.php?id=${activityId}&triggerview=0`, siteUrl).href);
  // A launch page is the tool's form alone (an LTI 1.3 tool's starts with its login), without Moodle's
  // page around it; anything else is the login page or Moodle's error page.
  if (!/\bid="lti(?:Launch|InitiateLogin)Form"/.test(response.body)) {
    if (!isLoggedIn(response.url, siteUrl, htmlSessionFacts(response.body))) throw new NotLoggedInError();
    const message = /class="errormessage">([\s\S]*?)<\/p>/.exec(response.body)?.[1]?.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    throw new ExternalToolError(`You can't launch activity ${activityId}: ${message ?? "it isn't an external tool, or you can't see it"} (it takes ${CAPABILITY.view}).`);
  }
  return new URL(`mod/lti/launch.php?id=${activityId}`, siteUrl).href;
}
