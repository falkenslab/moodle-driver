// Activity completion: a student marking manual completion, a teacher overriding someone's, and the
// course's progress report (report/progress), read by its links and icons in any language.
import type { BrowserContext, Page } from "playwright-core";
import { MoodleServiceError, callService } from "../../core/ajax.js";
import { openSitePage } from "../../core/session.js";
import { COMPLETION_STATES, type CompletionState } from "../courses/structure.js";
import { MoodleError } from "../../core/errors.js";

/** Completion can't be changed or read there: not enabled, automatic, or not allowed. */
export class CompletionError extends MoodleError {
  override name = "CompletionError";
  constructor(message: string) {
    super(message, "completion");
  }
}

/** Moodle's refusals, in its terms. */
function completionError(error: unknown, activityId: number): unknown {
  if (!(error instanceof MoodleServiceError)) return error;
  if (error.errorcode === "cannotmanualctrack") return new CompletionError(`Activity ${activityId} completes automatically (on view, grade, submission…): it can't be marked by hand.`);
  if (error.errorcode === "completionnotenabled") return new CompletionError(`Completion isn't enabled in activity ${activityId}'s course.`);
  if (error.errorcode === "nopermissions" || error.errorcode === "nopermission") return new CompletionError(`You aren't allowed to change completion in activity ${activityId}.`);
  return error;
}

/**
 * Marks the person's own completion of an activity with manual completion, done or not, as its
 * "Mark as done" button does; doing it twice changes nothing. An activity that completes on its own
 * gives a `CompletionError`.
 */
export async function setCompletion(context: BrowserContext, siteUrl: string, activityId: number, done: boolean): Promise<{ changed: string }> {
  try {
    await callService(context, siteUrl, "core_completion_update_activity_completion_status_manually", { cmid: activityId, completed: done });
  } catch (error) {
    throw completionError(error, activityId);
  }
  return { changed: `Activity ${activityId} marked ${done ? "done" : "not done"}.` };
}

/** Sets someone's completion of an activity as a teacher does from the progress report; returns the state saved. */
export async function overrideCompletion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  state: CompletionState,
): Promise<{ changed: string; state: CompletionState; overridden: boolean }> {
  let saved: { state: number; overrideby: number | null };
  try {
    saved = await callService(context, siteUrl, "core_completion_override_activity_completion_status", { userid: userId, cmid: activityId, newstate: COMPLETION_STATES.indexOf(state) });
  } catch (error) {
    throw completionError(error, activityId);
  }
  const now = COMPLETION_STATES[saved.state] ?? "incomplete";
  return { changed: `User ${userId}'s completion of activity ${activityId} set to ${now}.`, state: now, overridden: Boolean(saved.overrideby) };
}

/** A participant's completion of one activity in the progress report. */
export interface CompletionCell {
  activityId: number;
  state: CompletionState;
  /** Whether the person marks it complete themselves, or Moodle does by its conditions. */
  tracking: "manual" | "auto";
  /** A teacher set it, not the person or Moodle. */
  overridden: boolean;
}

/** A course's progress report (`completionReport`): the activities that track completion, and each participant's. */
export interface CompletionReport {
  activities: { id: number; name: string; type: string }[];
  participants: { userId: number; fullName: string; completion: CompletionCell[] }[];
}

/** One page of the progress report: its activities from the header links, its rows' icons by name. */
export function readCompletionReport(page: Page): Promise<CompletionReport> {
  return page.evaluate(() => {
    interface El {
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const STATES: Record<string, string> = { n: "incomplete", y: "complete", pass: "complete-pass", fail: "complete-fail" };
    const activities = Array.from(doc.querySelectorAll("#completion-progress thead th.completion-header a")).flatMap((link) => {
      const match = /\/mod\/([a-z0-9_]+)\/view\.php\?(?:.*&)?id=(\d+)/.exec(link.getAttribute("href") ?? "");
      return match ? [{ id: Number(match[2]), name: (link.getAttribute("title") ?? link.textContent ?? "").trim(), type: match[1]! }] : [];
    });
    const participants = Array.from(doc.querySelectorAll("#completion-progress tbody tr")).flatMap((row) => {
      const link = row.querySelector('th a[href*="/user/view.php?id="]');
      const userId = Number(new URL(link?.getAttribute("href") ?? "", "http://x/").searchParams.get("id"));
      if (!userId) return [];
      // One cell per activity, in the header's order; the icon's file names the state.
      const completion = Array.from(row.querySelectorAll("td.completion-progresscell")).flatMap((cell, i) => {
        const icon = /completion-(manual|auto)-(n|y|pass|fail)(-override)?/.exec(cell.querySelector("img")?.getAttribute("src") ?? "");
        const activity = activities[i];
        return icon && activity ? [{ activityId: activity.id, state: STATES[icon[2]!]!, tracking: icon[1]!, overridden: icon[3] !== undefined }] : [];
      });
      return [{ userId, fullName: (link?.textContent ?? "").replace(/\s+/g, " ").trim(), completion }];
    });
    return { activities, participants } as CompletionReport;
  });
}

const MAX_PAGES = 100;

/**
 * A course's progress report: every participant's completion of every activity that tracks it, page
 * by page, in one group when given. People come as user id and full name only.
 */
export async function completionReport(context: BrowserContext, siteUrl: string, courseId: number, { group }: { group?: number } = {}): Promise<CompletionReport> {
  const report: CompletionReport = { activities: [], participants: [] };
  const seen = new Set<number>();
  let start = 0;
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await openSitePage(context, siteUrl, `report/progress/index.php?course=${courseId}&start=${start}${group ? `&group=${group}` : ""}`);
    try {
      // An error page keeps the report's body id; only the report has its activity selector.
      if ((await page.locator("body#page-report-progress-index #include-activity-select-report").count()) === 0) {
        throw new CompletionError(`You can't see course ${courseId}'s progress report: the course doesn't exist, or you aren't allowed.`);
      }
      if ((await page.locator("#completion-progress").count()) === 0) {
        // The page explains in the site's language: no activity tracks completion, or nobody to list.
        return report;
      }
      const read = await readCompletionReport(page);
      if (p === 0) report.activities = read.activities;
      const fresh = read.participants.filter((row) => !seen.has(row.userId));
      if (fresh.length === 0) break;
      for (const row of fresh) seen.add(row.userId);
      report.participants.push(...fresh);
      start += read.participants.length;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return report;
}
