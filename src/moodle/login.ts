// Logging in by hand (ADR-002): a window at the site's login page, and waiting for the person.
import type { BrowserContext, Page } from "playwright-core";
import type { BrowserManager } from "../browser.js";
import { NotLoggedInError, openSitePage, pageIsLoggedIn } from "./session.js";

const POLL_MS = 1000;

export class LoginTimeoutError extends Error {
  override name = "LoginTimeoutError";
}

export class LoginWindowClosedError extends Error {
  override name = "LoginWindowClosedError";
  constructor() {
    super("The login window was closed before the person logged in.");
  }
}

/** The logged-in user, read from their own profile page (`user/profile.php`). */
export async function readOwnProfile(context: BrowserContext, siteUrl: string): Promise<{ userId: number; fullName: string }> {
  const page = await openSitePage(context, siteUrl, "user/profile.php");
  try {
    return await page.evaluate(() => {
      const g = globalThis as unknown as {
        M: { cfg: { userId: number } };
        document: { querySelector(selector: string): { textContent: string | null } | null };
      };
      // The page heading is the user's full name, in any interface language.
      const heading = g.document.querySelector("#page-header h1, .page-header-headings h1, h1");
      return { userId: g.M.cfg.userId, fullName: heading?.textContent?.trim() ?? "" };
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Waits until `page` shows the site with a user logged in. The person may go through other domains
 * (SSO) on the way; reads fail while a page navigates, and are retried.
 */
export async function waitForLogin(
  page: Page,
  siteUrl: string,
  { timeoutMs, pollMs = POLL_MS, onWait }: { timeoutMs: number; pollMs?: number; onWait?: (elapsedMs: number) => void },
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (page.isClosed()) throw new LoginWindowClosedError();
    if (await pageIsLoggedIn(page, siteUrl).catch(() => false)) return;
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) throw new LoginTimeoutError(`Nobody logged in within ${Math.round(timeoutMs / 1000)} seconds; the window was closed.`);
    onWait?.(elapsed);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export interface LoginResult {
  status: "already-logged-in" | "logged-in";
  userId: number;
  fullName: string;
}

/**
 * Makes sure there's a session: the user at once if there is one; otherwise a browser window at the
 * site's login page, waiting (calling `onWait`) until the person logs in there themselves. The session
 * is saved (ADR-003), and the window closes again unless the browser is shown on demand.
 */
export async function logIn(browser: BrowserManager, siteUrl: string, { timeoutMs, onWait }: { timeoutMs: number; onWait?: (elapsedMs: number) => void }): Promise<LoginResult> {
  try {
    return { status: "already-logged-in", ...(await readOwnProfile(await browser.context(), siteUrl)) };
  } catch (error) {
    if (!(error instanceof NotLoggedInError)) throw error;
  }
  const context = await browser.context({ headed: true });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(new URL("login/index.php", siteUrl).href, { waitUntil: "domcontentloaded" });
  await page.bringToFront();
  try {
    await waitForLogin(page, siteUrl, { timeoutMs, onWait });
  } catch (error) {
    if (error instanceof LoginTimeoutError) await browser.close();
    throw error;
  }
  const user = await readOwnProfile(context, siteUrl);
  await browser.saveSession();
  // Back to the chosen mode: the next call reopens the browser without a window.
  if (!browser.visible()) await browser.close();
  return { status: "logged-in", ...user };
}
