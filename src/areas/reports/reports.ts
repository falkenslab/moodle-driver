// A course's reports on what people did: its logs (report/log), the views per activity (report/outline)
// and who took part in one activity (report/participation). No service open to AJAX gives them: they
// are read from the report pages, by ids, classes and links; dates by the language's own formats.
import type { BrowserContext, Page } from "playwright-core";
import { openSitePage } from "../../core/session.js";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";
import { decodeEntities } from "../../core/text.js";
import { languageFormats, parseMoodleDate, type DateFormat } from "./dates.js";

/** A report the person can't see: the course or activity isn't there, or they aren't allowed (`report/log:view`…). */
export class ReportError extends MoodleError {
  override name = "ReportError";
  constructor(message: string) {
    super(message, "report");
  }
}

/** One event in a course's logs, as the logs report lists it. */
export interface LogEntry {
  /** When it happened (ISO 8601); absent when the site's date format couldn't be read back. */
  time?: string;
  /** The time as the report shows it, in the site's language. */
  timeText: string;
  /** Who did it; none for an event without a user (the system's). */
  userId?: number;
  userName: string;
  /** Who was really logged in, when someone acted logged in as `userId`. */
  realUserId?: number;
  /** The person the event was about (graded, enrolled, messaged…), when any. */
  relatedUserId?: number;
  relatedUserName?: string;
  /** Where it happened, as Moodle names it ("Forum: News"), and the activity when it was one. */
  context: string;
  activityId?: number;
  /** The component's and the event's names, in the site's language ("Forum", "Course module viewed"). */
  component: string;
  event: string;
  /** Moodle's description of the event (in English, as events write it). */
  description: string;
  /** "web", "cli", "ws"… */
  origin: string;
  ip?: string;
}

/** What the logs report filters by its "actions" menu: creating, viewing, updating, deleting, or any change (the three writes). */
export const LOG_ACTIONS = ["create", "view", "update", "delete", "change"] as const;
/** One of `LOG_ACTIONS`: the kind of action `courseLogs` keeps. */
export type LogAction = (typeof LOG_ACTIONS)[number];
const MODACTIONS: Record<LogAction, string> = { create: "c", view: "r", update: "u", delete: "d", change: "cud" };

interface RawLogRow {
  timeText: string;
  users: { id: number; name: string }[];
  userName: string;
  related?: { id: number; name: string };
  context: string;
  contextUrl?: string;
  component: string;
  event: string;
  description: string;
  origin: string;
  ip: string;
}

/** The logs table's rows (`table.reportlog`), cell by cell: time, user, affected user, context, component, event, description, origin, IP. */
export function readLogRows(page: Page): Promise<{ form: boolean; rows: RawLogRow[] }> {
  // Through inPage: it has helper functions (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      textContent: string | null;
      getAttribute(n: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const text = (el: El | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    // Anonymous callbacks only: see the conventions on page.evaluate.
    const userLinks = (cell: El | undefined) =>
      Array.from(cell?.querySelectorAll('a[href*="/user/view.php"]') ?? []).map((link) => ({ id: Number(new URL(link.getAttribute("href") ?? "", "http://x/").searchParams.get("id")), name: text(link) }));
    const rows = Array.from(doc.querySelectorAll("table.reportlog tbody tr:not(.emptyrow)")).flatMap((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 9) return [];
      const related = userLinks(cells[2])[0];
      return [
        {
          timeText: text(cells[0]),
          users: userLinks(cells[1]),
          userName: text(cells[1]),
          ...(related ? { related } : {}),
          context: text(cells[3]),
          ...(cells[3]!.querySelector("a") ? { contextUrl: cells[3]!.querySelector("a")!.getAttribute("href") ?? "" } : {}),
          component: text(cells[4]),
          event: text(cells[5]),
          description: text(cells[6]),
          origin: text(cells[7]),
          ip: text(cells[8]),
        },
      ];
    });
    return { form: doc.querySelector("form.logselecform") !== null, rows };
  }, null);
}

