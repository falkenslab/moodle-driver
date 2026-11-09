# A browser lost mid-call is reported as something else

Issue: [#97](https://github.com/falkenslab/moodle-driver/issues/97)

## Problem

From falkenslab/moodle-mcp#57: when headless Edge crashes during a call, `importQuestions` says "Activity N has no question bank you can import into", even for a quiz that had just imported questions. Other calls fail with Playwright's `Target page, context or browser has been closed`, which has no `MoodleError` code a program can act on.

## Cause

`importQuestions`, `exportQuestions`, `createQuestion` and `updateQuestion` (`src/areas/questions/banks.ts`) wrap every failure of `openForm` except `NotLoggedInError` in `QuestionBankError`, and other `.catch` of that shape may do the same. Nothing turns Playwright's closed-target error into a driver error.

## Solution

A `BrowserLostError` (`MoodleError`, code `browser-lost`) for a browser, context or page closed during a call, raised where Playwright's error is recognized. The catch-alls of that shape let it through, across `src/areas/`. Exported and documented like the other error classes. Recovering from it is a separate feature (`browser-lost-recovery`).

## Verification

Tests in Docker that close the browser during a call: the function fails with code `browser-lost`, `importQuestions` among them; a bank that really can't be opened still gives `QuestionBankError`.
