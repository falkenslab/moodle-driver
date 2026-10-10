import type { BrowserContext } from "playwright-core";
import { NotLoggedInError, fetchSitePage, readMoodleConfig } from "./session.js";
import { MoodleError } from "./errors.js";
import { siteFetch } from "./http.js";

/** A Moodle AJAX service answered with an exception. */
export class MoodleServiceError extends MoodleError {
  override name = "MoodleServiceError";
  constructor(
    readonly methodname: string,
    readonly errorcode: string,
    message: string,
  ) {
    super(`Moodle's ${methodname} failed (${errorcode}): ${message}`, "moodle-service");
  }
}

// What service.php answers when the session is gone or the sesskey is from an older one.
const SESSION_ERRORS = new Set(["servicerequireslogin", "invalidsesskey"]);

// A light page that needs a session: its `M.cfg` carries the session's sesskey and the person's settings.
const SESSION_PAGE = "user/preferences.php";

/** What `M.cfg` says about the logged-in person. */
export interface PageConfig {
  userId: number;
  language: string;
  timeZone: string;
}

// Per context: the site, the session's sesskey and the person's settings, read once from a page (ADR-011).
const sessions = new WeakMap<BrowserContext, { siteUrl: string; sesskey: string; config: PageConfig }>();

async function session(context: BrowserContext, siteUrl: string, fresh: boolean) {
  const current = sessions.get(context);
  // The program may have changed the site since the sesskey was read.
  if (current && current.siteUrl === siteUrl && !fresh) return current;
  const { html } = await fetchSitePage(context, siteUrl, SESSION_PAGE, { follow: false });
  const cfg = readMoodleConfig(html) ?? {};
  if (typeof cfg.sesskey !== "string") throw new NotLoggedInError();
  const config = { userId: Number(cfg.userId), language: String(cfg.language), timeZone: String(cfg.usertimezone) };
  const next = { siteUrl, sesskey: cfg.sesskey, config };
  sessions.set(context, next);
  return next;
}

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

/**
 * Calls one of Moodle's AJAX services as the logged-in person: a request to `lib/ajax/service.php`
 * with the profile's session and its sesskey, as Moodle's pages make them, without a tab (ADR-004,
 * ADR-011). Throws `NotLoggedInError` when there's no session, `MoodleServiceError` when the service fails.
 */
export async function callService<T>(context: BrowserContext, siteUrl: string, methodname: string, args: Record<string, unknown>): Promise<T> {
  for (const fresh of [false, true]) {
    const { sesskey } = await session(context, siteUrl, fresh);
    const url = new URL(`lib/ajax/service.php?sesskey=${encodeURIComponent(sesskey)}&info=${encodeURIComponent(methodname)}`, siteUrl).href;
    const { status, body } = await siteFetch(context, url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ index: 0, methodname, args }]),
    });
    try {
      return parseServiceResponse<T>(methodname, status, body);
    } catch (error) {
      const sessionError = error instanceof MoodleServiceError && SESSION_ERRORS.has(error.errorcode);
      if (!sessionError) throw error;
      // The sesskey may be stale (a new login, an expiry): reading it again tells which.
      if (fresh) throw new NotLoggedInError();
    }
  }
  throw new NotLoggedInError(); // Unreachable: the fresh attempt returns or throws.
}

/** The logged-in person's id, interface language and time zone, from `M.cfg`, read now: someone else may have logged in since. */
export async function readPageConfig(context: BrowserContext, siteUrl: string): Promise<PageConfig> {
  return (await session(context, siteUrl, true)).config;
}
