import type { BrowserContext, Page } from "playwright-core";
import { BrowserLostError, MoodleError, isBrowserLost } from "./errors.js";
import { siteFetch } from "./http.js";

/** No live Moodle session: the person has to log in again (ADR-002). */
export class NotLoggedInError extends MoodleError {
  override name = "NotLoggedInError";
  constructor() {
    super("There is no Moodle session, or it expired: the person has to log in again.", "not-logged-in");
  }
}

/**
 * For a `.catch` that reads a failure to open a page as "you can't do that here": whether the failure
 * has nothing to do with that page (no session, no browser), so it has to reach the caller as it is.
 */
export function isSessionOrBrowserFailure(error: unknown): boolean {
  return error instanceof NotLoggedInError || isBrowserLost(error);
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

/**
 * How a context's browser manager shows the pages functions work on while the person watches (ADR-007).
 * Each page is loaded once (#101): a function's tab becomes the working tab when the function is done
 * with it, and a page read over HTTP is loaded in the working tab instead, so Moodle logs one view.
 */
export interface Follower {
  /** Whether the person watches now: a window is shown and following. */
  watching(): boolean;
  /** Shows `url` (a site page) in the working tab; best effort, never throws. */
  show(url: string): Promise<void>;
  /** Makes `page`, a function's tab it's done with, the working tab, as it is; false when it can't (the page is then closed). */
  adopt(page: Page): Promise<boolean>;
  /** The working tab. */
  tab(): Promise<Page>;
}

// While the person watches (ADR-007), a context's browser manager shows the pages functions worked on.
const followers = new WeakMap<BrowserContext, Follower>();

/**
 * Has the context's manager show the pages functions work on. A plain function only shows each page
 * once a function is done with it, loading it again (tests use it to see what's followed).
 */
export function followPages(context: BrowserContext, follower: Follower | ((url: string) => Promise<void>)): void {
  followers.set(context, typeof follower === "function" ? { watching: () => false, show: follower, adopt: async () => false, tab: () => Promise.reject(new Error("no working tab")) } : follower);
}

// One at a time per context: loading a page in the working tab and handing it over never overlap
// (two navigations in one tab abort each other).
const followQueues = new WeakMap<BrowserContext, Promise<unknown>>();
function inTurn<T>(context: BrowserContext, operation: () => Promise<T>): Promise<T> {
  const result = (followQueues.get(context) ?? Promise.resolve()).then(operation, operation);
  followQueues.set(context, result.catch(() => undefined));
  return result;
}

/** The page at `url` loaded in the working tab, with the HTML the server sent (not the page after its scripts). */
async function loadInWorkingTab(follower: Follower, url: string): Promise<{ status: number; url: string; body: string }> {
  const tab = await follower.tab();
  const response = await tab.goto(url, { waitUntil: "domcontentloaded" });
  if (!response) throw new Error(`No response for ${url}.`);
  await tab.bringToFront().catch(() => undefined);
  return { status: response.status(), url: response.url(), body: await response.text() };
}

// The last page each context's functions followed: a method that would show the same one again doesn't.
const lastFollowed = new WeakMap<BrowserContext, string>();

function toFollower(context: BrowserContext, url: string): Promise<void> | undefined {
  lastFollowed.set(context, url);
  const follower = followers.get(context);
  return follower && inTurn(context, () => follower.show(url));
}

/** The last page (a full URL) the functions working in `context` followed, if any. */
export function lastPageFollowed(context: BrowserContext): string | undefined {
  return lastFollowed.get(context);
}

/** Has the context's follower show `path` (relative to the site), as the page a function worked on; best effort, never throws. */
export async function followPage(context: BrowserContext, siteUrl: string, path: string): Promise<void> {
  try {
    await toFollower(context, new URL(path, siteUrl).href);
  } catch {
    // Following is a courtesy: a page that can't be shown never changes a function's result.
  }
}

/**
 * A page the web server doesn't have (its own 404, not a Moodle page): a Moodle version or a plugin
 * without it, rather than a lost session.
 */
function noSuchPage(path: string): MoodleError {
  return new MoodleError(`The site has no page ${path.split("?")[0]} (HTTP 404): its Moodle version or its plugins don't include it.`, "not-found");
}

/**
 * Opens a page of the site (`path` relative to it) in a new tab and checks the session; throws
 * `NotLoggedInError`, closing the tab, when Moodle answers with its login page.
 */
export async function openSitePage(context: BrowserContext, siteUrl: string, path: string, { follow = true } = {}): Promise<Page> {
  const page = await context.newPage();
  try {
    const response = await page.goto(new URL(path, siteUrl).href, { waitUntil: "domcontentloaded" });
    if (!(await pageIsLoggedIn(page, siteUrl))) throw response?.status() === 404 ? noSuchPage(path) : new NotLoggedInError();
    if (follow) handOverOnClose(context, page);
    return page;
  } catch (error) {
    // A window closed in the middle of a navigation reads as net::ERR_ABORTED, and the page doesn't
    // say it's closed yet (confirmed empirically, playwright-core 1.65, Chromium): asking it does.
    if (error instanceof Error && error.message.includes("net::ERR_ABORTED") && (await page.evaluate(() => 1).then(() => false, isBrowserLost))) throw new BrowserLostError();
    await page.close().catch(() => undefined);
    throw error;
  }
}

/**
 * When the function closes `page`: while the person watches, it becomes the working tab as it is
 * (where the function left it, no reload); otherwise it closes, and the follower is told the page as
 * it was opened (a form's URL, not where posting it led).
 */
function handOverOnClose(context: BrowserContext, page: Page): void {
  const opened = page.url();
  const close = page.close.bind(page);
  page.close = async (options) => {
    const follower = followers.get(context);
    if (follower?.watching() && !page.isClosed()) {
      lastFollowed.set(context, page.url());
      const adopted = await inTurn(context, () => follower.adopt(page)).catch(() => false);
      if (adopted) return;
      return close(options);
    }
    await close(options);
    void toFollower(context, opened);
  };
}

/**
 * While the person watches, a tab a function keeps open (a quiz attempt's) is the page it worked on:
 * brought to the front, and not loaded again as its result.
 */
export async function showOwnTab(context: BrowserContext, page: Page): Promise<void> {
  if (!followers.get(context)?.watching()) return;
  lastFollowed.set(context, page.url());
  await page.bringToFront().catch(() => undefined);
}

/** Closes a tab a function kept open, or while the person watches makes it the working tab as it is (#101). */
export async function releaseTab(context: BrowserContext, page: Page): Promise<void> {
  const follower = followers.get(context);
  if (follower?.watching() && !page.isClosed()) {
    lastFollowed.set(context, page.url());
    if (await inTurn(context, () => follower.adopt(page)).catch(() => false)) return;
  }
  await page.close().catch(() => undefined);
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
  const url = new URL(path, siteUrl).href;
  const follower = follow ? followers.get(context) : undefined;
  // While the person watches, the working tab loads it: one load, and it's the one they see (#101).
  // A tab that can't (a download, a lost tab) leaves it to HTTP, unshown.
  const shown = follower?.watching() ? await inTurn(context, () => loadInWorkingTab(follower, url)).catch(() => undefined) : undefined;
  const response = shown ?? (await siteFetch(context, url));
  if (!isLoggedIn(response.url, siteUrl, htmlSessionFacts(response.body))) throw response.status === 404 ? noSuchPage(path) : new NotLoggedInError();
  if (shown) lastFollowed.set(context, response.url);
  else if (follow && !follower?.watching()) void toFollower(context, response.url);
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
