// An Attendance activity's sessions, as its sessions page (manage.php) lists them and its add,
// update and delete pages (sessions.php, actions 1, 2 and 3) write them. The list shows each
// session's date and time formatted in the person's language only; the exact time is in each
// session's update form, read in the page without opening it (fetched and parsed by the browser).
import type { BrowserContext, Page } from "playwright-core";
import { MoodleError } from "../../core/errors.js";
import { FormError, dateSelectorParts, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { AttendanceError, MANAGE, TAKE, bodyId, failOnRefusal, openAttendancePage } from "./attendance.js";

/** A session of an Attendance activity. */
export interface AttendanceSession {
  id: number;
  /**
   * When it starts (ISO 8601). Left out when the person can't change sessions
   * (mod/attendance:manageattendances): only the session's form gives the exact time.
   */
  start?: string;
  /** How long it lasts, in minutes; left out with `start`. */
  durationMinutes?: number;
  /** Its date and time as the sessions page shows them, in the person's language ("Mon 2 Nov 2026 10AM - 11AM"). */
  when: string;
  /** The group it's for; left out for a session for all students. */
  groupId?: number;
  /** Its description, as HTML ("" when it has none and the person can change sessions; Moodle's "No description" otherwise). */
  description: string;
  /** Attendance has been taken for it. */
  taken: boolean;
}

/** A day of the week, as the add session form names it. */
export type AttendanceWeekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

/**
 * New sessions: one, or with `repeatOn` one on each of those weekdays from the start's week until
 * `repeatUntil` (that day included), every `repeatEveryWeeks` weeks. Plain fields rather than a
 * nested object, so the `moodle` command takes them as flags (a date inside JSON stays text).
 */
export interface AttendanceSessionInput {
  /** When the (first) session starts; its time of day is every repeated session's. */
  start: Date;
  /** How long each lasts, in minutes; it must end the same day (Moodle takes a start and an end time). */
  durationMinutes: number;
  /** A description, as HTML. */
  description?: string;
  /** The groups to add the sessions for, each its own session; none for all students. Only with the activity in group mode. */
  groupIds?: number[];
  /** Repeat it weekly on these weekdays (with `repeatUntil`). */
  repeatOn?: AttendanceWeekday[];
  /** The last day of the repeat. */
  repeatUntil?: Date;
  /** Every how many weeks (1 by default, up to 36, as the form offers). */
  repeatEveryWeeks?: number;
}

/** The repeat an input asks for, or undefined; refused when only part of it is given. */
interface Repeat {
  days: AttendanceWeekday[];
  until: Date;
  everyWeeks: number;
}

/** What `editAttendanceSession` changes: only what's given. A new start keeps the session's duration unless a new one is given. */
export interface AttendanceSessionChanges {
  start?: Date;
  durationMinutes?: number;
  description?: string;
}

/** What adding sessions did, their ids, and the sessions added. */
export interface AttendanceSessionsAdded {
  changed: string;
  sessionIds: number[];
  sessions: AttendanceSession[];
}

/** What a change to a session did, its id, and the session afterwards (not after a delete). */
export interface AttendanceSessionChange {
  changed: string;
  sessionId: number;
  session?: AttendanceSession;
}

/** A row of the sessions page's table. */
export interface SessionRow {
  id: number;
  when: string;
  groupId?: number;
  description: string;
  taken: boolean;
  /** Its update form's URL, when the row links it (the person can change sessions). */
  editUrl?: string;
}

/** What a session's update form holds: its date, start and end time in the person's time zone, and its description. */
export interface SessionTimes {
  year: number;
  month: number;
  day: number;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  description: string;
}

const manageUrl = (activityId: number) => `manage.php?id=${activityId}&view=5&group=-1`;

/**
 * The rows of the sessions page's table: each session's id from its checkbox (`sessid[]`), its
 * group from its take link (`grouptype`), taken when its date links to changing it (or is in
 * italics, for who can't); the first five columns are fixed (custom fields come after them).
 */
export function readSessionRows(page: Page): Promise<SessionRow[]> {
  return inPage(
    page,
    () => {
      interface El {
        innerHTML: string;
        tagName: string;
        textContent: string | null;
        parentElement: El | null;
        children: ArrayLike<El>;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { document: El; location: { href: string } };
      const text = (cell: El | undefined) => (cell?.textContent ?? "").replace(/\s+/g, " ").trim();
      const rows: SessionRow[] = [];
      for (const box of Array.from(g.document.querySelectorAll('.attsessions_manage_table input[name="sessid[]"]'))) {
        let row: El | null = box;
        while (row && row.tagName !== "TR") row = row.parentElement;
        if (!row) continue;
        const cells = Array.from(row.children);
        const take = row.querySelector('a[href*="/mod/attendance/take.php"]');
        const edit = row.querySelector('a[href*="/mod/attendance/sessions.php"][href*="action=2"]');
        const group = take ? new URL(take.getAttribute("href") ?? "", g.location.href).searchParams.get("grouptype") : null;
        let description = (cells[4]?.innerHTML ?? "").trim();
        // format_text wraps a plain description in div.text_to_html.
        const wrapped = /^<div class="text_to_html">([\s\S]*)<\/div>$/.exec(description);
        if (wrapped) description = wrapped[1]!;
        rows.push({
          id: Number(box.getAttribute("value")),
          when: [text(cells[1]), text(cells[2])].filter(Boolean).join(" "),
          ...(group && Number(group) > 0 ? { groupId: Number(group) } : {}),
          description,
          taken: Boolean(cells[1]?.querySelector("a, i")),
          ...(edit ? { editUrl: new URL(edit.getAttribute("href") ?? "", g.location.href).href } : {}),
        });
      }
      return rows;
    },
    null,
  );
}

/** Each session's update form, fetched in `page` and parsed there: its date and times as selected, and its description. */
function readSessionForms(page: Page, urls: string[]): Promise<(SessionTimes | undefined)[]> {
  return inPage(
    page,
    async (urls: string[]) => {
      const g = globalThis as unknown as {
        fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
        DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): { value: string } | null } };
      };
      const forms: (SessionTimes | undefined)[] = [];
      for (const url of urls) {
        const html = await (await g.fetch(url, { credentials: "same-origin" })).text();
        const doc = new g.DOMParser().parseFromString(html, "text/html");
        const value = (name: string) => doc.querySelector(`form.mform [name="${name}"]`)?.value;
        const number = (name: string) => Number(value(name));
        const year = number("sessiondate[year]");
        forms.push(
          year
            ? {
                year,
                month: number("sessiondate[month]"),
                day: number("sessiondate[day]"),
                startHour: number("sestime[starthour]"),
                startMinute: number("sestime[startminute]"),
                endHour: number("sestime[endhour]"),
                endMinute: number("sestime[endminute]"),
                description: value("sdescription[text]") ?? "",
              }
            : undefined,
        );
      }
      return forms;
    },
    urls,
  );
}

