import type { BrowserContext, Page } from "playwright-core";
import { MoodleError } from "./errors.js";
import { siteFetch } from "./http.js";

/** No live Moodle session: the person has to log in again (ADR-002). */
export class NotLoggedInError extends MoodleError {
  override name = "NotLoggedInError";
  constructor() {
    super("There is no Moodle session, or it expired: the person has to log in again.", "not-logged-in");
  }
}

/** What a Moodle page says about its session, read without depending on the interface's language. */
export interface SessionFacts {
  /** Moodle adds the `notloggedin` body class when nobody is logged in. */
  notLoggedIn: boolean;
  /** `M.cfg.userId`: 0 when logged out; `null` on a page that isn't Moodle's (an SSO provider's). */
  userId: number | null;
  /** A logout link, in the user menu of a real user's pages. */
  hasLogoutLink: boolean;
  /** A login link: a guest (who also has a user id) gets one and no logout link. */
  hasLoginLink: boolean;
}

/**
 * What `page`, as it is now, says about its session: Moodle's body class, `M.cfg.userId` and its login
 * and logout links, which mean the same in any interface language. Give them to `isLoggedIn`; a page
 * fetched as HTML goes through `htmlSessionFacts` instead.
 */
export function readSessionFacts(page: Page): Promise<SessionFacts> {
  return page.evaluate(() => {
    // Runs in the page: Moodle's globals and the DOM, typed loosely on purpose (no DOM lib in Node).
    const g = globalThis as unknown as {
      M?: { cfg?: { userId?: unknown } };
      document: { body: { classList: { contains(name: string): boolean } } | null; querySelector(selector: string): unknown };
    };
    const userId = g.M?.cfg?.userId;
    return {
      notLoggedIn: g.document.body?.classList.contains("notloggedin") ?? true,
      userId: typeof userId === "number" ? userId : null,
      hasLogoutLink: g.document.querySelector('a[href*="/login/logout.php"]') !== null,
      hasLoginLink: g.document.querySelector('a[href*="/login/index.php"]') !== null,
    };
  });
}

/**
 * Whether a page at `url`, with these facts (`readSessionFacts`, `htmlSessionFacts`), belongs to the
 * site and has a real user logged in: `false` off the site (an SSO provider's page), on its login
 * pages, for nobody logged in and for a guest. It decides from what it's given, opening nothing, so
 * a program that reads pages its own way can tell an expired session (where the driver's functions
 * throw `NotLoggedInError`) without asking Moodle again; `pageIsLoggedIn` does both steps on a page.
 */
export function isLoggedIn(url: string, siteUrl: string, facts: SessionFacts): boolean {
  if (!url.startsWith(siteUrl)) return false;
  if (url.startsWith(new URL("login/", siteUrl).href)) return false;
  // Pages without the navigation bar (the assignment grader) have neither link (confirmed empirically,
  // Moodle 5.2): only a login link without a logout one means a guest.
  const guest = facts.hasLoginLink && !facts.hasLogoutLink;
  return !facts.notLoggedIn && (facts.userId ?? 0) > 0 && !guest;
}

/** Whether `page`, as it is now, shows the site with a real user logged in. */
export async function pageIsLoggedIn(page: Page, siteUrl: string): Promise<boolean> {
  return isLoggedIn(page.url(), siteUrl, await readSessionFacts(page));
}

// While the person watches (ADR-007), a context's browser manager shows the pages functions worked on.
const followers = new WeakMap<BrowserContext, (url: string) => Promise<void>>();

/** Has `show` called with the page each function opened, once it's done with it. */
export function followPages(context: BrowserContext, show: (url: string) => Promise<void>): void {
  followers.set(context, show);
}

/**
 * Opens a page of the site (`path` relative to it) in a new tab and checks the session; throws
 * `NotLoggedInError`, closing the tab, when Moodle answers with its login page.
 */
