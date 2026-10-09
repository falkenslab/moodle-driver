# Update course

## Goal

`updateCourse(context, siteUrl, courseId, { fullName?, shortName?, summary?, settings? })`: a course's names, summary and other settings.

## Context

- A teacher's agent renamed a course after approval.
- `course/edit.php?id=` is a form; `openForm`, `setFields` and `submitForm` already handle such forms.

## Changes

- `moodle/courses.ts`: `updateCourse()`, other settings by form field name; returns the course as `listCourses()` gives it.

## Acceptance

- Course 3's summary changes, and `listCourses()` shows a new name.
- A duplicate short name returns Moodle's form error.
