# Completion

Issue: [#5](https://github.com/falkenslab/moodle-driver/issues/5)

## Goal

Manual completion for students; overrides and the progress report for teachers.

## Context

- `courseStructure()` already gives the person's completion state; nothing changes it.
- Teachers' agents used the progress report for monitoring.
- AJAX: `core_completion_update_activity_completion_status_manually`, `core_completion_override_activity_completion_status`; the report is a page (`report/progress/index.php`).

## Changes

- `moodle/completion.ts`: `setCompletion(context, siteUrl, cmid, done)` (manual completion only; idempotent); `overrideCompletion(context, siteUrl, cmid, userId, state)` (teachers); `completionReport(context, siteUrl, courseId)` (participants by activities with their state, paged).
- People in the report as user id and full name: pseudonymizing them is the consumer's job.

## Acceptance

- As a student, marking a manual-completion page done shows in `courseStructure()`.
- An activity with automatic completion gives a clear error.
- As a teacher, the report of course 3 shows the student's row, and an override changes it.