export async function openSitePage(context: BrowserContext, siteUrl: string, path: string, { follow = true } = {}): Promise<Page> {
  const page = await context.newPage();
  try {
    await page.goto(new URL(path, siteUrl).href, { waitUntil: "domcontentloaded" });
    if (!(await pageIsLoggedIn(page, siteUrl))) throw new NotLoggedInError();
    // The page as it was opened (a form's URL, not where posting it led), once it's closed.
    const opened = page.url();
    if (follow) page.once("close", () => void followers.get(context)?.(opened));
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** `M.cfg` as a Moodle page's HTML sets it (`M.cfg = {…};`), parsed; `undefined` when it has none. */
export function readMoodleConfig(html: string): Record<string, unknown> | undefined {
  const start = html.indexOf("M.cfg = {");
  if (start < 0) return undefined;
  // The object literal is JSON (Moodle writes it with json_encode): its end is where the braces balance.
  let depth = 0;
  let inString = false;
  const from = html.indexOf("{", start);
  for (let i = from; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(from, i + 1)) as Record<string, unknown>;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** What a page's HTML says about its session, read as `readSessionFacts` reads a page. */
export function htmlSessionFacts(html: string): SessionFacts {
  const userId = readMoodleConfig(html)?.userId;
  const bodyClass = /<body\b[^>]*\bclass="([^"]*)"/i.exec(html)?.[1] ?? "notloggedin";
  return {
    notLoggedIn: /(^|\s)notloggedin(\s|$)/.test(bodyClass),
    userId: typeof userId === "number" ? userId : null,
    hasLogoutLink: /href="[^"]*\/login\/logout\.php/.test(html),
    hasLoginLink: /href="[^"]*\/login\/index\.php/.test(html),
  };
}

/**
 * A page of the site over HTTP with the profile's session, without a tab (ADR-011): its final URL and
 * HTML. Throws `NotLoggedInError` when Moodle answers with its login page. While the browser is shown,
 * the working tab shows the page afterwards (ADR-007), unless `follow` is false.
 */
export async function fetchSitePage(context: BrowserContext, siteUrl: string, path: string, { follow = true } = {}): Promise<{ url: string; html: string }> {
  const response = await siteFetch(context, new URL(path, siteUrl).href);
  if (!isLoggedIn(response.url, siteUrl, htmlSessionFacts(response.body))) throw new NotLoggedInError();
  if (follow) void followers.get(context)?.(response.url);
  return { url: response.url, html: response.body };
}

/**
 * Logs the person out of Moodle through the user menu's logout link (it carries the sesskey; without
 * one Moodle asks to confirm, and the confirmation is accepted). Returns false when nobody was logged
 * in. Only Moodle's session ends: a single sign-on provider may keep its own.
 */
export async function logOut(context: BrowserContext, siteUrl: string): Promise<boolean> {
  const page = await context.newPage();
  const home = new URL("my/", siteUrl).href;
  try {
    await page.goto(home, { waitUntil: "domcontentloaded" });
    if (!(await pageIsLoggedIn(page, siteUrl))) return false;
    const link = await page.locator('a[href*="/login/logout.php"]').first().getAttribute("href").catch(() => null);
    // Moodle's redirect after logging out can abort this navigation (ERR_ABORTED, confirmed empirically,
    // Moodle 5.2); whether the session ended is checked below either way.
    await page.goto(new URL(link ?? "login/logout.php", siteUrl).href, { waitUntil: "domcontentloaded" }).catch((error: Error) => {
      if (!/ERR_ABORTED/.test(error.message)) throw error;
    });
    const confirm = page.locator('form[action*="/login/logout.php"] [type="submit"]');
    if ((await confirm.count()) > 0) await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click()]);
    await page.goto(home, { waitUntil: "domcontentloaded" });
    if (await pageIsLoggedIn(page, siteUrl)) throw new MoodleError("Moodle didn't end the session: the person is still logged in. Try again, or log out in the browser.", "logout-failed");
    return true;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Moodle's message on an error page (its fatal error box: no permission, no such record), which keeps the page's body id. */
export async function moodleErrorMessage(page: Page): Promise<string | undefined> {
  const box = page.locator('[data-rel="fatalerror"] .errormessage');
  return (await box.count()) > 0 ? ((await box.first().textContent()) ?? "").replace(/\s+/g, " ").trim() : undefined;
}
