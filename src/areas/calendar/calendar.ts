// Course calendar events: created and changed through the calendar's own event form (rendered as a
// fragment, submitted through its service), read back from the upcoming view or by id, deleted
// through its service.
import type { BrowserContext, Page } from "playwright-core";
import { MoodleServiceError, callService, readPageConfig } from "../../core/ajax.js";
import { isoDate } from "../courses/list.js";
import { dateSelectorValues, setFields, type FieldValue } from "../../core/forms.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

/** Moodle refused the event, or it isn't there. */
export class CalendarError extends MoodleError {
  override name = "CalendarError";
  constructor(message: string) {
    super(message, "calendar");
  }
}

export interface CalendarEvent {
  id: number;
  name: string;
  /** The event's kind: "course", "group", "user", or an activity's ("due", "open"…). */
  type: string;
  start: string;
  durationMinutes?: number;
  courseId?: number;
  /** For an activity's event, its module and instance. */
  activity?: { type: string; instance: number };
}

/** An event as the calendar's services return it (Moodle 5.2), the fields read. */
interface MoodleEvent {
  id: number;
  name: string;
  eventtype: string;
  timestart: number;
  timeduration: number;
  modulename?: string | null;
  instance?: number | null;
  course?: { id: number } | null;
}

function toEvent(raw: MoodleEvent): CalendarEvent {
  return {
    id: raw.id,
    name: decodeEntities(raw.name),
    type: raw.eventtype,
    start: isoDate(raw.timestart)!,
    ...(raw.timeduration > 0 ? { durationMinutes: Math.round(raw.timeduration / 60) } : {}),
    ...(raw.course ? { courseId: raw.course.id } : {}),
    ...(raw.modulename && raw.instance ? { activity: { type: raw.modulename, instance: raw.instance } } : {}),
  };
}

/** The person's upcoming events, as the calendar's "Upcoming events" view lists them, in one course or all. */
export async function upcomingEvents(context: BrowserContext, siteUrl: string, { courseId }: { courseId?: number } = {}): Promise<CalendarEvent[]> {
  // Course 1 is the site: every course the person is in.
  const { events } = await callService<{ events: MoodleEvent[] }>(context, siteUrl, "core_calendar_get_calendar_upcoming_view", { courseid: courseId ?? 1, categoryid: 0 });
  return events.map(toEvent);
}

/**
 * Creates a course event, through the calendar's own form: its start, and its duration and
 * description when given. Returns it as the calendar has it.
 */
