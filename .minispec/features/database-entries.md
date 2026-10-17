# A database activity's entries: list, add, edit, approve and export

Issue: [#69](https://github.com/falkenslab/moodle-driver/issues/69)

## Goal

A program fills, reviews and moderates a database activity's entries, and moves them in and out as CSV.

## Context

- 0.9 defines a database's fields, templates and presets (`src/areas/databases/fields.ts`, `templates.ts`), and `rate` rates a record by id, but nothing reads or writes the entries.
- Moodle's services, to confirm on the sandbox: `mod_data_get_entries`, `mod_data_search_entries`, `mod_data_add_entry`, `update_entry`, `delete_entry`, `approve_entry`; exporting through `mod/data/export.php`, importing through `mod/data/import.php`.
- moodle-mcp needs it.

## Changes

- `databaseEntries(activityId, { search?, limit?, offset? })`: each entry's id, author (user id and name), created and modified dates, approved or not, and each field's value by field id and name (files and pictures as URLs).
- `addDatabaseEntry(activityId, values)` with a value per field id or name (local files for file and picture fields, through draft areas), `editDatabaseEntry(activityId, entryId, values)`, `deleteDatabaseEntry(activityId, entryId)`, `setDatabaseEntryApproved(activityId, entryId, approved)`.
- `exportDatabaseEntries(activityId, file)` (CSV to a local file) and `importDatabaseEntries(activityId, file)` (CSV).
- Errors naming a missing capability (`mod/data:writeentry`, `mod/data:approve`, `mod/data:manageentries`, `mod/data:exportallentries`) and a value a field doesn't take; `changed` and the entry's id returned.
- Data categories: reading and exporting `others-personal`; writing `course-content`, and `others-write` when editing, deleting or approving someone else's entry.
- Docs in the databases page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a database needing approval in a scratch course, with text, menu, date and picture fields: entries added by the teacher and the student, read, edited, approved, exported to CSV and deleted.
