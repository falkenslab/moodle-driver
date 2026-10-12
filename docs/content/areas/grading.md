# Grading

The teacher's side of an assignment, of forums and of workshops: whole-forum grades with `forumGrades` and `gradeForumUser`, ratings on forum posts, glossary entries and database records with `rate`, and a workshop's phases and assessments with `workshopInfo`, `setWorkshopPhase` and `assessWorkshopSubmission`. For an assignment: everyone's submissions with their content and dates, grading a participant as Moodle's grader does (a simple grade or scale, a rubric's levels, a marking guide's scores, remarks and feedback comments), reading the grading method and its criteria, and granting extensions; feedback files go with the grade. Assignments with group submissions and the marking workflow are covered too: who submits for which group, grading a group at once, workflow states, markers and releasing grades. It needs a teacher's rights in the assignment (Moodle's grading capabilities); for a student Moodle refuses. Grading goes through the grader's own panel and service (`core_get_fragment` with `mod_assign`'s `gradingpanel`, then `mod_assign_submit_grading_form`), and fields are found by their form names, so it works in any language. The student's side is in [assignments](assignments.md); quiz overrides are with [quizzes](quizzes.md).

**Terms:** [assignment](../reference/glossary.md#assignment), [submission](../reference/glossary.md#submission), [grading method](../reference/glossary.md#grading-method), [extension](../reference/glossary.md#extension), [scale](../reference/glossary.md#scale), [workshop](../reference/glossary.md#workshop).

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
- `feedbackFiles`: the files attached to the participant's feedback, `{ name, url }`, where the assignment has feedback files on. They're read as the grader's file manager holds them: `url` is the person's working copy (`draftfile.php`), which [downloadFile](files.md) saves while the session lasts; the student sees the saved files' own links (`studentAssignment`).
- `group`: with group submissions ("Students submit in groups"), the group the participant submits for, `{ id, name }`; absent for a participant in no group (Moodle's "Default group").
- `workflowState`: with the marking workflow, the submission's state: `"notmarked"`, `"inmarking"`, `"readyforreview"` (marking completed), `"inreview"`, `"readyforrelease"` or `"released"`. Students see their grade only once it's released.
- `markers`: with marker allocation, the markers allocated to the submission, `{ id, name }[]` (Moodle 5.2 allows several per submission; empty when none is).
- `content`: per submission plugin, `{ plugin, text, files }`: `plugin` is the plugin's name (`"onlinetext"`, `"file"`…), `text` its content as plain text with paragraphs and lists kept, `files` its `{ name, url }` links (for [downloadFile](files.md)). Only for submitted and draft submissions; the comments plugin isn't part of it.

`includeContent` is `true` by default. Content, feedback files, the workflow state and the markers come from each participant's grading panel (the group from the participants service, always), one service call per participant (and one listing of the panel's feedback files where the assignment has them); with `includeContent: false` neither is loaded, which is much faster for a large course when only the statuses are needed. Participants are read one at a time; an extension's date comes from the extension form (no service open to AJAX gives it), one page per participant with an extension.

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
    feedbackFiles?: string[];
    workflowState?: WorkflowState;
    applyToGroup?: boolean;
    notify?: boolean;
    fields?: Record<string, FieldValue>;
  },
): Promise<{ changed: string; grade?: string; gradebookGrade?: string; feedback?: string; feedbackFiles?: { name: string; url: string }[]; workflowState?: WorkflowState }>;