const activityOf = (url: string | undefined) => {
  const match = /\/mod\/[a-z0-9_]+\/view\.php\?(?:.*&)?id=(\d+)/.exec(url ?? "");
  return match ? Number(match[1]) : undefined;
};

/** A log row in the driver's terms: ids from the links, the time read back with the site's format. */
export function toLogEntry(raw: RawLogRow, format: DateFormat): LogEntry {
  const time = parseMoodleDate(raw.timeText, format);
  // Logged in as someone else: the real user's link first, then the one they acted as.
  const user = raw.users.at(-1);
  const real = raw.users.length > 1 ? raw.users[0] : undefined;
  const activityId = activityOf(raw.contextUrl);
  return {
    ...(time ? { time: time.toISOString() } : {}),
    timeText: raw.timeText,
    ...(user ? { userId: user.id } : {}),
    userName: decodeEntities(user?.name ?? raw.userName),
    ...(real ? { realUserId: real.id } : {}),
    ...(raw.related ? { relatedUserId: raw.related.id, relatedUserName: decodeEntities(raw.related.name) } : {}),
    context: decodeEntities(raw.context),
    ...(activityId !== undefined ? { activityId } : {}),
    component: decodeEntities(raw.component),
    event: decodeEntities(raw.event),
    description: decodeEntities(raw.description),
    origin: raw.origin,
    ...(raw.ip && raw.ip !== "-" ? { ip: raw.ip } : {}),
  };
}

/** The format a report's page writes dates with, and the person's time zone from its `M.cfg`. */
async function dateFormat(context: BrowserContext, siteUrl: string, page: Page, name: string): Promise<DateFormat> {
  const { formats, locale } = await languageFormats(context, siteUrl, [name]);
  const timeZone = await page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { usertimezone?: string } } }).M?.cfg?.usertimezone ?? "UTC");
  return { format: formats[name] ?? "", locale, timeZone };
}

const PAGE_SIZE = 100;
const MAX_PAGES = 200;

/**
 * A course's logs, newest first, as its logs report lists them: by a user, an activity, a kind of
 * action, and a time span, up to `limit` entries (100 unless given). Moodle filters by user, activity
 * and action; the span is read page by page, stopping at the first entry older than `from`. Every
 * entry's time comes as an ISO date, read back with the site language's own format.
 */
export async function courseLogs(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  { userId, activityId, from, until, action, limit = 100 }: { userId?: number; activityId?: number; from?: Date; until?: Date; action?: LogAction; limit?: number } = {},
): Promise<LogEntry[]> {
  if (action !== undefined && !LOG_ACTIONS.includes(action)) throw new MoodleError(`Unknown log action "${action}": use one of ${LOG_ACTIONS.join(", ")}.`, "invalid-input");
  // Fewer, longer pages for more entries: each page is a page load.
  const perPage = Math.min(Math.max(limit, 20), 500);
  const query = new URLSearchParams({ id: String(courseId), chooselog: "1", edulevel: "-1", perpage: String(perPage) });
  if (userId !== undefined) query.set("user", String(userId));
  if (activityId !== undefined) query.set("modid", String(activityId));
  if (action !== undefined) query.set("modaction", MODACTIONS[action]);
  const entries: LogEntry[] = [];
  let format: DateFormat | undefined;
  // Viewing the report logs an event, and others act meanwhile: a page may begin with the previous one's last rows.
  let previous = new Set<string>();
  for (let p = 0; p < MAX_PAGES && entries.length < limit; p++) {
    query.set("page", String(p));
    const page = await openSitePage(context, siteUrl, `report/log/index.php?${query}`);
    let read: { form: boolean; rows: RawLogRow[] };
    try {
      read = await readLogRows(page);
      if (!read.form) throw new ReportError(`You can't see course ${courseId}'s logs: the course doesn't exist, or you aren't allowed (report/log:view).`);
      format ??= await dateFormat(context, siteUrl, page, "strftimedatetimeaccurate");
    } finally {
      await page.close().catch(() => undefined);
    }
    const keys = new Set(read.rows.map((raw) => JSON.stringify(raw)));
    for (const raw of read.rows) {
      if (previous.has(JSON.stringify(raw))) continue;
      const entry = toLogEntry(raw, format);
      const time = entry.time ? Date.parse(entry.time) : undefined;
      if ((from || until) && time === undefined) {
        throw new ReportError(`The logs show dates as "${raw.timeText}", which the driver can't read back with the site's format: ask without from and until.`);
      }
      if (until && time! > until.getTime()) continue;
      if (from && time! < from.getTime()) return entries;
      entries.push(entry);
      if (entries.length >= limit) return entries;
    }
    if (read.rows.length < perPage) break;
    previous = keys;
  }
  return entries;
}

