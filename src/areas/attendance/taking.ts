// Taking attendance and reading it: a session's take page (take.php), whose form lists the session's
// status set (each status a column, `checkstatus<id>`) and a radio group per participant
// (`user<id>`, with `remarks<id>`), Moodle's pages of participants included; and the report's
// summary view (report.php, view 7), a row per participant with their count of each status and the
// totals over taken sessions, over all sessions, and the maximum still possible.
import type { BrowserContext, Page } from "playwright-core";
import { MoodleError } from "../../core/errors.js";
import { inPage } from "../../core/inPage.js";
import { AttendanceError, REPORT, TAKE, bodyId, failOnRefusal, openAttendancePage } from "./attendance.js";
import { readSessionRows } from "./sessions.js";

/** A status of a session's status set: what a participant can be marked. */
export interface AttendanceStatus {
  id: number;
  /** Its acronym ("P", "A", "L", "E" in Moodle's default set). */
  acronym: string;
  /** Its name ("Present", "Absent"…). */
  description: string;
}

/** A participant as a session's take page lists them, with what they're marked. */
export interface SessionParticipant {
  userId: number;
  fullName: string;
  /** Their status's id; left out when they aren't marked. */
  statusId?: number;
  /** Their status's acronym; left out when they aren't marked. */
  status?: string;
  remarks: string;
  /** False when Moodle doesn't let them be marked: their enrolment ended or is suspended before the session. */
  canMark: boolean;
}

/** A session's attendance: the statuses it can take, and each participant's mark. */
export interface SessionAttendance {
  sessionId: number;
  statuses: AttendanceStatus[];
  participants: SessionParticipant[];
}

/** A participant's mark: a status of the session's set, by id, acronym or name, and optional remarks. */
export interface AttendanceMark {
  userId: number;
  status: number | string;
  /** Remarks shown beside the mark in the report; left as they are when not given. */
  remarks?: string;
}

/** What taking attendance did, and the session's attendance afterwards. */
export interface AttendanceTaken {
  changed: string;
  sessionId: number;
  attendance: SessionAttendance;
}

/** Points earned out of the points possible, and that as a percentage. */
export interface AttendancePoints {
  sessions?: number;
  points: number;
  maxPoints: number;
  percentage: number;
}

/** A participant's row of the report. */
export interface AttendanceReportRow {
  userId: number;
  fullName: string;
  /** How many taken sessions they have with each status, and that as a percentage of their taken sessions. */
  statuses: { acronym: string; count: number; percentage: number }[];
  /** Over the sessions taken for them: how many, the points earned of those possible, the percentage (what Moodle grades). */
  taken: AttendancePoints;
  /** Over all sessions, taken or not: how many, the points earned of all possible, the percentage. */
  all: AttendancePoints;
  /** The points and percentage they'd reach attending every session not taken yet. */
  maxPossible: AttendancePoints;
}

/** What `attendanceReport` takes. */
export interface AttendanceReportOptions {
  /** Only this group's participants (the activity's group mode decides which groups the person sees). */
  groupId?: number;
}

/** One page of a take page, as read. */
interface TakePage {
  statuses: AttendanceStatus[];
  participants: SessionParticipant[];
  next: boolean;
}

