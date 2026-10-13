# Back up part of a course and restore it anywhere in another

Issue: [#57](https://github.com/falkenslab/moodle-driver/issues/57)

## Goal

Back up any part of a course (whole sections, single activities or resources, or any mix of them) to a `.mbz` file, and restore it into an existing course, on the same site or another, at the place the caller asks for.

## Context

- The driver has `backupCourse` (a whole course to `.mbz`), `restoreCourse` (into a new or an existing course, merged or replacing) and `importActivities` (activities between two courses of the same site), in `src/areas/backup/backup.ts`. Nothing backs up less than a course, and `importActivities` can't cross sites.
- moodle-mcp will copy content between sites through backup and restore (falkenslab/moodle-mcp#16).
- Moodle's course backup wizard has a schema stage with a checkbox per section (`setting_section_section_<id>_included`) and per course module (`setting_activity_<module>_<cmid>_included`); `importActivities` already fills that stage. Activities and resources (page, file, URL, label…) are all course modules to Moodle.
- Restoring into an existing course, Moodle puts each section's content into the target's section with the same number (creating it if missing), and each module into the section with its original number, after what's there; the wizard can't choose a place. To confirm on the sandbox (`backup/moodle2/restore_stepslib.php`) before coding.
- The driver can move things afterwards: `editActivity` (`sectionId`, `beforeActivityId`), `editSection` (`afterSectionId`), `addSection`.

## Changes

- `backupCourse(courseId, destDir, { sections?, activities?, … })`: with `sections` (section ids) and/or `activities` (course module ids), only those are ticked in the schema stage (a section's own modules with it); without them, the whole course as now. Always without users' data when a selection is given.
- `restoreCourse` into an existing course returns what it created (new section and module ids, found by comparing the course's structure before and after), and takes where to put it: `sectionId` (every restored module into that section, after what's there) or `afterSectionId` (the restored sections, as new sections, after that one). Without them, where Moodle puts it. The driver restores, then moves what was created; a restored section that Moodle merged into an existing one with content is split out into a new section with `addSection` and moves.
- Errors that name what's missing (`moodle/backup:backupcourse` with a selection, `moodle/restore:restorecourse`, a section or activity id not in the course).
- Before the restore wizard, the driver checks the backup against the site, from its `moodle_backup.xml`: a backup from a newer Moodle than the site's, or with a module type the site doesn't have (e.g. `questionnaire`), is refused with an error naming the version or the missing plugins, instead of failing half-way in the wizard.
- A selection backup carries no personal data: no users, logs, grades, submissions, comments or badges' awards (the wizard's settings for them off, checked rather than assumed), and the docs say what's left (the backup's own creator in its metadata, if Moodle writes it).
- Docs on the backup page (what a selection backs up, how placement works and its cost: one move per restored item), the `moodle` command (`cli:generate`), data categories unchanged (course content).
- Settle, and say in the docs: whether one browser context can hold sessions for several sites (and two accounts on one host) or each site needs its own profile, so a program can back up on one site and restore on another.

## Acceptance

- In the sandbox, a mix of course 3's content (one whole section, plus a page and an activity with a file from other sections) is backed up (course 3 only read) and restored into a scratch course with content: into a given section, and as new sections after a given one; everything arrives with its settings and files, no users' data, in the place asked, and the returned ids are the new items.
- The restored `.mbz`, unpacked, holds no user of course 3 (no `users.xml` entries, no submissions, logs or grades); restoring a backup that names a module type the site lacks, or a newer Moodle version (fake-Moodle test with an edited `moodle_backup.xml`), is refused before the wizard.
- `backupCourse` without a selection and `restoreCourse` without a place behave as before (the existing sandbox checks pass).
- Fake-Moodle tests for the schema stage's selection and for the placement moves.
