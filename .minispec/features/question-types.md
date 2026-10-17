# Question banks: create every question type

Issue: [#85](https://github.com/falkenslab/moodle-driver/issues/85)

## Goal

`createQuestion` and `updateQuestion` make and change a question of any type the bank's "Add a question" dialog offers, not only five.

## Context

- `src/areas/questions/banks.ts`: `QUESTION_TYPES` is `multichoice`, `truefalse`, `shortanswer`, `numerical`, `essay`; any other type is refused with a pointer to `importQuestions` (GIFT, Moodle XML). `QuestionInput` only knows `answers` (text, fraction, feedback, tolerance) and `correct`; `fields` reaches any other form field by name.
- `updateQuestion` changes `answers` only for multichoice, short answer and numerical.
- Reading already covers every type: the bank, a quiz's structure and manual grading take it from the `qtype_*` icon or class.
- A teacher's Moodle offers, besides the five: calculated, calculated simple, calculated multichoice, matching, random short-answer matching, drag and drop into text, onto image and markers, select missing words, embedded answers (Cloze), ordering, description; and plugins: CodeRunner, Formulas, Gap fill, drag and drop matching.
- Not every form is one page: calculated types go through a dataset wizard (wildcards, then values); drag and drop onto an image needs a background image uploaded to the form; Cloze takes its answers inside the text.

## Changes

- `QUESTION_TYPES` with the core types: `calculated`, `calculatedsimple`, `calculatedmulti`, `match`, `randomsamatch`, `ddwtos`, `ddimageortext`, `ddmarker`, `gapselect`, `multianswer`, `ordering`, `description`.
- Plugin types `coderunner`, `formulas`, `gapfill`, `ddmatch`: created when the site has them; when it doesn't, a `QuestionBankError` naming the missing plugin.
- `QuestionInput` grows per-type inputs, each confirmed against its form on the sandbox: pairs (matching types), choices and groups (gap and drag and drop types), drop zones and an image file (`ddimageortext`, `ddmarker`), items in order (`ordering`), wildcards with values or ranges (calculated types), the test cases and language of a CodeRunner, the parts of a Formulas question. Whatever isn't modelled still goes through `fields`.
- Validation before opening the form: each type's required inputs, as today for answers and `correct`.
- `updateQuestion` changes the same inputs on the types that have them.
- Data category `course-content`; docs in the question banks page (both languages, ADR-015); `npm run cli:generate`; fake-Moodle tests per type.

## Acceptance

- In the sandbox, a scratch course's bank gets one question of each core type through `createQuestion`, each previews without error, and `updateQuestion` changes one per family (matching, gaps, drag and drop, calculated, Cloze, ordering).
- On a site with CodeRunner and Formulas, one of each is created and runs its checks; on one without them, the error names the plugin.
- A type outside the list is still refused, pointing to `importQuestions`.
