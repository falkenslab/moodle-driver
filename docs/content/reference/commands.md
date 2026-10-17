# Commands

Every method of the `Moodle` object as a command of `moodle`, generated from the driver's types: the same names (also in kebab-case), arguments and options. See [The command line](../getting-started/command-line.md) for installing it, logging in and the global options.

Each one can also be typed in `moodle shell`, without the `moodle` in front, on one browser kept open between commands (see [An interactive session](../getting-started/command-line.md#an-interactive-session)). After `moodle open`, separate `moodle` commands from any terminal work on one browser left open in the background, until `moodle close` (see [Watching separate commands act](../getting-started/command-line.md#watching-separate-commands-act)).

Besides these, `moodle` has its own commands for the session and the browser: `login`, `sites`, `forget`, `shell`, `open`, `close` and `help` (see [The command line](../getting-started/command-line.md)).

## activitiesOverview

Moodle 5's activities overview of a course for one type ("resource" for every resource type): per activity, the columns its overview page shows the person (due dates, submissions, what needs grading, their own grade…). Without a type, every type in the course's state: "resource" first, which brings pages, books, files, folders and links at once, then each type still missing.

```bash
moodle activities-overview <courseId> [type]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `type` (optional) | `string` |  |

## activityContent

Reads a page's or label's text, a book's chapters, a URL resource's target, or a file resource's or folder's files. With the realistic trail, page by page at a reader's pace, calling `onProgress` with the seconds read so far while it pauses. Takes an activity as the course structure gives it (`{ id, type }`), or its id and module.

```bash
moodle activity-content <activityId> <type> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `type` | `"url" \| "page" \| "book" \| "label" \| "resource" \| "folder"` |  |
| `--trail` | `"realistic" \| "fast"` |  |

## activityReport

A course's activity report: per activity, how many times it was viewed, by how many people, and when last, from the logs (between `from` and `until` when given). Activities nobody viewed come with zero views.

```bash
moodle activity-report <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--from` | `Date` |  |
| `--until` | `Date` |  |

## activitySettings

An activity's settings as its form holds them, without submitting it: its module, name and description, every field by the name `updateActivity` takes in `settings`, the files of a resource, folder or SCORM, and its restrictions and completion in plain terms. Teachers only.

```bash
moodle activity-settings <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## addBookChapter

Adds a chapter to a book through Moodle's chapter form, at the end or after another chapter, as a subchapter when asked, hidden when asked, with `embed`'s local files in its content. Gives the new chapter's id and the chapters afterwards. Throws `BookError` when the person can't edit the book or `afterChapterId` isn't in it.

```bash
moodle add-book-chapter <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--title` (required) | `string` |  |
| `--content` (required) | `string` | Its content (HTML); Moodle requires some. |
| `--subchapter` | `boolean` | A subchapter of the chapter before it (not for the first). |
| `--hidden` | `boolean` | Hidden from students; shown by default, as Moodle adds it. |
| `--after-chapter-id` | `number` | The chapter it goes after; at the end of the book without it. |
| `--embed` | `string[]` | Local files (absolute paths) to embed in the content, which names each by its file name (`<img src="shot.png">`). |

## addDatabaseField

Adds a field to a database activity through Moodle's form for its type, as "Create a field" does: templates left at Moodle's default show it, and Moodle appends it to a saved single, add entry or RSS template that has no `##otherfields##` (not to the list template). Returns its id and the fields afterwards. Throws `MoodleError` (`invalid-input`) for a type that isn't one of `DATABASE_FIELD_TYPES`, an option the type doesn't take, a choice list without choices or a required date (Moodle's form offers it no such setting), before anything changes; `DatabaseError` with Moodle's reason when it refuses the field (a name the database already has, an image size that isn't a number, a maximum size its form doesn't offer); `NotADatabaseError` when the id isn't a database.

```bash
moodle add-database-field <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--type` (required) | `"number" \| "url" \| "text" \| "textarea" \| "date" \| "menu" \| "radiobutton" \| "checkbox" \| "multimenu" \| "file" \| "picture" \| "latlong"` |  |
| `--name` (required) | `string` | Unique in the database: templates name the field by it (`[[name]]`). |
| `--description` | `string` |  |
| `--required` | `boolean` |  |
| `--options` | `DatabaseFieldOptions` |  |

## addGradeCategory

Adds a grade category (at the course's top level, or inside `parentId`); returns it as the setup shows it.

```bash
moodle add-grade-category <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--name` (required) | `string` |  |
| `--aggregation` | `"mean" \| "median" \| "lowest" \| "highest" \| "mode" \| "weighted-mean" \| "simple-weighted-mean" \| "mean-with-extra-credits" \| "natural"` |  |
| `--parent-id` | `number` |  |

## addGradeItem

Adds a manual grade item (one graded in the gradebook, not by an activity): out of `maxGrade` (Moodle's default, 100, when left out) or on a scale (`scaleId`), at the course's top level or in `categoryId`, hidden from students when asked. Returns it as the setup shows it.

```bash
moodle add-grade-item <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--name` (required) | `string` |  |
| `--max-grade` | `number` |  |
| `--scale-id` | `number` |  |
| `--category-id` | `number` |  |
| `--hidden` | `boolean` |  |

## addLessonPage

Adds a page to a lesson through Moodle's lesson editor, after page `after` (0 puts it first; by default it goes last): a content page with its buttons, a question page with its answers (their responses, scores and jumps), an essay, or a cluster, end of cluster or end of branch (which Moodle makes at once, then edited when more is given). A jump to a page the lesson doesn't have is an error before anything is saved. Returns the new page's id and the lesson's pages in order.

```bash
moodle add-lesson-page <activityId> <input> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `input` | `LessonPageInput` |  |
| `--after` | `number` |  |

## addQuestionCategory

Adds a category to a bank, as the categories page's "Add category" does: at the top level, or inside `parentId`, with an optional description (HTML). Returns the category made.

```bash
moodle add-question-category <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--name` (required) | `string` |  |
| `--parent-id` | `number` |  |
| `--description` | `string` |  |

## addQuestionsToQuiz

Adds bank questions to a quiz by id, and random questions from a bank category, at the end or on a page, as the edit page's bank actions post them. Returns the quiz's structure afterwards. A quiz already attempted can't change its questions: Moodle refuses, and so does this.

```bash
moodle add-questions-to-quiz <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--question-ids` | `number[]` |  |
| `--random` | `{ categoryId: number; count: number; includeSubcategories?: boolean; }` |  |
| `--page` | `number` |  |

## addQuizSection

Adds a section to a quiz starting at a slot, with its heading and whether its questions are shuffled, as the edit page's "Add a new section heading" and its heading and shuffle controls do. A section starts at a page: the slot must be the first of its page (see `setQuizPages`).

```bash
moodle add-quiz-section <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--first-slot` (required) | `number` |  |
| `--heading` (required) | `string` |  |
| `--shuffle` | `boolean` |  |

## addSection

Adds a section after another one (at the end without it), named when a name is given, with a description (HTML) when `summary` is, and `embed`'s local files in it (`<img src="shot.png">`).

```bash
moodle add-section <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--name` | `string` |  |
| `--after-section-id` | `number` |  |
| `--summary` | `string` |  |
| `--embed` | `string[]` |  |

## allocateMarker

Allocates a marker (the user id of someone who can grade; several where the assignment uses several markers per submission) to participants' submissions, as the grading table's "Allocate marker" does. Moodle leaves alone submissions past marking (marking completed, in review, ready for release, released).

```bash
moodle allocate-marker <activityId> <userIds> <markerId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userIds` | `number[]` |  |
| `markerId` | `number \| number[]` |  |

## allocateRandomly

Allocates submissions to reviewers at random, as Moodle's random allocation form does: `perSubmission` reviews for each submission, or `perReviewer` for each reviewer, keeping the current allocations unless `keepCurrent` is false (Moodle never removes an assessment already graded), among reviewers with a submission of their own unless `withoutSubmission`, with self-assessments when `selfAssessment` (and the workshop allows them), and without peers of the same group when `excludeSameGroup` (visible groups mode only). Returns a sentence of what changed, how many allocations were added and removed, Moodle's report of what it did (its lines, in the site's language) and the problems among them (not enough reviewers, graded assessments kept), and the allocation afterwards. Throws `WorkshopError` for a setting the workshop doesn't have or when the person can't allocate (`mod/workshop:allocate`); `FormError` when Moodle refuses the form.

```bash
moodle allocate-randomly <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--per-submission` | `number` | Reviews each submission gets (Moodle's "Number of reviews … per submission"); give this or `perReviewer`. |
| `--per-reviewer` | `number` | Reviews each reviewer does ("… per reviewer"). |
| `--keep-current` | `boolean` | Keep the allocations there are (default) or remove them first ("Remove current allocations"; Moodle never removes graded ones). |
| `--without-submission` | `boolean` | Reviewers without a submission of their own too ("Participants can assess without having submitted anything"); off by default. |
| `--self-assessment` | `boolean` | Add each author's self-assessment ("Add self-assessments"), where the workshop allows it; off by default. |
| `--exclude-same-group` | `boolean` | Prevent reviews by peers of the same group ("Prevent reviews by peers from the same group"), only in visible groups mode; off by default. |

## allocateReviewer

Allocates a reviewer to a submission, as the "Add reviewer" menu of Moodle's manual allocation page does, in any phase. The submission is given by its id or by its author's (`authorId`); the reviewer must be one Moodle offers for it: a participant who can assess peers in the course (enrolled as a student), and not the author unless the workshop allows self-assessment. Returns a sentence of what changed, the assessment Moodle made (or the one the reviewer already had: `added` is false then), and the submission's reviewers afterwards. Throws `WorkshopError` when the reviewer isn't one Moodle offers, the submission isn't there, or the person can't allocate (`mod/workshop:allocate`).

```bash
moodle allocate-reviewer <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--submission-id` | `number` | The submission's id (give this or `authorId`). |
| `--author-id` | `number` | The submission's author's user id. |
| `--reviewer-id` (required) | `number` | The reviewer's user id. |

## anonymizeBackup

A copy of a backup file that names no one and no site, written on this computer without the browser or a session (`anonymizeBackup`).

```bash
moodle anonymize-backup <file> <destFile>
```

| Argument | Type | Description |
| --- | --- | --- |
| `file` | `string` |  |
| `destFile` | `string` |  |

## answerChoice

Answers a choice with one option (several where it allows them) by id, as "Save my choice" does; returns the choice afterwards.

```bash
moodle answer-choice <activityId> <optionIds>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `optionIds` | `number[]` |  |

## answerLessonPage

Answers the page the person is on: a content page's button (its label or position), or a question's fields by name. Returns Moodle's feedback when it gives one, and the page that follows, going on past the feedback as its "Continue" does; reaching the end ends the attempt. With the realistic trail it first takes the time a reader needs for the page (ADR-005).

```bash
moodle answer-lesson-page <activityId> <answer> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `answer` | `{ button?: string \| number; responses?: Record<string, string>; }` |  |
| `--trail` | `"realistic" \| "fast"` |  |

## answerQuizQuestions

Saves answers in an attempt in progress without finishing it, and gives its questions afterwards. With the realistic trail, it first takes the time a reader needs for the questions and their options (ADR-005), calling `onProgress` with the seconds elapsed and the total.

```bash
moodle answer-quiz-questions <attemptId> <answers> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |
| `answers` | `{ slot: number; responses: Record<string, string>; }[]` |  |
| `--trail` | `"realistic" \| "fast"` |  |

## applyDatabasePreset

Gives a database activity one of the site's presets (`databasePresets`), as "Use this preset" and "Apply preset" do: the preset's fields are added, a field with the same name and type is kept with what entries have in it, and every other field is deleted with its content; its templates replace the database's, and its other settings stay. Returns the fields afterwards. Throws `MoodleError` (`not-found`) for a preset the presets page doesn't list, `DatabaseError` when Moodle doesn't apply it or the person can't manage the database, `NotADatabaseError` when the id isn't a database.

```bash
moodle apply-database-preset <activityId> <presetId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `presetId` | `string` |  |

## assessWorkshopSubmission

Assesses a submission as the person, through the workshop's assessment form (its grading strategy's: accumulative, comments, number of errors or rubric), as "Assess" on the submission's page and the form do: a teacher who hasn't assessed it yet gets an assessment of their own, and one already made is changed. `criteria` go in the form's order; `feedback` is the overall feedback for the author (HTML), where the workshop has it on; `fields` sets any other field of the form by name (`weight`…). Returns a sentence of what changed, the assessment's id, and the grade it gives the submission out of the workshop's grade. Throws `WorkshopError` outside the assessment phase, when a criterion's grade isn't one it takes, or when the workshop has no overall feedback; `FormError` when Moodle refuses the form (a criterion left without a grade).

```bash
moodle assess-workshop-submission <activityId> <submissionId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `submissionId` | `number` |  |
| `--criteria` | `WorkshopCriterion[]` |  |
| `--feedback` | `string` |  |
| `--fields` | `Record<string, FieldValue>` |  |

## assignmentSubmissions

Every participant's submission to an assignment, with the group they submit for (group submissions), and, unless `includeContent` is false, its content, the feedback files they have, its marking workflow state and markers (all from each participant's grading panel). Those come only for participants with a submission: Moodle's grading panel creates an empty one for a participant who has none, so reading leaves them at "none", without the panel's details (confirmed empirically on the sandbox, 5.2). For a participant with a submission and no grade yet, the panel still leaves an empty grade (-1, not graded) and a "Grading form viewed" event, as Moodle's grader does. Only some participants when given their `userIds`; with `limit`, a page of them in the grader's order (see "Long lists" in the docs' concepts): Moodle's service lists every participant at once, cut to the page, and only the page's participants are read further (their dates, their panels).

```bash
moodle assignment-submissions <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--include-content` | `boolean` | Also each submission's content, feedback files, workflow state and markers, from the grading panels: true unless given. |
| `--user-ids` | `number[]` | Only these participants (their user ids). |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## awardBadge

Awards a badge by hand to a participant, through its manual award page, as the person's role in its manual criterion (`roleId` when the criterion names several the person holds; the first otherwise). The badge must be enabled and have a manual criterion naming a role the person holds. Moodle issues the badge when its criteria are met: at once when the manual award is enough (its only criterion, or any one earning it), else once the rest are met too (confirmed empirically, 5.2). A participant awarded already is left as is. Returns the badge afterwards. Throws `BadgeError` when the person can't award it (it takes moodle/badges:awardbadge and one of the criterion's roles), when it isn't enabled or has no manual criterion, and when Moodle doesn't award it (the user isn't a participant).

```bash
moodle award-badge <badgeId> <userId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `badgeId` | `number` |  |
| `userId` | `number` |  |
| `--role-id` | `number` |  |

## backupContents

What a backup file (`.mbz`) holds and what its activities refer to outside it, read on this computer without the browser or a session (`backupContents`).

```bash
moodle backup-contents <file>
```

| Argument | Type | Description |
| --- | --- | --- |
| `file` | `string` |  |

## backupCourse

Backs a course up to a `.mbz` file, through Moodle's backup wizard (initial settings, schema, confirmation), and downloads it into `destDir`. Without users' data unless `withUsers`, which needs `moodle/backup:userinfo` (`anonymize` makes their names anonymous). An asynchronous backup is waited for up to `timeoutMs` (ten minutes). Moodle keeps the file in the course's or the person's backup area too. With `sections` (section ids) or `activities` (course module ids: activities and resources), only those go in: a section with everything in it, an activity alone (with its section's name, which Moodle needs for it). A selection never carries people's data, nor what belongs to the course rather than to its content (blocks, filters, badges, course events, groups, competencies, custom fields, content bank, legacy files); the file is read afterwards to check that it holds what was asked and no people's data. `anonymous` (the default for a selection, not for a whole course) makes the file name no one and no site, through `anonymizeBackup`: no user ids or authors, a neutral site, course and file name. It's then saved as `backup-moodle2-anonymous-<date>.mbz`; the copy Moodle keeps in its backup area stays as Moodle made it. `anonymous: false` keeps what Moodle wrote.

```bash
moodle backup-course <courseId> <destDir> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `destDir` | `string` |  |
| `--with-users` | `boolean` |  |
| `--anonymize` | `boolean` |  |
| `--anonymous` | `boolean` | The file naming no one and no site (`anonymizeBackup`): true unless given for a selection, false for a whole course. |
| `--sections` | `number[]` | Ids of the sections to back up, each with everything in it. |
| `--activities` | `number[]` | Course module ids of activities and resources to back up, each alone. |
| `--timeout-ms` | `number` |  |

## bookChapters

A book's chapters in order: each one's id, title, whether it is a subchapter or hidden, and its place; with `content`, its HTML and images too, each chapter's page read (Moodle logs a view of it). A teacher sees hidden chapters; a student's list leaves them out. Throws `BookError` when the activity isn't a book the person can read.

```bash
moodle book-chapters <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--content` | `boolean` |  |

## calendarEvent

One calendar event by its id, as `upcomingEvents` gives them.

```bash
moodle calendar-event <eventId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `eventId` | `number` |  |

## callService

Calls one of Moodle's AJAX services as the logged-in person.

```bash
moodle call-service <methodname> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `methodname` | `string` |  |
| `--<name> <value>` | | Any other field of `args` |

## completionReport

A course's progress report: every participant's completion of every activity that tracks it, page by page, in one group when given, only some people's when given their `userIds` (the report has no filter by user: its pages are read until all of them are found). People come as user id and full name only.

```bash
moodle completion-report <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--group` | `number` |  |
| `--user-ids` | `number[]` |  |

## conversation

A conversation's messages, oldest first, as text, and its members as `conversations()` gives them: everyone but the person, whether they wrote in it or not (the person alone in their own conversation). With `limit`, `messages` is a page of them (see "Long lists" in the docs' concepts) counted from the newest: the first page is the latest messages, `more` says there are older ones, and each page's messages still come oldest first. Moodle's service returns only the page.

```bash
moodle conversation <conversationId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `conversationId` | `number` |  |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## conversations

The person's conversations, latest first, with their last message as text. With `limit`, a page of them (see "Long lists" in the docs' concepts), the only ones Moodle's service returns.

```bash
moodle conversations [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## copyCourse

Copies a course into a new one, as Moodle's "Copy course" does: its content (and its people's data and enrolments, `withUsers`), under a new full and short name, in a category (the course's unless given), with new dates. Goes through Moodle's copy service, then waits for the copy, which Moodle makes in its scheduled tasks, up to `timeoutMs` (ten minutes). Needs the rights to back up, restore and create courses (`moodle/backup:backupcourse`, `moodle/restore:restorecourse`, `moodle/course:create`); without them, `BackupError` says so.

```bash
moodle copy-course <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--full-name` (required) | `string` |  |
| `--short-name` (required) | `string` |  |
| `--category-id` | `number` |  |
| `--start` | `Date` |  |
| `--end` | `Date` |  |
| `--with-users` | `boolean` |  |
| `--visible` | `boolean` |  |
| `--timeout-ms` | `number` |  |

## courseAbilities

What the person can do in a course, asked of read-only services that need the capability: the activity types they can add (none without `moodle/course:manageactivities`) and the grader report's users (`nopermissions` without `gradereport/grader:view`). Nothing is changed.

```bash
moodle course-abilities <courseId> <sectionId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `sectionId` | `number` |  |

## courseActivityTypes

The activity and resource types the person can add to a course: none when they can't edit it.

```bash
moodle course-activity-types <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## courseBadges

A course's badges, as its badges page lists them: each one's name, description, image, criteria (Moodle's summary, in the site's language), whether it's enabled, whether the person has it and, for whom may see it (a teacher), how many people have it. A student sees only enabled badges. Throws `BadgesDisabledError` on a site with badges off, `BadgeError` when the person can't see the course's badges.

```bash
moodle course-badges <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## courseLogs

A course's logs, newest first, as its logs report lists them: by a user, an activity, a kind of action, and a time span, up to `limit` entries (100 unless given). Moodle filters by user, activity and action; the span is read page by page, stopping at the first entry older than `from`. Every entry's time comes as an ISO date, read back with the site language's own format. Without `limit`, the first 100 entries (from `offset`) as a list; with it, a page of them (see "Long lists" in the docs' concepts), from the report's page that holds `offset` on (without `until`; with it, from the first page, since only the driver filters by it).

```bash
moodle course-logs <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--user-id` | `number` | Only this user's actions. |
| `--activity-id` | `number` | Only in this activity (its course module id). |
| `--from` | `Date` | Only from this date on. |
| `--until` | `Date` | Only until this date. |
| `--action` | `"create" \| "view" \| "update" \| "delete" \| "change"` | Only this kind of action. |
| `--limit` | `number` | How many entries (1 or more): with it, the entries come as a `ListPage`; without it, the first 100, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## courseRoles

A user's roles in a course, from their profile there: role links carry the role id in any language.

```bash
moodle course-roles <userId> <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `userId` | `number` |  |
| `courseId` | `number` |  |

## courseStructure

A course's sections and activities; with `details`, each activity's dates and restriction and each section's description, from the course page (slower).

```bash
moodle course-structure <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--details` | `boolean` |  |

## courseUpdates

What changed in a course's activities since a date, with their names from the course's state.

```bash
moodle course-updates <courseId> <since>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `since` | `Date` |  |

## createActivity

Creates an activity or resource of any type at the end of a section, through Moodle's own form, hidden from students unless `visibility` says otherwise. `files` are local paths uploaded to a file resource or folder (a `DraftUpload` puts one in a folder's subfolder); a SCORM (`type: "scorm"`) or an H5P activity (`type: "h5pactivity"`) takes the first as its package.

```bash
moodle create-activity <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `input` | `ActivityFields & { courseId: number; sectionId: number; type: string; files?: (string \| DraftUpload)[]; }` |  |

## createBadge

Creates a course badge, disabled and without criteria, through Moodle's new badge form: its name, description and image (a local file, uploaded as the form's file picker does). The issuer is the site's default. Returns the badge. Throws `BadgeError` when the person can't create badges in the course (it takes moodle/badges:createbadge), `BadgesDisabledError` on a site with badges off, `FormError` with Moodle's reason when it refuses the form (an image it can't use).

```bash
moodle create-badge <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--name` (required) | `string` |  |
| `--description` (required) | `string` | Plain text: Moodle strips tags from it. |
| `--image` (required) | `string` | A local image file (absolute path): PNG, JPEG or GIF, at most 256 KB; Moodle resizes it. |
| `--image-caption` | `string` | The image's caption (its alternative text). |

## createEvent

Creates a course event, through the calendar's own form: its start, and its duration and description when given. Returns it as the calendar has it.

```bash
moodle create-event --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `--course-id` (required) | `number` |  |
| `--name` (required) | `string` |  |
| `--start` (required) | `Date` |  |
| `--duration-minutes` | `number` |  |
| `--description` | `string` |  |

## createGroup

Creates a group in a course with its group form (`group/group.php`). Throws `FormError` with Moodle's reason when it refuses (a name already used, an enrolment key another group has).

```bash
moodle create-group <courseId> <settings>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `settings` | `GroupSettings & { name: string; }` |  |

## createGrouping

Creates a grouping in a course with its form (`group/grouping.php`); add its groups with `setGroupingGroups`.

```bash
moodle create-grouping <courseId> <settings>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `settings` | `GroupingSettings & { name: string; }` |  |

## createQuestion

Creates one question in a bank through its type's edit form; returns its id. Imports are the way for several; this is for one-offs.

```bash
moodle create-question <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--type` (required) | `"multichoice" \| "truefalse" \| "shortanswer" \| "numerical" \| "essay"` |  |
| `--name` (required) | `string` |  |
| `--text` (required) | `string` | The question's text (HTML). |
| `--answers` | `{ text: string; fraction: number; feedback?: string; tolerance?: number; }[]` | Multichoice, short answer and numerical answers: a fraction of the mark (1 right, 0 wrong, negatives for penalties), the nearest one Moodle offers. A numerical answer's `tolerance` is the error accepted around it. |
| `--correct` | `boolean` | True/false: the right answer. |
| `--category-id` | `number` | The bank's category it goes in; a new question goes in the bank's default one when left out. |
| `--default-mark` | `number` |  |
| `--fields` | `Record<string, FieldValue>` | Any other field of the type's form, by name. |

## databaseFields

A database activity's fields, in the fields page's order: each one's id, name, type, description, whether it's required and its type's settings (`DatabaseFieldOptions`), read from its edit form. Throws `NotADatabaseError` when the id isn't a database, `DatabaseError` when the person can't manage it (it takes `mod/data:managetemplates`, which editing teachers have).

```bash
moodle database-fields <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## databasePresets

The presets a database activity can be given, from its presets page: Moodle's own and those saved on the site that the person can see. Throws `DatabaseError` when the person can't manage the database, `NotADatabaseError` when the id isn't one.

```bash
moodle database-presets <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## databaseTemplates

A database activity's templates (`DATABASE_TEMPLATES`), as its templates page shows them: what was saved, or Moodle's default for the fields it has where nothing was (an empty header, footer or RSS title, CSS or JavaScript stays empty). Throws `DatabaseError` when the database has no fields yet (Moodle has no templates before the first) or the person can't manage it, `NotADatabaseError` when the id isn't a database.

```bash
moodle database-templates <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## deadlines

What the person has to do by a date (calendar action events: submit, attempt, grade…), from the last `pastDays` to `days` ahead, in one course or all. Teachers' grading counts come from the activities overview instead: Moodle gives them few action events.

```bash
moodle deadlines [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--course-id` | `number` |  |
| `--days` | `number` |  |
| `--past-days` | `number` |  |

## deleteActivity

Deletes an activity, with its participants' data (submissions, posts, attempts); gives the course afterwards.

```bash
moodle delete-activity <courseId> <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |

## deleteBookChapter

Deletes a chapter, with its files, as the table of contents' delete does; deleting a chapter (not a subchapter) deletes its subchapters too. Throws `BookError` when the chapter isn't in the book.

```bash
moodle delete-book-chapter <activityId> <chapterId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `chapterId` | `number` |  |

## deleteDatabaseField

Deletes a database field, as its delete action confirmed does: what entries have in it goes too, and its tags leave the templates. Returns the fields afterwards. Throws `MoodleError` (`not-found`) when the database has no such field, `DatabaseError` when Moodle refuses, `NotADatabaseError` when the id isn't a database.

```bash
moodle delete-database-field <activityId> <fieldId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `fieldId` | `number` |  |

## deleteEvent

Deletes a calendar event the person can manage.

```bash
moodle delete-event <eventId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `eventId` | `number` |  |

## deleteGradeCategory

Deletes a grade category. Moodle moves what it held (items and categories) into its parent and deletes the grades of its total; the course's own category can't be deleted.

```bash
moodle delete-grade-category <courseId> <categoryId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `categoryId` | `number` |  |

## deleteGradeItem

Deletes a manual grade item and its grades. An activity's item goes with its activity (Moodle would make it again), so it's refused.

```bash
moodle delete-grade-item <courseId> <itemId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `itemId` | `number` |  |

## deleteGroup

Deletes a group, as the groups page's "Delete selected group" does once confirmed; its members stay in the course.

```bash
moodle delete-group <groupId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `groupId` | `number` |  |

## deleteGrouping

Deletes a grouping, as its delete icon does once confirmed; its groups stay.

```bash
moodle delete-grouping <groupingId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `groupingId` | `number` |  |

## deleteLessonPage

Deletes a page of a lesson, as the editor's delete link does once confirmed. Answers of other pages that jumped to it are left as Moodle leaves them. Returns the pages left, in order.

```bash
moodle delete-lesson-page <activityId> <pageId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `pageId` | `number` |  |

## deletePost

Deletes a post and its replies through Moodle's own confirmation (`post.php?delete=`); a discussion's first post takes the whole discussion. Only a moderator deletes a post with replies, or someone else's. `replies` says how many replies went with it. Throws `ForumError` with Moodle's reason when it refuses.

```bash
moodle delete-post <postId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `postId` | `number` |  |

## deleteQuestionCategory

Deletes a bank's category as its delete action does. Its subcategories move up to its parent, as Moodle does. A category with questions takes `moveTo`, the bank's category its questions go to, which Moodle asks for before deleting; without it nothing is deleted. Moodle keeps a bank's last top-level category.

```bash
moodle delete-question-category <activityId> <categoryId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `categoryId` | `number` |  |
| `--move-to` | `number` |  |

## deleteQuestions

Deletes questions from a bank, every version of each, as the bank's delete action does: asked, then confirmed. Moodle doesn't delete a question a quiz uses: it hides it, and `hidden` lists those.

```bash
moodle delete-questions <activityId> <questionIds>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `questionIds` | `number[]` |  |

## deleteSection

Deletes a section and every activity in it, with their participants' data.

```bash
moodle delete-section <courseId> <sectionId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `sectionId` | `number` |  |

## discussion

A discussion's posts, oldest first, with their messages as text, and whether the person is subscribed to it (`subscribed`, undefined where they can't subscribe or it's forced). With `limit`, `posts` is a page of them (see "Long lists" in the docs' concepts): Moodle's service has no paging, so every post is read and cut, but only the page's messages are turned into text.

```bash
moodle discussion <discussionId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `discussionId` | `number` |  |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## downloadFile

Saves a file of the site into `destDir` with the person's session, never overwriting. Only URLs of the site's origin: the session's cookies go nowhere else (its media outside Moodle's path included).

```bash
moodle download-file <url> [destDir]
```

| Argument | Type | Description |
| --- | --- | --- |
| `url` | `string` |  |
| `destDir` (optional) | `string` |  |

## duplicateActivity

Duplicates an activity as the course page's "Duplicate" does (right after it, named with "(copy)"); gives the copy's id and the course afterwards.

```bash
moodle duplicate-activity <courseId> <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |

## editActivity

Renames, shows or hides, or moves an activity (to a section's end, or before another one).

```bash
moodle edit-activity <courseId> <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |
| `--name` | `string` |  |
| `--visibility` | `"shown" \| "hidden" \| "stealth"` |  |
| `--section-id` | `number` |  |
| `--before-activity-id` | `number` |  |

## editBookChapter

Changes a chapter's title, content (with `embed`'s local files in it) or whether it is a subchapter, through its form: only what's given changes. Throws `BookError` when the chapter isn't in the book, or the person can't edit it.