/** The person's time zone in Moodle (`M.cfg.usertimezone`), which the forms' dates are in. */
function pageTimeZone(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { usertimezone?: string } } }).M?.cfg?.usertimezone ?? "UTC");
}

/** The moment a wall time in `timeZone` is: taken as UTC, then corrected by the zone's offset at that moment (twice, across a DST change). */
export function zonedDate(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let time = wall;
  for (let i = 0; i < 2; i++) {
    const parts = dateSelectorParts("x", new Date(time), timeZone);
    time += wall - Date.UTC(parts["x[year]"]!, parts["x[month]"]! - 1, parts["x[day]"]!, parts["x[hour]"]!, parts["x[minute]"]!);
  }
  return new Date(time);
}

/** A session from its row and, when the person could read it, its update form. */
export function toSession(row: SessionRow, form: SessionTimes | undefined, timeZone: string): AttendanceSession {
  const shown = { when: row.when, ...(row.groupId ? { groupId: row.groupId } : {}), taken: row.taken };
  if (!form) return { id: row.id, ...shown, description: row.description };
  const start = zonedDate(form.year, form.month, form.day, form.startHour, form.startMinute, timeZone);
  const durationMinutes = form.endHour * 60 + form.endMinute - (form.startHour * 60 + form.startMinute);
  return { id: row.id, start: start.toISOString(), durationMinutes, ...shown, description: form.description };
}