/** An activity's line in the activity report: its views, by how many people, and the last one. */
export interface ActivityViews {
  activityId: number;
  /** The module ("forum", "quiz"…) and the name, as the course shows it. */
  type: string;
  name: string;
  views: number;
  users: number;
  /** The last view (ISO 8601); absent when nobody viewed it, or the site hides it. */
  lastAccess?: string;
}

interface RawOutlineRow {
  url: string;
  name: string;
  numbers: number[];
  lastAccess: string;
}

/** The activity report's rows (`#outlinereport`): the activity's link, its views cell's numbers, its last access text. */
export function readOutlineRows(page: Page): Promise<{ form: boolean; rows: RawOutlineRow[] }> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      textContent: string | null;
      getAttribute(n: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const text = (el: El | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const rows = Array.from(doc.querySelectorAll("#outlinereport tbody tr")).flatMap((row) => {
      const link = row.querySelector("td.activityname a[href*='/mod/']");
      if (!link) return [];
      return [
        {
          url: link.getAttribute("href") ?? "",
          name: text(link),
          // "36 views by 1 users", in the site's words: its numbers in order; "-" when none.
          numbers: (text(row.querySelector("td.numviews")).match(/\d+/g) ?? []).map(Number),
          lastAccess: text(row.querySelector("td.lastaccess")),
        },
      ];
    });
    return { form: doc.querySelector('form [name^="filterstartdate"]') !== null || doc.querySelector("#outlinereport") !== null, rows };
  }, null);
}

/**
 * A course's activity report: per activity, how many times it was viewed, by how many people, and
 * when last, from the logs (between `from` and `until` when given). Activities nobody viewed come with
 * zero views.
 */
