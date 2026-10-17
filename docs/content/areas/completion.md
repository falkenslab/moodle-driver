# Completion

Activity completion is how Moodle tracks what each participant has done in a course. This area covers the three sides of it: a student marking their own manual completion (`setCompletion`), a teacher overriding someone's completion (`overrideCompletion`), and a teacher reading the course's progress report, everyone's completion of every activity (`completionReport`). The person's own completion of each activity also comes with the course's structure (`courseStructure`). Course completion, whether someone has completed the course as a whole, is apart: its criteria, each participant's status and marking someone complete by hand (see [Course completion](#course-completion)); the progress report is never the course completion report.

**Terms:** [completion](../reference/glossary.md#completion), [activity](../reference/glossary.md#activity).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

Completion has to be enabled in the course. Each activity's rules (manual, or automatic on view, grade, submission…) are set with `createActivity` and `updateActivity`'s `completion`, and read back with `activitySettings` (see [Restrictions and completion](activities.md#restrictions-and-completion)).

## Completion states

Moodle's four completion states, by name, are exported as `COMPLETION_STATES` (in Moodle's order, `COMPLETION_INCOMPLETE` to `COMPLETION_COMPLETE_FAIL`):

```ts
const COMPLETION_STATES = ["incomplete", "complete", "complete-pass", "complete-fail"] as const;
type CompletionState = (typeof COMPLETION_STATES)[number];
```

- `incomplete`: not done yet.
- `complete`: done.
- `complete-pass`: done, with a passing grade (an activity that requires one).
- `complete-fail`: done, with a grade below the passing grade.

## setCompletion

Marks the person's own completion of an activity with manual completion, done or not done, as its "Mark as done" button does. Marking it twice changes nothing.

```ts
function setCompletion(context: BrowserContext, siteUrl: string, activityId: number, done: boolean): Promise<{ changed: string }>;
```

- `activityId`: the activity's id (course module id) (the `id` in `courseStructure`).
- `done`: `true` for done, `false` to undo it.

It returns a sentence ("Activity 5 marked done."). It goes through the service the button uses (`core_completion_update_activity_completion_status_manually`).

It throws `CompletionError` when:

- the activity completes automatically (on view, grade, submission…): it can't be marked by hand;
- completion isn't enabled in the activity's course;
- the person isn't allowed to change completion there.

Any other refusal from Moodle comes as `MoodleServiceError`, with Moodle's error code (see [Errors](../concepts/errors.md)).

When a program goes through activities as a student would, the trail described in [Student pace](../concepts/student-pace.md) lets Moodle record views (and automatic completion on view) as for a person.

## overrideCompletion

Sets someone else's completion of an activity as a teacher does from the progress report, and returns the state Moodle saved.

```ts
function overrideCompletion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  state: CompletionState,
): Promise<{ changed: string; state: CompletionState; overridden: boolean }>;
```

- `userId`: the participant (see [Participants](participants.md)).
- `state`: the state to set, by name; it's sent as Moodle's state number. The progress report itself overrides to `complete` or `incomplete`.

It returns:

- `changed`: a sentence ("User 4's completion of activity 6 set to complete.").
- `state`: the state Moodle has after the override.
- `overridden`: whether Moodle records the state as set by a teacher.

It goes through `core_completion_override_activity_completion_status`, which needs the capability to override completion in the course (teachers have it by default). The errors are those of `setCompletion`: `CompletionError` for completion not enabled or not allowed, `MoodleServiceError` for anything else Moodle refuses.

## completionReport

A course's progress report (`report/progress/index.php`): every participant's completion of every activity that tracks it, page by page until no new rows come, optionally in one group.

```ts
function completionReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { group?: number; userIds?: number[] }): Promise<CompletionReport>;

interface CompletionReport {
  activities: { id: number; name: string; type: string }[];
  participants: { userId: number; fullName: string; completion: CompletionCell[] }[];
}

interface CompletionCell {
  activityId: number;
  state: CompletionState;
  tracking: "manual" | "auto";
  overridden: boolean;
}
```

- `activities`: the report's columns, by course module id, name and module ("page", "quiz"…), read from the header links.
- `userIds`: only these people's rows. The report has no filter by user: its pages are read until all of them are found.
- `participants`: one per row, by user id and full name only. The report also shows other identity fields (an email, say): they're not read.
- `completion`: one cell per activity, in the activities' order. `tracking` says whether the activity completes by hand or automatically; `overridden` is `true` when a teacher set it, not the person or Moodle.

The states are read from the cells' icon file names, never from their texts, so the report reads the same in any language.

When no activity tracks completion, or there's nobody to list, Moodle shows a message instead of the table, and the function returns an empty report (`{ activities: [], participants: [] }`). It throws `CompletionError` when the page isn't the report: the course doesn't exist, or the person can't see its report.

## Completion in courseStructure

`courseStructure` (see [Courses](courses.md)) returns the person's own completion with each activity, when the activity tracks it for them:

```ts
completion?: { state: CompletionState; complete: boolean };
```

`state` is one of the four states above; `complete` is Moodle's overall verdict (an activity can be done with `complete-fail` yet not count as complete). A teacher, or an activity without completion, has no `completion` field. `pendingActivities` uses it to list what's still to do.

## Course completion

Course completion is another thing: whether a participant has completed the course as a whole, by the criteria its "Course completion" settings set (activities completed, a course grade, a date, a teacher's mark…). Moodle shows it in the course completion report (`report/completion/index.php`), not in the progress report `completionReport` reads, which is activity completion. Four functions cover it: `courseCompletionCriteria` and `setCourseCompletionCriteria` read and set the criteria, `courseCompletionStatus` reads each participant's course completion, and `markCourseComplete` marks someone complete by hand. A badge's course completion criterion ([Badges](badges.md)) is met when this completion is.

Moodle works course completion out as participants meet the criteria: an activity completed counts at once, but some criteria (a course grade, a date, days enrolled, other courses) are reviewed only by its scheduled task "Calculate regular completion data" (`\core\task\completion_regular_task`, every minute by default, as the site's cron runs it). Until it runs, a criterion met may not show yet (confirmed empirically, Moodle 5.2).

## courseCompletionCriteria

A course's completion criteria, from its "Course completion" settings form (`course/completion.php`).

```ts
function courseCompletionCriteria(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompletionCriteria>;

interface CourseCompletionCriteria {
  enabled: boolean;
  locked: boolean;
  overall: "all" | "any";
  activities?: { activityIds: number[]; all: boolean };
  courses?: { courseIds: number[]; all: boolean };
  date?: string;
  enrolmentDays?: number;
  unenrolment?: true;
  grade?: number;
  self?: true;
  roles?: { roleIds: number[]; all: boolean };
  offered: { activities: { id: number; name: string }[]; roles: { id: number; name: string }[] };
}
```

- `enabled`: whether completion is enabled on the site and in the course ("Enable completion tracking" in the course's settings). Moodle keeps criteria either way, but tracks nobody's completion while it's off.
- `locked`: whether someone has met a criterion already. Moodle then locks the criteria: they can't change until they're unlocked (see `setCourseCompletionCriteria`).
- `overall`: whether the course completes when all the criteria are met, or any one.
- Each kind of criterion, only when it's set: `activities` (course module ids, all of them or any one), `courses` (other courses to complete first), `date` (ISO, the start of that day in the person's time zone), `enrolmentDays` (days after enrolling), `unenrolment`, `grade` (a course grade of at least this), `self` (the participant marks it themselves) and `roles` (marked complete by someone with these roles, all of them or any one).
- `offered`: the course's activities with completion tracking and the roles that may mark a participant complete (those with `moodle/course:markcomplete`), with their names as the form shows them.

A locked form shows its choices as text only: the driver reads them back by Moodle's own strings in the person's language (`core_get_strings`), and a locked course's prerequisite courses from the course completion report's columns. It throws `CompletionError` when the person can't set the course's criteria (it takes `moodle/course:update`; Moodle sends a non-editing teacher to another page) or the course doesn't exist.

## setCourseCompletionCriteria

Sets a course's completion criteria through the same form, as a teacher does, and returns them afterwards.

```ts
function setCourseCompletionCriteria(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  changes: CourseCompletionChanges,
  options?: { unlock?: boolean },
): Promise<{ changed: string; criteria: CourseCompletionCriteria }>;

interface CourseCompletionChanges {
  overall?: "all" | "any";
  activities?: { activityIds: number[]; all?: boolean } | null;
  courses?: { courseIds: number[]; all?: boolean } | null;
  date?: Date | null;
  enrolmentDays?: number | null;
  unenrolment?: boolean;
  grade?: number | null;
  self?: boolean;
  roles?: { roleIds: number[]; all?: boolean } | null;
}
```

- A criterion given replaces that kind's settings; `null` (or `false`) removes it; one not given stays as it is.
- `all` defaults to `true` (Moodle's default too). The form has an activity aggregation only with two activities or more.
- `date`: the day counts, in the person's time zone. `enrolmentDays`: one of Moodle's choices (1 to 30, 40 to 180 by tens, 365). `grade`: above 0, in the course total's points.
- `unlock`: when the criteria are locked, unlocks them first, as the form's "Unlock completion settings and delete user completion data" button does: it deletes every participant's course completion data (not their activity completion).

It returns `changed` ("Course 7's completion criteria set: activities, grade.") and the criteria afterwards. It throws `CompletionError` when the person can't set them (`moodle/course:update`), when completion is off on the site or in the course, when they're locked and `unlock` isn't given, and for activities or roles the form doesn't offer (naming the ones it does); `FormError` with Moodle's message when it refuses the form (a prerequisite course that doesn't track completion).

## courseCompletionStatus

Each participant's course completion, from the course completion report: whether they've completed the course and when, and each criterion met and when.

```ts
function courseCompletionStatus(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { userId?: number; group?: number; limit?: number; offset?: number },
): Promise<CourseCompletionStatus[]>; // ListPage<CourseCompletionStatus> with limit

interface CourseCompletionStatus {
  userId: number;
  fullName: string;
  complete: boolean;
  completedAt?: string;
  criteria: CourseCriterionStatus[];
  markable: boolean;
}

interface CourseCriterionStatus {
  type: "activity" | "course" | "date" | "duration" | "unenrolment" | "grade" | "self" | "role" | "other";
  activityId?: number;
  courseId?: number;
  name: string;
  met: boolean;
  metAt?: string;
}
```

- `userId`: only this participant; `group`: only this group's.
- `criteria`: in the report's order (prerequisite courses, activities, then the rest), each by its type, its activity or course id, and its name as the report shows it (the activity's, the course's, the role's).
- `markable`: whether the person may mark them complete with `markCourseComplete`.
- Without `limit`, every participant in the report's order (by last name); with it, a page (see [Long lists](../concepts/calling-functions.md#long-lists)). The report is read in full and cut.

The criteria come from the report's column headers (activities and courses by their links, the rest by their icons), the dates from its CSV export, as instants in any language. It throws `CompletionError` when the person can't see the report (it takes `report/completion:view`) or the course has no completion criteria; a course with nobody to list gives `[]`. The report shows the criteria's state even with completion off in the course, but nothing changes it then.

## markCourseComplete

Marks a participant's course completion by hand, as the report's link does: the course's "Manual completion by others" criterion, for a role the person holds in the course.

```ts
function markCourseComplete(context: BrowserContext, siteUrl: string, courseId: number, userId: number): Promise<{ changed: string; status: CourseCompletionStatus }>;
```

That criterion met, Moodle completes the course when the rest of the criteria allow it (any one, or all of them met); with other criteria still to review, the course completes when Moodle's completion task next runs. A participant already marked is left as is ("User 4 was already marked complete in course 7."). It returns their completion afterwards. It throws `CompletionError` when the person can't see the report, when the course has no role criterion for a role they hold (it takes `moodle/course:markcomplete`), when completion isn't enabled, and when the user isn't a tracked participant.

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.

// As a teacher: course 7 completes when its final quiz (course module 12) is done and the teacher approves.
await moodle.setCourseCompletionCriteria(7, { overall: "all", activities: { activityIds: [12] }, roles: { roleIds: [3] } });

// Who has done the quiz but still waits for the teacher? Approve them.
for (const status of await moodle.courseCompletionStatus(7)) {
  const quiz = status.criteria.find((c) => c.activityId === 12);
  if (quiz?.met && !status.complete && status.markable) {
    const { changed } = await moodle.markCourseComplete(7, status.userId);
    console.log(changed);
  }
}
```

## Example

A student marks a page done; a teacher reads the report and marks done a book a student has read on paper.

```ts
import { CompletionError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

// As a student: mark every incomplete manual page in course 3 done.
const sections = await moodle.courseStructure(3);
for (const activity of sections.flatMap((s) => s.activities)) {
  if (activity.type !== "page" || activity.completion?.state !== "incomplete") continue;
  try {
    await moodle.setCompletion(activity.id, true);
  } catch (error) {
    if (error instanceof CompletionError) console.log(`${activity.name}: ${error.message}`);
    else throw error;
  }
}

// As a teacher: who hasn't completed the book (course module 6)?
const report = await moodle.completionReport(3);
for (const participant of report.participants) {
  const cell = participant.completion.find((c) => c.activityId === 6);
  if (cell?.state === "incomplete") console.log(participant.userId, participant.fullName);
}
const result = await moodle.overrideCompletion(6, 7, "complete");
console.log(result.changed, result.overridden);
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `setCompletion`: `own`.
- `overrideCompletion`: `others-write` (deciding about someone else).
- `completionReport`: `others-personal`.
- `courseCompletionCriteria` and `setCourseCompletionCriteria`: `course-content`.
- `courseCompletionStatus`: `others-personal`.
- `markCourseComplete`: `others-write`.
- `courseStructure`: `course-content` and `own` (the person's own completion).
