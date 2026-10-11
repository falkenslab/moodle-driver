# Edit and delete questions in a question bank

Issue: [#35](https://github.com/falkenslab/moodle-driver/issues/35)

## Goal

A teacher edits an existing question (text, answers, marks) and deletes or hides questions in a bank.

## Context

- `questionBanks`, `questions`, `importQuestions` and `createQuestion` exist; a question can't be changed or removed.
- Moodle edits through `question/bank/editquestion/question.php?id=…` (each type's form; saving makes a new version) and deletes through `question/bank/deletequestion/delete.php` (a question in use is hidden instead); `qbank_editquestion_set_status` (open to AJAX) sets it ready or draft.

## Changes

- `updateQuestion(questionId, { name?, text?, …, settings? })`: the same inputs as `createQuestion`, only what's given; returns the new version's id.
- `deleteQuestions(questionIds)`: `changed` says which were deleted and which hidden because they're in use.
- `setQuestionStatus(questionId, "ready" | "draft")`.
- Category `course-content`; docs in question banks; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), a multiple choice question is edited and `questions` shows the new text and version; a question used in a quiz is hidden, an unused one deleted.
