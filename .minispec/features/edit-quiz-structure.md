# Remove, reorder and paginate a quiz's questions

Issue: [#34](https://github.com/falkenslab/moodle-driver/issues/34)

## Goal

A teacher removes questions from a quiz, moves them, sets its pages and sections, and changes a slot's maximum mark.

## Context

- `quizStructure` reads the slots and `addQuestionsToQuiz` adds; nothing else changes a quiz's structure.
- Moodle's edit page uses `mod/quiz/edit_rest.php` (`class=resource`, `field=move|delete|updatemaxmark|updatepagebreak`), and `mod_quiz_update_slots` (open to AJAX) for some of it.

## Changes

- `editQuizSlot(activityId, slot, { maxMark?, moveAfter?, page? })` and `removeQuizSlot(activityId, slot)`.
- `setQuizPages(activityId, { perPage } | { breaksAfter })`: repaginate, or page breaks after the given slots.
- `addQuizSection(activityId, { firstSlot, heading, shuffle? })`.
- Refused with Moodle's reason once the quiz has attempts (Moodle's own rule).
- Docs in the quizzes area; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3, a quiz without attempts), a question is removed, another moved first, its mark changed, and the quiz split in two pages; `quizStructure` shows it.
