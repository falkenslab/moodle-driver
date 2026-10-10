# Calendar

This area works the Moodle calendar: the person's upcoming events (`upcomingEvents`), creating a course event (`createEvent`) and deleting an event (`deleteEvent`). Anyone can read their upcoming events; creating and deleting course events needs the right to manage the course's calendar, which teachers have by default. What the person has to do by a date (submit, attempt, grade) is better read with `deadlines` (see [Overview and deadlines](overview-and-deadlines.md)).

**Terms:** [calendar event](../reference/glossary.md#calendar-event).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## CalendarEvent

The events every function here returns:

```ts
interface CalendarEvent {
  id: number;
  name: string;
  type: string;
  start: string;
  durationMinutes?: number;
  courseId?: number;
  activity?: { type: string; instance: number };
}
```

- `id`: the event's id, what `deleteEvent` takes.
- `type`: Moodle's event type: `"course"`, `"group"`, `"user"`, `"site"`, or an activity's own (`"due"`, `"open"`, `"close"`…).
- `start`: an ISO date in UTC.
- `durationMinutes`: only for an event with a duration.
- `courseId`: the course it belongs to, when it belongs to one.
- `activity`: for an activity's event, its module ("assign", "quiz"…) and its instance id (the module's own id, not the course module id).

## upcomingEvents

The person's upcoming events as the calendar's "Upcoming events" view lists them, in one course or in every course of theirs.

```ts
function upcomingEvents(context: BrowserContext, siteUrl: string, options?: { courseId?: number }): Promise<CalendarEvent[]>;
```

Without `courseId` it asks for the site's view (course 1), which brings the events of every course the person is in, plus their own and site events. It goes through `core_calendar_get_calendar_upcoming_view`, so it's bounded as that view is: Moodle uses the person's calendar preferences (how many days ahead, how many events at most).

## createEvent

Creates a course event through the calendar's own event form, and returns it as the calendar has it.

```ts
function createEvent(
  context: BrowserContext,
  siteUrl: string,
  options: { courseId: number; name: string; start: Date; durationMinutes?: number; description?: string },
): Promise<{ changed: string; event: CalendarEvent }>;
```

- `courseId`: the course whose calendar gets the event. The event is always a course event (`type: "course"`), seen by everyone in the course.
- `name`: the event's title.
- `start`: when it starts, as a `Date`.
- `durationMinutes`: its length in minutes; without it, the event has no duration.
- `description`: HTML for the event's description (`"<p>Room 3</p>"`); it's sent as written.

It returns `changed`, a sentence ("Event 12 "Tutorial" added to course 3's calendar."), and `event`.

It throws `CalendarError` when:

- the form doesn't offer course events for that course: the person can't add events to its calendar (a student, for instance);
- Moodle's validation refuses the form: the message asks to check the name, start and duration.

### The start time and time zones

A Moodle form shows dates in the person's time zone (their profile's, or the site's), as separate fields for day, month, year, hour and minute. Filling those from a `Date` would mean converting it to that time zone first. `createEvent` avoids it: it asks Moodle for the event form already opened at the start time (the `starttime` of the form's fragment, a Unix timestamp, as when the person clicks a day in the calendar), so the date fields come filled in by Moodle itself for the instant of `start`, whatever the person's or the program's time zone.

`event.start` comes back as an ISO date in UTC: format it in the person's time zone (`readPageConfig()` returns it as `timeZone`) when showing it to them.

## deleteEvent

Deletes a calendar event the person can manage.

```ts
function deleteEvent(context: BrowserContext, siteUrl: string, eventId: number): Promise<{ changed: string }>;
```

It goes through `core_calendar_delete_calendar_events`, one event (not the rest of a repeating series). It throws `CalendarError` when there's no such event (already deleted, or never existed). Other refusals, such as an event the person isn't allowed to delete, pass as Moodle's `MoodleServiceError` (see [Errors](../concepts/errors.md)). An activity's events (an assignment's due date) belong to the activity: they change with its settings.

## Example

A teacher adds a 45-minute tutorial to course 3, lists the course's upcoming events, and removes it again.

```ts
import { CalendarError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const { event } = await moodle.createEvent({
    courseId: 3,
    name: "Tutorial: recursion",
    start: new Date("2026-11-04T16:00:00Z"),
    durationMinutes: 45,
    description: "<p>Room 3, bring your exercises.</p>",
  });
  console.log(`Created ${event.id} at ${event.start}`);

  for (const upcoming of await moodle.upcomingEvents({ courseId: 3 })) {
    console.log(upcoming.start, upcoming.type, upcoming.name);
  }

  await moodle.deleteEvent(event.id);
} catch (error) {
  if (error instanceof CalendarError) console.log(error.message);
  else throw error;
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `upcomingEvents`: `own` and `course-content` (the person's own events, and the events teachers set in courses).
- `createEvent`, `deleteEvent`: `course-content`.
