# A database activity's fields, templates and presets

Issue: [#64](https://github.com/falkenslab/moodle-driver/issues/64)

## Goal

A teacher gives a database activity its fields and templates through the driver, so it can hold entries.

## Context

- A database (`data`) can be created with `createActivity`, but nothing reads or writes its fields (`mod/data/field.php`, one form per field type), its templates (`mod/data/templates.php`) or presets (`mod/data/preset.php`).
- moodle-mcp needs it (falkenslab/moodle-mcp#20).

## Changes

- `databaseFields(activityId)`: each field's id, name, type, description, required, and its type's options (menu choices, min/max, sizes…); `databaseTemplates(activityId)`: list, single, add, search, RSS, CSS and JavaScript templates.
- `addDatabaseField(activityId, { type, name, description?, required?, options? })` for each core type (text, textarea, number, date, menu, radiobutton, checkbox, multimenu, url, file, picture, latlong), `editDatabaseField`, `deleteDatabaseField`; `setDatabaseTemplate(activityId, template, html)` and resetting one to Moodle's default.
- `applyDatabasePreset(activityId, preset)` with one of the site's presets, listed by `databasePresets`.
- Errors for an unknown type or an option the type doesn't take; data category course content; a new docs page for databases (both languages); fake-Moodle tests per field type.

## Acceptance

- In the sandbox, in a scratch course: a database given text, menu, date and picture fields and a list template, read back as set; an entry added by the student through Moodle's form shows the fields.