export async function createEvent(
  context: BrowserContext,
  siteUrl: string,
  { courseId, name, start, durationMinutes, description }: { courseId: number; name: string; start: Date; durationMinutes?: number; description?: string },
): Promise<{ changed: string; event: CalendarEvent }> {
  // The form takes its start as the time it's opened for: no date fields to fill in the person's time zone.
  const fragment = await callService<{ html: string }>(context, siteUrl, "core_get_fragment", {
    component: "core_calendar",
    callback: "event_form",
    contextid: 1,
    args: [
      { name: "courseid", value: String(courseId) },
      { name: "starttime", value: String(Math.floor(start.getTime() / 1000)) },
    ],
  });
  const page = await context.newPage();
  let formdata: string;
  try {
    await page.setContent(fragment.html);
    const types = await page.evaluate(() =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll('form [name="eventtype"] option')).map((o) => o.value),
    );
    if (!types.includes("course")) throw new CalendarError(`You can't add events to course ${courseId}'s calendar.`);
    const values: Record<string, FieldValue> = { name, eventtype: "course", courseid: String(courseId) };
    if (durationMinutes !== undefined) Object.assign(values, { duration: 2, timedurationminutes: durationMinutes });
    if (description !== undefined) values["description[text]"] = description;
    await setFields(page, values, "form");
    formdata = await formData(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  const event = await submitEventForm(context, siteUrl, formdata, `Moodle refused the event "${name}": check its name, start and duration.`);
  return { changed: `Event ${event.id} "${event.name}" added to course ${courseId}'s calendar.`, event };
}

/**
 * The event form's fields, encoded as the calendar's page sends them to the service, without those
 * of the other event types. The form hides a group event's course and group, a category event's
 * category… unless the event is of that type; outside Moodle's page its group select still holds its
 * first group, and Moodle saves it into a course event, which only that group then sees (confirmed
 * empirically, 5.2).
 */
function formData(page: Page): Promise<string> {
  return page.evaluate(() => {
    const g = globalThis as unknown as {
      document: { querySelector(s: string): unknown };
      FormData: new (form: unknown) => Iterable<[string, string]>;
      URLSearchParams: new (init: Iterable<[string, string]>) => { delete(name: string): void; get(name: string): string | null; toString(): string };
    };
    const data = new g.URLSearchParams(new g.FormData(g.document.querySelector("form")));
    const type = data.get("eventtype");
    if (type !== "category") data.delete("categoryid");
    if (type !== "course") data.delete("courseid");
    if (type !== "group") {
      data.delete("groupcourseid");
      data.delete("groupid");
    }
    return data.toString();
  });
}

/** Saves the event form through its service; Moodle answers the event, or that its validation failed. */
async function submitEventForm(context: BrowserContext, siteUrl: string, formdata: string, refused: string): Promise<CalendarEvent> {
  const answer = await callService<{ event?: MoodleEvent; validationerror?: boolean }>(context, siteUrl, "core_calendar_submit_create_update_form", { formdata });
  if (!answer.event || answer.validationerror) throw new CalendarError(refused);
  return toEvent(answer.event);
}

/** One calendar event by its id, as `upcomingEvents` gives them. */
export async function calendarEvent(context: BrowserContext, siteUrl: string, eventId: number): Promise<CalendarEvent> {
  try {
    const { event } = await callService<{ event: MoodleEvent }>(context, siteUrl, "core_calendar_get_calendar_event_by_id", { eventid: eventId });
    return toEvent(event);
  } catch (error) {
    // A missing event answers "nopermissions" rather than a missing record (confirmed empirically, 5.2).
    if (error instanceof MoodleServiceError && (/^invalidrecord/.test(error.errorcode) || error.errorcode === "nopermissions")) {
      throw new CalendarError(`There's no calendar event ${eventId} you can see: it was deleted, never existed, or isn't yours to see.`);
    }
    throw error;
  }
}

/** What to change in a calendar event: only what's given changes. */
export interface EventChanges {
  name?: string;
  /** HTML, sent as written. */
  description?: string;
  start?: Date;
  /** The new length in minutes; 0 leaves the event without one. */
  durationMinutes?: number;
  /** The new end, instead of a length in minutes. */
  until?: Date;
  location?: string;
  /** For an event of a repeated series: change every event of the series (Moodle's default), or only this one. */
  wholeSeries?: boolean;
}

/**
 * Changes a calendar event through the calendar's own form, opened on it: only what's given
 * changes. A new start keeps the event's length unless a new one is given. Returns the event as the
 * calendar has it afterwards.
 */
export async function updateEvent(context: BrowserContext, siteUrl: string, eventId: number, changes: EventChanges): Promise<{ changed: string; event: CalendarEvent }> {
  const { name, description, start, durationMinutes, until, location, wholeSeries } = changes;
  if (durationMinutes !== undefined && until !== undefined) throw new MoodleError("Give the event's new length either in minutes or as an end (until), not both.", "invalid-input");
  if (durationMinutes !== undefined && !(Number.isInteger(durationMinutes) && durationMinutes >= 0)) throw new MoodleError("durationMinutes is a whole number of minutes, 0 for none.", "invalid-input");
  if (name !== undefined && name.trim() === "") throw new MoodleError("The event's name is empty.", "invalid-input");
  const current = await calendarEvent(context, siteUrl, eventId);
  if ([name, description, start, durationMinutes, until, location].every((value) => value === undefined)) return { changed: "Nothing to change.", event: current };

  let fragment: { html: string };
  try {
    fragment = await callService<{ html: string }>(context, siteUrl, "core_get_fragment", {
      component: "core_calendar",
      callback: "event_form",
      contextid: 1,
      args: [{ name: "eventid", value: String(eventId) }],
    });
  } catch (error) {
    if (error instanceof MoodleServiceError && error.errorcode === "nopermissiontoupdatecalendar") {
      throw new CalendarError(`You can't change calendar event ${eventId}${current.activity ? `: it's ${current.activity.type}'s, and changes with the activity's settings` : ""}.`);
    }
    throw error;
  }
  // The form's dates are in the person's time zone; the fragment comes without the page that says it.
  const timeZone = start !== undefined || until !== undefined ? (await readPageConfig(context, siteUrl)).timeZone : undefined;
  const page = await context.newPage();
  let formdata: string;
  try {
    await page.setContent(fragment.html);
    const values: Record<string, FieldValue> = {};
    if (name !== undefined) values.name = name;
    if (description !== undefined) values["description[text]"] = description;
    if (location !== undefined) values.location = location;
    if (start !== undefined) Object.assign(values, await dateSelectorValues(page, "timestart", start, timeZone));
    if (durationMinutes !== undefined) Object.assign(values, durationMinutes === 0 ? { duration: 0 } : { duration: 2, timedurationminutes: durationMinutes });
    else if (until !== undefined) Object.assign(values, { duration: 1 }, await dateSelectorValues(page, "timedurationuntil", until, timeZone));
    // The form keeps a length as its end ("until"): a new start would stretch or invert it.
    else if (start !== undefined) Object.assign(values, current.durationMinutes ? { duration: 2, timedurationminutes: current.durationMinutes } : { duration: 0 });
    // Only a repeated event's form asks whether the change is for the whole series.
    if (wholeSeries !== undefined && (await page.locator('form [name="repeateditall"]').count()) > 0) values.repeateditall = wholeSeries ? 1 : 0;
    await setFields(page, values, "form");
    formdata = await formData(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  const event = await submitEventForm(context, siteUrl, formdata, `Moodle refused the changes to event ${eventId}: check its name, start and duration (an end before the start, a start before the course's).`);
  const done = Object.entries(changes)
    .filter(([key, value]) => value !== undefined && key !== "wholeSeries")
    .map(([key]) => key);
  return { changed: `Event ${eventId} "${event.name}" changed (${done.join(", ") || "nothing"}).`, event };
}

/** Deletes a calendar event the person can manage. */
export async function deleteEvent(context: BrowserContext, siteUrl: string, eventId: number): Promise<{ changed: string }> {
  try {
    await callService(context, siteUrl, "core_calendar_delete_calendar_events", { events: [{ eventid: eventId, repeat: false }] });
  } catch (error) {
    if (error instanceof MoodleServiceError && /^invalidrecord/.test(error.errorcode)) throw new CalendarError(`There's no calendar event ${eventId}: it was deleted, or never existed.`);
    throw error;
  }
  return { changed: `Event ${eventId} deleted.` };
}
