# Export a course's grades

Issue: [#38](https://github.com/falkenslab/moodle-driver/issues/38)

## Goal

Download a course's grades as Moodle exports them (spreadsheet, text or XML).

## Context

- `graderReport` gives the grades as data; a teacher often needs Moodle's own export file (for a secretariat, a spreadsheet).
- Moodle exports from `grade/export/<plugin>/index.php` (`xls`, `ods`, `txt`, `xml`): a form choosing items, group, display types and feedback, then a download.

## Changes

- `exportGrades(courseId, { format: "xlsx" | "ods" | "csv" | "xml", itemIds?, groupId?, display?, feedback? }, destDir)`: the file Moodle gives, saved as `downloadFile` saves (path, name, size).
- A format whose export plugin is disabled on the site is refused, naming the ones available.
- Category `others-personal`; docs in grades and gradebook; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher exports the grades as CSV, and the file holds every student and item `graderReport` gives.
