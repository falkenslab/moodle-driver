# Copy, backup and restore

Reusing a course: copying it into a new one, backing it up to a `.mbz` file, restoring a backup into a new course or an existing one, and importing activities from another course. Each needs Moodle's rights for it, which a site gives teachers only in part: on a default site an editing teacher can back up and import, and restore into their own courses, but not create courses, so copying and restoring into a new course take a manager, a course creator or an administrator. When Moodle refuses, the `BackupError` says which right it asks for, with Moodle's own message.

**Terms:** [backup](../reference/glossary.md#backup), [course module id](../reference/glossary.md#course-module-id), [section](../reference/glossary.md#section).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Copying goes through Moodle's copy service (`core_backup_submit_copy_form`), with the copy form's own fields; backing up, restoring and importing through their page wizards, stage by stage, as a person would. Moodle makes copies, and backups and restores when the site makes them asynchronous (its "asynchronous backups" setting), in its scheduled tasks (cron): the driver waits for them, asking Moodle's progress services, up to `timeoutMs` (ten minutes unless given). A site whose cron doesn't run never finishes them: the `BackupError` after the wait says so, and Moodle goes on when cron runs. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

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
  options?: { withUsers?: boolean; anonymize?: boolean; timeoutMs?: number },
): Promise<{ changed: string; file: DownloadedFile }>;
```

- The whole course, without its people's data unless `withUsers` (which needs `moodle/backup:userinfo`; `anonymize` makes their names anonymous).
- `destDir` is an absolute folder: the file is saved there under Moodle's name for it (`backup-moodle2-course-3-…mbz`), never overwriting (see [Files](files.md)). Moodle keeps it as well, in the course's or the person's backup area, as its restore page lists them.

Needs `moodle/backup:backupcourse`; Moodle refuses a second backup of a course while one is waiting for cron.

## restoreCourse

Restores a backup file through Moodle's restore wizard.

```ts
function restoreCourse(
  context: BrowserContext,
  siteUrl: string,
  file: string,
  options: { into: "new" | number; categoryId?: number; mode?: "merge" | "replace"; fullName?: string; shortName?: string; withUsers?: boolean; timeoutMs?: number },
): Promise<{ changed: string; course: CourseRef }>;
```

- `into: "new"` creates a course in `categoryId` (needed), named as in the backup unless `fullName` and `shortName` are given; it needs `moodle/course:create` there.
- `into: <course id>` restores into that course: `mode: "merge"` (the default) adds the backup's content to the course's, `"replace"` deletes the course's content first, which can't be undone.
- `withUsers` restores the people's data when the backup has it (`moodle/restore:userinfo`).
- `file` is an absolute path to a `.mbz`; it's uploaded as the restore page's file picker does.

Needs `moodle/restore:restorecourse` where it restores. A file Moodle can't read as a backup is a `BackupError`.

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
} catch (error) {
  if (error instanceof BackupError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `copyCourse`, `backupCourse`, `restoreCourse`: `course-content`, and `others-personal` (the people's data, with `withUsers`).
- `importActivities`: `course-content`.

See [Data categories](../concepts/data-categories.md).