```bash
moodle edit-book-chapter <activityId> <chapterId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `chapterId` | `number` |  |
| `--title` | `string` |  |
| `--content` | `string` |  |
| `--subchapter` | `boolean` |  |
| `--embed` | `string[]` |  |

## editDatabaseField

Changes a database field through its edit form: what `changes` leaves out stays as it is (its options one by one). Renaming it renames its tag in the templates, as Moodle does. Its type can't change: delete it and add another. Returns the fields afterwards. Throws `MoodleError` (`not-found`) when the database has no such field, (`invalid-input`) for an option its type doesn't take; `DatabaseError` with Moodle's reason when it refuses the change; `NotADatabaseError` when the id isn't a database.

```bash
moodle edit-database-field <activityId> <fieldId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `fieldId` | `number` |  |
| `--name` | `string` |  |
| `--description` | `string` |  |
| `--required` | `boolean` |  |
| `--options` | `DatabaseFieldOptions` |  |

## editLessonPage

Changes a page of a lesson through its form in the lesson editor, with what's given: its title, contents, buttons or answers (given, they replace them all: the form's other rows are blanked, and Moodle drops blank ones), options and other fields. A page keeps its type. A jump to a page the lesson doesn't have is an error before anything is saved.

```bash
moodle edit-lesson-page <activityId> <pageId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `pageId` | `number` |  |
| `--title` | `string` |  |
| `--contents` | `string` | The page's contents (HTML); local files it names (`<img src="shot.png">`) go in `embed`. |
| `--embed` | `string[]` | Local files (absolute paths) to embed in the contents, answers or responses. |
| `--buttons` | `{ label: string; jumpTo?: LessonJump; }[]` | A content page's buttons, in order (given, they replace them all). |
| `--answers` | `LessonAnswer[]` | A question page's answers, in order (given, they replace them all); an essay or structural page's single row. |
| `--multiple-answers` | `boolean` |  |
| `--case-sensitive` | `boolean` |  |
| `--fields` | `Record<string, FieldValue>` | Any other field of the page's form, by name (`layout`, `display`…). |

## editPost

Changes a post through Moodle's own post form (`post.php?edit=`), as its author (within the site's editing time) or a moderator: only what's given changes. Returns the post afterwards. Throws `ForumError` with Moodle's reason when it refuses.

```bash
moodle edit-post <postId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `postId` | `number` |  |
| `--subject` | `string` |  |
| `--message` | `string` | The new message (HTML), replacing the old one. |
| `--files` | `{ add?: string[]; remove?: string[]; }` | Attachments to add (absolute local paths) and to remove (by name, as the post lists them). |
| `--embed` | `string[]` | Absolute local paths to embed in the new message, which names each by its file name (`<img src="shot.png">`). |

