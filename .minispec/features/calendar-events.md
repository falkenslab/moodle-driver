# Calendar events

## Goal

`createEvent` and `deleteEvent`: course calendar events.

## Context

- No run needed it yet; activities' due dates appear in the calendar without it.
- AJAX: `core_calendar_submit_create_update_form` (the form's data), `core_calendar_delete_calendar_events`.

## Changes

- `moodle/calendar.ts`: `createEvent(context, siteUrl, { courseId, name, start, durationMinutes?, description? })` returning the event's id; `deleteEvent(context, siteUrl, eventId)`.
- `deadlines()` already lists action events; plain course events need `core_calendar_get_calendar_upcoming_view` or similar to read back (to confirm).

## Acceptance

- An event created in course 3 is visible to the student in the calendar's upcoming view, and gone after `deleteEvent`.
