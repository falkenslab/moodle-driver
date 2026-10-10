# Grading

The teacher's side of an assignment: everyone's submissions with their content and dates, grading a participant as Moodle's grader does (a simple grade or scale, a rubric's levels, a marking guide's scores, remarks and feedback comments), reading the grading method and its criteria, and granting extensions. It needs a teacher's rights in the assignment (Moodle's grading capabilities); for a student Moodle refuses. Grading goes through the grader's own panel and service (`core_get_fragment` with `mod_assign`'s `gradingpanel`, then `mod_assign_submit_grading_form`), and fields are found by their form names, so it works in any language. The student's side is in [assignments](assignments.md); quiz overrides are with [quizzes](quizzes.md).

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
```

## Data categories

`assignmentSubmissions` is `others-personal`. `gradeSubmission` is `others-personal` and `others-write` (it reads the panel and decides about someone). `rubric` is `course-content`, and `grantExtension` is `others-write`. See [data categories](../concepts/data-categories.md).
