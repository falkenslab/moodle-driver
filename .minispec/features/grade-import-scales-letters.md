# Gradebook: import grades from CSV, scales and grade letters

Issue: [#75](https://github.com/falkenslab/moodle-driver/issues/75)

## Goal

A teacher imports a CSV of grades and manages the scales and letters a course's grades are shown with.

## Context

- `src/areas/grades/` reads and sets grades one by one (`graderReport`, `setGrade`), sets up items and categories (`gradebookSetup`, `addGradeItem`…) and exports (`exportGrades`), but imports nothing and manages no scales or letters.
- Moodle, to confirm on the sandbox: `grade/import/csv/index.php?id=` (upload, then the mapping form with its preview), `grade/edit/scale/index.php?id=` and `edit.php` (a used scale can't be edited), `grade/edit/letter/index.php?id=<context>&edit=1`.
- moodle-mcp needs it.

## Changes

- `importGrades(courseId, file, { mapFrom, mapTo: "id" | "username" | "email", columns, preview? })`: `columns` maps CSV columns to grade item ids; with `preview` it returns Moodle's preview of what changes without importing, otherwise it confirms.
- `courseScales(courseId)` (id, name, items, used or not; site scales too, marked), `addScale(courseId, { name, items, description? })`, `editScale(courseId, scaleId, …)` for one not used yet.
- `gradeLetters(courseId)` and `setGradeLetters(courseId, letters | null)` (`null` back to the site's defaults).
- Errors naming a missing capability (`moodle/grade:import`, `gradeimport/csv:view`, `moodle/course:managescales`, `moodle/grade:manageletters`), a participant or column not found, a scale in use.
- Data categories: importing `others-write`, its preview `others-personal`; scales and letters `course-content`.
- Docs in the grades and gradebook page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a scratch course: a CSV previewed and imported into a manual grade item, read back with `graderReport`; a scale added; the grade letters changed and put back.