/** What a take page shows: the statuses (with their names from the counts under the form), the participants, whether a next page follows. */
export function readTakePage(page: Page): Promise<TakePage> {
  return inPage(
    page,
    () => {
      interface El {
        id: string;
        name: string;
        value: string;
        checked: boolean;
        nodeType: number;
        textContent: string | null;
        nextSibling: El | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { document: El; location: { href: string } };
      const form = g.document.querySelector("#attendancetakeform");
      if (!form) return { statuses: [], participants: [], next: false };
      const text = (el: El | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      // Under the form Moodle writes "<name> = <count>" for each status, in the columns' order.
      const names: string[] = [];
      for (let node = form.nextSibling; node; node = node.nextSibling) {
        const line = /^(.+?) = \d+$/.exec(text(node));
        if (node.nodeType === 3 && line) names.push(line[1]!);
      }
      const statuses = Array.from(form.querySelectorAll('a[id^="checkstatus"]')).map((link, i) => {
        // The link's title is "Set status to «<name>»" in English: the name between the quotes, when the counts are missing.
        const titled = /«(.+)»/.exec(link.getAttribute("title") ?? "")?.[1];
        return { id: Number(link.id.slice("checkstatus".length)), acronym: text(link), description: names[i] ?? titled ?? text(link) };
      });
      const acronyms = new Map(statuses.map((status) => [status.id, status.acronym]));
      // Each participant's name links to their attendance (`studentid`), in the page's order; whose
      // enrolment ended or is suspended has a row with no radios and no remarks.
      const participants: SessionParticipant[] = [];
      for (const link of Array.from(form.querySelectorAll('a[href*="/mod/attendance/view.php"][href*="studentid="]'))) {
        const userId = Number(new URL(link.getAttribute("href") ?? "", g.location.href).searchParams.get("studentid"));
        if (!userId || participants.some((p) => p.userId === userId)) continue;
        const remarks = form.querySelector(`input[name="remarks${userId}"]`);
        const checked = form.querySelector(`input[type="radio"][name="user${userId}"]:checked`);
        const statusId = checked ? Number(checked.value) : undefined;
        participants.push({ userId, fullName: text(link), ...(statusId ? { statusId, status: acronyms.get(statusId) ?? "" } : {}), remarks: remarks?.value ?? "", canMark: remarks !== null });
      }
      const current = Number(new URL(g.location.href).searchParams.get("page") ?? 1) || 1;
      const next = Array.from(g.document.querySelectorAll('a[href*="/mod/attendance/take.php"]')).some((link) => new URL(link.getAttribute("href") ?? "", g.location.href).searchParams.get("page") === String(current + 1));
      return { statuses, participants, next };
    },
    null,
  );
}

/** The take page's path for a session, its group and a page of participants. */
const takePath = (activityId: number, sessionId: number, groupId: number, pageNumber: number) => `take.php?id=${activityId}&sessionid=${sessionId}&grouptype=${groupId}${pageNumber > 1 ? `&page=${pageNumber}` : ""}`;

/** The session's group, from its row on the sessions page; `AttendanceError` when it isn't there or the person can't take it. */
async function sessionGroup(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<number> {
  const page = await openAttendancePage(context, siteUrl, activityId, `manage.php?id=${activityId}&view=5&group=-1`, `You can't see attendance ${activityId}'s sessions`, TAKE);
  try {
    if ((await bodyId(page)) !== "page-mod-attendance-manage") throw new AttendanceError(`You can't take attendance in attendance ${activityId}: ${TAKE}.`);
    const row = (await readSessionRows(page)).find((r) => r.id === sessionId);
    if (!row) throw new AttendanceError(`Attendance ${activityId} lists no session ${sessionId}: take its id from attendanceSessions (Moodle doesn't list sessions before the course's start date).`);
    return row.groupId ?? 0;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Opens each page of a session's take page in turn, keeping them open, until the last. The caller closes them. */
async function openTakePages(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<{ pages: Page[]; read: TakePage[] }> {
  const groupId = await sessionGroup(context, siteUrl, activityId, sessionId);
  const refused = `You can't take attendance for session ${sessionId} of attendance ${activityId}`;
  const pages: Page[] = [];
  const read: TakePage[] = [];
  try {
    for (let n = 1; ; n++) {
      const page = await openAttendancePage(context, siteUrl, activityId, takePath(activityId, sessionId, groupId, n), refused, TAKE);
      pages.push(page);
      const shown = await readTakePage(page);
      if (shown.statuses.length === 0) throw new MoodleError(`The take page of session ${sessionId} shows no statuses: it isn't what the driver expects.`, "unexpected-page");
      read.push(shown);
      if (!shown.next || n >= 100) break;
    }
    return { pages, read };
  } catch (error) {
    for (const page of pages) await page.close().catch(() => undefined);
    throw error;
  }
}

/** A session's attendance from its take pages as read. */
function toAttendance(sessionId: number, read: TakePage[]): SessionAttendance {
  return { sessionId, statuses: read[0]!.statuses, participants: read.flatMap((shown) => shown.participants) };
}

/**
 * A session's attendance, as its take page shows it: the statuses of its status set (id, acronym,
 * name; the ones the activity shows) and each participant the session is for (its group's, for a
 * group session), with their status and remarks when marked; all of Moodle's pages of participants.
 * Throws `AttendanceError` when the person can't take attendance (mod/attendance:takeattendances,
 * which teachers have) or there's no such session, `NotAnAttendanceError` when the activity isn't an
 * Attendance activity (confirmed empirically, mod_attendance 2026042102 on Moodle 5.2).
 */
export async function sessionAttendance(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<SessionAttendance> {
  const { pages, read } = await openTakePages(context, siteUrl, activityId, sessionId);
  for (const page of pages) await page.close().catch(() => undefined);
  return toAttendance(sessionId, read);
}

/** The status a mark names, from the session's set: by id, by acronym (exact, then ignoring case), or by name ignoring case. */
export function findStatus(statuses: AttendanceStatus[], wanted: number | string): AttendanceStatus | undefined {
  if (typeof wanted === "number") return statuses.find((status) => status.id === wanted);
  const text = String(wanted).trim();
  return statuses.find((status) => status.acronym === text) ?? statuses.find((status) => status.acronym.toLowerCase() === text.toLowerCase()) ?? statuses.find((status) => status.description.toLowerCase() === text.toLowerCase());
}

/**
 * Takes attendance for a session through its take page: each participant given gets the status
 * (from the session's own status set, read from the page) and, when given, the remarks; the others
 * keep what they have. Every mark is checked before anything is saved: a status not in the set, a
 * participant the session doesn't list or can't be marked, refuses the whole call. Moodle marks the
 * session taken (and recalculates the activity's grade). Gives the session's attendance afterwards.
 * Throws `AttendanceError` for a refused mark, when the person can't take attendance
 * (mod/attendance:takeattendances; mod/attendance:changeattendances once taken) or there's no such
 * session (confirmed empirically, mod_attendance 2026042102 on Moodle 5.2).
 */
export async function takeAttendance(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number, marks: AttendanceMark[]): Promise<AttendanceTaken> {
  if (!Array.isArray(marks) || marks.length === 0) throw new MoodleError("marks needs at least one participant's status.", "invalid-input");
  const twice = marks.map((mark) => mark.userId).filter((id, i, ids) => ids.indexOf(id) !== i);
  if (twice.length > 0) throw new MoodleError(`marks names participant ${twice.join(", ")} more than once.`, "invalid-input");
  const { pages, read } = await openTakePages(context, siteUrl, activityId, sessionId);
  try {
    const statuses = read[0]!.statuses;
    const set = statuses.map((status) => `${status.acronym} (${status.description}, ${status.id})`).join(", ");
    const plan: { page: number; userId: number; statusId: number; remarks?: string }[] = [];
    const problems: string[] = [];
    for (const mark of marks) {
      const status = findStatus(statuses, mark.status);
      const where = read.findIndex((shown) => shown.participants.some((p) => p.userId === mark.userId));
      const participant = where < 0 ? undefined : read[where]!.participants.find((p) => p.userId === mark.userId);
      if (!status) problems.push(`"${String(mark.status)}" isn't a status of the session's set (${set})`);
      if (!participant) problems.push(`participant ${mark.userId} isn't among those session ${sessionId} lists`);
      else if (!participant.canMark) problems.push(`participant ${mark.userId} (${participant.fullName}) can't be marked: their enrolment ended or is suspended`);
      if (status && participant?.canMark) plan.push({ page: where, userId: mark.userId, statusId: status.id, ...(mark.remarks !== undefined ? { remarks: mark.remarks } : {}) });
    }
    if (problems.length > 0) throw new AttendanceError(`Nothing was saved for session ${sessionId}: ${problems.join("; ")}.`);
    const refused = `You can't take attendance for session ${sessionId} of attendance ${activityId}`;
    for (let n = 0; n < pages.length; n++) {
      const here = plan.filter((step) => step.page === n);
      if (here.length === 0) continue;
      const page = pages[n]!;
      await page.evaluate((steps) => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { checked: boolean; value: string } | null } }).document;
        for (const step of steps) {
          const radio = doc.querySelector(`#attendancetakeform input[type="radio"][name="user${step.userId}"][value="${step.statusId}"]`);
          if (radio) radio.checked = true;
          const remarks = doc.querySelector(`#attendancetakeform input[name="remarks${step.userId}"]`);
          if (remarks && step.remarks !== undefined) remarks.value = step.remarks;
        }
      }, here);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.locator('#attendancetakeform [type="submit"]').first().click()]);
      await failOnRefusal(page, activityId, refused, TAKE);
    }
  } finally {
    for (const page of pages) await page.close().catch(() => undefined);
  }
  const attendance = await sessionAttendance(context, siteUrl, activityId, sessionId);
  return { changed: `Took attendance for ${marks.length} participant${marks.length === 1 ? "" : "s"} in session ${sessionId} of attendance ${activityId}.`, sessionId, attendance };
}

/** One page of the report's summary view, as read: the status acronyms and a row per participant. */
interface ReportPage {
  acronyms: string[];
  rows: AttendanceReportRow[];
  next: boolean;
}

/**
 * The report's summary view on `page`: the second header row names the columns (the participant,
 * their identity fields, a column per status from the first shaded one, and eight totals: taken
 * sessions, points, percentage; all sessions, points, percentage; maximum points, percentage); each
 * participant's row has the same cells. Numbers as Moodle formats them ("4 / 6", "66.7%", "66,7%").
 */
export function readReportPage(page: Page): Promise<ReportPage> {
  return inPage(
    page,
    () => {
      interface El {
        tagName: string;
        className: string;
        textContent: string | null;
        children: ArrayLike<El>;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { document: El; location: { href: string } };
      const text = (el: El | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const number = (raw: string) => Number(raw.replace(/[%\s]/g, "").replace(",", ".")) || 0;
      const fraction = (raw: string) => {
        const [points = "0", max = "0"] = raw.split("/");
        return { points: number(points), maxPoints: number(max) };
      };
      const table = g.document.querySelector("table.attreport");
      const empty = { acronyms: [] as string[], rows: [] as AttendanceReportRow[], next: false };
      if (!table) return empty;
      const rows = Array.from(table.querySelectorAll("tr"));
      const header = rows.find((row) => row.children[0]?.tagName === "TH" && row.querySelector("th.headcol") !== null && row.querySelector('a[href*="sort="]') !== null);
      if (!header) return empty;
      const heads = Array.from(header.children);
      const first = heads.findIndex((cell) => / contrast /.test(` ${cell.className} `));
      const totals = heads.length - 8;
      if (first < 1 || first > totals) return empty;
      const acronyms = heads.slice(first, totals).map((cell) => text(cell));
      const report: AttendanceReportRow[] = [];
      for (const row of rows) {
        const link = row.querySelector('td.headcol a[href*="/mod/attendance/view.php"][href*="studentid="]');
        if (!link) continue;
        const cells = Array.from(row.children).map((cell) => text(cell));
        if (cells.length !== heads.length) continue;
        const sessions = number(cells[totals]!);
        const counts = acronyms.map((acronym, i) => {
          const count = number(cells[first + i]!);
          return { acronym, count, percentage: sessions ? Math.round((count / sessions) * 1000) / 10 : 0 };
        });
        report.push({
          userId: Number(new URL(link.getAttribute("href") ?? "", g.location.href).searchParams.get("studentid")),
          fullName: text(link),
          statuses: counts,
          taken: { sessions, ...fraction(cells[totals + 1]!), percentage: number(cells[totals + 2]!) },
          all: { sessions: number(cells[totals + 3]!), ...fraction(cells[totals + 4]!), percentage: number(cells[totals + 5]!) },
          maxPossible: { ...fraction(cells[totals + 6]!), percentage: number(cells[totals + 7]!) },
        });
      }
      const current = Number(new URL(g.location.href).searchParams.get("page") ?? 1) || 1;
      const next = Array.from(g.document.querySelectorAll('a[href*="/mod/attendance/report.php"]')).some((a) => new URL(a.getAttribute("href") ?? "", g.location.href).searchParams.get("page") === String(current + 1));
      return { acronyms, rows: report, next };
    },
    null,
  );
}

/**
 * An Attendance activity's report, as its summary view shows it: for each participant, how many of
 * their taken sessions have each status (and that as a percentage of them), their points and
 * percentage over taken sessions (what Moodle grades), over all sessions, and the most they can still
 * reach; all of Moodle's pages of participants. Sessions before the course's start date don't count.
 * Throws `AttendanceError` when the person can't see reports (mod/attendance:viewreports, which
 * teachers have), `NotAnAttendanceError` when the activity isn't an Attendance activity (confirmed
 * empirically, mod_attendance 2026042102 on Moodle 5.2).
 */
export async function attendanceReport(context: BrowserContext, siteUrl: string, activityId: number, { groupId }: AttendanceReportOptions = {}): Promise<AttendanceReportRow[]> {
  if (groupId !== undefined && (!Number.isInteger(groupId) || groupId <= 0)) throw new MoodleError("groupId is the id of one of the course's groups.", "invalid-input");
  const rows: AttendanceReportRow[] = [];
  for (let n = 1; n <= 100; n++) {
    const path = `report.php?id=${activityId}&view=7${groupId ? `&group=${groupId}` : ""}${n > 1 ? `&page=${n}` : ""}`;
    const page = await openAttendancePage(context, siteUrl, activityId, path, `You can't see attendance ${activityId}'s report`, REPORT);
    let shown: ReportPage;
    try {
      shown = await readReportPage(page);
    } finally {
      await page.close().catch(() => undefined);
    }
    rows.push(...shown.rows.filter((row) => !rows.some((seen) => seen.userId === row.userId)));
    if (!shown.next) break;
  }
  return rows;
}
