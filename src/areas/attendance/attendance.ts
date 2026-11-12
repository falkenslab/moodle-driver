// What every page of an Attendance activity (mod_attendance, a plugin) shares: the errors, opening
// its pages with the module checked, and Moodle's refusals told apart by the error page's error code.
// None of the plugin's services is open to AJAX (servicenotavailable, confirmed empirically on 5.2:
// they're the mobile app's), so the driver works its pages as a teacher does.
import type { BrowserContext, Page } from "playwright-core";
import { MoodleError } from "../../core/errors.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";

/** The activity isn't an Attendance (`attendance`) activity the person can open, or there's no activity with that id. */
export class NotAnAttendanceError extends MoodleError {
  override name = "NotAnAttendanceError";
  constructor(message: string) {
    super(message, "not-an-attendance");
  }
}

/** Moodle refused something in an Attendance activity: the person lacks the capability, the session isn't there, a status or participant isn't the session's. */
export class AttendanceError extends MoodleError {
  override name = "AttendanceError";
  constructor(message: string) {
    super(message, "attendance");
  }
}

/** The error code an error page names in its "More information" link (`…/error/moodle/invalidrecordunknown`). */
async function errorCode(page: Page): Promise<string | undefined> {
  const href = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a')?.getAttribute("href"));
  return href ? href.split("/").pop() : undefined;
}

/** The page's body id (`page-mod-attendance-manage`), which names the script Moodle ran. */
export function bodyId(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as unknown as { document: { body: { id: string } } }).document.body.id);
}

/**
 * Throws the error an error page means, if `page` is one: `NotAnAttendanceError` when Moodle found
 * no Attendance activity with that id (or the page isn't one of its pages), `AttendanceError` with
 * Moodle's message and what it means otherwise. `refused` says what was refused; `capability`
 * explains a missing permission.
 */
export async function failOnRefusal(page: Page, activityId: number, refused: string, capability: string): Promise<void> {
  const message = await moodleErrorMessage(page);
  const id = await bodyId(page);
  const code = message === undefined ? undefined : await errorCode(page);
  // Moodle refuses a missing capability before the plugin names its page, so the error page is the
  // site's (`page-site-index`); a missing record is a session when the plugin's page names it, the
  // activity itself otherwise (no Attendance activity with that id) (confirmed empirically, 5.2).
  const ours = id.startsWith("page-mod-attendance-");
  if (code === "nopermissions") throw new AttendanceError(`${refused} (Moodle says: ${message}): ${capability}.`);
  if (code === "invalidcoursemodule" || !ours) {
    throw new NotAnAttendanceError(`Activity ${activityId} isn't an Attendance activity you can open${message ? ` (Moodle says: ${message})` : ""}: take its id and module from the course structure.`);
  }
  if (message === undefined) return;
  const hint = code?.startsWith("invalidrecord") ? `no such session in attendance ${activityId}: take its id from attendanceSessions` : "";
  throw new AttendanceError(`${refused} (Moodle says: ${message})${hint ? `: ${hint}` : ""}.`);
}

/** Opens a page of the activity (`mod/attendance/<path>`) and fails as `failOnRefusal` says when Moodle refuses it. */
export async function openAttendancePage(context: BrowserContext, siteUrl: string, activityId: number, path: string, refused: string, capability: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/attendance/${path}`);
  try {
    await failOnRefusal(page, activityId, refused, capability);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** What managing sessions takes, as Moodle's capability names it. */
export const MANAGE = "it takes Moodle's capability mod/attendance:manageattendances, which editing teachers have";
/** What taking attendance takes. */
export const TAKE = "it takes Moodle's capability mod/attendance:takeattendances (mod/attendance:changeattendances for a session already taken), which teachers have";
/** What the report takes. */
export const REPORT = "it takes Moodle's capability mod/attendance:viewreports, which teachers have";
