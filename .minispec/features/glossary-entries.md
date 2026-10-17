# Glossaries: list, add, edit, delete and approve entries

Issue: [#68](https://github.com/falkenslab/moodle-driver/issues/68)

## Goal

A program reads a glossary's entries and writes them as the person, teacher or student, and a teacher approves them.

## Context

- Nothing reads or writes a glossary's entries: `createActivity` creates a glossary, `activityContent` doesn't list its entries, and `rate` (`src/areas/ratings/ratings.ts`) only rates an entry whose id is already known.
- Moodle's services, to confirm on the sandbox: `mod_glossary_get_entries_by_letter` and `get_entries_by_search`, `mod_glossary_get_categories`, `mod_glossary_add_entry`, `prepare_entry_for_edition`, `update_entry`, `delete_entry`; approving goes through `mod/glossary/approve.php`, exporting and importing through `mod/glossary/export.php` and `import.php`.
- moodle-mcp needs it.

## Changes

- `glossaryEntries(activityId, { letter?, search?, limit?, offset? })`: each entry's id, concept, definition (HTML), aliases, categories, author (user id and name), approved or not, attachments' URLs; paged as `core/paging.ts` says.
- `addGlossaryEntry(activityId, { concept, definition, aliases?, categoryIds?, attachments?, embed? })` (local images embedded as `createActivity` does, attachments as local files), `editGlossaryEntry(activityId, entryId, …)`, `deleteGlossaryEntry(activityId, entryId)`, `setGlossaryEntryApproved(activityId, entryId, approved)`.
- Optional, as the issue says: `glossaryCategories` and `addGlossaryCategory`, and export and import in Moodle's XML to and from a local file; whether they come now is a choice to settle on the sandbox.
- Errors naming a missing capability (`mod/glossary:write`, `mod/glossary:approve`, `mod/glossary:manageentries`) or a glossary that takes no entries from students; `changed` and the entry's id returned.
- Data categories: reading `others-personal` (entries carry their authors); writing `course-content`, and `others-write` for a teacher editing, deleting or approving someone else's entry.
- A new docs page for glossaries (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a glossary needing approval in a scratch course: entries added as the teacher and as the student (the student's pending), read back, one edited, the student's approved, then deleted.