## editQuestionCategory

Changes a bank's category as its "Edit settings" does, only what's given: its name, its description (HTML), or its parent (`parentId`, which moves it with its subcategories and questions; the bank's Top, the top-level categories' `parentId`, moves it to the top level). Returns the category afterwards.

```bash
moodle edit-question-category <activityId> <categoryId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `categoryId` | `number` |  |
| `--name` | `string` |  |
| `--description` | `string` |  |
| `--parent-id` | `number` |  |

## editQuizSlot

Changes one slot of a quiz (by its place, from 1): its maximum mark, through the slots' service, and where it is, as dragging it on the edit page does: after another slot (`moveAfter`, 0 for first) and on a page. Moodle lets the mark change after attempts (it regrades them), not the rest.

```bash
moodle edit-quiz-slot <activityId> <slot> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `slot` | `number` |  |
| `--max-mark` | `number` |  |
| `--move-after` | `number` |  |
| `--page` | `number` |  |

## editSection

Renames, shows or hides, describes (`summary`, HTML, with `embed`'s local files in it), restricts (`restrictions`; `{ conditions: [] }` removes them) or moves a section after another one.

```bash
moodle edit-section <courseId> <sectionId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `sectionId` | `number` |  |
| `--name` | `string` |  |
| `--visible` | `boolean` |  |
| `--summary` | `string` |  |
| `--restrictions` | `Restrictions` |  |
| `--after-section-id` | `number` |  |
| `--embed` | `string[]` |  |

## enrolUsers

Enrols users in a course by manual enrolment, as the participants page's "Enrol users" dialog does: with `roleId` or the enrolment's default role, from `start` (now, unless given) until `end` (the enrolment's default duration, unless given). Users already enrolled keep their enrolment, with the new dates. Throws `EnrolmentError` with Moodle's reason when it refuses (a role the person can't assign, no manual enrolment).

```bash
moodle enrol-users <courseId> <userIds> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `userIds` | `number[]` |  |
| `--role-id` | `number` |  |
| `--start` | `Date` |  |
| `--end` | `Date` |  |

## enrolmentMethods

A course's enrolment methods, in the order Moodle tries them: each one's type, name, whether it's enabled and how many users it enrolled, and from its form the role it gives and, for self enrolment and guest access, whether it asks for a key (never the key), self enrolment's dates and limit. Throws `EnrolmentError` when the person can't manage the course's enrolment methods.

```bash
moodle enrolment-methods <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## exportGrades

Saves a course's grades into `destDir` as Moodle exports them for a teacher: a spreadsheet (`xlsx`, `ods`), comma-separated text (`csv`) or XML, with the items, group, display and feedback chosen as in the export form. Returns the file as `downloadFile` does (never overwriting one). Throws `GradebookError` when the site has that format's export plugin disabled (naming the ones it has), when an item isn't in the course, or when Moodle refuses the export.

```bash
moodle export-grades <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--format` (required) | `"ods" \| "xml" \| "xlsx" \| "csv"` |  |
| `--item-ids` | `number[]` | The grade items to export (ids from `graderReport` or `gradebookSetup`); all of them when left out. |
| `--group-id` | `number` | Only this group's members (a group id from `groups`). |
| `--display` | `GradeExportDisplay[]` | How grades are written; the site's default when left out. XML takes only one. |
| `--feedback` | `boolean` | Include each grade's feedback. |
| `--dest-dir` | `string` | The folder to save the file in (an absolute path); the `Moodle` object's `downloadDir` when left out there. |

## exportQuestions

Exports a bank's questions, or a category's (its subcategories' included), to a local GIFT or Moodle XML file, through the bank's export form; `file` (an absolute path) is written, replacing one there. The file names each question's category, as Moodle writes it by default, so importing it without a category recreates them. Hidden questions aren't exported, and a question's latest version only.

```bash
moodle export-questions <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--format` (required) | `"xml" \| "gift"` |  |
| `--category-id` | `number` |  |
| `--file` (required) | `string` |  |

## finishQuizAttempt

Submits an attempt for grading, and gives its review when the quiz shows it.

```bash
moodle finish-quiz-attempt <attemptId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |

## forumDiscussions

A forum's discussions, as its page lists them: who started each, replies, last post, the person's subscription. With `limit`, a page of them in the forum's order (see "Long lists" in the docs' concepts), read from the one page of the forum's own paging that holds it.

