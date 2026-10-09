import type { BrowserContext, Page } from "playwright-core";
import { NotLoggedInError, openSitePage } from "./session.js";

/** A Moodle AJAX service answered with an exception. */
export class MoodleServiceError extends Error {
  override name = "MoodleServiceError";
  constructor(
    readonly methodname: string,
    readonly errorcode: string,
    message: string,
  ) {
    super(`Moodle's ${methodname} failed (${errorcode}): ${message}`);
  }
}

// What service.php answers when the session is gone or the tab's sesskey is from an older one.
const SESSION_ERRORS = new Set(["servicerequireslogin", "invalidsesskey"]);

// A light page that needs a session: the tab only lends its cookies and `M.cfg.sesskey`.
const SERVICE_PAGE = "user/preferences.php";

/** The tab kept open per context for service calls (ADR-008), and the site it belongs to. */
const servicePages = new WeakMap<BrowserContext, { page: Page; siteUrl: string }>();

/** The response of `lib/ajax/service.php` for one request: `data`, or throws. */
export function parseServiceResponse<T>(methodname: string, status: number, body: string): T {
  let responses: unknown;
  try {
    responses = JSON.parse(body);
  } catch {
    throw new MoodleServiceError(methodname, `http${status}`, "the answer isn't JSON");
  }
  const response = (Array.isArray(responses) ? responses[0] : responses) as
    | { error?: boolean; data?: T; exception?: { errorcode?: string; message?: string }; errorcode?: string; message?: string }
    | undefined;
  if (!response) throw new MoodleServiceError(methodname, `http${status}`, "empty answer");
  if (response.error === false) return response.data as T;
  // A failure before any function runs (bad sesskey) comes as a bare exception object.
  const exception = response.exception ?? response;
  throw new MoodleServiceError(methodname, exception.errorcode ?? "unknown", exception.message ?? "no message");
}

async function postFromPage(page: Page, methodname: string, args: unknown): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ methodname, args }) => {
      // Runs in the page, with its cookies and Moodle's globals.
      const g = globalThis as unknown as {
        M: { cfg: { wwwroot: string; sesskey: string } };
        fetch(url: string, init: object): Promise<{ status: number; text(): Promise<string> }>;
      };
      const url = `${g.M.cfg.wwwroot}/lib/ajax/service.php?sesskey=${encodeURIComponent(g.M.cfg.sesskey)}&info=${encodeURIComponent(methodname)}`;
      const response = await g.fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ index: 0, methodname, args }]),
      });
      return { status: response.status, body: await response.text() };
    },
    { methodname, args },
  );
}

async function servicePage(context: BrowserContext, siteUrl: string, fresh: boolean): Promise<Page> {
  const current = servicePages.get(context);
  // The program may have changed the site since the tab was opened.
  if (current && !current.page.isClosed() && current.siteUrl === siteUrl && !fresh) return current.page;
  await current?.page.close().catch(() => undefined);
  // The kept tab isn't a tool's page: nothing to follow when it's replaced.
  const page = await openSitePage(context, siteUrl, SERVICE_PAGE, { follow: false });
  servicePages.set(context, { page, siteUrl });
  return page;
}

/**
 * Calls one of Moodle's AJAX services as the logged-in person (ADR-008). Throws `NotLoggedInError`
 * when there's no session, `MoodleServiceError` when the service fails.
 */
export async function callService<T>(context: BrowserContext, siteUrl: string, methodname: string, args: Record<string, unknown>): Promise<T> {
  for (const fresh of [false, true]) {
    const page = await servicePage(context, siteUrl, fresh);
    const { status, body } = await postFromPage(page, methodname, args);
    try {
      return parseServiceResponse<T>(methodname, status, body);
    } catch (error) {
      const sessionError = error instanceof MoodleServiceError && SESSION_ERRORS.has(error.errorcode);
      if (!sessionError) throw error;
      // The kept tab's session may be stale (a new login, an expiry): a new tab tells which.
      if (fresh) throw new NotLoggedInError();
    }
  }
  throw new NotLoggedInError(); // Unreachable: the fresh attempt returns or throws.
}

/** What `M.cfg` says about the logged-in person on the kept service tab. */
export interface PageConfig {
  userId: number;
  language: string;
  timeZone: string;
}

export async function readPageConfig(context: BrowserContext, siteUrl: string): Promise<PageConfig> {
  const page = await servicePage(context, siteUrl, false);
  return page.evaluate(() => {
    const cfg = (globalThis as unknown as { M: { cfg: { userId: number; language: string; usertimezone: string } } }).M.cfg;
    return { userId: cfg.userId, language: cfg.language, timeZone: cfg.usertimezone };
  });
}
