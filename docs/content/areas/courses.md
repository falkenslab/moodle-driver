# Courses

The courses the person is enrolled in, a course's sections and activities, its assignments, what the person still has to do in it, changing a course's settings, and resetting it for a new year. Reading works for anyone enrolled (student or teacher); `updateCourse` needs the right to edit the course's settings, which teachers with editing rights and managers have. Everything here is read through the services the course page itself uses (`core_course_get_enrolled_courses_by_timeline_classification`, `core_courseformat_get_state`), so it doesn't depend on the interface's language, except the details (activities' dates and restrictions, sections' descriptions), which are read from the course page as it shows them.

**Terms:** [section](../reference/glossary.md#section), [activity](../reference/glossary.md#activity), [module](../reference/glossary.md#module), [course module id](../reference/glossary.md#course-module-id), [completion](../reference/glossary.md#completion).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## listCourses

The courses the person is enrolled in, as teacher or student, sorted by full name.

```ts
function listCourses(context: BrowserContext, siteUrl: string, classification?: CourseClassification): Promise<Course[]>;

type CourseClassification = "all" | "inprogress" | "future" | "past"; // COURSE_CLASSIFICATIONS
```

`classification` defaults to `"all"`, which also includes the courses the person hid from their dashboard. `"inprogress"`, `"future"` and `"past"` filter by the course's dates, as the dashboard's course overview does.

Each `Course` has:

- `id`: the course id every course function takes.
- `shortname`, `fullname`: with HTML entities decoded.
- `category`: the category's name, when Moodle gives it.
- `url`: the course page.
- `visible`: whether students can see the course.
- `startDate`, `endDate`: ISO 8601, absent when the course has none.
- `progress`: the person's completion percentage, only when the course tracks completion.
- `lastAccess`: when the person last opened the course (ISO 8601).

It throws `NotLoggedInError` without a session, and `MoodleServiceError` if the service fails.

## courseStructure

A course's sections and activities, in the course's order.

```ts
function courseStructure(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { details?: boolean },
): Promise<CourseSection[]>;
```

With `details: false` (the default) it makes a single service call. With `details: true` it also opens the course page and reads each activity's dates and restriction as the page shows them, and each section's description; in a course with one section per page it then opens the section pages of the activities the course page doesn't show. That's slower, and the texts come in the site's language (for example `{ label: "Due", value: "Friday, 23 October 2026, 12:00 AM" }`).

Each `CourseSection` has `id`, `number` (0 is the general section), `title`, `visible`, `restricted` (it has access restrictions), `url`, `parentSectionId` (for a subsection, the section that holds it), `summary` (only with `details`: the section's description as HTML, as the course page renders it, when it has one; set it with [editSection](activities.md#addsection-editsection-and-deletesection)) and `activities`. Each `CourseActivity` has:

- `id`: the course module id, which every activity function takes.
- `name`, `type`: the module, such as `"page"`, `"assign"`, `"quiz"`, `"forum"` or `"resource"`.
- `url`: the activity's page, when it has one (a label has none).
- `visible`: shown to students.
- `availableToMe`: the person can open it now. For a student, false on an activity blocked by a restriction (one hidden from students isn't listed for them at all); for a teacher, true on hidden and restricted activities alike, since they can open them (`visible: false, availableToMe: true` is a hidden activity seen by its teacher).
- `restricted`: it has access restrictions.
- `completion`: the person's completion, only when the activity tracks it for them: `state` is one of `"incomplete"`, `"complete"`, `"complete-pass"`, `"complete-fail"` (`COMPLETION_STATES`), and `complete` is Moodle's overall verdict.
- `dates`, `restriction`: only with `details`.

A course the person can't see comes back as Moodle's `MoodleServiceError` (its `errorcode` says why); no session is `NotLoggedInError`.

## courseState and activityDetails

The pieces `courseStructure` is made of, in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

```ts
function courseState(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseState>;
function activityDetails(context: BrowserContext, siteUrl: string, courseId: number, state: CourseState): Promise<Map<number, ActivityDetails>>;
```

- `courseState` returns `core_courseformat_get_state` parsed, with Moodle's own field names (`section`, `cm`, `cmlist`, `uservisible`, `completionstate`…); the type lists the fields the driver reads, as Moodle 4.0 to 5.2 return them.
- `activityDetails` reads the course page (and the section pages it needs) and returns, by course module id, `{ id, dates: { label, value }[], restriction? }`.

## pendingActivities

What the person still has to do in a course.

```ts
function pendingActivities(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
): Promise<{ completionTracked: boolean; pending: PendingActivity[] }>;
```

An activity is pending when its completion is tracked for the person and isn't complete (`reason: "incomplete"`), or, when completion isn't tracked, when it's a graded activity with no grade yet in the person's grade report (`reason: "not-graded"`). Activities hidden from students and not available to the person are left out. `completionTracked` tells whether the course tracks completion for the person at all.

Each `PendingActivity` has `activityId`, `name`, `type`, `url`, `section` (`{ number, title }`), `reason`, `completion` (the state, when tracked), `availableToMe`, and the course page's `dates` and `restriction`. It always reads the details, so it opens the course page (and section pages when needed) and the grade report: it's meant for a student. If the grade report can't be read, the graded check is simply skipped.

## listAssignments

The course's assignments, in the course's order, from the same course state.

```ts
function listAssignments(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseAssignment[]>;
```

Each `CourseAssignment` has `id` (the course module id, for [assignments](assignments.md) and [grading](grading.md)), `name`, `url`, `visible` and `section` (`{ number, title }`).

## updateCourse

Changes a course's settings through its settings form (`course/edit.php`), as a teacher would, and returns the course as `listCourses` gives it.

```ts
function updateCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  changes: { fullName?: string; shortName?: string; summary?: string; settings?: Record<string, FieldValue> },
): Promise<{ changed: string; course?: Course }>;
```

- `fullName`, `shortName`: the course's names.
- `summary`: HTML, set through the summary's editor.
- `settings`: any other field of the form by its form name (`startdate[day]`, `visible`, `format`…); `FieldValue` is a string, number, boolean or array of strings. The named options win over `settings` when both set the same field.

With nothing to change it returns `changed: "Nothing to change."` without opening the form. `course` is `undefined` when the person isn't enrolled in the course (so `listCourses` doesn't list it).

Errors:

- `CourseError` when the form can't be opened: the course doesn't exist or the person isn't allowed.
- `FormError` when Moodle refuses the form (a short name already taken), with `fields` holding Moodle's message per field, or when a field in `settings` isn't in the form or is disabled.

## resetCourse

Empties a course of its people's data for a new year, keeping its content, through Moodle's reset form. **It can't be undone.**

```ts
function resetCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { delete?: ResetDeletions; unenrolRoles?: number[]; start?: Date; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; report: ResetStatus[] }>;

interface ResetDeletions {
  submissions?: boolean; // assignments' submissions
  attempts?: boolean; // quiz, lesson, SCORM and H5P attempts
  posts?: boolean; // every forum post
  grades?: boolean; // every grade in the gradebook
  overrides?: boolean; // assignment, quiz and lesson overrides
  choices?: boolean; // choice answers
  events?: boolean; // the course's calendar events
  groups?: boolean; // groups and groupings
  completion?: boolean; // completion data
  notes?: boolean;
  comments?: boolean;
}

interface ResetStatus {
  component: string;
  item: string;
  done: boolean;
  error?: string;
}
```

- Only what's named is reset: Moodle's form opens with its own defaults ticked (events, grades, every module's data…), and they're all unticked first. A call that names nothing throws `MoodleError` with code `invalid-input`.
- `delete` names each kind of data, set in every module of the course that has it (the reset form's `reset_assign_submissions`, `reset_quiz_attempts`, `reset_lesson`, `reset_scorm`…); a kind no activity of the course has is left out, and `changed` says so.
- `unenrolRoles` unenrols everyone with these roles (role ids, as in [Participants](participants.md); 5 is Student on a default site); a role the form doesn't offer is a `CourseError`.
- `start` moves the course's start date, and its activities' dates with it, as the form's start date does.
- `fields` sets any other of the form's fields by name (`reset_forum_subscriptions`, `reset_glossary_all`…).
- `report` is the table Moodle shows afterwards: per component, each task, `done`, or its `error` in the site's language (a module without reset support comes as "Reset not supported").

The reset button's confirmation dialog is skipped: the form is submitted as the dialog does once confirmed. A site that makes resets asynchronous queues it for cron, and `report` comes empty. Needs `moodle/course:reset` (editing teachers have it); without it, `CourseError`.

## Example

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

for (const course of await moodle.listCourses("inprogress")) {
  console.log(`${course.id} ${course.fullname}${course.progress !== undefined ? ` (${course.progress}%)` : ""}`);
}

const sections = await moodle.courseStructure(3, { details: true });
for (const section of sections) {
  console.log(`${section.number}. ${section.title}`);
  for (const activity of section.activities) {
    const due = activity.dates?.map((d) => `${d.label}: ${d.value}`).join("; ") ?? "";
    console.log(`  [${activity.type}] ${activity.id} ${activity.name} ${due}`);
  }
}

const { completionTracked, pending } = await moodle.pendingActivities(3);
console.log(completionTracked ? "Completion is tracked" : "Completion isn't tracked", pending.map((p) => p.name));

const { course } = await moodle.updateCourse(3, { fullName: "Programming 101 (2026)", summary: "<p>Loops, functions and recursion.</p>" });
console.log(course?.fullname);
```

## Data categories

`listCourses` is `own`. `courseState` and `courseStructure` are `course-content` and `own` (the state carries the person's completion), and so is `pendingActivities` (`own`). `activityDetails` and `listAssignments` are `course-content`. `updateCourse` is `course-content`; `resetCourse` is `course-content` and `others-write` (it deletes people's work and enrolments). See [data categories](../concepts/data-categories.md).