```bash
moodle forum-discussions <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## forumGrades

Everyone's whole-forum grade in a forum graded as a whole, as its grader shows them: one per person it can grade (only the active ones when the forum says so), with how it's graded. One service call per person. Throws `NotAForumError` for another activity, and `GradingError` when the forum isn't graded as a whole or uses an advanced grading method.

```bash
moodle forum-grades <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--group-id` | `number` |  |

## getChoice

A choice: its options, whether it can be answered or changed, and the person's answer.

```bash
moodle get-choice <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## getSurvey

A survey (questionnaire or feedback): whether it can be answered, its intro and messages, and its questions page by page. Its module is found when not given.

```bash
moodle get-survey <activityId> [type]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `type` (optional) | `SurveyType` |  |

## gradeForumUser

Gives a person their whole-forum grade, as the forum's grader does: points (out of the forum's maximum), or a scale item by name or value; `null` takes the grade away. Moodle's forum grader has no feedback text. `notify` sends the person Moodle's notification, as the grader's checkbox does. Returns a sentence of what changed and the grade afterwards. Throws `GradingError` when the forum isn't graded as a whole, the grade is out of range or not on the scale, or Moodle refuses it.

```bash
moodle grade-forum-user <activityId> <userId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `--grade` (required) | `string \| number` |  |
| `--notify` | `boolean` |  |

