# A section's description

Issue: [#32](https://github.com/falkenslab/moodle-driver/issues/32)

## Goal

Read and change a section's description (summary), and set it when the section is added.

## Context

- `addSection` and `editSection` set the name, visibility and position; `courseStructure` gives the title only.
- The summary is edited in `course/editsection.php` (field `summary_editor`); `core_course_edit_section` (open to AJAX) has no action for it.

## Changes

- `editSection(courseId, sectionId, { summary })` and `addSection(…, { summary })`: through `editsection.php`, HTML as given.
- `courseStructure(courseId, { details: true })` gives each section's `summary`.
- Docs in activities and courses; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), a section gets a description, the student's `courseStructure` shows it, and it's changed again.
