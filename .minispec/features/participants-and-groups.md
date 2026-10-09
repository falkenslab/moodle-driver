# Participants and groups

Issue: [#12](https://github.com/falkenslab/moodle-driver/issues/12)

## Goal

`participants` (with an inactivity filter) and `groups`.

## Context

- Teachers' agents read the participants table in 3 sessions, telling roles apart by hand and reading last access.
- The participants page is a dynamic table (`core_table_dynamic_fetch` with `core_user\table\participants`); groups through `core_group_get_course_groups` and their members.
- Personal data: the consumer decides what reaches anyone (moodle-mcp pseudonymizes, its ADR-013). The driver still gives no emails, phones or profile fields: callers don't need them to tell participants apart.

## Changes

- `moodle/participants.ts`: `participants(context, siteUrl, courseId, { role?, group?, inactiveSince? })` → user id, full name, roles, groups and, with `inactiveSince`, whether each has been inactive since then (no access times otherwise); paged.
- `groups(context, siteUrl, courseId)` → groups with their members' user ids.

## Acceptance

- Course 3 lists the teacher and the student with their roles; `inactiveSince` today leaves out whoever just logged in.
