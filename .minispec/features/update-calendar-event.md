# Change a calendar event

Issue: [#36](https://github.com/falkenslab/moodle-driver/issues/36)

## Goal

Change an event's name, description, date, duration or repetition, not only create and delete it.

## Context

- `createEvent`, `deleteEvent` and `upcomingEvents` exist.
- `core_calendar_submit_create_update_form` (open to AJAX) takes the event's id to update it, and `core_calendar_get_calendar_event_by_id` reads one.

## Changes

- `updateEvent(eventId, { name?, description?, start?, durationMinutes?, until?, location? })`: through the same form service as `createEvent`, only what's given.
- `calendarEvent(eventId)`: one event, in `upcomingEvents`' shape.
- A repeated event: this one or the whole series (Moodle's option).
- Docs in the calendar area; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher moves a course event to another day and renames it; `upcomingEvents` shows it.