## gradeQuizQuestion

Grades one question of a finished attempt by hand, with a comment, through Moodle's comment form (the review's "Make comment or override mark"): an essay waiting for grading, or any question whose mark the teacher overrides. The mark is in the question's points (0 to its maximum in the quiz). Returns the attempt's grade afterwards when the results report shows it.

```bash
moodle grade-quiz-question <attemptId> <slot> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |
| `slot` | `number` |  |
| `--mark` (required) | `number` |  |
| `--comment` | `string` |  |

## gradeSubmission

Grades a participant as the grader does: a grade (simple grading), a rubric's level per criterion or a marking guide's score per criterion (by their ids, from `rubric()`), remarks per criterion, feedback comments (HTML), feedback files (local paths that replace the ones the participant has; `[]` removes them), whether to notify, and any other grading field by name. Returns the grade saved and the gradebook's grade, the total Moodle computes for a rubric or a guide, and the feedback files after saving when they were given. Throws `GradingError` when Moodle refuses the grade, or when files are given to an assignment without feedback files.

```bash
moodle grade-submission <activityId> <userId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `--grade` | `string \| number` |  |
| `--rubric` | `Record<number, number>` | Criterion id → level id. |
| `--guide` | `Record<number, number>` | Criterion id → score. |
| `--remarks` | `Record<number, string>` | Criterion id → remark, for a rubric or a guide. |
| `--feedback` | `string` |  |
| `--feedback-files` | `string[]` | Local paths (absolute): the participant's feedback files afterwards. |
| `--workflow-state` | `"notmarked" \| "inmarking" \| "readyforreview" \| "inreview" \| "readyforrelease" \| "released"` | With the marking workflow: the state to leave the submission in ("released" shows the grade). |
| `--apply-to-group` | `boolean` | With group submissions: grade every member of the participant's group alike (Moodle's default), or only them. |
| `--notify` | `boolean` |  |
| `--fields` | `Record<string, FieldValue>` |  |

## gradebookSetup

A course's gradebook setup: its categories (aggregation, weights) and grade items (category, maximum, weight).

```bash
moodle gradebook-setup <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## graderReport

Everyone's grades in a course as the grader report shows them, page by page, in one group when given, only some people's rows when given their `userIds` (the report has no filter by user: its pages are read until all of them are found). People come as user id and full name only.

```bash
moodle grader-report <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--group` | `number` |  |
| `--user-ids` | `number[]` |  |

## grantExtension

Grants participants an extension until a date, through the assignment's extension form (several at once as its bulk action does). Moodle refuses a date before the assignment's due date, and a person without its "grant extension" capability only on saving (the form opens for anyone, confirmed empirically on the sandbox, 5.2): both throw.

```bash
moodle grant-extension <activityId> <userIds> <until>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userIds` | `number[]` |  |
| `until` | `Date` |  |

## groupings

A course's groupings with their groups' ids, from its groupings page and each grouping's groups page. Throws `MoodleError` with Moodle's refusal for a person who can't manage groups.

```bash
moodle groupings <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## groups

A course's groups the person can see, with their members' user ids.

```bash
moodle groups <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## h5pActivity

An H5P activity: its content type, whether attempts are tracked, and the person's attempts with their scores.

```bash
moodle h5p-activity <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## importActivities

Imports activities from another course into a course, as Moodle's "Import" does: every activity of `fromCourseId`, or only `activityIds`, added to `toCourseId`'s content (with their sections), without users' data. Needs `moodle/restore:restoretargetimport` in the course imported into and `moodle/backup:backuptargetimport` in the other. Returns the activities the course has afterwards that it didn't have before, by id.

```bash
moodle import-activities <fromCourseId> <toCourseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `fromCourseId` | `number` |  |
| `toCourseId` | `number` |  |
| `--activity-ids` | `number[]` |  |

## importQuestions

Imports questions into a bank from a GIFT or Moodle XML file (a local path) or text, through the bank's import form; returns the questions created. A file Moodle can't parse comes back as a `QuestionBankError` with its messages, and nothing is imported.

```bash
moodle import-questions <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--format` (required) | `"xml" \| "gift"` |  |
| `--file` | `string` |  |
| `--text` | `string` |  |
| `--category-id` | `number` |  |

## lessonPage

The lesson page the person is on (starting the lesson the first time).

```bash
moodle lesson-page <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## lessonPages

The pages of a lesson as its teacher has them in Moodle's lesson editor, in order: type, title, contents, and a content page's buttons or a question's answers with their responses, scores and jumps. Reads the editor's expanded view and each page's form; the person's choice of view (collapsed or expanded, which Moodle remembers) is put back afterwards. Takes a teacher's role.

```bash
moodle lesson-pages <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## listAssignments

The course's assignments, in the course's order, with the section each is in.

```bash
moodle list-assignments <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## listCourses

The courses the person is enrolled in, as teacher or student.

```bash
moodle list-courses [classification]
```

| Argument | Type | Description |
| --- | --- | --- |
| `classification` (optional) | `"all" \| "inprogress" \| "future" \| "past"` |  |

## logIn

Makes sure there's a session: at once if there is one, else a window where the person logs in (`loginTimeoutMs` by default).

```bash
moodle log-in [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--timeout-ms` | `number` |  |

## logOut

Logs the person out of Moodle through the user menu's logout link (it carries the sesskey; without one Moodle asks to confirm, and the confirmation is accepted). Returns false when nobody was logged in. Only Moodle's session ends: a single sign-on provider may keep its own.

```bash
moodle log-out
```

## markNotificationsRead

Marks all the person's notifications read, as the popover's "Mark all as read" does; doing it twice changes nothing.

```bash
moodle mark-notifications-read
```

## messageParticipants

Sends one message to several participants of a course, as the participants page's "Send a message" does for the users selected: one private message each, in one call. They are `userIds`, or the participants `participants()` chooses with `role`, `group` and `inactiveSince` (all of them when none is given), the person left out. `sentTo` lists exactly who got it, `refused` who Moodle didn't write to and why (they blocked the person, their privacy settings); someone who may message any user (a teacher, `moodle/site:messageanyuser`) gets through a block, as in Moodle's own page (confirmed empirically, Moodle 5.2). Throws `MessageError` for an empty message or nobody to write to, `NoParticipantsError` when the person can't see the course's participants.

```bash
moodle message-participants <courseId> <text> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `text` | `string` |  |
| `--user-ids` (required) | `number[]` |  |

## moveBookChapter

Moves a chapter one place up or down, as the table of contents' arrows do: a chapter moves with its subchapters, past the whole chapter before or after it; a subchapter moves alone, past one chapter or subchapter. Moodle may make a subchapter that ends up first a chapter. Throws `BookError` when the chapter isn't in the book.

```bash
moodle move-book-chapter <activityId> <chapterId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `chapterId` | `number` |  |
| `--direction` (required) | `"up" \| "down"` |  |

## moveLessonPage

Moves a page of a lesson after page `after` (0 puts it first), as the editor's move link does; returns the pages in order.

```bash
moodle move-lesson-page <activityId> <pageId> <after>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `pageId` | `number` |  |
| `after` | `number` |  |

## moveQuestions

Moves questions into a category of a bank, several at once, as the bank's bulk "Move to" does (Moodle's core_question_move_questions service). A question keeps its id and versions.

```bash
moodle move-questions <activityId> <questionIds> <categoryId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `questionIds` | `number[]` |  |
| `categoryId` | `number` |  |

## myGrades

The person's own grade report for a course.

