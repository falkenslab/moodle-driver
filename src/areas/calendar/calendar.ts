// Course calendar events: created through the calendar's own event form (rendered as a fragment,
// submitted through its service), read back from the upcoming view, deleted through its service.
import type { BrowserContext } from "playwright-core";
import { MoodleServiceError, callService } from "../../core/ajax.js";
import { isoDate } from "../courses/list.js";
import { setFields, type FieldValue } from "../../core/forms.js";
import { decodeEntities } from "../../core/text.js";

/** Moodle refused the event, or it isn't there. */
export class CalendarError extends Error {
  override name = "CalendarError";
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
    formdata = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown };
        FormData: new (form: unknown) => Iterable<[string, string]>;
        URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
      };
      return new g.URLSearchParams(new g.FormData(g.document.querySelector("form"))).toString();
    });
  } finally {
    await page.close().catch(() => undefined);
  }
  const answer = await callService<{ event?: MoodleEvent; validationerror?: boolean }>(context, siteUrl, "core_calendar_submit_create_update_form", { formdata });
  if (!answer.event || answer.validationerror) throw new CalendarError(`Moodle refused the event "${name}": check its name, start and duration.`);
  const event = toEvent(answer.event);
  return { changed: `Event ${event.id} "${event.name}" added to course ${courseId}'s calendar.`, event };
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