type WorkflowState = "notmarked" | "inmarking" | "readyforreview" | "inreview" | "readyforrelease" | "released";
```

- `grade`: for simple grading, the grade as a number (`8.5`) or as the grader's field takes it (`"8.5"`, or `"8,5"` where the site writes decimals with a comma); for a scale, the scale item's value.
- `rubric`: for a rubric, the level chosen per criterion, by the ids `rubric()` gives.
- `guide`: for a marking guide, the score per criterion.
- `remarks`: a rubric's or a guide's remark per criterion.
- `feedback`: feedback comments (HTML), when the assignment has feedback comments on.
- `feedbackFiles`: absolute local paths of files for the feedback (a corrected PDF, an audio comment), when the assignment has feedback files on. They replace the files the participant had: what the panel's file manager holds is deleted, then they're uploaded from Moodle's grading page for the participant (`mod/assign/view.php?action=grade`, whose file picker carries the upload repository), before the form is submitted. `[]` removes them all; without the option they stay as they are.
- `workflowState`: with the marking workflow, the state the submission is left in (`WORKFLOW_STATES` lists them); `"released"` shows the student the grade, any other state keeps it hidden. Moodle offers each person only the states they may set (releasing takes its own capability).
- `applyToGroup`: with group submissions, whether the grade and feedback go to every member of the participant's group (`true`, Moodle's default) or only to them.
- `notify`: whether Moodle notifies the student; the panel's default otherwise.
- `fields`: any other field of the grading panel's form by name (another feedback plugin's, a workflow state…); the named options win for the same field.

It fills the panel's form in a blank tab (nothing of the grader's page loads), submits it through `mod_assign_submit_grading_form`, then reads the panel again. The result has:

- `changed`: what was done.
- `grade`: the grade field's value now, for simple grading.
- `gradebookGrade`: the "Current grade in gradebook" Moodle shows, which for a rubric or a guide is the total it computed from the levels or scores (`"75.00"`); absent when there's none.
- `feedback`: the feedback comments now.
- `feedbackFiles`: when files were given, the participant's feedback files now, as `assignmentSubmissions` gives them.
- `workflowState`: the submission's workflow state now, with the marking workflow.

With the marking workflow, `gradebookGrade` stays "not graded" until the grade is released: the gradebook only gets it then.

Errors:

- `NotAnAssignmentError` when the id isn't an assignment the person can grade.
- `FormError` when a field isn't in the panel's form, such as a criterion or level id that doesn't exist (`advancedgrading[criteria][9][levelid]`), or `grade` on an assignment graded by rubric.
- A `MoodleError` (`not-available`) when `feedback` is given and the assignment has no feedback comments; nothing is saved.
- `GradingError` when `feedbackFiles` is given and the assignment has no feedback files, `workflowState` and it doesn't use the marking workflow (or the state isn't one the form offers the person), or `applyToGroup` and it doesn't take group submissions; nothing is saved.
- A `MoodleError` (`invalid-input`, `not-found`) when a file path isn't absolute or doesn't exist, checked before anything; `FormError` when the upload fails (no upload repository, a file too big).
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

## setWorkflowState

Sets the marking workflow state of several participants' submissions at once, as the grading table's "Set marking workflow state" does (`mod/assign/view.php?action=viewbatchsetmarkingworkflowstate`), and releases their grades with `"released"`.

```ts
function setWorkflowState(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userIds: number[],
  state: "inmarking" | "readyforreview" | "inreview" | "readyforrelease" | "released",
  options?: { notify?: boolean },
): Promise<{ changed: string }>;
```

- `state`: any state but `"notmarked"`, which the form doesn't offer. Releasing makes the grade and feedback visible to the students and puts the grade in the gradebook.
- `notify`: when releasing, whether Moodle notifies the students, as the form's "Notify student" does; `false` by default, the form's default. Moodle notifies only on release, so `notify` with another state is refused.

With group submissions, a group's members are separate participants: give every member's id (`assignmentSubmissions` gives each one's `group`). With several markers per submission, it sets the submission's overall state (the form's "Grade" context), not the person's own mark. Moodle skips participants whose grading is disabled (locked, or a submission they can't be graded on).

Errors (`GradingError`): `userIds` empty; a state that isn't one, or that the form doesn't offer the person (releasing takes Moodle's "release grades" capability); `notify` without releasing; Moodle not opening the form (the activity isn't an assignment with the marking workflow, or the person isn't allowed), with Moodle's reason when it gives one. `FormError` when Moodle refuses the form.

## allocateMarker

Allocates a marker to several participants' submissions, as the grading table's "Allocate marker" does (`mod/assign/view.php?action=viewbatchmarkingallocation`), in an assignment with the marking workflow and marker allocation on.

```ts
function allocateMarker(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], markerId: number | number[]): Promise<{ changed: string }>;
```

- `markerId`: the user id of someone in the course who can grade the assignment; an array where the assignment uses several markers per submission (Moodle 5.2's "Number of markers"), one per marker in order. The ones not given are left unallocated.

Moodle leaves alone the submissions whose state is past marking (marking completed, in review, ready for release, released). `assignmentSubmissions` gives each submission's `markers`.

Errors (`GradingError`): `userIds` or `markerId` empty; more markers than the assignment uses; a user who can't mark it; Moodle not opening the form, with its reason, such as an assignment needing more markers per submission than the course has ("There are not enough markers (1) to meet the required number for this assignment (2)").

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

It opens the item's page (`mod/forum/discuss.php`; for a glossary entry, its glossary's `mod/glossary/view.php` showing the entry, since the entry's own `showentry.php` has no ratings; `mod/data/view.php`), reads the item's rating form by its hidden fields and menu, and sends it to `rating/rate_ajax.php` as the page's own script does. It throws `GradingError` when the item has no rating menu for the person (the activity doesn't use ratings, it's their own, the rating period is over, or they aren't allowed to rate), when the rating isn't on the menu, and when Moodle refuses it. Ratings on forum posts were checked against Moodle 5.2; glossary entries and database records use the same rating form, on their own pages.

A forum's ratings and its whole-forum grade are separate grade items in the gradebook, and both show in [`graderReport`](grades-and-gradebook.md#graderreport).

## workshopInfo

A workshop's phase, and its report as the workshop's page shows it to a teacher.

```ts
function workshopInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopInfo>;