```bash
moodle my-grades <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## notifications

The person's notifications, newest first, only the unread ones when asked. With `limit`, a page of them (see "Long lists" in the docs' concepts): Moodle's service gives only the page, or, for the unread ones, batches until the page is full (it has no unread filter).

```bash
moodle notifications [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--unread-only` | `boolean` | Only the unread ones; `offset` then counts unread ones. |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## overrideCompletion

Sets someone's completion of an activity as a teacher does from the progress report; returns the state saved.

```bash
moodle override-completion <activityId> <userId> <state>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `state` | `"incomplete" \| "complete" \| "complete-pass" \| "complete-fail"` |  |

## participantFilters

The roles and groups the participants page filters by in a course (its filters' options), as the person may use them: every group, or only their own in a course with separate groups. "No roles" and "no group" left out.

```bash
moodle participant-filters <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## participants

A course's participants with their roles and groups, as the participants page lists them: only those with a role (its id), in a group, or (`inactiveSince`) who haven't accessed the course since that date, when asked. Each role and group is a filter of its own, so ids come in any language. With `limit`, a page of them in the page's order, by last name (see "Long lists" in the docs' concepts): the one page of the table's own paging that holds it; the roles' and groups' members are still read whole, to tell each one's.

```bash
moodle participants <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--role` | `number` | Only those with this role (its id). |
| `--group` | `number` | Only those in this group (its id). |
| `--inactive-since` | `Date` | Only those who haven't accessed the course since this date. |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## participationReport

Who took part in an activity of a course, as its participation report counts it: everyone with the role (every role the report offers, unless `roleId`), with how many actions they made there (views or posts only, when `action`; since `since`, when given); those who did nothing come with 0.

```bash
moodle participation-report <courseId> <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |
| `--role-id` | `number` |  |
| `--since` | `Date` |  |
| `--action` | `"view" \| "post"` |  |

## pendingActivities

What the person still has to do in a course: activities whose completion is tracked and not complete or, where completion isn't tracked, graded activities without a grade yet.

```bash
moodle pending-activities <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## potentialUsers

Users the person may enrol in a course by manual enrolment, matching `search` anywhere in their name or the identity fields the site shows (all of them, a page of up to 100, when empty), as the "Enrol users" dialog finds them. Throws `EnrolmentError` when the course has no manual enrolment the person can use.

```bash
moodle potential-users <courseId> [search]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `search` (optional) | `string` |  |

## publicSiteInfo

What the site tells anyone before logging in, without the browser.

```bash
moodle public-site-info
```

## questionBanks

A course's question banks: its shared ones and the activities' own, as the banks page lists them.

```bash
moodle question-banks <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## questionCategories

A bank's categories as its categories page shows them, parents before their subcategories: each one's id, name, parent, description and the questions directly in it. The bank's hidden "Top" category isn't one of them: it's the `parentId` of the top-level ones. Reading the page takes the capability to manage the bank's categories, which `questions` doesn't, so it's a function of its own.

```bash
moodle question-categories <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## questions

A bank's categories and every question in them, category by category. With `limit`, `questions` is a page of them in that order (see "Long lists" in the docs' concepts), the categories all: the bank is read category by category until the page is full, each category whole and cut (its page counts aren't reliable enough to skip by).

```bash
moodle questions <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## questionsToGrade

The questions of a quiz that wait for grading by hand (essays…), as its manual grading report lists them, each with the finished attempts whose answer requires grading (from the results report). People as user id and full name.

```bash
moodle questions-to-grade <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## quizInfo

A quiz's page as the person sees it: its description and dates, the person's attempts with their summary, and whether they can start one.

```bash
moodle quiz-info <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## quizResults

A quiz's attempts as its grades report shows them: per attempt the user, state, dates, grade and the mark per question; with `responses`, also the answer per question from the responses report. Every page of the report; with `limit`, `attempts` is a page of them in the report's order (see "Long lists" in the docs' concepts), read from the one page of the report's own paging that holds it.

```bash
moodle quiz-results <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--responses` | `boolean` | Also the answer per question, from the responses report. |
| `--limit` | `number` | How many items to return (1 or more): with it, the list comes as a `ListPage`; without it, every item, as a plain list. |
| `--offset` | `number` | How many items to skip first, in the function's own order: 0 unless given. |

## quizStructure

A quiz's questions as its edit page lists them: slots with their page, question, type, name and mark, and its sections.

```bash
moodle quiz-structure <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## rate

Rates a forum post, a glossary entry or a database record as the person, as the rating menu under it does: by a scale item's name, or its number (the points of a point scale). `null` takes the person's rating away. Returns a sentence of what changed and the item's aggregate afterwards (as Moodle shows it, by the activity's aggregation) with the number of ratings. Throws `GradingError` when the item has no rating menu for the person (ratings off, their own item, outside the rating period, or no permission) or the rating isn't on its scale.

```bash
moodle rate <item> <rating>
```

| Argument | Type | Description |
| --- | --- | --- |
| `item` | `RateableItem` |  |
| `rating` | `string \| number` |  |

## readAttempt

Every question of an attempt, page by page, with the page each is on.

```bash
moodle read-attempt <attemptId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |

## readReview

A finished attempt's review, as far as the quiz's review options let the person see it.

```bash
moodle read-review <attemptId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |

## removeQuizSlot

Removes a slot (by its place, from 1) from a quiz, as the edit page's delete icon does; the question stays in its bank.

```bash
moodle remove-quiz-slot <activityId> <slot>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `slot` | `number` |  |

## removeReviewer

Removes a reviewer's allocation to a submission, as the delete icon of Moodle's manual allocation page does: Moodle deletes the reviewer's assessment of it. An assessment the reviewer already graded is only deleted with `evenIfAssessed` (Moodle warns about it and the grade is lost). The submission is given by its id or its author's. Returns a sentence of what changed, the assessment removed, and the submission's reviewers afterwards. Throws `WorkshopError` when the reviewer isn't allocated to it, when the assessment is graded and `evenIfAssessed` isn't set, or when the person can't allocate (`mod/workshop:allocate`).

```bash
moodle remove-reviewer <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--even-if-assessed` | `boolean` | Remove it even when the reviewer already assessed the submission (the assessment and its grade are deleted). |
| `--submission-id` | `number` | The submission's id (give this or `authorId`). |
| `--author-id` | `number` | The submission's author's user id. |
| `--reviewer-id` (required) | `number` | The reviewer's user id. |

## replyToPost

Replies to a post; returns the new post's id and its discussion's, and, when `subscribe` is given, the person's subscription to the discussion afterwards, read back (`subscribed`).

```bash
moodle reply-to-post <postId> <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `postId` | `number` |  |
| `input` | `PostInput & { subject?: string; }` |  |

## resetCourse

Resets a course for a new year, as Moodle's reset form does: deletes only what's named in `delete` (in every module of the course that has it), unenrols the people with `unenrolRoles` (role ids), moves the course's start date to `start` (and its activities' dates with it), and sets any other of the form's fields by name (`fields`). Nothing is deleted unless asked: the form's own defaults are unticked first. It can't be undone. Returns Moodle's report: per component, what it did and its errors. Needs `moodle/course:reset`.

```bash
moodle reset-course <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--delete` | `ResetDeletions` |  |
| `--unenrol-roles` | `number[]` |  |
| `--start` | `Date` |  |
| `--fields` | `Record<string, FieldValue>` |  |

## restoreCourse

Restores a backup file (`.mbz`) through Moodle's restore wizard: into a new course in a category (`into: "new"`, with `categoryId`, which needs `moodle/course:create` there), or into an existing course (`into: <course id>`), its content added to the course's (`mode: "merge"`, the default) or replacing it (`"replace"`: the course's content is deleted first). A new course takes the backup's names unless `fullName` and `shortName` are given. Users' data is restored when `withUsers` and the backup has it. An asynchronous restore is waited for up to `timeoutMs` (ten minutes). Needs `moodle/restore:restorecourse` where it restores. Before the wizard, the backup is read: one made on a newer Moodle than the site's, or holding activities of a type the site doesn't offer the person in that course, is refused (Moodle would warn only, or skip those activities without a word). Merged into an existing course, Moodle puts each of the backup's sections into the course's section of the same number (creating it when there's none) and each activity at the end of it; `sectionId` puts every restored activity at the end of that section instead, and `afterSectionId` makes each of the backup's sections a new section, in order, after that one (the driver restores, then moves what Moodle made: one move per section). With either, a section of the course that Moodle changed on the way (named, described, hidden or restricted as the backup's, when it had none) is put back. Returns the sections and activities the course has new, in the course's order.

```bash
moodle restore-course <file> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `file` | `string` |  |
| `--into` (required) | `number \| "new"` |  |
| `--category-id` | `number` |  |
| `--mode` | `"merge" \| "replace"` |  |
| `--full-name` | `string` |  |
| `--short-name` | `string` |  |
| `--with-users` | `boolean` |  |
| `--section-id` | `number` | Merged into an existing course: every restored activity at the end of this section. |
| `--after-section-id` | `number` | Merged into an existing course: the backup's sections as new sections after this one. |
| `--timeout-ms` | `number` |  |

## rubric

An assignment's grading method and, for a rubric or a marking guide, its criteria with the ids `gradeSubmission` takes: read from the grader's panel for the first participant with a submission. Where nobody has one yet, the panel is the first participant's, and Moodle creates an empty submission ("new") for them on opening it.

```bash
moodle rubric <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## saveSubmission

Saves the submission's online text and adds files, as "Save changes" on the edit page does; gives the assignment afterwards.

```bash
moodle save-submission <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--online-text` | `string` |  |
| `--files` | `string[]` |  |

## scheduleAllocation

Turns the scheduled allocation on or off, as Moodle's scheduled allocation form does: when on, Moodle runs the random allocation by itself at the end of the submission phase (once the workshop's submissions deadline passes, by its cron), with the settings given here (those of `allocateRandomly`; the ones left out keep what the form has). Returns a sentence of what changed and the scheduled allocation afterwards, with Moodle's status of it (a workshop without a submissions deadline is never allocated). Throws `WorkshopError` for a setting the workshop doesn't have or when the person can't allocate (`mod/workshop:allocate`); `FormError` when Moodle refuses the form.

