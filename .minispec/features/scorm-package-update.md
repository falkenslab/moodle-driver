# Replace a SCORM activity's package

Issue: [#67](https://github.com/falkenslab/moodle-driver/issues/67)

## Goal

A corrected SCORM package replaces the old one in the same activity, keeping its id, attempts settings, grade item and links.

## Context

- `createActivity` uploads a SCORM package; `updateActivity` (`src/areas/activities/build.ts`) changes only a file resource's or a folder's files (`FileChanges`), so a new package means a new activity.
- moodle-mcp needs it (falkenslab/moodle-mcp#23).

## Changes

- `updateActivity` takes a SCORM's new package (`package`: a local `.zip`), uploaded into the settings form's package field as `createActivity` does, replacing the current one in place.
- What Moodle does with the existing attempts and tracks (kept or not, by the activity's settings) stated in the docs, after checking it on the sandbox; the result is the activity as `scorm` reads it.
- Moodle's error for an invalid package passed on as an `ActivitySettingsError`; docs in the SCORM and activities pages (both languages); fake-Moodle test.

## Acceptance

- In the sandbox, a SCORM in a scratch course given a new package: `scorm` reads the new content, the activity's id and grade item stay; an invalid zip refused with nothing changed.
