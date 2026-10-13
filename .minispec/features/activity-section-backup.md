# Back up and restore a single activity or section

Issue: [#57](https://github.com/falkenslab/moodle-driver/issues/57)

## Goal

Back up one activity or one section to a `.mbz` file and restore it into an existing course, so content smaller than a course can move between two Moodle sites.

## Context

- The driver has `backupCourse` (a whole course to `.mbz`), `restoreCourse` (into a new or an existing course, merged or replacing) and `importActivities` (activities between two courses of the same site), in `src/areas/backup/backup.ts`. Nothing backs up less than a course, and `importActivities` can't cross sites.
- moodle-mcp will copy content between sites through backup and restore (falkenslab/moodle-mcp#16).
- Moodle backs up an activity with the course's wizard (`backup/backup.php?id=<course id>&cm=<cmid>`) and a section with `&section=<section id>`; the restore wizard takes an activity or section backup into an existing course, and a section backup into a chosen section.

## Changes

- `backupActivity(activityId, destDir, { timeoutMs })` and `backupSection(sectionId, destDir, { timeoutMs })`: always without users' data, through Moodle's wizard as `backupCourse` does, returning the downloaded file.
- Restoring an activity or section backup into an existing course (an option of `restoreCourse` or a sibling function, whichever reads clearer): an activity into a given section, a section as a new section or into a given one; returns what was created (activity and section ids), as `importActivities` does.
- Errors that name what's missing (`moodle/backup:backupactivity`, `moodle/backup:backupsection`, `moodle/restore:restoreactivity`, `moodle/restore:restoresection`).
- Data categories for the new functions (course content), wiring, the `moodle` command, the backup docs page.
- Settle, and say in the docs: whether one browser context can hold sessions for several sites (and two accounts on one host) or each site needs its own profile, so a program can back up on one site and restore on another.

## Acceptance

- In the sandbox, an activity with a file and a section of course 3 are backed up (read only) and restored into a scratch course, arriving with their settings and files and no users' data.
- Fake-Moodle tests for the wizards' steps.
