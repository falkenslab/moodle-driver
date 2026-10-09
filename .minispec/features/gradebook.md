# Gradebook

Issue: [#8](https://github.com/falkenslab/moodle-driver/issues/8)

## Goal

Read the grader report and the gradebook setup; change items and add categories.

## Context

- Teachers' agents read the grader report in 3 sessions; weights were planned by script and set by hand.
- `grade/report/grader/index.php` is a page; `core_grades_get_grade_tree` (AJAX) gives the setup; items are edited through gradebook forms, categories through `core_form_dynamic_form`.

## Changes

- `moodle/gradebook.ts`: `graderReport(context, siteUrl, courseId)` (items by participants, paged) and `gradebookSetup(context, siteUrl, courseId)` (categories, items, weights, aggregation); `updateGradeItem(…, itemId, { category?, weight?, maxGrade? })` and `addGradeCategory(…, { name, aggregation?, parentId? })`.
- People as user id and full name; pseudonymizing is the consumer's job.

## Acceptance

- In course 3, a new category takes the assignment with a weight; `gradebookSetup()` and the student's `myGrades()` reflect it.
