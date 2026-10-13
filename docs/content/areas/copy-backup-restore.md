# Copy, backup and restore

Reusing a course: copying it into a new one, backing it up (or part of it) to a `.mbz` file, reading what a backup file holds, restoring a backup into a new course or an existing one, and importing activities from another course. Each needs Moodle's rights for it, which a site gives teachers only in part: on a default site an editing teacher can back up and import, and restore into their own courses, but not create courses, so copying and restoring into a new course take a manager, a course creator or an administrator. When Moodle refuses, the `BackupError` says which right it asks for, with Moodle's own message.

**Terms:** [backup](../reference/glossary.md#backup), [course module id](../reference/glossary.md#course-module-id), [section](../reference/glossary.md#section).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Copying goes through Moodle's copy service (`core_backup_submit_copy_form`), with the copy form's own fields; backing up, restoring and importing through their page wizards, stage by stage, as a person would. Moodle makes copies, and backups and restores when the site makes them asynchronous (its "asynchronous backups" setting), in its scheduled tasks (cron): the driver waits for them, asking Moodle's progress services, up to `timeoutMs` (ten minutes unless given). A site whose cron doesn't run never finishes them: the `BackupError` after the wait says so, and Moodle goes on when cron runs. Every function but `backupContents`, which reads a file on this computer, throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

A backup is a local file, so it can be restored on another site: back up with one `Moodle` object and restore with another, each on its site, both in one browser if wished (see [Several sites, several accounts](../concepts/browser.md#several-sites-several-accounts)).

```ts
interface CourseRef {
  id: number;
  fullName: string;
  shortName: string;
  categoryId?: number;
  url: string;
}
```

## copyCourse

Copies a course into a new one, as Moodle's "Copy course".

```ts
function copyCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { fullName: string; shortName: string; categoryId?: number; start?: Date; end?: Date; withUsers?: boolean; visible?: boolean; timeoutMs?: number },
): Promise<{ changed: string; course: CourseRef }>;
```

- `fullName` and `shortName` name the new course (the short name must be free); `categoryId` is the category (the course's own unless given); `start` and `end` its dates; `visible` whether students see it.
- `withUsers` copies the people's data and keeps everyone's enrolments; without it, only the content.
- Returns the new course, found by its short name once Moodle has finished.

Needs `moodle/backup:backupcourse`, `moodle/restore:restorecourse` and `moodle/course:create`. A copy whose settings Moodle refuses (a short name taken) is a `BackupError`.

## backupCourse

Backs a course up to a file and downloads it.

```ts
function backupCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  destDir: string,
  options?: { withUsers?: boolean; anonymize?: boolean; sections?: number[]; activities?: number[]; timeoutMs?: number },
): Promise<{ changed: string; file: DownloadedFile }>;
```

- The whole course, without its people's data unless `withUsers` (which needs `moodle/backup:userinfo`; `anonymize` makes their names anonymous).
- `sections` (section ids) and `activities` (course module ids, activities and resources alike, from the course's [structure](courses.md#coursestructure)) back up only part of the course: each section with everything in it (its subsections too), each activity alone. Moodle needs an activity's section in the backup to hold it, so the section comes along with its name and description, and only the activities chosen. A section or activity the course doesn't have is a `MoodleError` with code `not-found`.
- `destDir` is an absolute folder: the file is saved there under Moodle's name for it (`backup-moodle2-course-3-…mbz`), never overwriting (see [Files](files.md)). Moodle keeps it as well, in the course's or the person's backup area, as its restore page lists them.

Needs `moodle/backup:backupcourse`; Moodle refuses a second backup of a course while one is waiting for cron.

### Part of a course, to share

A backup of part of a course is meant to travel: kept, shared with other teachers and restored in their courses, maybe on another site. So it carries the content and nothing of the course's people or of the course itself: the wizard's settings for users, their roles, comments, completion, logs, grade history and xAPI states are off (with users off, so are submissions, attempts, posts and grades), and so are the course's blocks, filters, badges, calendar events, groups, competencies, custom fields, content bank and legacy files, which a restore would otherwise add to the course restored into. Activities' own dates and events come back with them (Moodle rebuilds them). `withUsers` can't go with a selection.

The driver doesn't take that on trust: it reads the file afterwards, and a file that holds other activities than those asked, or any of the people's data, is deleted and the call fails with `BackupError`.

What such a file still says about people, as Moodle writes it: the original site's address and the course's names in its description, and, in its list of files, who uploaded each file (a user id) and the author Moodle recorded for it (often the uploader's full name). No `users.xml`, so those ids name no one on another site, but the authors' names are there.

Backing up only reads the course: Moodle stores the file in the person's private backup area (a backup without users' data goes there) and logs that a backup was made; nothing else changes.

## restoreCourse

Restores a backup file through Moodle's restore wizard.

```ts
function restoreCourse(
  context: BrowserContext,
  siteUrl: string,
  file: string,
  options: {
    into: "new" | number;
    categoryId?: number;
    mode?: "merge" | "replace";
    fullName?: string;
    shortName?: string;
    withUsers?: boolean;
    sectionId?: number;
    afterSectionId?: number;
    timeoutMs?: number;
  },
): Promise<{ changed: string; course: CourseRef; sectionIds?: number[]; activityIds?: number[]; warnings?: RestoreWarning[] }>;
```

- `into: "new"` creates a course in `categoryId` (needed), named as in the backup unless `fullName` and `shortName` are given; it needs `moodle/course:create` there.
- `into: <course id>` restores into that course: `mode: "merge"` (the default) adds the backup's content to the course's, `"replace"` deletes the course's content first, which can't be undone. It returns the sections (`sectionIds`) and activities (`activityIds`) the course has new afterwards, in the course's order, and what the restore left broken in them (`warnings`, below).
- `sectionId` and `afterSectionId` say where a merged restore goes (below); without them, where Moodle puts it.
- `withUsers` restores the people's data when the backup has it (`moodle/restore:userinfo`).
- `file` is an absolute path to a `.mbz`; it's uploaded as the restore page's file picker does.

Needs `moodle/restore:restorecourse` where it restores. A file that isn't a Moodle backup, or one Moodle can't read, is a `BackupError`.

### Checked before the wizard

The driver reads the backup first (its `moodle_backup.xml`) and refuses, with a `BackupError` that names what's missing, a backup Moodle would restore badly:

- made on a newer Moodle than the site's (by branch: 5.3 on a 5.2 site; 5.2.4 on 5.2.0 goes on). Moodle only warns, and such a restore can fail half-way. The site's branch is read from the documentation link Moodle puts on its restore page; a site that shows none isn't checked.
- holding activities of a type the site doesn't offer the person in that course (a plugin such as `questionnaire` not installed, disabled, or not theirs to add): Moodle would restore the rest and skip those without a word. A course where the person can add nothing isn't checked.

A backup in zip format (a site with Moodle's `usezipbackups` makes them) isn't read: Moodle restores it unchecked.

### Where a merged restore goes

Moodle puts each of the backup's sections into the course's section with the same number, creating it when the course has none, and each activity at the end of its section; a section of the course that had no name, description, restrictions or visibility of its own takes the backup's (`restore_section_structure_step`, confirmed on Moodle 5.2). The wizard can't choose a place, so the driver restores, then moves what Moodle made:

- `sectionId`: every restored activity at the end of that section, in the backup's order; the sections Moodle made for them are deleted.
- `afterSectionId`: each of the backup's sections as a new section, in order, right after that one. A section Moodle merged into one of the course's own is split out into a new one, with the backup section's name and visibility (its description too, unless it has files or links to other activities, which only Moodle's restore can carry over).

With either, what Moodle took from the backup into the course's own sections (a name, a description, restrictions, hiding them) is put back. Placing costs a move per restored section, and a look at the course page before and after.

### What a restore left broken

Moodle restores a piece taken out of its course without a word about what it pointed to: a restriction on an activity, a grade, a group or a grouping the backup didn't hold stays, marked as broken; a link in its text to an activity it didn't hold points back to the original one (on the original site). Restored into an existing course, `warnings` lists them, one per problem, read from the restored activities' settings forms (those with restrictions, and those whose text linked elsewhere in the backup), so a program can tell the teacher what to fix:

```ts
interface RestoreWarning {
  activityId: number; // the restored activity, in the course restored into
  name: string;
  kind: "restriction" | "link";
  condition?: "completion" | "grade" | "group" | "grouping"; // for a restriction
  url?: string; // for a link: where it points
  message: string;
}
```

`backupContents` tells the same before restoring, from the file.

## backupContents

What a backup file holds, read on this computer: no browser, no session, no site.

```ts
function backupContents(file: string): Promise<BackupContents>;

interface BackupContents {
  name: string; // the file's
  type: "course" | "section" | "activity"; // a part of a course is "course", as Moodle writes it
  moodle: { version: string; release: string }; // the Moodle that made it: "2026042004", "5.2.4 (Build: 20261005)"
  original: { site?: string; courseId: number; courseFullName?: string; courseShortName?: string; format?: string };
  sections: { id: number; number?: number; name?: string; summary?: string; visible?: boolean; parentActivityId?: number }[];
  activities: { id: number; type: string; title: string; sectionId: number; dependencies: BackupDependency[] }[];
  plugins: string[]; // "mod_quiz", "qtype_multichoice", "block_html", "format_topics"
  withUsers: boolean; // it holds people's data
  gradebook: boolean; // it holds the course's gradebook setup (a part of a course doesn't)
}

interface BackupDependency {
  kind: "restriction" | "link" | "grade-category";
  condition?: "completion" | "grade" | "group" | "grouping";
  activityId?: number;
  module?: string;
  gradeItemId?: number;
  groupId?: number;
  groupingId?: number;
  categoryId?: number;
}
```

- Ids are the original site's: a section's `number` is where a merged restore puts it (see above), a section without `name` takes the course format's default.
- `plugins` are what a site needs to restore all of it: the activities' modules, the questions' types, the blocks, and the course format (for a new course). `restoreCourse` checks the modules before restoring.
- `dependencies`, per activity, what it refers to that the backup doesn't hold: a `restriction` on another activity's completion (`activityId`), on a grade item (`gradeItemId`), a group or a grouping; a `link` in its text to another activity (`activityId`, `module`); and, in a backup without the gradebook, the `grade-category` its grade sat in (restored, it goes to the course's top category; the original may have been the top one too, the backup doesn't say). Read from the activity's XML: the restrictions in `module.xml`, the links as Moodle encodes them in a backup (`$@PAGEVIEWBYID*12@# Copy, backup and restore

Reusing a course: copying it into a new one, backing it up (or part of it) to a `.mbz` file, reading what a backup file holds, restoring a backup into a new course or an existing one, and importing activities from another course. Each needs Moodle's rights for it, which a site gives teachers only in part: on a default site an editing teacher can back up and import, and restore into their own courses, but not create courses, so copying and restoring into a new course take a manager, a course creator or an administrator. When Moodle refuses, the `BackupError` says which right it asks for, with Moodle's own message.

**Terms:** [backup](../reference/glossary.md#backup), [course module id](../reference/glossary.md#course-module-id), [section](../reference/glossary.md#section).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Copying goes through Moodle's copy service (`core_backup_submit_copy_form`), with the copy form's own fields; backing up, restoring and importing through their page wizards, stage by stage, as a person would. Moodle makes copies, and backups and restores when the site makes them asynchronous (its "asynchronous backups" setting), in its scheduled tasks (cron): the driver waits for them, asking Moodle's progress services, up to `timeoutMs` (ten minutes unless given). A site whose cron doesn't run never finishes them: the `BackupError` after the wait says so, and Moodle goes on when cron runs. Every function but `backupContents`, which reads a file on this computer, throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

A backup is a local file, so it can be restored on another site: back up with one `Moodle` object and restore with another, each on its site, both in one browser if wished (see [Several sites, several accounts](../concepts/browser.md#several-sites-several-accounts)).

```ts
interface CourseRef {
  id: number;
  fullName: string;
  shortName: string;
  categoryId?: number;
  url: string;
}
```

## copyCourse

Copies a course into a new one, as Moodle's "Copy course".

```ts
function copyCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { fullName: string; shortName: string; categoryId?: number; start?: Date; end?: Date; withUsers?: boolean; visible?: boolean; timeoutMs?: number },
): Promise<{ changed: string; course: CourseRef }>;
```

- `fullName` and `shortName` name the new course (the short name must be free); `categoryId` is the category (the course's own unless given); `start` and `end` its dates; `visible` whether students see it.
- `withUsers` copies the people's data and keeps everyone's enrolments; without it, only the content.
- Returns the new course, found by its short name once Moodle has finished.

Needs `moodle/backup:backupcourse`, `moodle/restore:restorecourse` and `moodle/course:create`. A copy whose settings Moodle refuses (a short name taken) is a `BackupError`.

## backupCourse

Backs a course up to a file and downloads it.

```ts
function backupCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  destDir: string,
  options?: { withUsers?: boolean; anonymize?: boolean; sections?: number[]; activities?: number[]; timeoutMs?: number },
): Promise<{ changed: string; file: DownloadedFile }>;
```

- The whole course, without its people's data unless `withUsers` (which needs `moodle/backup:userinfo`; `anonymize` makes their names anonymous).
- `sections` (section ids) and `activities` (course module ids, activities and resources alike, from the course's [structure](courses.md#coursestructure)) back up only part of the course: each section with everything in it (its subsections too), each activity alone. Moodle needs an activity's section in the backup to hold it, so the section comes along with its name and description, and only the activities chosen. A section or activity the course doesn't have is a `MoodleError` with code `not-found`.
- `destDir` is an absolute folder: the file is saved there under Moodle's name for it (`backup-moodle2-course-3-…mbz`), never overwriting (see [Files](files.md)). Moodle keeps it as well, in the course's or the person's backup area, as its restore page lists them.

Needs `moodle/backup:backupcourse`; Moodle refuses a second backup of a course while one is waiting for cron.

### Part of a course, to share

A backup of part of a course is meant to travel: kept, shared with other teachers and restored in their courses, maybe on another site. So it carries the content and nothing of the course's people or of the course itself: the wizard's settings for users, their roles, comments, completion, logs, grade history and xAPI states are off (with users off, so are submissions, attempts, posts and grades), and so are the course's blocks, filters, badges, calendar events, groups, competencies, custom fields, content bank and legacy files, which a restore would otherwise add to the course restored into. Activities' own dates and events come back with them (Moodle rebuilds them). `withUsers` can't go with a selection.

The driver doesn't take that on trust: it reads the file afterwards, and a file that holds other activities than those asked, or any of the people's data, is deleted and the call fails with `BackupError`.

What such a file still says about people, as Moodle writes it: the original site's address and the course's names in its description, and, in its list of files, who uploaded each file (a user id) and the author Moodle recorded for it (often the uploader's full name). No `users.xml`, so those ids name no one on another site, but the authors' names are there.

Backing up only reads the course: Moodle stores the file in the person's private backup area (a backup without users' data goes there) and logs that a backup was made; nothing else changes.

## restoreCourse

Restores a backup file through Moodle's restore wizard.

```ts
function restoreCourse(
  context: BrowserContext,
  siteUrl: string,
  file: string,
  options: {
    into: "new" | number;
    categoryId?: number;
    mode?: "merge" | "replace";
    fullName?: string;
    shortName?: string;
    withUsers?: boolean;
    sectionId?: number;
    afterSectionId?: number;
    timeoutMs?: number;
  },
): Promise<{ changed: string; course: CourseRef; sectionIds?: number[]; activityIds?: number[]; warnings?: RestoreWarning[] }>;
```

- `into: "new"` creates a course in `categoryId` (needed), named as in the backup unless `fullName` and `shortName` are given; it needs `moodle/course:create` there.
- `into: <course id>` restores into that course: `mode: "merge"` (the default) adds the backup's content to the course's, `"replace"` deletes the course's content first, which can't be undone. It returns the sections (`sectionIds`) and activities (`activityIds`) the course has new afterwards, in the course's order, and what the restore left broken in them (`warnings`, below).
- `sectionId` and `afterSectionId` say where a merged restore goes (below); without them, where Moodle puts it.
- `withUsers` restores the people's data when the backup has it (`moodle/restore:userinfo`).
- `file` is an absolute path to a `.mbz`; it's uploaded as the restore page's file picker does.

Needs `moodle/restore:restorecourse` where it restores. A file that isn't a Moodle backup, or one Moodle can't read, is a `BackupError`.

### Checked before the wizard

The driver reads the backup first (its `moodle_backup.xml`) and refuses, with a `BackupError` that names what's missing, a backup Moodle would restore badly:

- made on a newer Moodle than the site's (by branch: 5.3 on a 5.2 site; 5.2.4 on 5.2.0 goes on). Moodle only warns, and such a restore can fail half-way. The site's branch is read from the documentation link Moodle puts on its restore page; a site that shows none isn't checked.
- holding activities of a type the site doesn't offer the person in that course (a plugin such as `questionnaire` not installed, disabled, or not theirs to add): Moodle would restore the rest and skip those without a word. A course where the person can add nothing isn't checked.

A backup in zip format (a site with Moodle's `usezipbackups` makes them) isn't read: Moodle restores it unchecked.

### Where a merged restore goes

Moodle puts each of the backup's sections into the course's section with the same number, creating it when the course has none, and each activity at the end of its section; a section of the course that had no name, description, restrictions or visibility of its own takes the backup's (`restore_section_structure_step`, confirmed on Moodle 5.2). The wizard can't choose a place, so the driver restores, then moves what Moodle made:

- `sectionId`: every restored activity at the end of that section, in the backup's order; the sections Moodle made for them are deleted.
- `afterSectionId`: each of the backup's sections as a new section, in order, right after that one. A section Moodle merged into one of the course's own is split out into a new one, with the backup section's name and visibility (its description too, unless it has files or links to other activities, which only Moodle's restore can carry over).

), the grade items in `grades.xml`.
- A file that isn't a Moodle backup is a `BackupError` that says so; one in zip format (`usezipbackups`) too, as the driver doesn't read those. A file that isn't there is a `MoodleError` with code `not-found`.

It's also `moodle.backupContents(file)` and `moodle backup-contents <file>`, neither of which opens the browser.

## importActivities

Imports activities from another course, as Moodle's "Import".

```ts
function importActivities(context: BrowserContext, siteUrl: string, fromCourseId: number, toCourseId: number, options?: { activityIds?: number[] }): Promise<{ changed: string; activityIds: number[] }>;
```

- Every activity of `fromCourseId`, or only `activityIds` (course module ids, from its [structure](courses.md#coursestructure)), is added to `toCourseId` with its section; never its people's data.
- Returns the course module ids `toCourseId` has new afterwards.

Needs `moodle/restore:restoretargetimport` in the course imported into and `moodle/backup:backuptargetimport` in the other, which editing teachers have in their courses.

## Example

```ts
import { BackupError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  // Next year's course from this year's, and a forum from another course (4) into it.
  const { course } = await moodle.copyCourse(3, { fullName: "Programming 2027", shortName: "prog-2027", start: new Date("2027-09-15") });
  const { activityIds } = await moodle.importActivities(4, course.id, { activityIds: [46] });
  console.log(`Course ${course.id}, with activities ${activityIds.join(", ")} imported`);

  // A backup on disk, restored as a new course somewhere else.
  const { file } = await moodle.backupCourse(3, "/home/ada/backups");
  const restored = await moodle.restoreCourse(file.path, { into: "new", categoryId: 1, fullName: "Programming (archive)", shortName: "prog-archive" });
  console.log(restored.changed);

  // A unit (section 12) and a quiz (activity 57) to share, restored as new sections after section 30 of course 8.
  const part = await moodle.backupCourse(3, "/home/ada/backups", { sections: [12], activities: [57] });
  const contents = await moodle.backupContents(part.file.path);
  for (const activity of contents.activities) if (activity.dependencies.length > 0) console.log(`"${activity.title}" depends on things left out`, activity.dependencies);
  const placed = await moodle.restoreCourse(part.file.path, { into: 8, afterSectionId: 30 });
  console.log(`New sections ${placed.sectionIds?.join(", ")}, new activities ${placed.activityIds?.join(", ")}`);
  for (const warning of placed.warnings ?? []) console.log(warning.message);
} catch (error) {
  if (error instanceof BackupError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `copyCourse`, `backupCourse`, `restoreCourse`: `course-content`, and `others-personal` (the people's data, with `withUsers`).
- `importActivities`, `backupContents`: `course-content`.

See [Data categories](../concepts/data-categories.md).
