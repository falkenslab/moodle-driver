# Overview and deadlines

This area answers "what is there to do, and what changed": Moodle 5's activities overview of a course (`activitiesOverview`), the person's deadlines from the calendar (`deadlines`), and what changed in a course's activities since a date (`courseUpdates`). All three work for students and teachers; each shows what Moodle shows the person (a student sees their own submission and grade, a teacher how many submitted and what needs grading).

The signatures below are the functions'; each is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

What the person still has to do in one course, by completion or missing grades, is `pendingActivities`, documented in [Courses](courses.md#pendingactivities).

## activitiesOverview

Moodle 5's activities overview of a course (the "Activities" page of the course), through the service that page uses (`core_courseformat_get_overview_information`): per activity, the columns its overview shows the person, such as the due date, the submissions, what needs grading or their own grade.

```ts
function activitiesOverview(context: BrowserContext, siteUrl: string, courseId: number, type?: string): Promise<OverviewActivity[]>;

// The shape of each activity (the type is inferred, not exported by this name).
interface OverviewActivity {
  id: number;
  name: string;
  type: string;
  url?: string;
  visible: boolean;
  available?: boolean;
  fields: OverviewField[];
}

interface OverviewField {
  key: string;
  label: string;
  text: string;
  date?: string;
  url?: string;
  details?: { label: string; value: string }[];
  alert?: { label: string; count: number };
}
```

- `type`: one module ("assign", "quiz", "forum"…), or `"resource"` for every resource type at once (pages, books, files, folders, links). Without it, every type in the course: `"resource"` first, then each type it didn't bring yet.
- `id` is the course module id; `visible` is `false` for an activity hidden from students; `available: false` appears only when the person can't open it now.
- `fields`: the overview's columns except the name, in Moodle's order. `key` is Moodle's column key ("duedate", "submissions", "actions"…), stable in any language; `label` is its heading in the site's language.

Each field's `text` is what the cell shows, whatever kind of cell Moodle used:

- A date has `date` as an ISO string, and `text` as Moodle wrote it ("Sunday, 20 December 11:55 PM").
- A mark (answered, submitted…) has its meaning in `text`, from the icon's alternative text.
- A dialog (a quiz's attempts, say) has its button's text and its lines in `details`.
- Any other value has its plain text, and `url` when it's a link (a "View" or "Grade" action).
- `alert`: a badge with a count, such as "Needs grading" with 2.

Asking for one type that has no overview (labels, some plugins) passes Moodle's `MoodleServiceError` (`invalidparameter`); without a type, such types are skipped. The overview page is Moodle 5's: on older sites the service doesn't exist.

## deadlines

What the person has to do by a date, from the calendar's action events (submit, attempt, grade…), in one course or all of theirs, from some days ago to some days ahead.

```ts
function deadlines(context: BrowserContext, siteUrl: string, options: { courseId?: number; days?: number; pastDays?: number }): Promise<Deadline[]>;

// The shape of each deadline (the type is inferred, not exported by this name).
interface Deadline {
  activityId?: number;
  activity: string;
  type?: string;
  event: string;
  kind: string;
  date: string;
  overdue: boolean;
  course?: { id: number; shortname?: string };
  action?: { name: string; actionable: boolean; count?: number; url?: string };
}
```

Options (the object is required, its fields aren't):

- `courseId`: one course; without it, every course of the person's.
- `days`: how far ahead, default 30.
- `pastDays`: how far back, default 7, so recent overdue work shows up.

Each deadline has the activity's course module id and name, its module, the event's name ("Essay is due") and kind (Moodle's event type, such as `"due"` or `"close"`), its date as an ISO string, and whether it's `overdue`. `action` is what the person can do about it ("Add submission", with `url` to do it); `actionable` is `false` when it can't be done yet or any more. Moodle returns at most 50 events per call.

It reads `core_calendar_get_action_events_by_course` or `core_calendar_get_action_events_by_timesort`, as the dashboard's timeline does. Moodle gives teachers few action events: their grading counts are in `activitiesOverview` (the `alert` of an assignment's or quiz's actions field).

## courseUpdates

What changed in a course's activities since a date, with the activities' names from the course.

```ts
function courseUpdates(context: BrowserContext, siteUrl: string, courseId: number, since: Date): Promise<CourseUpdate[]>;

// The shape of each update (the type is inferred, not exported by this name).
interface CourseUpdate {
  id: number;
  name?: string;
  type?: string;
  changes: { what: string; time?: string; items?: number }[];
}
```

- `id`: the activity's course module id; `name` and `type` come from the course's state (an activity deleted since then has none).
- `changes`: what Moodle reports per activity, by its area name (`"configuration"`, `"submissions"`, `"discussions"`, `"grades"`…), with the time of the change when Moodle gives it and how many items changed (new submissions, posts…).

It goes through `core_course_get_updates_since`, the service Moodle's mobile app uses to know what to refresh. Only activities' changes are kept. A course Moodle refuses (no such course, say) passes Moodle's `MoodleServiceError`.

## Example

A student's week: what's due across courses, and what changed in course 3 since yesterday.

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

for (const deadline of await moodle.deadlines({ days: 7, pastDays: 0 })) {
  const where = deadline.course?.shortname ?? "";
  console.log(`${deadline.date} ${where} ${deadline.activity}: ${deadline.action?.name ?? deadline.event}`);
}

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
for (const update of await moodle.courseUpdates(3, yesterday)) {
  console.log(update.name ?? update.id, update.changes.map((c) => c.what).join(", "));
}

// As a teacher: the assignments with submissions waiting for a grade.
for (const activity of await moodle.activitiesOverview(3, "assign")) {
  const alert = activity.fields.find((f) => f.alert)?.alert;
  if (alert && alert.count > 0) console.log(`${activity.name}: ${alert.count} (${alert.label})`);
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `activitiesOverview`: `course-content`, `own` and `others-aggregate` (counts such as "2 of 4 submitted", which identify no one).
- `deadlines`: `own`.
- `courseUpdates`: `course-content` and `others-aggregate`.
- `pendingActivities`: `own`.
- `overviewField`: `none` (it reads a value the caller already has).