type WorkshopPhase = "setup" | "submission" | "assessment" | "evaluation" | "closed";

interface WorkshopInfo {
  activityId: number;
  phase: WorkshopPhase;
  submissions: WorkshopSubmission[];
  assessments: WorkshopAssessment[];
}

interface WorkshopSubmission {
  id: number;
  title: string;
  authorId: number;
  author: string;
  grade?: number;
  gradeOverride?: number;
}

interface WorkshopAssessment {
  id: number;
  submissionId?: number;
  authorId?: number;
  author?: string;
  reviewerId?: number;
  reviewer?: string;
  grade?: number;
  gradingGrade?: number;
  gradingGradeOverride?: number;
  weight: number;
}
```

- `phase`: the phase the workshop is in (`WORKSHOP_PHASES` lists them in order).
- `submissions`: one per participant who submitted, with the grade for the submission once the evaluation phase calculated it (out of the workshop's "grade for submission"), and the teacher's override of it.
- `assessments`: every assessment of a submission, with its reviewer (left out when the person can't see reviewers' names), the submission's author, the grade it gives (out of the same maximum; left out until it's assessed), its weight, and the grade for the assessment itself once calculated.

It reads the workshop's page (`mod/workshop/view.php`), every page of its report, by the phase list's and the report's classes and links, so it works in any language. Moodle shows the report from the submission phase on to those who can see every submission (a teacher), in the course's current group; for a student both lists are empty. Grades are numbers as Moodle shows them, with as many decimals as the workshop's settings say. Calculating the grades in the evaluation phase ("Re-calculate grades") isn't covered. It throws `WorkshopError` for an activity that isn't a workshop the person can view.

## setWorkshopPhase

Switches a workshop to a phase, as the phase links on its page do.

```ts
function setWorkshopPhase(context: BrowserContext, siteUrl: string, activityId: number, phase: WorkshopPhase): Promise<{ changed: string; phase: WorkshopPhase }>;
```

It opens Moodle's confirmation (`mod/workshop/switchphase.php`) and confirms it, then reads the phase from the workshop's page it lands on. Any phase can be chosen, forwards or back. Switching does only that: a teacher allocates submissions to reviewers (Moodle's "Allocate submissions") and calculates grades on Moodle's pages. It throws `WorkshopError` with Moodle's reason when the person can't switch phases (a student), and `MoodleError` (`invalid-input`) for a phase that isn't one of the five.

## assessWorkshopSubmission

Assesses a submission as the person, through the workshop's assessment form.

```ts
function assessWorkshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  submissionId: number,
  input: { criteria?: WorkshopCriterion[]; feedback?: string; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; assessmentId: number; grade?: number; maxGrade?: number }>;

