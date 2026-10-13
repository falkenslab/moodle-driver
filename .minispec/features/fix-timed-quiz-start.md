# startQuizAttempt times out on a quiz with a time limit

Issue: [#56](https://github.com/falkenslab/moodle-driver/issues/56)

## Problem

In the sandbox (Moodle 5.2), course 3, quiz 27 (time limit 20 min, 5 attempts allowed, two finished), as the student: `startQuizAttempt` fails after 60 s with `page.waitForNavigation: Timeout 60000ms exceeded`, while `quizInfo` says `canStart: true`. Seen from moodle-mcp on 12 October 2026.

## Cause

`startQuizAttempt` (`src/areas/quizzes/attempts.ts`, line ~219) clicks the start button inside `Promise.all([page.waitForNavigation(…), start.click()])`. With JavaScript on, a quiz with a time limit (or a password) doesn't navigate: `view.php` opens the preflight form (`#mod_quiz_preflight_form`) in a modal dialog on the same page, so the wait times out before the code that handles the preflight form runs; that code only works when the form is a page of its own. To confirm on the sandbox.

## Solution

Click the start button, then wait for whichever comes first: a navigation to the attempt, or the preflight form (in the modal or as a page). In the preflight form, refuse a password as now, otherwise press its submit button and wait for the attempt page. The password error says what the driver doesn't do in the driver's terms (it says "this server" today, ADR-006). Fake-Moodle test: a timed quiz whose start opens the modal.

## Verification

- The fake-Moodle test above and the quizzes area's tests.
- In the sandbox, `test/sandbox/quizzes.sandbox.ts` gains a check on a scratch quiz with a time limit: the student starts an attempt (`startQuizAttempt` returns it) and finishes it.
