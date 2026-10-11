# Copy, back up, restore and import courses

Issue: [#42](https://github.com/falkenslab/moodle-driver/issues/42)

## Goal

A teacher copies a course into a new one, backs a course up to a file, restores a backup, and imports activities from another of their courses.

## Context

- Nothing exists for it; rebuilding a course activity by activity is slow when last year's course is there.
- Open to AJAX: `core_backup_submit_copy_form` (course copy) with `core_backup_get_copy_progress`, and `core_backup_get_async_backup_progress`. Backup, restore and import are page wizards: `backup/backup.php`, `backup/restore.php`, `backup/import.php`, with settings per step, and asynchronous when the site enables it.

## Changes

- `copyCourse(courseId, { fullName, shortName, categoryId?, start?, end?, withUsers? })`: through the copy service; waits for it and returns the new course.
- `backupCourse(courseId, { withUsers?, … }, destDir)`: through the wizard; downloads the `.mbz`.
- `restoreCourse(file, { into: "new" | courseId, categoryId?, … })`.
- `importActivities(fromCourseId, toCourseId, { activityIds? })`: the import wizard.
- Each says what Moodle refused (`moodle/backup:backupcourse`, `moodle/restore:restorecourse`, `moodle/course:create` for a new course).
- Category `course-content` (`others-personal` with users); docs in a new area page; tests against the fake Moodle.

## Acceptance

- In the sandbox, the teacher copies course 3 into a new course and imports one activity from course 3 into it; a backup of course 3 gives an `.mbz` that restores into a new course (as a user who may create courses). Never course 2.
