# Know what a backup holds and what it leaves behind

Issue: [#58](https://github.com/falkenslab/moodle-driver/issues/58)

## Goal

Read what a `.mbz` file holds without restoring it, and know which of its pieces depend on things left out of it, so backups can be catalogued and shared between teachers and restored without surprises.

## Context

- Backups of part of a course (feature `activity-section-backup`, #57) are meant to feed a catalog of activities shared between teachers: files kept, searched and restored weeks later, in another teacher's course, maybe on another site.
- Every `.mbz` (a gzipped tar) has a `moodle_backup.xml`: backup type, Moodle version and release, the original site and course, the sections and activities (module type, title, cmid, section), and the settings used (users, logs…). Each activity's folder has its own XML (`module.xml` with its availability and completion, `inforef.xml` with what it references, `grades.xml`).
- A piece taken out of its course can lose what it pointed to: access restrictions and completion conditions on activities not in the backup, a gradebook category, links in its text to other activities (`view.php?id=…`, `@@PLUGINFILE@@` is fine). A quiz's questions travel with it, and restoring puts them in a new bank of the target course. Moodle restores silently and leaves broken conditions marked as such.

## Changes

- `backupContents(file)`: reads the `.mbz` locally (no browser, no session), returns its type, Moodle version, original site and course, the sections and activities it holds (type, title, original ids, section), the plugins it needs, and whether it has users' data; it fails clearly on a file that isn't a Moodle backup.
- In the same result, `dependencies`: per activity, what it refers to outside the backup (restrictions, completion conditions, links to other activities in its text, its grade category), read from its XML.
- Restoring into an existing course (`restoreCourse`) returns `warnings`: what was left broken (conditions on activities not restored, links to ids that don't exist on the target), read from the restored course's structure, so a program can tell a teacher what to fix.
- Exported from the main entry point (it opens no browser); data category: course content. Docs on the backup page; the `moodle` command (`moodle backup-contents <file>`).

## Acceptance

- In the sandbox, a selection backup of course 3 (an activity with a restriction on another one left out, and one whose text links to another) is read with `backupContents`: the activities, the version, the plugins and the dependencies are listed; restored into a scratch course, `warnings` names the broken condition and link.
- Unit tests on `.mbz` fixtures (a course, a section and an activity backup; a file that isn't one), with no Moodle at all.