export async function activityReport(context: BrowserContext, siteUrl: string, courseId: number, { from, until }: { from?: Date; until?: Date } = {}): Promise<ActivityViews[]> {
  const query = new URLSearchParams({ id: String(courseId) });
  if (from) query.set("startdate", String(Math.floor(from.getTime() / 1000)));
  if (until) query.set("enddate", String(Math.floor(until.getTime() / 1000)));
  const page = await openSitePage(context, siteUrl, `report/outline/index.php?${query}`);
  try {
    const read = await readOutlineRows(page);
    if (!read.form) throw new ReportError(`You can't see course ${courseId}'s activity report: the course doesn't exist, or you aren't allowed (report/outline:view).`);
    const format = await dateFormat(context, siteUrl, page, "strftimedaydatetime");
    return read.rows.flatMap((row) => {
      const match = /\/mod\/([a-z0-9_]+)\/view\.php\?(?:.*&)?id=(\d+)/.exec(row.url);
      if (!match) return [];
      const last = row.lastAccess ? parseMoodleDate(row.lastAccess, format) : undefined;
      return [
        {
          activityId: Number(match[2]),
          type: match[1]!,
          name: decodeEntities(row.name),
          views: row.numbers[0] ?? 0,
          users: row.numbers[1] ?? 0,
          ...(last ? { lastAccess: last.toISOString() } : {}),
        },
      ];
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Someone with a role in the course, and whether they took part in the activity. */
export interface ActivityParticipant {
  userId: number;
  fullName: string;
  roleId: number;
  /** How many actions (views, posts…) they made there; 0 when they didn't take part. */
  actions: number;
}

/** The kinds of action the participation report counts: views, or posts (submitting, answering, posting). */
export const PARTICIPATION_ACTIONS = ["view", "post"] as const;
/** One of `PARTICIPATION_ACTIONS`: the kind of action `participationReport` counts. */
export type ParticipationAction = (typeof PARTICIPATION_ACTIONS)[number];

interface ParticipationPage {
  activities: number[];
  roles: number[];
  rows: { userId: number; fullName: string; actions: number }[];
}

/** The participation report's page: the activities and roles its form offers, and its table's rows (count from the row's checkbox, else the cell). */
export function readParticipation(page: Page): Promise<ParticipationPage> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      textContent: string | null;
      value: string;
      getAttribute(n: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const options = (selector: string) =>
      Array.from(doc.querySelectorAll(selector))
        .map((option) => Number(option.value))
        .filter((id) => id > 0);
    const rows = Array.from(doc.querySelectorAll("#participationreport table tbody tr:not(.emptyrow)")).flatMap((row) => {
      const link = row.querySelector('td a[href*="/user/view.php"]');
      if (!link) return [];
      const userId = Number(new URL(link.getAttribute("href") ?? "", "http://x/").searchParams.get("id"));
      const box = row.querySelector("input.usercheckbox");
      // "Yes (11)" or "No", in the site's words: the number in brackets, when there's no checkbox.
      const cell = /\((\d+)\)/.exec(row.querySelectorAll("td")[1]?.textContent ?? "");
      const actions = box ? Number(box.value) || 0 : cell ? Number(cell[1]) : 0;
      return [{ userId, fullName: (link.textContent ?? "").replace(/\s+/g, " ").trim(), actions }];
    });
    return { activities: options("select[name='instanceid'] option"), roles: options("select[name='roleid'] option"), rows };
  }, null);
}

/**
 * Who took part in an activity of a course, as its participation report counts it: everyone with
 * the role (every role the report offers, unless `roleId`), with how many actions they made there
 * (views or posts only, when `action`; since `since`, when given); those who did nothing come with 0.
 */
export async function participationReport(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  activityId: number,
  { roleId, since, action }: { roleId?: number; since?: Date; action?: ParticipationAction } = {},
): Promise<ActivityParticipant[]> {
  if (action !== undefined && !PARTICIPATION_ACTIONS.includes(action)) throw new MoodleError(`Unknown participation action "${action}": use "view" or "post".`, "invalid-input");
  const base = { id: String(courseId), instanceid: String(activityId), timefrom: String(since ? Math.floor(since.getTime() / 1000) : 0), action: action ?? "", perpage: String(PAGE_SIZE) };
  const read = async (role: number | undefined, spage: number) => {
    const query = new URLSearchParams(role === undefined ? { id: String(courseId) } : { ...base, roleid: String(role), spage: String(spage) });
    const page = await openSitePage(context, siteUrl, `report/participation/index.php?${query}`);
    try {
      const facts = await readParticipation(page);
      if (facts.activities.length === 0 && facts.roles.length === 0) {
        throw new ReportError(`You can't see course ${courseId}'s participation report: the course doesn't exist, or you aren't allowed (report/participation:view).`);
      }
      if (!facts.activities.includes(activityId)) throw new ReportError(`Activity ${activityId} isn't in course ${courseId}'s participation report: take its id from the course structure.`);
      return facts;
    } finally {
      await page.close().catch(() => undefined);
    }
  };
  const roles = roleId !== undefined ? [roleId] : (await read(undefined, 0)).roles;
  const people: ActivityParticipant[] = [];
  for (const role of roles) {
    const seen = new Set<number>();
    for (let p = 0; p < MAX_PAGES; p++) {
      const fresh = (await read(role, p)).rows.filter((row) => !seen.has(row.userId));
      for (const row of fresh) {
        seen.add(row.userId);
        people.push({ userId: row.userId, fullName: decodeEntities(row.fullName), roleId: role, actions: row.actions });
      }
      if (fresh.length < PAGE_SIZE) break;
    }
  }
  return people;
}