/** The sessions on `page` (the sessions page), those `keep` keeps, with their exact times when the person can read them. */
async function sessionsOn(page: Page, keep: (row: SessionRow) => boolean = () => true): Promise<AttendanceSession[]> {
  const rows = (await readSessionRows(page)).filter(keep);
  const timeZone = await pageTimeZone(page);
  const editable = rows.filter((row) => row.editUrl);
  const forms = await readSessionForms(page, editable.map((row) => row.editUrl!));
  return rows.map((row) => toSession(row, forms[editable.indexOf(row)], timeZone));
}

/** Opens the sessions page, all of them, for every group the person sees; fails as Moodle refuses. */
async function openSessionsPage(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openAttendancePage(context, siteUrl, activityId, manageUrl(activityId), `You can't see attendance ${activityId}'s sessions`, TAKE);
  // Moodle sends who can't take attendance to the activity's own page instead.
  if ((await bodyId(page)) !== "page-mod-attendance-manage") {
    await page.close().catch(() => undefined);
    throw new AttendanceError(`You can't see attendance ${activityId}'s sessions: ${TAKE}.`);
  }
  return page;
}

/**
 * An Attendance activity's sessions, by date: each one's id, start and duration, the group it's for,
 * its description and whether attendance has been taken. What the sessions page shows: sessions from
 * the course's start date on (Moodle hides earlier ones, and leaves them out of the report), of the
 * groups the person sees. The exact start comes from each session's form, which only who can change
 * sessions opens (mod/attendance:manageattendances); for the others `when` has Moodle's text alone.
 * Throws `NotAnAttendanceError` when the activity isn't an Attendance activity, `AttendanceError` when
 * the person can't take attendance in it (confirmed empirically, mod_attendance 2026042102 on Moodle
 * 5.2; on 4.5 the plugin's own 4.5 release is expected to render the same pages, not checked).
 */
