# Grading

The teacher's side of an assignment, and of forums: whole-forum grades with `forumGrades` and `gradeForumUser`, and ratings on forum posts, glossary entries and database records with `rate`. For an assignment: everyone's submissions with their content and dates, grading a participant as Moodle's grader does (a simple grade or scale, a rubric's levels, a marking guide's scores, remarks and feedback comments), reading the grading method and its criteria, and granting extensions. It needs a teacher's rights in the assignment (Moodle's grading capabilities); for a student Moodle refuses. Grading goes through the grader's own panel and service (`core_get_fragment` with `mod_assign`'s `gradingpanel`, then `mod_assign_submit_grading_form`), and fields are found by their form names, so it works in any language. The student's side is in [assignments](assignments.md); quiz overrides are with [quizzes](quizzes.md).

**Terms:** [assignment](../reference/glossary.md#assignment), [submission](../reference/glossary.md#submission), [grading method](../reference/glossary.md#grading-method), [extension](../reference/glossary.md#extension), [scale](../reference/glossary.md#scale).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## assignmentSubmissions

Every participant's submission to an assignment.

```ts
function assignmentSubmissions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options?: { includeContent?: boolean },
): Promise<Submission[]>;
```

`activityId` is the assignment's activity id (course module id). Each `Submission` has:

- `userId`, `fullName`: the participant.
- `status`: Moodle's submission status, `"submitted"`, `"draft"`, `"new"`, `"reopened"`, or `"none"` without a submission.
- `submitted`: submitted for grading.
- `needsGrading`: Moodle says it requires grading.
- `extensionGranted`: the participant has an extension.
- `extensionDueDate`: until when (ISO 8601), where an extension is granted.
- `allowSubmissionsFrom`, `dueDate`, `cutoffDate`: for this participant, with their overrides and extensions applied (ISO 8601; absent when the assignment has none).
- `content`: per submission plugin, `{ plugin, text, files }`: `plugin` is the plugin's name (`"onlinetext"`, `"file"`…), `text` its content as plain text with paragraphs and lists kept, `files` its `{ name, url }` links (for [downloadFile](files.md)). Only for submitted and draft submissions; the comments plugin isn't part of it.

`includeContent` is `true` by default. Content comes from each participant's grading panel, one service call per participant with a submission; with `includeContent: false` none is loaded, which is much faster for a large course when only the statuses are needed. Participants are read one at a time; an extension's date comes from the extension form (no service open to AJAX gives it), one page per participant with an extension.

It throws `NotAnAssignmentError` when the id isn't an assignment the person can grade, and passes the services' refusals as `MoodleServiceError`.

## gradeSubmission

Grades one participant as the grader does, and reads the grade back.

```ts
function gradeSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  input: {
    grade?: string | number;
    rubric?: Record<number, number>; // criterion id -> level id
    guide?: Record<number, number>; // criterion id -> score
    remarks?: Record<number, string>; // criterion id -> remark
    feedback?: string;
    notify?: boolean;
    fields?: Record<string, FieldValue>;
  },
): Promise<{ changed: string; grade?: string; gradebookGrade?: string; feedback?: string }>;
```

- `grade`: for simple grading, the grade as a number (`8.5`) or as the grader's field takes it (`"8.5"`, or `"8,5"` where the site writes decimals with a comma); for a scale, the scale item's value.
- `rubric`: for a rubric, the level chosen per criterion, by the ids `rubric()` gives.
- `guide`: for a marking guide, the score per criterion.
- `remarks`: a rubric's or a guide's remark per criterion.
- `feedback`: feedback comments (HTML), when the assignment has feedback comments on.
- `notify`: whether Moodle notifies the student; the panel's default otherwise.
- `fields`: any other field of the grading panel's form by name (another feedback plugin's, a workflow state…); the named options win for the same field.

It fills the panel's form in a blank tab (nothing of the grader's page loads), submits it through `mod_assign_submit_grading_form`, then reads the panel again. The result has:

- `changed`: what was done.
- `grade`: the grade field's value now, for simple grading.
- `gradebookGrade`: the "Current grade in gradebook" Moodle shows, which for a rubric or a guide is the total it computed from the levels or scores (`"75.00"`); absent when there's none.
- `feedback`: the feedback comments now.

Errors:

- `NotAnAssignmentError` when the id isn't an assignment the person can grade.
- `FormError` when a field isn't in the panel's form, such as a criterion or level id that doesn't exist (`advancedgrading[criteria][9][levelid]`), or `grade` on an assignment graded by rubric.
- A `MoodleError` (`not-available`) when `feedback` is given and the assignment has no feedback comments; nothing is saved.
- `GradingError` when Moodle doesn't save the grade. Moodle's service only answers that it couldn't save, without the reason: usually a grade out of the assignment's range or scale, or a field's name.

## rubric

An assignment's grading method and, for a rubric or a marking guide, its criteria with the ids `gradeSubmission` takes.

```ts
function rubric(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ assignment: { id: number }; method: "simple" | "rubric" | "guide"; criteria: GradingCriterion[] }>;

interface GradingCriterion {
  id: number;
  description: string;
  details?: string;
  markers?: string;
  levels?: { id: number; definition: string; score: number }[];
  maxScore?: number;
}
```

`method` is `"simple"` for a plain grade or a scale (with no criteria), `"rubric"` or `"guide"` for advanced grading. A rubric criterion has its `description` and its `levels` (`id` for `gradeSubmission`, the level's `definition` and its `score`). A guide criterion has its short name as `description`, its description for students (`details`) and for markers (`markers`), and its `maxScore`.

It's read from the grading panel of the assignment's first participant, so it throws `GradingError` when the assignment has no participants, and `NotAnAssignmentError` when the id isn't an assignment the person can grade.

## grantExtension

Grants one or more participants an extension until a date, through the assignment's extension form (several at once, as its bulk action does).

```ts
function grantExtension(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], until: Date): Promise<{ changed: string }>;
```

The date is written into the form's date selector in the person's time zone in Moodle (`M.cfg.usertimezone`), which is how Moodle reads it, so `until` is the exact moment whatever the program's time zone. Moodle's date selector has minutes, so seconds are dropped. Granting again replaces the extension.

Errors:

- `GradingError` when `userIds` is empty.
- `NotAnAssignmentError` when the extension form can't be opened: the activity isn't an assignment, or the person isn't allowed.
- `FormError` when Moodle refuses the form, with its message by field: a date before the assignment's due date, for one. Also when the person's time zone in Moodle isn't one the driver knows.

`assignmentSubmissions` reports the granted date as `extensionDueDate`.

## forumGrades

Everyone's whole-forum grade in a forum graded as a whole ("Whole forum grading" in the forum's settings), as the forum's "Grade users" grader shows them.

```ts
function forumGrades(context: BrowserContext, siteUrl: string, activityId: number, options?: { groupId?: number }): Promise<ForumGrades>;

interface ForumGrades {
  activityId: number;
  method: "point" | "scale";
  maxGrade?: number;
  scale?: { value: number; name: string }[];
  grades: ForumGrade[];
}

interface ForumGrade {
  userId: number;
  fullName: string;
  grade?: string;
  value?: number;
  gradedBy?: string;
  gradedAt?: string;
}
```

- `method`: out of points (`maxGrade`) or on a scale (`scale`, its items by value).
- `grades`: one per person the grader can grade (the course's gradable users, only the active ones when the forum says so; one group's with `groupId`). `grade` is as Moodle shows it ("8.00 / 10.00", a scale item's name), `value` the number stored; both are left out when the person has no grade.

It reads the ids from the forum page's grader button and goes through the grader's own services (`core_grades_get_gradable_users`, `core_grades_grader_gradingpanel_point_fetch` or `…_scale_fetch`), one call per person. It throws `NotAForumError` for another activity, and `GradingError` when the forum isn't graded as a whole (or the person can't grade it) or uses an advanced grading method (a rubric), which the driver doesn't fill for forums.

## gradeForumUser

Gives one person their whole-forum grade, as the grader's panel does.

```ts
function gradeForumUser(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  options: { grade: number | string | null; notify?: boolean },
): Promise<{ changed: string; grade: Omit<ForumGrade, "fullName"> }>;
```

- `grade`: points (from 0 to the forum's maximum), or a scale item's name or value; `null` takes the grade away. A grade out of range or off the scale throws `GradingError` before anything is sent.
- `notify`: send the person Moodle's grade notification, as the panel's checkbox does (off by default).

Moodle's forum grader has no feedback text, so there's none to give. The grade goes to the gradebook as the forum's "whole forum" item, beside its "rating" item when the forum also uses [ratings](#rate).

## rate

Rates a forum post, a glossary entry or a database record as the person, as the rating menu under it does.

```ts
function rate(context: BrowserContext, siteUrl: string, item: RateableItem, rating: number | string | null): Promise<{ changed: string; aggregate?: string; count?: number }>;

type RateableItem =
  | { type: "forum-post"; id: number; discussionId: number }
  | { type: "glossary-entry"; id: number }
  | { type: "database-record"; id: number };
```

- `item`: a forum post by its id and its discussion's (from [`discussion`](forums.md#discussion)), a glossary entry, or a database record.
- `rating`: a point scale's number, or a scale item's name or value; `null` takes the person's rating away.
- `aggregate`, `count`: the item's aggregate afterwards, as the activity aggregates ratings (average, count, maximum…), and how many ratings it has; no `aggregate` once none is left.

It opens the item's page (`mod/forum/discuss.php`, `mod/glossary/showentry.php`, `mod/data/view.php`), reads the item's rating form by its hidden fields and menu, and sends it to `rating/rate_ajax.php` as the page's own script does. It throws `GradingError` when the item has no rating menu for the person (the activity doesn't use ratings, it's their own, the rating period is over, or they aren't allowed to rate), when the rating isn't on the menu, and when Moodle refuses it. Ratings on forum posts were checked against Moodle 5.2; glossary entries and database records use the same rating form, on their own pages.

A forum's ratings and its whole-forum grade are separate grade items in the gradebook, and both show in [`graderReport`](grades-and-gradebook.md#graderreport).

## Example

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const submissions = await moodle.assignmentSubmissions(45);
for (const s of submissions.filter((s) => s.needsGrading)) {
  const text = s.content?.find((c) => c.plugin === "onlinetext")?.text ?? "";
  console.log(`${s.fullName} (${s.userId}): ${text.slice(0, 80)}`);
}

const definition = await moodle.rubric(45);
if (definition.method === "rubric") {
  // Choose the highest level of every criterion for user 7.
  const levels = Object.fromEntries(definition.criteria.map((c) => [c.id, c.levels!.at(-1)!.id]));
  const result = await moodle.gradeSubmission(45, 7, {
    rubric: levels,
    remarks: { [definition.criteria[0]!.id]: "Clear base case." },
    feedback: "<p>Well done, Ada.</p>",
    notify: true,
  });
  console.log(result.changed, result.gradebookGrade);
} else {
  await moodle.gradeSubmission(45, 7, { grade: "9", feedback: "<p>Well done, Ada.</p>" });
}

await moodle.grantExtension(45, [4, 7], new Date("2026-11-06T22:59:00Z"));

// A forum graded as a whole: grade everyone without a grade yet, and rate a post.
const forum = await moodle.forumGrades(54);
for (const person of forum.grades.filter((g) => g.grade === undefined)) {
  await moodle.gradeForumUser(54, person.userId, { grade: forum.method === "point" ? 7 : forum.scale![0]!.name });
}
await moodle.rate({ type: "forum-post", id: 11, discussionId: 6 }, 4);
```

## Data categories

`assignmentSubmissions` is `others-personal`. `gradeSubmission` is `others-personal` and `others-write` (it reads the panel and decides about someone). `rubric` is `course-content`, and `grantExtension` is `others-write`. `forumGrades` is `others-personal`, `gradeForumUser` `others-personal` and `others-write`, and `rate` `others-write`. See [data categories](../concepts/data-categories.md).
