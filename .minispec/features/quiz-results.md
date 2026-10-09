# Quiz results

## Goal

`quizResults(context, siteUrl, quizId, { responses? })`: a quiz's attempts with grades and per-question marks.

## Context

- A teacher's agent read the quiz overview report.
- `mod/quiz/report.php?mode=overview` is a dynamic table; `mode=responses` gives the answers.

## Changes

- `moodle/quiz.ts` (or `quizResults.ts`): per attempt the user (id, full name), state, dates, grade and marks per slot; the answers too with `responses`. Paged.
- Pseudonymizing people is the consumer's job.

## Acceptance

- After a student attempt in course 3, the teacher sees it with the grade `readReview()` gives.