interface WorkshopCriterion {
  grade?: number | string;
  comment?: string;
}
```

- `criteria`: one per criterion of the form, in its order (the first is the form's "Aspect 1"). What `grade` takes depends on the workshop's grading strategy: accumulative grading, the points (`8`) or a scale item's name; number of errors, `1` when the assertion holds and `-1` when it doesn't (or the word the teacher gave either); rubric, the level, by its position (`1` for the first) or its definition; comments, none. `comment` is the comment on the criterion (not in a rubric).
- `feedback`: the overall feedback for the author (HTML), where the workshop has overall feedback on.
- `fields`: any other field of the form by name, such as `weight` (the assessment's weight, for a teacher).
- `grade`, `maxGrade`: the grade the assessment gives the submission, out of the workshop's grade for submission, as the assessment's page shows it afterwards.

A teacher who hasn't assessed the submission gets an assessment of their own, as "Assess" on the submission's page (`mod/workshop/submission.php`) does; one the person already made (a teacher's, or a reviewer's allocated one) is changed. The form (`mod/workshop/assessment.php`) is filled by its field names and saved with "Save and continue". Moodle only lets anyone assess in the assessment phase. It throws `WorkshopError` when Moodle offers no assessment (another phase, or the person isn't a reviewer or teacher), when a criterion's grade isn't one it takes (the error lists those it takes), when more criteria are given than the form has, or when the workshop has no overall feedback; `FormError` with Moodle's messages when it refuses the form (a criterion without a grade).

Students submit to a workshop on Moodle's pages: the driver has no workshop submission.

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
  // A corrected copy of the work goes back with the grade.
  await moodle.gradeSubmission(45, 7, { grade: "9", feedback: "<p>Well done, Ada.</p>", feedbackFiles: ["/home/teacher/corrected/ada.pdf"] });
}

await moodle.grantExtension(45, [4, 7], new Date("2026-11-06T22:59:00Z"));

// A forum graded as a whole: grade everyone without a grade yet, and rate a post.
const forum = await moodle.forumGrades(54);
for (const person of forum.grades.filter((g) => g.grade === undefined)) {
  await moodle.gradeForumUser(54, person.userId, { grade: forum.method === "point" ? 7 : forum.scale![0]!.name });
}
await moodle.rate({ type: "forum-post", id: 11, discussionId: 6 }, 4);

// A workshop: open the assessment phase and assess every submission with an accumulative form of two criteria.
await moodle.setWorkshopPhase(58, "assessment");
const workshop = await moodle.workshopInfo(58);
for (const submission of workshop.submissions) {
  const result = await moodle.assessWorkshopSubmission(58, submission.id, {
    criteria: [{ grade: 8, comment: "Clear." }, { grade: 4 }],
    feedback: "<p>Good work.</p>",
  });
  console.log(submission.author, result.grade, "of", result.maxGrade);
}
```

An assignment with group submissions and the marking workflow: grade one member for the whole group, then release the group's grades.

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const submissions = await moodle.assignmentSubmissions(52);
const ada = submissions.find((s) => s.userId === 7)!;
await moodle.allocateMarker(52, [7], 3);
await moodle.gradeSubmission(52, 7, { grade: 8, feedback: "<p>Good work, team.</p>", workflowState: "readyforrelease", applyToGroup: true });

// Every member of Ada's group, released together.
const members = submissions.filter((s) => s.group && s.group.id === ada.group?.id).map((s) => s.userId);
await moodle.setWorkflowState(52, members, "released", { notify: true });
```

## Data categories

`assignmentSubmissions` is `others-personal`. `gradeSubmission` is `others-personal` and `others-write` (it reads the panel and decides about someone). `rubric` is `course-content`, and `grantExtension`, `setWorkflowState` and `allocateMarker` are `others-write`. `forumGrades` is `others-personal`, `gradeForumUser` `others-personal` and `others-write`, and `rate` `others-write`. `workshopInfo` is `others-personal`, `setWorkshopPhase` `others-write` (it opens and closes participants' work), and `assessWorkshopSubmission` `others-personal` and `others-write`. See [data categories](../concepts/data-categories.md).
