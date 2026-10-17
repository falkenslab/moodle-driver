# Question banks: export questions and manage categories

Issue: [#72](https://github.com/falkenslab/moodle-driver/issues/72)

## Goal

A program exports a bank's questions and organises its categories.

## Context

- `src/areas/questions/banks.ts` lists banks and questions (`questionBanks`, `questions`, which gives the categories flat, id and name only), imports GIFT and XML (`importQuestions`), and creates, edits and deletes questions; `updateQuestion` with `categoryId` already moves one question.
- Moodle 5.x, to confirm on the sandbox: `question/bank/exportquestions/export.php?cmid=` (format and category), `question/bank/managecategories/category.php?cmid=` (the tree, adding, editing, moving by drag and drop through its own service), and the bank's bulk "Move to" action (qbank_bulkmove).
- moodle-mcp needs it.

## Changes

- `exportQuestions(activityId, { format: "gift" | "xml", categoryId?, file })`: the bank's or a category's questions to a local file.
- `questionCategories(activityId)`: the tree, each category's id, name, parent, description and question count; whether `questions` gains the parent instead is a choice to settle.
- `addQuestionCategory(activityId, { name, parentId?, description? })`, `editQuestionCategory(activityId, categoryId, { name?, description?, parentId? })` (renaming and moving), `deleteQuestionCategory(activityId, categoryId)` (Moodle asks where its questions go).
- `moveQuestions(activityId, questionIds, categoryId)`, several at once as the bulk action does.
- Errors naming a missing capability (`moodle/question:managecategory`, `moodle/question:moveall`) and a category not in the bank.
- Data category `course-content`; docs in the question banks page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a scratch course's bank: a category added, questions moved into it and exported in GIFT and XML, each file read back by `importQuestions` into another category.
