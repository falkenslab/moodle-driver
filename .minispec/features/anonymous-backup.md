# Share a backup without saying who made it or where

Issue: [#59](https://github.com/falkenslab/moodle-driver/issues/59)

## Goal

Turn a backup of part of a course into one that names no person and no site, so it can go into a catalog shared between teachers.

## Context

- `backupCourse` with a selection (#57) leaves out people's data, but the `.mbz` still names people and the origin: `files.xml` keeps each file's uploader (`userid`) and `author` (seen: "Profesor Demo"), and `moodle_backup.xml` the original site's URL, its identifier hash and the course's names. Questions in a quiz's or bank's backup keep their creator and modifier ids. Moodle's own "anonymize" setting only applies to backups with users.
- `backupContents` (#58) reads the `.mbz` locally; `src/areas/backup/mbz.ts` has the tar and XML reading.
- The original site's URL matters to the restore: Moodle compares it with the target's to decide how to decode links and file references. What changing it does to a restore has to be checked, not assumed.

## Changes

- `anonymizeBackup(file, destFile)`: no browser, no session; writes a copy of the `.mbz` where every user id is 0 and every author, creator or modifier name empty, in `files.xml`, `questions.xml` and any other of the backup's XML that carries them, and the course's names and the original site replaced by neutral values. Refuses a backup with users' data (that needs Moodle's own anonymization). Leaves the content, settings and files untouched.
- `backupCourse` with a selection (`sections`/`activities`) gives an anonymous backup by default, through the same rewriting (`anonymous: false` keeps the metadata); a whole-course backup stays as Moodle makes it unless `anonymous: true`. If the sandbox shows the neutral site breaks something in a restore, the default is reconsidered and the report says why.
- `backupContents` gains `identifies`: what in the backup still names a person or the site (empty after `anonymizeBackup`), so a catalog can check a file before accepting it.
- Writing the archive back: a minimal tar writer over Node's zlib, next to the reader, no dependency.
- Docs on the backup page (what a catalog-ready backup is); the `moodle` command (`moodle anonymize-backup <file> <dest>`); exported like `backupContents`.

## Acceptance

- In the sandbox, a selection backup of a scratch course (a page with an image, a quiz with questions, a file resource) anonymized, then restored into another scratch course: everything arrives (content, files, questions), and the restored files and questions show no original author; `backupContents` on it gives an empty `identifies`.
- What the neutral original site does to a restore (link decoding, file references) is checked on the sandbox and said in the docs.
- Unit tests on the existing fixtures: anonymized output re-read, nothing identifying left, a backup with users refused.
