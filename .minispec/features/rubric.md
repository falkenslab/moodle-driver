# Rubric

## Goal

`rubric(context, siteUrl, cmid)`: an assignment's grading method and its rubric or marking guide, with criteria and levels; `gradeSubmission` grading by them.

## Context

- A teacher's agent read a rubric as text (6 criteria, 4 levels) to grade.
- `gradeSubmission` takes a grade today; rubric levels need their ids.
- The definition is on `grade/grading/manage.php` and in the grading panel fragment (`gradingpanel`).

## Changes

- `moodle/grading.ts`: `rubric()` → method (simple, rubric, guide), criteria with levels (id, definition, score).
- `gradeSubmission()`: rubric levels by id, or guide scores, when the method asks for them.

## Acceptance

- With a rubric added to the sandbox assignment, `rubric()` lists it, and `gradeSubmission()` grades by levels with the total Moodle computes.
