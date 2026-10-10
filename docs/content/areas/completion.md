# Completion

Activity completion is how Moodle tracks what each participant has done in a course. This area covers the three sides of it: a student marking their own manual completion (`setCompletion`), a teacher overriding someone's completion (`overrideCompletion`), and a teacher reading the course's progress report, everyone's completion of every activity (`completionReport`). The person's own completion of each activity also comes with the course's structure (`courseStructure`).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

Completion has to be enabled in the course and set in each activity (manual, or automatic on view, grade, submission…): the driver doesn't change that. Setting an activity's completion rules is part of its settings (see [Activities](activities.md)).

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
function completionReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { group?: number }): Promise<CompletionReport>;

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

## Example

A student marks a page done; a teacher reads the report and marks done a book a student has read on paper.

```ts
import { CompletionError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

// As a student: mark every incomplete manual page in course 3 done.
const { sections } = await moodle.courseStructure(3);
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
- `courseStructure`: `course-content` and `own` (the person's own completion).
