# Notes about participants

Issue: [#83](https://github.com/falkenslab/moodle-driver/issues/83)

## Goal

A teacher reads and writes Moodle's notes about a course's participants.

## Context

- Nothing reads or writes notes.
- Moodle's services, to confirm on the sandbox: `core_notes_get_course_notes` (site, course and personal notes, for the course or one user), `core_notes_create_notes`, `update_notes`, `delete_notes`; the page is `notes/index.php?course=&user=`. A personal note is seen by its author only; a site note needs the capability at site level.
- moodle-mcp needs it.

## Changes

- `notes(courseId, { userId?, limit?, offset? })`: each note's id, the participant it's about (user id and name), its content, context (`personal`, `course`, `site`), author (user id and name) and dates.
- `addNote(courseId, userId, { content, context })`, `editNote(noteId, { content, context? })`, `deleteNote(noteId)`; `changed` and the note's id returned.
- Errors naming a missing capability (`moodle/notes:view`, `moodle/notes:manage`) and notes disabled on the site.
- Data categories: reading `others-personal`; writing `others-write` (a judgement about someone, as feedback is).
- A new docs page for notes, or a section in the participants page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a course note and a personal note about the student in a scratch course, read, edited and deleted.
