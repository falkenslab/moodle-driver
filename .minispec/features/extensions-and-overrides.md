# Extensions and overrides

## Goal

`grantExtension` for assignments and `setQuizOverride` for quizzes: dates for some people.

## Context

- No run needed them yet; common teacher requests.
- Assignment: the form at `mod/assign/view.php?action=grantextension`; quiz: AJAX `mod_quiz_save_overrides` (5.x), availability to confirm.

## Changes

- `moodle/grading.ts`: `grantExtension(context, siteUrl, cmid, userIds, until)`.
- `moodle/quiz.ts`: `setQuizOverride(context, siteUrl, quizId, userId, { open?, close?, timeLimitMinutes?, attempts? })`.
- `assignmentSubmissions()` already reports `extensionGranted`; add the extension's date when there is one.

## Acceptance

- The student in course 3 gets an extension, and their `studentAssignment()` shows the new date.
- A quiz override shows in the student's `quizInfo()`.