```bash
moodle schedule-allocation <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--enabled` (required) | `boolean` | On: Moodle allocates at random by itself at the end of the submission phase; off: it doesn't. |
| `--per-submission` | `number` | Reviews each submission gets (Moodle's "Number of reviews … per submission"); give this or `perReviewer`. |
| `--per-reviewer` | `number` | Reviews each reviewer does ("… per reviewer"). |
| `--keep-current` | `boolean` | Keep the allocations there are (default) or remove them first ("Remove current allocations"; Moodle never removes graded ones). |
| `--without-submission` | `boolean` | Reviewers without a submission of their own too ("Participants can assess without having submitted anything"); off by default. |
| `--self-assessment` | `boolean` | Add each author's self-assessment ("Add self-assessments"), where the workshop allows it; off by default. |
| `--exclude-same-group` | `boolean` | Prevent reviews by peers of the same group ("Prevent reviews by peers from the same group"), only in visible groups mode; off by default. |

## scorm

A SCORM activity as the person sees it: its attempts (allowed and made), the grading method, the grade reported and each attempt's, and its SCOs with the person's status and score in the last attempt. Moodle doesn't show a SCORM's version on its page: `openScorm` tells it.

```bash
moodle scorm <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## sendMessage

Sends a private message to a user, as the messaging drawer does; returns the message and its conversation.

```bash
moodle send-message <userId> <text>
```

| Argument | Type | Description |
| --- | --- | --- |
| `userId` | `number` |  |
| `text` | `string` |  |

## setBadgeCriteria

Sets a badge's criteria through its criterion forms: activity completion (course module ids), course completion (with a minimum grade and a date), and manual award by role; `all` sets whether all criteria must be met or any. A criterion given replaces that kind's settings, `null` removes it, one not given stays. Moodle lets criteria change only while the badge is disabled and nobody has it. Returns the criteria afterwards. Throws `BadgeError` when the person can't set criteria (it takes moodle/badges:configurecriteria), when the badge is enabled or already awarded, and for activities or roles the criterion doesn't offer (naming them); `BadgesDisabledError` on a site with badges off.

```bash
moodle set-badge-criteria <badgeId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `badgeId` | `number` |  |
| `--activities` | `{ activityIds: number[]; all?: boolean; }` | Completing these activities (course module ids, with completion tracking); `all` defaults to true (Moodle's form to "any"). |
| `--course-completion` | `{ minGrade?: number; by?: Date; }` | Completing the course (it must track completion), optionally with a minimum course grade and by a date (in the person's time zone, the day counts). |
| `--manual` | `{ roleIds: number[]; all?: boolean; }` | Awarded by hand by people with these roles (only roles that may award badges); `all` defaults to false: any one of them awards it. |
| `--all` | `boolean` | With more than one criterion: whether all must be met or any one; ignored with one. |

## setBadgeEnabled

Enables or disables a badge through the service its badges page's buttons call. Enabling awards it at once to whoever already meets its criteria; Moodle needs criteria first. A badge already in that state is left as it is. Returns the badge afterwards. Throws `BadgeError` when the person can't (it takes moodle/badges:configurecriteria) or the badge has no criteria, `BadgesDisabledError` on a site with badges or course badges off.

```bash
moodle set-badge-enabled <badgeId> <enabled>
```

| Argument | Type | Description |
| --- | --- | --- |
| `badgeId` | `number` |  |
| `enabled` | `boolean` |  |

## setBookChapterVisible

Shows a chapter to students or hides it from them, as the table of contents' eye does: a chapter's subchapters are shown or hidden with it, and a subchapter of a hidden chapter stays hidden. Throws `BookError` when the chapter isn't in the book.

```bash
moodle set-book-chapter-visible <activityId> <chapterId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `chapterId` | `number` |  |
| `--visible` (required) | `boolean` |  |

## setCompletion

Marks the person's own completion of an activity with manual completion, done or not, as its "Mark as done" button does; doing it twice changes nothing. An activity that completes on its own gives a `CompletionError`.

```bash
moodle set-completion <activityId> <done>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `done` | `boolean` |  |

## setDatabaseTemplate

Saves one of a database's templates (`DATABASE_TEMPLATES`) as it is, without Moodle's HTML editor in between, as its templates page's Save does; `null` resets it to Moodle's default (for the list template alone: its header and footer stay). Fields go in as `[[name]]`, Moodle's other tags as `##tag##` (the templates page lists them). Returns every template afterwards. Throws `MoodleError` (`invalid-input`) for a template that isn't one of `DATABASE_TEMPLATES`; `DatabaseError` when the database has no fields yet, Moodle doesn't keep the template (an add entry template with a field's tag twice) or the person can't manage it; `NotADatabaseError` when the id isn't a database.

```bash
moodle set-database-template <activityId> <template> <html>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `template` | `"list" \| "listHeader" \| "listFooter" \| "single" \| "add" \| "search" \| "rss" \| "rssTitle" \| "css" \| "js"` |  |
| `html` | `string` |  |

## setDiscussionState

Pins or unpins, locks or unlocks a discussion, as the discussion list's menu does; what's already so is left alone. Returns the discussion as the forum lists it afterwards.

```bash
moodle set-discussion-state <activityId> <discussionId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `discussionId` | `number` |  |
| `--pinned` | `boolean` |  |
| `--locked` | `boolean` |  |

## setDiscussionSubscription

Subscribes the person to a discussion or unsubscribes them, as the discussion list's toggle does (`mod_forum_set_subscription_state`); what's already so is left alone. Returns the discussion as the forum lists it afterwards.

```bash
moodle set-discussion-subscription <activityId> <discussionId> <subscribed>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `discussionId` | `number` |  |
| `subscribed` | `boolean` |  |

## setEnrolmentMethod

Sets an enrolment method: by id, or the course's first method of a type (`{ type: "self" }`), added when the course has none and the "Add method" menu offers it. Only what's given changes. `enabled` goes through the methods page's enable and disable icons, the rest through the method's form: what Moodle lets the person change differs by method (an editing teacher can't configure manual enrolment, enrol/manual:config, so neither switch it nor set its role). Returns the method afterwards. Throws `EnrolmentError` for a method the course doesn't have or can't add, and for a setting Moodle doesn't let the person change (naming it); `FormError` with Moodle's reason when it refuses the form (a key required by the site, an end before the start).

```bash
moodle set-enrolment-method <courseId> <method> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `method` | `number \| { type: string; }` |  |
| `--enabled` | `boolean` |  |
| `--key` | `string` | Self enrolment and guest access: the key to ask for; "" removes it. |
| `--start` | `Date` | Self enrolment: from when and until when students may enrol; `null` removes the limit. |
| `--end` | `Date` |  |
| `--role-id` | `number` | The role it gives (manual and self enrolment). |
| `--max-users` | `number` | Self enrolment: the most users it enrols; 0 for no limit. |
| `--welcome` | `string \| false` | Manual and self enrolment: the welcome message to send (from the course contact unless another sender is set); `false` sends none. |

## setGrade

Sets a person's grade in a grade item through the gradebook's single view report, as a teacher does there: a manual item takes the grade; an activity's or a category's is overridden (Moodle keeps the override until it's taken off with `override: false`). Feedback and excluding from the totals go the same way. Returns a sentence of what changed and the grade afterwards. Throws `GradebookError` when the item or the person isn't in the course's gradebook, the grade is locked, or Moodle refuses the value (out of range, a scale item it doesn't have).

```bash
moodle set-grade <courseId> <itemId> <userId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `itemId` | `number` |  |
| `userId` | `number` |  |
| `--grade` | `string \| number` | A number, or a scale item's name or value for a scale; `null` empties the grade. |
| `--feedback` | `string` | Feedback text; an empty string removes it. |
| `--override` | `boolean` | Override the activity's or category's grade. Giving a grade or feedback to an activity's or a category's item overrides it unless this says `false`; `false` alone gives the grade back to the activity. |
| `--excluded` | `boolean` | Leave the grade out of the totals. |

## setGradingDefinition

Sets an assignment's advanced grading method (a rubric or a marking guide) and saves its definition through Moodle's editor form, ready for use, as "Define new grading form from scratch" and "Save rubric and make it ready" (or the guide's) do: one is created where there is none, and the one there is replaced (its criteria, levels and comments, so their ids change). Moodle's editor offers to save as a draft only while nothing has been graded with the definition: without that, it would ask to regrade on saving, so the driver refuses with `GradingError` before anything changes (the method too). Returns the definition as `rubric` reads it, read from the editor form, not from a grading panel, so it creates no submission. Throws `GradingError` when the person lacks `moodle/grade:managegradingforms` or Moodle refuses the definition, `NotAnAssignmentError` when the id isn't an assignment they can grade, and `MoodleError` (`invalid-input`) for a definition Moodle's editor wouldn't take (no criteria, a rubric criterion with fewer than two levels…).

```bash
moodle set-grading-definition <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--method` (required) | `"rubric"` |  |
| `--name` (required) | `string` | The rubric's name, as the advanced grading page lists it. |
| `--description` | `string` | Its description (HTML), shown to students where Moodle shows it. |
| `--criteria` (required) | `{ description: string; levels: { definition: string; score: number; }[]; }[]` |  |

## setGroupMembers

Adds and removes a group's members (user ids), as its members page does. Only the course's participants can be added: ids the page doesn't offer (not enrolled, or already members) and members not in it are left as they were and named in `changed`. Returns the members afterwards.

```bash
moodle set-group-members <groupId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `groupId` | `number` |  |
| `--add` | `number[]` |  |
| `--remove` | `number[]` |  |

## setGroupingGroups

Makes a grouping's groups exactly `groupIds`, as its groups page adds and removes them. Groups of other courses aren't offered there and are left out, named in `changed`. Returns the groups afterwards.

```bash
moodle set-grouping-groups <groupingId> <groupIds>
```

| Argument | Type | Description |
| --- | --- | --- |
| `groupingId` | `number` |  |
| `groupIds` | `number[]` |  |

## setQuestionStatus

Sets a question ready (quizzes can use it) or draft, as the bank's status menu does, through its service.

```bash
moodle set-question-status <questionId> <status>
```

| Argument | Type | Description |
| --- | --- | --- |
| `questionId` | `number` |  |
| `status` | `"ready" \| "draft"` |  |

## setQuizOverride

Sets a user override on a quiz, through its override form: other opening and closing dates, a time limit in minutes, or a number of attempts (0 unlimited); what isn't given stays the quiz's.

```bash
moodle set-quiz-override <activityId> <userId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `--open` | `Date` |  |
| `--close` | `Date` |  |
| `--time-limit-minutes` | `number` |  |
| `--attempts` | `number` |  |

## setQuizPages

Sets a quiz's pages: `perPage` questions a page (0 for all on one), as the edit page's "Repaginate" does, or page breaks exactly after the given slots (and nowhere else), as its page break icons do one by one.

```bash
moodle set-quiz-pages <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--per-page` (required) | `number` |  |

## setUserRoles

Sets a user's roles in a course, as the participants page's roles column does: gives the roles in `roleIds` the person may assign, and takes away the others the person may assign. Roles the person can't assign that the user already holds, and those from elsewhere (a category, an enrolment that protects them), stay. Returns the user's roles afterwards, as that column shows them. Throws `EnrolmentError` with Moodle's reason for a role the person can't assign or a user not enrolled.

```bash
moodle set-user-roles <courseId> <userId> <roleIds>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `userId` | `number` |  |
| `roleIds` | `number[]` |  |

## setWorkflowState

Sets the marking workflow state of participants' submissions, as the grading table's "Set marking workflow state" does; "released" shows them their grades, notifying them when `notify` is true (the form's default is not to). With several markers, it sets the submission's overall state.

```bash
moodle set-workflow-state <activityId> <userIds> <state> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userIds` | `number[]` |  |
| `state` | `"inmarking" \| "readyforreview" \| "inreview" \| "readyforrelease" \| "released"` |  |
| `--notify` | `boolean` |  |

## setWorkshopPhase

Switches a workshop to a phase, as its page's phase links do, confirming Moodle's question (any phase, forwards or back; Moodle allocates nothing and calculates no grades on its own when it switches). Returns a sentence of what changed and the phase afterwards. Throws `WorkshopError` when the person can't switch the workshop's phases (Moodle's `mod/workshop:switchphase`, a teacher's) or the id isn't a workshop's.

```bash
moodle set-workshop-phase <activityId> <phase>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `phase` | `WorkshopPhase` |  |

## siteName

The site's name, from its public settings; `undefined` where the mobile app support is off.

```bash
moodle site-name
```

## startDiscussion

Starts a discussion in a forum; returns its id, and whether it's pinned and the person subscribed to it, as the forum lists it afterwards, so one call confirms what `subscribe` and `fields` set.

```bash
moodle start-discussion <activityId> <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `input` | `PostInput & { subject: string; }` |  |

## startQuizAttempt

Starts an attempt, or continues the one in progress, and gives its questions.

```bash
moodle start-quiz-attempt <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## studentAssignment

An assignment as the student sees it: its description and files, dates, the submission's status and files, the feedback, and whether it can be edited or submitted now.

```bash
moodle student-assignment <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## submitForGrading

Submits the saved submission for grading, accepting the site's statement when it asks for one (`acceptStatement`, once the person agrees; a bare boolean as before 0.2 too); gives the assignment afterwards.

```bash
moodle submit-for-grading <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--accept-statement` | `boolean` |  |

## submitSurvey

Fills the survey page by page with `responses` (field name → value) and submits it on the last page. Every name is checked against the form first, so nothing is sent with a wrong one.

```bash
moodle submit-survey <activityId> <responses> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `responses` | `Record<string, string>` |  |
| `--type` | `SurveyType` |  |

## unenrolUser

Unenrols a user from a course: removes every enrolment of theirs the person may remove (its unenrol link on the participants page), with their roles and group memberships in the course, as that link does. `changed` and `removed` say which ones (by enrolment method's name), `kept` those the person may not remove (a cohort sync, another teacher's method). Throws `EnrolmentError` when the user isn't enrolled.

```bash
moodle unenrol-user <courseId> <userId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `userId` | `number` |  |

## upcomingEvents

The person's upcoming events, as the calendar's "Upcoming events" view lists them, in one course or all.

```bash
moodle upcoming-events [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--course-id` | `number` |  |

## updateActivity

Changes an existing activity through its form: only what's given changes. A file resource's or folder's files stay as they are unless `files` says what to add, remove or replace. `package` (a local `.zip`, absolute path) replaces a SCORM's package in place: the activity keeps its id, settings and grade item, and the result has it as `scorm` reads it afterwards. Moodle matches the new package's SCOs to the old ones by their identifier in the manifest: one kept keeps its tracks (the attempts made in it) and a new one starts not attempted (confirmed empirically, 5.2), one gone is deleted with its tracks (`scorm_parse_scorm`). A package Moodle can't read is an `ActivitySettingsError`, with nothing changed.

```bash
moodle update-activity <activityId> <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `input` | `ActivityFields & { files?: FileChanges; package?: string; }` |  |

## updateCourse

Changes a course's full name, short name, summary (HTML) or any other setting by its form field name, through the course's settings form; returns the course as `listCourses` gives it. `embed` takes local files the summary names (`<img src="shot.png">`), put in it as Moodle's editor does. Moodle's refusals (a short name already taken) come back as `FormError` by field.

```bash
moodle update-course <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--full-name` | `string` |  |
| `--short-name` | `string` |  |
| `--summary` | `string` |  |
| `--settings` | `Record<string, FieldValue>` |  |
| `--embed` | `string[]` |  |

## updateEvent

Changes a calendar event through the calendar's own form, opened on it: only what's given changes. A new start keeps the event's length unless a new one is given. Returns the event as the calendar has it afterwards.

```bash
moodle update-event <eventId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `eventId` | `number` |  |
| `--name` | `string` |  |
| `--description` | `string` | HTML, sent as written. |
| `--start` | `Date` |  |
| `--duration-minutes` | `number` | The new length in minutes; 0 leaves the event without one. |
| `--until` | `Date` | The new end, instead of a length in minutes. |
| `--location` | `string` |  |
| `--whole-series` | `boolean` | For an event of a repeated series: change every event of the series (Moodle's default), or only this one. |

## updateGradeCategory

Changes a grade category: its name, its aggregation, its weight in its parent (percent, overriding Natural's automatic one), or moves it into another category. Returns the category afterwards.

```bash
moodle update-grade-category <courseId> <categoryId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `categoryId` | `number` |  |
| `--name` | `string` |  |
| `--aggregation` | `"mean" \| "median" \| "lowest" \| "highest" \| "mode" \| "weighted-mean" \| "simple-weighted-mean" \| "mean-with-extra-credits" \| "natural"` |  |
| `--weight` | `number` |  |
| `--parent-id` | `number` |  |

## updateGradeItem

Changes a grade item: moves it into a category, sets its weight (percent, overriding Natural's automatic one), or its maximum grade (a manual item's; an activity's is set in the activity). Returns the item afterwards.

```bash
moodle update-grade-item <courseId> <itemId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `itemId` | `number` |  |
| `--category` | `number` |  |
| `--weight` | `number` |  |
| `--max-grade` | `number` |  |

## updateGroup

Changes a group's name, description, ID number or enrolment key with its form; what isn't given stays.

```bash
moodle update-group <groupId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `groupId` | `number` |  |
| `--name` | `string` |  |
| `--description` | `string` | HTML. |
| `--id-number` | `string` |  |
| `--enrolment-key` | `string` | The key that puts a student enrolling with self enrolment in this group. |

## updateQuestion

Changes a question of a bank through its type's edit form, with the same inputs as `createQuestion` and only what's given (`answers` replaces them all). Saving makes a new version of the question, with an id of its own: the one returned, which quizzes using the latest version get from then on.

```bash
moodle update-question <activityId> <questionId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `questionId` | `number` |  |
| `--name` | `string` |  |
| `--text` | `string` | The question's text (HTML). |
| `--answers` | `{ text: string; fraction: number; feedback?: string; tolerance?: number; }[]` | Multichoice, short answer and numerical answers: a fraction of the mark (1 right, 0 wrong, negatives for penalties), the nearest one Moodle offers. A numerical answer's `tolerance` is the error accepted around it. |
| `--fields` | `Record<string, FieldValue>` | Any other field of the type's form, by name. |
| `--correct` | `boolean` | True/false: the right answer. |
| `--category-id` | `number` | The bank's category it goes in; a new question goes in the bank's default one when left out. |
| `--default-mark` | `number` |  |

## userById

A user by id, or `undefined` when there's nobody: no such user, one the person may not see, or a deleted account. Moodle keeps a deleted account's record and its user service still gives it to an administrator, renamed, with the email replaced by an MD5 hash of the old username (`delete_user`, confirmed empirically on the sandbox, 5.2); the driver treats it as gone.

```bash
moodle user-by-id <userId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `userId` | `number` |  |

## whoAmI

Who the logged-in person is; with `courseId`, also their roles and abilities in that course.

```bash
moodle who-am-i [courseId]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` (optional) | `number` |  |

## workshopAllocation

A workshop's allocation, as Moodle's manual allocation page shows it to a teacher (every page of it, in the course's current group): each submission with its author and the reviewers allocated to it (with the id of the assessment Moodle made for each, assessed or not), and the participants who may be allocated as reviewers. A teacher's own assessments count as allocations too. Throws `WorkshopError` when the person can't allocate (Moodle's `mod/workshop:allocate`, a teacher's) or the id isn't a workshop's.

```bash
moodle workshop-allocation <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## workshopInfo

A workshop's phase, and its report as the workshop's page shows it to a teacher: every submission (its author, title, and grade once calculated) and every assessment (reviewer, the submission's author, the grade it gives, its weight, the grade for assessing once calculated), all of its pages. The report is Moodle's own: it shows from the submission phase on to those who can see every submission, in the course's current group; for anyone else the lists are empty. Grades are out of the workshop's grade for submission, as Moodle shows them. Throws `WorkshopError` for an activity that isn't a workshop the person can view.

```bash
moodle workshop-info <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
