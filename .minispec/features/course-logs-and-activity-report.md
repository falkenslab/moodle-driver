# Course logs and activity reports

Issue: [#45](https://github.com/falkenslab/moodle-driver/issues/45)

## Goal

A teacher reads who did what in a course: the logs (by user, activity, date, action), the views per activity, and who took part in one.

## Context

- `completionReport` and `participants({ inactiveSince })` give some of it; nothing reads Moodle's logs.
- Moodle's pages: `report/log/index.php` (filters, paginated table, a download), `report/outline/index.php` (views per activity), `report/participation/index.php` (who did what in one activity). No service open to AJAX; what shows depends on site settings and capabilities (`report/log:view`…).

## Changes

- `courseLogs(courseId, { userId?, activityId?, from?, until?, action?, limit? })`: rows with time, user, context, component, event and description.
- `activityReport(courseId)`: per activity, views and last access.
- `participationReport(activityId, { roleId?, since?, action? })`: who viewed or posted, and who didn't.
- Category `others-personal`; docs in a new reports page; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), after a student views an activity, the teacher finds that view in `courseLogs` and the activity's count in `activityReport`.
