# Reset a course for a new year

Issue: [#43](https://github.com/falkenslab/moodle-driver/issues/43)

## Goal

Empty a course of its students' data (submissions, attempts, posts, grades, enrolments) while keeping its content, as Moodle's reset does.

## Context

- Nothing exists for it; reusing a course means Moodle's `course/reset.php` form: what to delete per module, which roles to unenrol, a new start date.
- It's destructive and can't be undone: the input has to be explicit, and the result the summary Moodle shows after resetting.

## Changes

- `resetCourse(courseId, { unenrolRoles?, start?, delete: { submissions?, attempts?, posts?, grades?, events?, groups?, completion?, … } })`: only what's named; nothing by default.
- Returns `changed` and Moodle's report (per component, what was done, and errors).
- Categories `course-content` and `others-write`; docs in courses, saying it can't be undone; tests against the fake Moodle.

## Acceptance

- In the sandbox, on a copy of course 3 (never course 3 or course 2 themselves), resetting submissions, attempts and students' enrolments keeps the activities and empties `assignmentSubmissions`, `quizResults` and the students in `participants`.