export async function attendanceSessions(context: BrowserContext, siteUrl: string, activityId: number): Promise<AttendanceSession[]> {
  const page = await openSessionsPage(context, siteUrl, activityId);
  try {
    return await sessionsOn(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

const WEEKDAYS: AttendanceWeekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Refuses a start that isn't a date and a duration that isn't whole minutes. */
function checkTimes(start: Date, durationMinutes: number): void {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) throw new MoodleError("start is a date.", "invalid-input");
  if (!Number.isInteger(durationMinutes) || durationMinutes < 0) throw new MoodleError(`durationMinutes is a whole number of minutes, not ${String(durationMinutes)}.`, "invalid-input");
}

/** A start and duration as the form's date and time fields, in `timeZone`; refused when it doesn't end the same day. */
export function timeFields(start: Date, durationMinutes: number, timeZone: string): Record<string, number> {
  checkTimes(start, durationMinutes);
  const from = dateSelectorParts("d", start, timeZone);
  const to = dateSelectorParts("d", new Date(start.getTime() + durationMinutes * 60_000), timeZone);
  if (to["d[day]"] !== from["d[day]"] || to["d[month]"] !== from["d[month]"] || to["d[year]"] !== from["d[year]"]) {
    const at = `${String(from["d[hour]"]).padStart(2, "0")}:${String(from["d[minute]"]).padStart(2, "0")}`;
    throw new MoodleError(`A session ends the day it starts: ${durationMinutes} minutes from ${at} goes past midnight (${timeZone}).`, "invalid-input");
  }
  return {
    "sessiondate[day]": from["d[day]"]!,
    "sessiondate[month]": from["d[month]"]!,
    "sessiondate[year]": from["d[year]"]!,
    "sestime[starthour]": from["d[hour]"]!,
    "sestime[startminute]": from["d[minute]"]!,
    "sestime[endhour]": to["d[hour]"]!,
    "sestime[endminute]": to["d[minute]"]!,
  };
}

/**
 * The repeat the input asks for, undefined for one session: refused without weekdays, with others
 * than Moodle's, without an end or with one days before the start, or with a period Moodle doesn't offer.
 */
function readRepeat({ start, repeatOn, repeatUntil, repeatEveryWeeks }: AttendanceSessionInput): Repeat | undefined {
  if (repeatOn === undefined && repeatUntil === undefined && repeatEveryWeeks === undefined) return undefined;
  if (!Array.isArray(repeatOn) || repeatOn.length === 0) throw new MoodleError("repeatOn needs at least one weekday to repeat on.", "invalid-input");
  const unknown = repeatOn.filter((day) => !WEEKDAYS.includes(day));
  if (unknown.length > 0) throw new MoodleError(`repeatOn takes ${WEEKDAYS.join(", ")}; not ${unknown.join(", ")}.`, "invalid-input");
  const everyWeeks = repeatEveryWeeks ?? 1;
  if (!Number.isInteger(everyWeeks) || everyWeeks < 1 || everyWeeks > 36) throw new MoodleError(`repeatEveryWeeks goes from 1 to 36, not ${String(everyWeeks)}.`, "invalid-input");
  if (!(repeatUntil instanceof Date) || Number.isNaN(repeatUntil.getTime())) throw new MoodleError("repeatUntil, the repeat's last day, is a date.", "invalid-input");
  if (repeatUntil.getTime() < start.getTime() - 86_400_000) throw new MoodleError("repeatUntil is before start.", "invalid-input");
  return { days: repeatOn, until: repeatUntil, everyWeeks };
}

/** The form's fields for repeating: the checkbox, the weekdays, the period and the last day (in `timeZone`). */
export function repeatFields({ days, until, everyWeeks }: Repeat, start: Date, timeZone: string): Record<string, FieldValue> {
  const last = dateSelectorParts("d", until, timeZone);
  const first = dateSelectorParts("d", start, timeZone);
  const day = (p: Record<string, number>) => p["d[year]"]! * 10_000 + p["d[month]"]! * 100 + p["d[day]"]!;
  if (day(last) < day(first)) throw new MoodleError("repeatUntil is before start.", "invalid-input");
  const values: Record<string, FieldValue> = { addmultiply: true };
  for (const name of days) values[`sdays[${name}]`] = true;
  values.period = String(everyWeeks);
  values["sessionenddate[day]"] = last["d[day]"]!;
  values["sessionenddate[month]"] = last["d[month]"]!;
  values["sessionenddate[year]"] = last["d[year]"]!;
  return values;
}

/** Opens one of the activity's forms (`sessions.php?…`), telling Moodle's refusal apart when it shows no form. */
async function openSessionForm(context: BrowserContext, siteUrl: string, activityId: number, path: string, refused: string): Promise<Page> {
  try {
    return await openForm(context, siteUrl, `mod/attendance/${path}`);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    // Moodle's error page instead of the form: opened again, to say which.
    const page = await openAttendancePage(context, siteUrl, activityId, path, refused, MANAGE);
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** The ids of the sessions the sessions page lists now. */
async function sessionIds(context: BrowserContext, siteUrl: string, activityId: number): Promise<number[]> {
  const page = await openSessionsPage(context, siteUrl, activityId);
  try {
    return (await readSessionRows(page)).map((row) => row.id);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Adds sessions to an Attendance activity through its add session form: one, or with `repeatOn` one
 * on each of those weekdays from `start`'s week until `repeatUntil`, every `repeatEveryWeeks` weeks,
 * all at `start`'s time of day (in the person's time zone in Moodle, which the form reads). With `groupIds`, one
 * session for each group (the activity in group mode). The form's other settings (calendar event,
 * students recording their own attendance…) stay as Moodle's defaults set them. Gives the new
 * sessions. Throws `AttendanceError` when the person can't add sessions (mod/attendance:manageattendances,
 * which editing teachers have), when the activity takes groups and none were given or the other way
 * round, or when Moodle added none it lists (a repeat whose weekdays never fall in its dates,
 * sessions before the course's start date); `FormError` with Moodle's messages when it refuses the
 * form (confirmed empirically, mod_attendance 2026042102 on Moodle 5.2).
 */
export async function addAttendanceSessions(context: BrowserContext, siteUrl: string, activityId: number, input: AttendanceSessionInput): Promise<AttendanceSessionsAdded> {
  const { start, durationMinutes, description, groupIds } = input;
  if (groupIds !== undefined && (!Array.isArray(groupIds) || groupIds.length === 0 || groupIds.some((id) => !Number.isInteger(id) || id <= 0))) {
    throw new MoodleError("groupIds are the ids of one or more of the course's groups.", "invalid-input");
  }
  checkTimes(start, durationMinutes);
  const repeat = readRepeat(input);
  const refused = `You can't add sessions to attendance ${activityId}`;
  const known = await sessionIds(context, siteUrl, activityId);
  const page = await openSessionForm(context, siteUrl, activityId, `sessions.php?id=${activityId}&action=1`, refused);
  try {
    const timeZone = await pageTimeZone(page);
    const values: Record<string, FieldValue> = timeFields(start, durationMinutes, timeZone);
    const form = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document;
      return {
        hiddenType: doc.querySelector('form.mform input[type="hidden"][name="sessiontype"]')?.value,
        radio: doc.querySelector('form.mform input[type="radio"][name="sessiontype"]') !== null,
        groups: doc.querySelector('form.mform select[name="groups[]"]') !== null,
      };
    });
    if (groupIds) {
      if (!form.groups) throw new AttendanceError(`Attendance ${activityId} doesn't take groups (its group mode is off, or the course has no groups): its sessions are for all students; leave groupIds out.`);
      if (form.radio) values.sessiontype = "1";
      values["groups[]"] = groupIds.map(String);
    } else if (form.hiddenType === "1") {
      throw new AttendanceError(`Attendance ${activityId} uses separate groups: each session is for a group; give groupIds.`);
    }
    if (description !== undefined) values["sdescription[text]"] = description;
    if (repeat) Object.assign(values, repeatFields(repeat, start, timeZone));
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    await failOnRefusal(page, activityId, refused, MANAGE);
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await openSessionsPage(context, siteUrl, activityId);
  try {
    const sessions = await sessionsOn(after, (row) => !known.includes(row.id));
    if (sessions.length === 0) throw new AttendanceError(`Moodle lists no new session in attendance ${activityId}: it hides sessions before the course's start date, and a repeat adds only on its weekdays between start and until.`);
    const ids = sessions.map((session) => session.id);
    return { changed: `Added ${ids.length === 1 ? `session ${ids[0]}` : `${ids.length} sessions (${ids.join(", ")})`} to attendance ${activityId}.`, sessionIds: ids, sessions };
  } finally {
    await after.close().catch(() => undefined);
  }
}

/** One session as the sessions page shows it, with its exact times when the person can read them; `AttendanceError` when it isn't there. */
export async function readSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<AttendanceSession> {
  const page = await openSessionsPage(context, siteUrl, activityId);
  try {
    const [session] = await sessionsOn(page, (row) => row.id === sessionId);
    if (!session) throw new AttendanceError(`Attendance ${activityId} lists no session ${sessionId}: take its id from attendanceSessions (Moodle doesn't list sessions before the course's start date).`);
    return session;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The times the update form holds now. */
function formTimes(page: Page): Promise<SessionTimes> {
  return inPage(
    page,
    () => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document;
      const number = (name: string) => Number(doc.querySelector(`form.mform [name="${name}"]`)?.value ?? 0);
      return {
        year: number("sessiondate[year]"),
        month: number("sessiondate[month]"),
        day: number("sessiondate[day]"),
        startHour: number("sestime[starthour]"),
        startMinute: number("sestime[startminute]"),
        endHour: number("sestime[endhour]"),
        endMinute: number("sestime[endminute]"),
        description: doc.querySelector('form.mform [name="sdescription[text]"]')?.value ?? "",
      };
    },
    null,
  );
}

/**
 * Changes a session through its update form: its start, its duration, its description; only what's
 * given, the rest as the form has it. Moodle doesn't move a session to another group. Gives the
 * session afterwards. Throws `AttendanceError` when the person can't change sessions
 * (mod/attendance:manageattendances) or there's no such session, `FormError` when Moodle refuses the
 * form (confirmed empirically, mod_attendance 2026042102 on Moodle 5.2).
 */
export async function editAttendanceSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number, changes: AttendanceSessionChanges): Promise<AttendanceSessionChange> {
  const { start, durationMinutes, description } = changes;
  if (start === undefined && durationMinutes === undefined && description === undefined) {
    return { changed: "Nothing to change.", sessionId, session: await readSession(context, siteUrl, activityId, sessionId) };
  }
  const refused = `You can't change session ${sessionId} of attendance ${activityId}`;
  const page = await openSessionForm(context, siteUrl, activityId, `sessions.php?id=${activityId}&sessionid=${sessionId}&action=2`, refused);
  try {
    const timeZone = await pageTimeZone(page);
    const now = await formTimes(page);
    const values: Record<string, FieldValue> = {};
    if (start !== undefined || durationMinutes !== undefined) {
      const from = start ?? zonedDate(now.year, now.month, now.day, now.startHour, now.startMinute, timeZone);
      const minutes = durationMinutes ?? now.endHour * 60 + now.endMinute - (now.startHour * 60 + now.startMinute);
      Object.assign(values, timeFields(from, minutes, timeZone));
    }
    if (description !== undefined) values["sdescription[text]"] = description;
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    await failOnRefusal(page, activityId, refused, MANAGE);
  } finally {
    await page.close().catch(() => undefined);
  }
  const what = [start !== undefined && "start", durationMinutes !== undefined && "duration", description !== undefined && "description"].filter(Boolean).join(", ");
  return { changed: `Changed session ${sessionId} of attendance ${activityId} (${what}).`, sessionId, session: await readSession(context, siteUrl, activityId, sessionId) };
}

/**
 * Deletes a session through its delete confirmation, as the sessions page's delete icon does; the
 * attendance taken for it goes with it, and Moodle recalculates the activity's grades. Throws
 * `AttendanceError` when the person can't change sessions (mod/attendance:manageattendances) or there's
 * no such session (confirmed empirically, mod_attendance 2026042102 on Moodle 5.2).
 */
export async function deleteAttendanceSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<AttendanceSessionChange> {
  const refused = `You can't delete session ${sessionId} of attendance ${activityId}`;
  const page = await openAttendancePage(context, siteUrl, activityId, `sessions.php?id=${activityId}&sessionid=${sessionId}&action=3`, refused, MANAGE);
  try {
    const confirm = page.locator('form[action$="/mod/attendance/sessions.php"]:has(input[name="confirm"]) [type="submit"]');
    if ((await confirm.count()) === 0) throw new MoodleError(`The delete confirmation of session ${sessionId} isn't what the driver expects: delete it in Moodle.`, "unexpected-page");
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click()]);
    await failOnRefusal(page, activityId, refused, MANAGE);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Deleted session ${sessionId} of attendance ${activityId}.`, sessionId };
}
