# Quiz statistics: the analysis of each question

Issue: [#78](https://github.com/falkenslab/moodle-driver/issues/78)

## Goal

A teacher reads Moodle's statistics report of a quiz: which questions work and which don't.

## Context

- `src/areas/quizzes/results.ts` reads the overview and responses reports (`quizResults`), each attempt by name; nothing reads the statistics report.
- Moodle, to confirm on the sandbox: `mod/quiz/report.php?id=&mode=statistics&whichattempts=` (no service), which may first need its calculation run ("Recalculate now", or a scheduled task on large quizzes), its per-question detail pages and its downloads.
- moodle-mcp needs it.

## Changes

- `quizStatistics(activityId, { attempts?: "first" | "all" | "highest", recalculate? })`: the quiz's figures (attempts, average, median, standard deviation, skewness, kurtosis, Cronbach's alpha, error ratio, standard error, as the report shows them) and per question (and per variant of a random question) its facility index, standard deviation, discrimination index and efficiency, and per response how often it was given.
- When the report needs its calculation, `recalculate` runs it; without it an error says so; whether to always run it is a choice to settle on the sandbox.
- Errors naming a missing capability (`quiz/statistics:view`) and a quiz without attempts.
- Data categories: `course-content` and `others-aggregate` (no one is named).
- Docs in the quizzes page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a quiz with attempts (course 3's, read only, if it has some; otherwise one in a scratch course): the statistics read for all and first attempts and checked against the report.
