# Activity settings

## Goal

`activitySettings(context, siteUrl, cmid)`: one activity's settings as its form holds them, so a program can edit from what's there with `updateActivity`.

## Context

- Teachers' agents started 16 edits from `modedit.php?update=` in real runs; `updateActivity` already writes any field by its form name.
- It also answers "an assignment's settings" (dates, submission types, max grade).

## Changes

- `moodle/activities.ts`: `activitySettings()` reads `course/modedit.php?update=<cmid>` without submitting: name, module, description and every form field (name, label, value, options for selects and radios, checked for checkboxes), editors' text included.
- Teachers only: a page without the form gives a clear error.

## Acceptance

- For the sandbox assignment, it gives the due date, submission types and max grade; one field fed back to `updateActivity` changes only that.
- As a student, a clear error.
