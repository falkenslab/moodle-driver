// What every page of a glossary activity shares: the errors, opening its pages with the module
// checked, Moodle's refusals told apart by the error page's error code, and the entries a page shows
// (`.glossarypost`, one per entry in every display format), each named by its links.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/** The activity isn't a glossary (`glossary`) activity the person can open, or there's no activity with that id. */
export class NotAGlossaryError extends MoodleError {
  override name = "NotAGlossaryError";
  constructor(message: string) {
    super(message, "not-a-glossary");
  }
}

/** Moodle refused something in a glossary: the person lacks the capability, the entry isn't there, or its editing time is over. */
export class GlossaryError extends MoodleError {
  override name = "GlossaryError";
  constructor(message: string) {
    super(message, "glossary");
  }
}

/** The error code an error page names in its "More information" link (`…/error/glossary/errcannoteditothers`). */
export async function errorCode(page: Page): Promise<string | undefined> {
  const href = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a')?.getAttribute("href"));
  return href ? href.split("/").pop() : undefined;
}

// What each of Moodle's refusals means for a program, by its error code (mod/glossary, 5.2).
const HINTS: Record<string, string> = {
  errcannoteditothers: "changing someone else's entry takes Moodle's capability mod/glossary:manageentries, which teachers have",
  erredittimeexpired: "the time to change your own entry is over (the site's maximum editing time), and the glossary doesn't let entries be edited always",
  errdeltimeexpired: "the time to delete your own entry is over (the site's maximum editing time), and the glossary doesn't let entries be edited always",
  nopermissiontodelentry: "deleting someone else's entry takes Moodle's capability mod/glossary:manageentries, which teachers have",
};

/**
 * Throws the error an error page means, if `page` is one: `NotAGlossaryError` when Moodle found no
 * glossary with that id (or the page isn't a glossary's), `GlossaryError` with Moodle's message and
 * what it means otherwise. `refused` says what was refused; `capability` explains a missing permission.
 */
export async function failOnRefusal(page: Page, activityId: number, refused: string, capability: string): Promise<void> {
  const message = await moodleErrorMessage(page);
  const bodyId = await page.evaluate(() => (globalThis as unknown as { document: { body: { id: string } } }).document.body.id);
  const code = message === undefined ? undefined : await errorCode(page);
  if (!bodyId.startsWith("page-mod-glossary-") || code === "invalidcoursemodule" || code === "invalidid") {
    throw new NotAGlossaryError(`Activity ${activityId} isn't a glossary you can open${message ? ` (Moodle says: ${message})` : ""}: take its id and module from the course structure.`);
  }
  if (message === undefined) return;
  const hint = code === "nopermissions" ? capability : code === "invalidentry" ? `the entry isn't in glossary ${activityId}: take its id from glossaryEntries` : (HINTS[code ?? ""] ?? "");
  throw new GlossaryError(`${refused} (Moodle says: ${message})${hint ? `: ${hint}` : ""}.`);
}

/** Opens a page of the glossary (`mod/glossary/<path>`) and fails as `failOnRefusal` says when Moodle refuses it. */
export async function openGlossaryPage(context: BrowserContext, siteUrl: string, activityId: number, path: string, refused: string, capability: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/glossary/${path}`);
  try {
    await failOnRefusal(page, activityId, refused, capability);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** One entry as a glossary's page shows it: its id (when a link or its aliases name it) and its aliases. */
export interface ShownEntry {
  id?: number;
  aliases: string[];
}

/**
 * The entries the glossary's page shows, in order: each `.glossarypost` (every display format wraps
 * an entry in one), its id from the links Moodle puts under it (the entry link, approve, edit and
 * delete) or its aliases' menu (`#keyword-<id>`), its aliases from that menu. An entry may show no
 * id: a student's own entry waiting for approval, once its editing time is over, has none of them.
 */
export function readShownEntries(page: Page): Promise<ShownEntry[]> {
  return inPage(
    page,
    () => {
      interface El {
        id: string;
        textContent: string | null;
        parentElement: El | null;
        getAttribute(name: string): string | null;
        closest(s: string): El | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El; location: { href: string } }).document;
      const base = (globalThis as unknown as { location: { href: string } }).location.href;
      // The parameter that names the entry in each of the links under it.
      const named: [RegExp, string][] = [
        [/\/showentry\.php$/, "eid"],
        [/\/approve\.php$/, "eid"],
        [/\/deleteentry\.php$/, "entry"],
        [/\/edit\.php$/, "id"],
      ];
      const entryId = (post: El): number | undefined => {
        for (const link of Array.from(post.querySelectorAll("a[href]"))) {
          const url = new URL(link.getAttribute("href") ?? "", base);
          for (const [path, param] of named) {
            const value = path.test(url.pathname) && url.pathname.includes("/mod/glossary/") ? url.searchParams.get(param) : null;
            if (value && /^\d+$/.test(value)) return Number(value);
          }
        }
        const keywords = /^keyword-(\d+)$/.exec(post.querySelector('select[id^="keyword-"]')?.id ?? "");
        return keywords ? Number(keywords[1]) : undefined;
      };
      return Array.from(doc.querySelectorAll(".glossarypost"))
        .filter((post) => !post.parentElement?.closest(".glossarypost"))
        .map((post) => {
          const aliases = Array.from(post.querySelectorAll('select[id^="keyword-"] option')).map((option) => (option.textContent ?? "").trim());
          const id = entryId(post);
          return id === undefined ? { aliases } : { id, aliases };
        });
    },
    null,
  );
}

/** The session key of the page's `M.cfg`, for the links that need one. */
export async function pageSesskey(page: Page): Promise<string> {
  const sesskey = await page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { sesskey?: string } } }).M?.cfg?.sesskey);
  if (!sesskey) throw new MoodleError("The glossary's page has no session key: log in again.", "unexpected-page");
  return sesskey;
}
