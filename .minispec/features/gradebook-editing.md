# Grade in the gradebook and edit its structure

Issue: [#37](https://github.com/falkenslab/moodle-driver/issues/37)

## Goal

A teacher sets or overrides a student's grade in the gradebook, adds manual grade items, and edits or deletes grade categories and items.

## Context

- `graderReport` and `gradebookSetup` read; `updateGradeItem` and `addGradeCategory` change items and add categories. A grade is only given through its activity (`gradeSubmission`); a manual item can't be graded at all.
- Moodle grades in the gradebook through the single view report (`grade/report/singleview/index.php`, a form per item or per user, with override and exclude) or the grader report's editing mode. Categories and items are edited in `grade/edit/tree/category.php` and `item.php`, and deleted through `grade/edit/tree/index.php?action=delete`.

## Changes

- `setGrade(courseId, itemId, userId, { grade?, feedback?, override?, excluded? })`: through single view; a manual item takes a grade, an activity's item is overridden.
- `addGradeItem(courseId, { name, max, categoryId?, … })` (a manual item), `updateGradeCategory`, `deleteGradeCategory`, `deleteGradeItem` (manual items only).
- Categories `others-personal`, `others-write` and `course-content`; docs in grades and gradebook; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher adds a manual item "Participation", grades two students in it, overrides an activity's grade, and `graderReport` shows all of it.
