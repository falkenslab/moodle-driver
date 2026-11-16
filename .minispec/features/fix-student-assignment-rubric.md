# A student's assignment gives each rubric criterion with only its first level

Issue: [#112](https://github.com/falkenslab/moodle-driver/issues/112)

## Problem

`studentAssignment` gives an assignment's rubric ("Grading criteria") as loose `status` rows: each criterion as a row with its name, and a row with only its first level ("No lo comprueba\n0 points"). The other levels and their points are lost, so a program working for the student can't tell which level the work reaches nor add up the rubric's points. Seen in padawan's run (Moodle 5.2, an assignment with a rubric of 4 criteria of 2 or 3 levels).

## Cause

`readStudentAssignment` (`src/areas/assignments/student.ts`) reads every `.submissionstatustable tr` as `{ label: th, value: first td }`. Moodle draws the rubric nested inside that table: a row per criterion with a cell per level, so the rubric's own rows are read as status rows, and only their first cell.

## Solution

- Leave the rubric's (and a marking guide's) nested rows out of `status`: only the status table's own rows.
- Read the grading form apart, in the shape `rubric()` gives a teacher (`GradingDefinition`): the method, and the criteria with their levels (definition and points) or a guide's maximum, plus the level chosen or the mark given once graded, with its remark.

## Verification

Tests against the fake Moodle with a rubric and a guide, before and after grading. On the sandbox, in a test course (never course 2): an assignment with a rubric, read by the student before grading (every level with its points) and after the teacher grades with it (the chosen levels).
