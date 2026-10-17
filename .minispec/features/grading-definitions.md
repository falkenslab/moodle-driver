# Define an assignment's rubric or marking guide

Issue: [#61](https://github.com/falkenslab/moodle-driver/issues/61)

## Goal

A program sets an assignment's advanced grading method (rubric or marking guide) and its definition, and gets it back as `rubric` reads it.

## Context

- `rubric` (`src/areas/assignments/grading.ts`) reads the definition from a grading panel; nothing writes one: it can only be built by hand in Moodle's advanced grading page (`grade/grading/manage.php`, then the rubric or guide editor form).
- moodle-mcp needs it (falkenslab/moodle-mcp#17).

## Changes

- `setGradingDefinition(activityId, definition)`: `{ method: "rubric", criteria: [{ description, levels: [{ definition, score }] }] }` or `{ method: "guide", criteria: [{ shortName, description, maxScore }], comments?: string[] }`, plus the definition's name and description; sets the assignment's grading method and saves the definition through Moodle's editor form, ready for use.
- Creates one when there is none, replaces it when nothing has been graded with it; when something has, refuses with a `GradingError` that says so, before saving (Moodle would ask to regrade).
- Returns the definition as `rubric` reads it (read from the definition, not from a grading panel, so it creates no submission, see #54).
- Errors that name a missing capability (`moodle/grade:managegradingforms`); data category course content; docs in the grading page (both languages); fake-Moodle tests for each form.

## Acceptance

- In the sandbox, on an assignment of a scratch course: a rubric defined, read back the same, replaced; a marking guide defined and read back; a definition already used for grading refused with nothing changed.
