# Quiz attempt functions load pages they don't need

Issue: [#100](https://github.com/falkenslab/moodle-driver/issues/100)

## Problem

Starting, answering and finishing a quiz attempt loads more pages of the attempt than the call needs, each logged as `attempt_viewed`: `startQuizAttempt` 6 views of a 5-page attempt, every `answerQuizQuestions` 4 to 6 more, `finishQuizAttempt` the 5 pages again (moodle-sandbox, Moodle 5.2, reported from padawan's runs).

## Cause

All in `src/areas/quizzes/attempts.ts`:

- `saveAnswers` opens page 0 only to read the navigation, then goes to each page it answers, page 0 again among them.
- `answerQuizQuestions` reads the whole attempt again after saving (`readAttempt`, every page), though only the pages it answered changed.
- `finishQuizAttempt` and `startQuizAttempt` are to be checked for the same: which of their loads the result needs.

## Solution

Open only the pages a call needs. Read the navigation from the first page the call needs anyway; don't load a page twice in one call. After saving answers, give the questions of the pages answered, read where the call already is; whether `answerQuizQuestions` keeps giving every question (and how, without reading every page) is decided when implementing, as it changes what the call returns.

With the `realistic` trail (ADR-005), the default, the page changes a call can't avoid are spaced out like a person reading the page before moving on (`pace.ts`); with `fast`, they aren't.

## Verification

Tests in Docker against the fake Moodle that count the attempt pages served per call. On the sandbox, the course log of one start, one answer and one finish shows no page viewed that the call didn't need, and with the realistic trail no two attempt pages viewed within a second.
