# Quiz structure

Issue: [#15](https://github.com/falkenslab/moodle-driver/issues/15)

## Goal

`quizStructure` and `addQuestionsToQuiz`: what a quiz holds, and filling it from the bank.

## Context

- 13 quiz editor loads in teachers' runs; one quiz stayed empty.
- `mod/quiz/edit.php` holds slots and pages; Moodle 5's `quiz_add_quiz_question` needs the page (seen while seeding the sandbox); random questions through `mod_quiz_add_random_questions`.
- Takes question ids from `question-bank.md`.

## Changes

- `moodle/quiz.ts` (or `quizStructure.ts`): `quizStructure(context, siteUrl, quizId)` (slots: number, page, question id, type, name, mark); `addQuestionsToQuiz(context, siteUrl, quizId, { questionIds?, random?: { categoryId, count }, page? })`.

## Acceptance

- Questions imported into course 3's bank are added to its quiz, and a student attempt shows them.
