# Offline Quiz and Questionnaire: add their questions

Issue: [#107](https://github.com/falkenslab/moodle-driver/issues/107)

## Goal

A program can put questions into an Offline Quiz (mod_offlinequiz) and a Questionnaire (mod_questionnaire), and read them.

## Context

- Both can be created, but go up empty: `addQuestionsToQuiz` works on mod_quiz only, and Questionnaire has its own question types and pages.
- The driver already answers questionnaires and reads their responses (`src/areas/surveys/`).
- moodle-sandbox's image has both plugins. Asked from moodle-mcp (falkenslab/moodle-mcp#65).

## Changes

- Offline Quiz: add bank questions to a form group (as `addQuestionsToQuiz` does for a quiz), read its groups and their questions, and create the forms.
- Questionnaire: add questions of its types (text, essay, radio, check, dropdown, rate, yes/no, numeric) with their choices, in order and by page; read them; refuse changes once there are responses, as Moodle does.
- Can be split in two when implementing, one per plugin.
- Doc comments, the quizzes and surveys pages in both languages, `npm run cli:generate`.

## Acceptance

- On the sandbox, questions added to each are read back in order, with their choices and pages.
- A Questionnaire with responses refuses a change.
- Tests in Docker against fakes of both plugins.
