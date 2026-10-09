# Question bank

## Goal

List banks and questions, import GIFT or Moodle XML, and create a single question.

## Context

- A teacher's agent left a quiz empty after failing the question type chooser; GIFT was researched.
- Moodle 5 keeps banks as module instances (`question/banks.php`); questions list through a `core_question` fragment; import is a form with an upload (`question/bank/importquestions/import.php`).

## Changes

- `moodle/questionBank.ts`: `questionBanks(context, siteUrl, courseId)`, `questions(context, siteUrl, bankCmid)`; `importQuestions(context, siteUrl, bankCmid, { format: "gift" | "xml", file? | text? })` returning the questions created; `createQuestion(context, siteUrl, bankCmid, { type, name, text, answers })` through the edit form.
- Import is the main path; `createQuestion` is for one-offs.

## Acceptance

- A GIFT file with multichoice, true/false and short answer questions imports into course 3's bank, and `questions()` lists them.
- A malformed file returns Moodle's parse errors.
