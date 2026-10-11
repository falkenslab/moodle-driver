# Replace or remove the files of a file resource or folder

Issue: [#31](https://github.com/falkenslab/moodle-driver/issues/31)

## Goal

A teacher changes the files of an existing file resource or folder: add, remove or replace them, not only on creation.

## Context

- `createActivity` uploads `files`; `updateActivity` keeps the files there ("files stay as they are"), so a new version of a PDF can't be published without deleting the activity.
- The form's draft area holds the current files: Moodle's `repository/draftfiles_ajax.php` lists (`action=list`) and deletes (`action=delete`) them, and the upload is the one `createActivity` already uses.

## Changes

- `updateActivity(activityId, { files: { add?, remove?, replace? } })`: `add` local paths, `remove` file names, `replace` the whole set; a file with the same name is overwritten.
- `activitySettings` lists the activity's current files (name, size).
- A folder's subfolders by path (`"week1/notes.pdf"`), if the draft area allows it.
- Docs in activities and files; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), a file resource's PDF is replaced by a new one and the student gets the new version with `activityContent`; a folder loses one file and gains another.
