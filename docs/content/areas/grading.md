# Grading

The teacher's side of an assignment, of forums and of workshops: whole-forum grades with `forumGrades` and `gradeForumUser`, ratings on forum posts, glossary entries and database records with `rate`, and a workshop from start to end: its phases, allocation and assessments with `workshopInfo`, `setWorkshopPhase`, `workshopAllocation`, `allocateReviewer`, `removeReviewer`, `allocateRandomly`, `scheduleAllocation` and `assessWorkshopSubmission`, a participant's submission with `workshopSubmission` and `saveWorkshopSubmission`, example submissions with `workshopExamples`, `addWorkshopExample`, `editWorkshopExample`, `deleteWorkshopExample` and `assessWorkshopExample`, and its grades with `calculateWorkshopGrades` and `overrideWorkshopGrade`. For an assignment: everyone's submissions with their content and dates, grading a participant as Moodle's grader does (a simple grade or scale, a rubric's levels, a marking guide's scores, remarks and feedback comments), reading the grading method and its criteria, defining a rubric or a marking guide, and granting extensions; feedback files go with the grade. Assignments with group submissions and the marking workflow are covered too: who submits for which group, grading a group at once, workflow states, markers and releasing grades. It needs a teacher's rights in the assignment (Moodle's grading capabilities); for a student Moodle refuses. Grading goes through the grader's own panel and service (`core_get_fragment` with `mod_assign`'s `gradingpanel`, then `mod_assign_submit_grading_form`), and fields are found by their form names, so it works in any language. The student's side is in [assignments](assignments.md); quiz overrides are with [quizzes](quizzes.md).

**Terms:** [assignment](../reference/glossary.md#assignment), [submission](../reference/glossary.md#submission), [grading method](../reference/glossary.md#grading-method), [extension](../reference/glossary.md#extension), [scale](../reference/glossary.md#scale), [workshop](../reference/glossary.md#workshop).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## assignmentSubmissions

Every participant's submission to an assignment.

```ts
function assignmentSubmissions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options?: { includeContent?: boolean; userIds?: number[]; limit?: number; offset?: number },
): Promise<Submission[]>; // ListPage<Submission> with limit
```

`activityId` is the assignment's activity id (course module id). `userIds` keeps to those participants; `limit` and `offset` give a page of them in the grader's order (see [Long lists](../concepts/calling-functions.md#long-lists)). Moodle's participants service lists everyone at once, so the list is cut, but only the page's participants are read further (their dates, extensions and grading panels): a page costs a page's requests. Each `Submission` has:

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

`includeContent` is `true` by default. Content, feedback files, the workflow state and the markers come from each participant's grading panel (the group from the participants service, always), one service call per participant (and one listing of the panel's feedback files where the assignment has them); with `includeContent: false` neither is loaded, which is much faster for a large course when only the statuses are needed. The panel is opened only for participants with a submission: Moodle's grading panel creates an empty submission (`"new"`) for a participant who has none, so reading leaves a participant who never submitted at `"none"`, without feedback files, workflow state or markers. Opening it is still not free of writes, as in Moodle's grader: a participant with a submission and no grade gets an empty one (not graded), and Moodle logs a "Grading form viewed" event. Participants are read one at a time; an extension's date comes from the extension form (no service open to AJAX gives it), one page per participant with an extension.

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

It's read from the grading panel of the assignment's first participant with a submission, so it throws `GradingError` when the assignment has no participants. Where nobody has submitted yet, the panel is the first participant's, and Moodle creates an empty submission (`"new"`) for them on opening it. It throws `NotAnAssignmentError` when the id isn't an assignment the person can grade.

## setGradingDefinition

Sets an assignment's advanced grading method, a rubric or a marking guide, and saves its definition ready for use, as Moodle's advanced grading page and its rubric or guide editor do.

```ts
function setGradingDefinition(context: BrowserContext, siteUrl: string, activityId: number, definition: GradingDefinitionInput): Promise<{ changed: string; assignment: { id: number }; method: "rubric" | "guide"; criteria: GradingCriterion[] }>;

type GradingDefinitionInput =
  | { method: "rubric"; name: string; description?: string; criteria: { description: string; levels: { definition: string; score: number }[] }[] }
  | { method: "guide"; name: string; description?: string; criteria: { shortName: string; description?: string; markers?: string; maxScore: number }[]; comments?: string[] };
```

`name` is the definition's name and `description` its description (HTML). A rubric's criteria each have a description and two levels at least, each level its definition and score. A guide's criteria each have a short name, a description for students and markers (`description`), one for markers only (`markers`) and a maximum score; `comments` are its frequently used comments. The criteria, levels and comments go in the order given.

Where the assignment has no definition for that method, one is created; where it has one, it's replaced whole (criteria, levels and comments), so their ids change. The grading method is set when it's another one. It returns the definition as [`rubric`](#rubric) reads it, with the ids `gradeSubmission` takes, but read from the definition's editor, not from a grading panel: it creates no submission for anyone.

Moodle's editor lets a definition be changed freely only while nothing has been graded with it; after that, saving asks to regrade. So a definition already used for grading is refused with `GradingError`, before anything changes (the method neither): change it in Moodle's editor, or delete it in the assignment's advanced grading page first. It throws `GradingError` too when the person can't manage grading forms (Moodle's capability `moodle/grade:managegradingforms`, which editing teachers have and non-editing teachers don't) or when Moodle's editor doesn't save the definition (with its reasons); `MoodleError` (`invalid-input`) before opening anything, for a definition the editor wouldn't take (no name, no criteria, a rubric criterion with fewer than two levels, highest scores that add up to 0, a negative maximum score); and `NotAnAssignmentError` when the id isn't an assignment the person can grade.

```ts
const rubric = await moodle.setGradingDefinition(1234, {
  method: "rubric",
  name: "Loops",
  criteria: [
    { description: "Explains a loop", levels: [{ definition: "No", score: 0 }, { definition: "Partly", score: 1 }, { definition: "Clearly", score: 2 }] },
    { description: "Gives an example", levels: [{ definition: "None", score: 0 }, { definition: "Right", score: 2 }] },
  ],
});
console.log(rubric.changed);
const [explains, example] = rubric.criteria;
await moodle.gradeSubmission(1234, 7, { rubric: { [explains!.id]: explains!.levels![2]!.id, [example!.id]: example!.levels![1]!.id } });
```

## grantExtension

Grants one or more participants an extension until a date, through the assignment's extension form (several at once, as its bulk action does).

```ts
function grantExtension(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], until: Date): Promise<{ changed: string }>;
```

The date is written into the form's date selector in the person's time zone in Moodle (`M.cfg.usertimezone`), which is how Moodle reads it, so `until` is the exact moment whatever the program's time zone. Moodle's date selector has minutes, so seconds are dropped. Granting again replaces the extension.

Errors:

- `GradingError` when `userIds` is empty.
- `NotAnAssignmentError` when the extension form can't be opened (the activity isn't an assignment), or when Moodle refuses to save it with its error page (the person isn't allowed to grant extensions: Moodle opens the form for anyone and checks only on saving), with Moodle's reason.
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

Errors (`GradingError`): `userIds` empty; a state that isn't one, or that the form doesn't offer the person (releasing takes Moodle's "release grades" capability); `notify` without releasing; an assignment without the marking workflow (read from the grading panel of a participant with a submission, or of the first one given, before anything is sent: Moodle's batch form would open and save there all the same); Moodle not opening the form (the person isn't allowed), with Moodle's reason when it gives one. `NotAnAssignmentError` when the id isn't an assignment the person can grade. `FormError` when Moodle refuses the form.

## allocateMarker

Allocates a marker to several participants' submissions, as the grading table's "Allocate marker" does (`mod/assign/view.php?action=viewbatchmarkingallocation`), in an assignment with the marking workflow and marker allocation on.

```ts
function allocateMarker(context: BrowserContext, siteUrl: string, activityId: number, userIds: number[], markerId: number | number[]): Promise<{ changed: string }>;
```

- `markerId`: the user id of someone in the course who can grade the assignment; an array where the assignment uses several markers per submission (Moodle 5.2's "Number of markers"), one per marker in order. The ones not given are left unallocated.

Moodle leaves alone the submissions whose state is past marking (marking completed, in review, ready for release, released). `assignmentSubmissions` gives each submission's `markers`.

Errors (`GradingError`): `userIds` or `markerId` empty; an assignment without marker allocation, or a person who can't manage allocations (read from the grading panel of a participant with a submission, or of the first one given, before anything is sent: Moodle's batch form would open and save there all the same); more markers than the assignment uses; a user who can't mark it; Moodle not opening the form, with its reason, such as an assignment needing more markers per submission than the course has ("There are not enough markers (1) to meet the required number for this assignment (2)").

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

It reads the workshop's page (`mod/workshop/view.php`), every page of its report, by the phase list's and the report's classes and links, so it works in any language. Moodle shows the report from the submission phase on to those who can see every submission (a teacher), in the course's current group; for a student both lists are empty. Grades are numbers as Moodle shows them, with as many decimals as the workshop's settings say. The evaluation phase's grades are calculated with [`calculateWorkshopGrades`](#calculateworkshopgrades). It throws `WorkshopError` for an activity that isn't a workshop the person can view.

## setWorkshopPhase

Switches a workshop to a phase, as the phase links on its page do.

```ts
function setWorkshopPhase(context: BrowserContext, siteUrl: string, activityId: number, phase: WorkshopPhase): Promise<{ changed: string; phase: WorkshopPhase }>;
```

It opens Moodle's confirmation (`mod/workshop/switchphase.php`) and confirms it, then reads the phase from the workshop's page it lands on. Any phase can be chosen, forwards or back. Switching does only that: submissions are allocated to reviewers with the functions below (Moodle's "Allocate submissions"), and grades are calculated with `calculateWorkshopGrades`. It throws `WorkshopError` with Moodle's reason when the person can't switch phases (a student), and `MoodleError` (`invalid-input`) for a phase that isn't one of the five.

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

A participant submits with [`saveWorkshopSubmission`](#saveworkshopsubmission). A reviewer allocated to their own submission (self-assessment) assesses it the same way.

## workshopAllocation

Who assesses whom in a workshop: its allocation, as Moodle's manual allocation page shows it to a teacher.

```ts
function workshopAllocation(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopAllocation>;

interface WorkshopAllocation {
  activityId: number;
  submissions: WorkshopAllocatedSubmission[];
  potentialReviewers: { userId: number; fullName: string }[];
}

interface WorkshopAllocatedSubmission {
  id: number;
  title: string;
  authorId: number;
  author: string;
  reviewers: WorkshopReviewer[];
}

interface WorkshopReviewer {
  assessmentId: number;
  reviewerId: number;
  reviewer: string;
}
```

- `submissions`: one per participant who submitted, with the reviewers allocated to it. An allocation is an assessment Moodle creates, empty until the reviewer assesses: `assessmentId` is its id. A teacher's own assessment of a submission counts as an allocation too.
- `potentialReviewers`: the participants Moodle offers as reviewers, those who can assess peers in the course (its students).

It reads every page of the manual allocation page (`mod/workshop/allocation.php`) by its table's cell classes and links, in the course's current group, in any phase. It throws `WorkshopError` when the person can't allocate (Moodle's `mod/workshop:allocate`, a teacher's; for a student Moodle refuses) or the id isn't a workshop's.

## allocateReviewer

Allocates a reviewer to a submission, as the "Add reviewer" menu of the manual allocation page does.

```ts
function allocateReviewer(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: { submissionId?: number; authorId?: number; reviewerId: number },
): Promise<{ changed: string; added: boolean; assessmentId: number; submission: WorkshopAllocatedSubmission }>;
```

- `submissionId` or `authorId`: the submission, by its id or its author's user id (one of the two).
- `reviewerId`: the reviewer's user id; it must be one Moodle's menu offers for the submission (a participant who can assess peers, not the author unless the workshop allows self-assessment).
- `added`: false when the reviewer was already allocated (nothing changes then); `assessmentId`: the allocation's assessment; `submission`: the submission and its reviewers afterwards.

Moodle itself would allocate any user id it's given, someone outside the course too; the driver allocates only those its menu offers, and throws `WorkshopError` for anyone else (the error lists who it offers), for the author when self-assessment is off, for a submission it doesn't find (an author without one), and when the person can't allocate. Allocating works in any phase; reviewers assess in the assessment phase.

## removeReviewer

Removes a reviewer's allocation to a submission, as the delete icon of the manual allocation page does.

```ts
function removeReviewer(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: { submissionId?: number; authorId?: number; reviewerId: number; evenIfAssessed?: boolean },
): Promise<{ changed: string; assessmentId: number; submission: WorkshopAllocatedSubmission }>;
```

Moodle deletes the reviewer's assessment of the submission. It asks first, and warns when the reviewer has already assessed it: the driver goes through that question and stops there with `WorkshopError` unless `evenIfAssessed` is set, since the assessment and its grade are lost. It also throws `WorkshopError` when the reviewer isn't allocated to the submission and when the person can't allocate.

## allocateRandomly

Allocates submissions to reviewers at random, as Moodle's random allocation form does.

```ts
function allocateRandomly(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  settings: RandomAllocationSettings,
): Promise<{ changed: string; added: number; removed: number; report: string[]; problems: string[]; allocation: WorkshopAllocation }>;

interface RandomAllocationSettings {
  perSubmission?: number;
  perReviewer?: number;
  keepCurrent?: boolean;
  withoutSubmission?: boolean;
  selfAssessment?: boolean;
  excludeSameGroup?: boolean;
}
```

- `perSubmission` or `perReviewer` (one of the two): how many reviews each submission gets, or each reviewer does (Moodle's "Number of reviews").
- `keepCurrent`: keep the allocations there are (the default), or remove them first (Moodle's "Remove current allocations"; it never removes an assessment already graded).
- `withoutSubmission`: reviewers without a submission of their own too (off by default, as in Moodle's form).
- `selfAssessment`: add each author's self-assessment, where the workshop allows self-assessment.
- `excludeSameGroup`: no reviews by peers of the same group, in visible groups mode only (in separate groups Moodle allocates within each group).
- `added`, `removed`: allocations added and removed, counted from the allocation before and after; `report`: Moodle's account of what it did, line by line, in the site's language; `problems`: the lines Moodle marks as errors (not enough reviewers, a graded assessment it kept); `allocation`: the allocation afterwards.

It throws `WorkshopError` for a setting the workshop doesn't have (self-assessment off, not in visible groups mode) and when the person can't allocate, `MoodleError` (`invalid-input`) without a number of reviews or with both, and `FormError` when Moodle refuses the form.

## scheduleAllocation

Turns the scheduled allocation on or off, as Moodle's scheduled allocation form does.

```ts
function scheduleAllocation(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  settings: RandomAllocationSettings & { enabled: boolean },
): Promise<{ changed: string } & ScheduledAllocation>;

interface ScheduledAllocation {
  enabled: boolean;
  perSubmission?: number;
  perReviewer?: number;
  keepCurrent: boolean;
  withoutSubmission: boolean;
  selfAssessment: boolean;
  status: string;
}
```

When it's on, Moodle runs the random allocation by itself, with these settings, at the end of the submission phase: once the workshop's submissions deadline has passed, from its scheduled tasks. The settings left out keep what the form has. It returns the scheduled allocation as the form shows it afterwards, with `status`, Moodle's words about it (a workshop without a submissions deadline is never allocated, and the status says so). Errors as in `allocateRandomly`.

## workshopSubmission

A workshop submission as its page shows it.

```ts
function workshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  which?: { submissionId?: number; authorId?: number },
): Promise<WorkshopSubmissionContent | undefined>;

interface WorkshopSubmissionContent {
  id: number;
  title: string;
  content: string;
  authorId?: number;
  author?: string;
  attachments: WorkshopAttachment[];
  editable: boolean;
}

interface WorkshopAttachment {
  name: string;
  url: string;
}
```

- Without `which`: the person's own submission, `undefined` before they submit.
- `submissionId`: that submission, which Moodle shows its author, its reviewers and those who can see every submission (a teacher).
- `authorId`: that participant's submission, found in the workshop's report (a teacher's), `undefined` when they have none.
- `content`: its text (HTML), with the site's URLs for the files embedded in it; `attachments`: its attached files, each with its URL on the site (`downloadFile` saves one); `author`: left out where Moodle hides authors' names; `editable`: whether Moodle lets the person edit it now (their own, in the submission phase).

It reads the submission's page (`mod/workshop/submission.php`) by its box's classes. It throws `WorkshopError` when Moodle doesn't let the person see the submission, when someone without a submission of their own can't submit (`mod/workshop:submit`, a student's: a teacher has none to read), or for an id that isn't a workshop's; `MoodleError` (`invalid-input`) with both `submissionId` and `authorId`.

## saveWorkshopSubmission

Adds the person's submission to a workshop, or changes the one they have, through Moodle's submission form.

```ts
function saveWorkshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: WorkshopSubmissionInput,
): Promise<{ changed: string; submissionId: number; submission: WorkshopSubmissionContent }>;

interface WorkshopSubmissionInput {
  title?: string;
  content?: string;
  attachments?: string[];
  embed?: string[];
}
```

- `title`: Moodle requires one, so a new submission takes it; editing, left out keeps the one there.
- `content`: the text (HTML), where the workshop takes online text.
- `attachments`: local files (absolute paths) to attach; they replace the files attached before, up to the workshop's "Maximum number of submission attachments". Left out keeps them; `[]` removes them.
- `embed`: local files to embed in the content, which names each by its file name (`<img src="shot.png">`), uploaded as Moodle's editor inserts them (see [Embedding files in rich text](files.md#embedding-files-in-rich-text)).

It does what "Add submission" and "Edit submission" do: only what's given changes. Moodle takes submissions in the submission phase, within its dates, and after any examples the workshop asks to assess first; where the workshop takes late submissions, a first submission in the assessment phase too. It throws `WorkshopError` when the person can't submit (`mod/workshop:submit`, a student's), when Moodle doesn't take the submission now (the error says when it does), or when the workshop doesn't take online text or attachments; `FormError` with Moodle's messages when it refuses the form (too many attachments, a required part missing); `MoodleError` (`invalid-input`) with nothing to save, or a new submission without a title.

## workshopExamples

A workshop's example submissions, as its page lists them to a teacher.

```ts
function workshopExamples(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopExample[]>;

interface WorkshopExample {
  id: number;
  title: string;
  assessed: boolean;
  grade?: number;
  maxGrade?: number;
}
```

Examples are submissions the teacher prepares and assesses (the reference assessment) so participants practise assessing before their own work, or before assessing their peers, as the workshop's settings say ("Use examples" and its mode). `assessed` says whether the reference assessment is made, and `grade` is the grade it gives, out of `maxGrade` (the workshop's grade for submission). Moodle lists examples on the workshop's page in the setup phase only; the driver throws `WorkshopError` in another phase, and when the page lists none (the workshop doesn't use examples, or the person can't manage them: `mod/workshop:manageexamples`, a teacher's).

## addWorkshopExample, editWorkshopExample and deleteWorkshopExample

Add, change and delete a workshop's example submissions, as "Add example submission", "Edit example" and "Delete example" do.

```ts
function addWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: WorkshopSubmissionInput & { title: string },
): Promise<{ changed: string; exampleId: number; example: { id: number; title: string; content: string; attachments: WorkshopAttachment[] } }>;

function editWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  exampleId: number,
  input: WorkshopSubmissionInput,
): Promise<{ changed: string; example: { id: number; title: string; content: string; attachments: WorkshopAttachment[] } }>;

function deleteWorkshopExample(context: BrowserContext, siteUrl: string, activityId: number, exampleId: number): Promise<{ changed: string }>;
```

An example takes the submission's own form (`mod/workshop/exsubmission.php`), so the input is `saveWorkshopSubmission`'s: a title, the text, attachments that replace those there, files to embed. Moodle asks for an example's reference assessment once it's added: `assessWorkshopExample` makes it. Deleting goes through Moodle's confirmation and deletes the example's assessments with it. Examples matter only where the workshop uses them, which Moodle doesn't check when they're added. They throw `WorkshopError` when the person can't manage examples (`mod/workshop:manageexamples`) or the example isn't there; `FormError` when Moodle refuses the form.

## assessWorkshopExample

Assesses an example submission through the workshop's assessment form, as "Assess" on the example does.

```ts
function assessWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  exampleId: number,
  input: { criteria?: WorkshopCriterion[]; feedback?: string; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; assessmentId: number; grade?: number; maxGrade?: number }>;
```

For a teacher who manages examples, it's the example's reference assessment, which participants' assessments of the example are compared with; for a participant, their own practice assessment, where the workshop lets them assess examples now (voluntarily, or before submitting or assessing, in that phase). The form is the grading strategy's, filled as [`assessWorkshopSubmission`](#assessworkshopsubmission) fills a submission's (`criteria` in the form's order, `feedback` where the workshop has overall feedback), on `mod/workshop/exassessment.php`, and saved with "Save and continue"; `grade` is the grade it gives out of `maxGrade`. It throws `WorkshopError` when Moodle offers no assessment of the example, or when a criterion's grade isn't one it takes; `FormError` when Moodle refuses the form.

## calculateWorkshopGrades

Calculates a workshop's grades, as "Re-calculate grades" in the evaluation phase does.

```ts
function calculateWorkshopGrades(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options?: { comparison?: WorkshopComparison },
): Promise<{ changed: string; comparison?: WorkshopComparison } & WorkshopInfo>;

type WorkshopComparison = "very strict" | "strict" | "fair" | "lax" | "very lax";
```

Moodle calculates each submission's grade from its assessments (their weighted mean; allocations not assessed don't count), and each assessment's grade for assessing by the workshop's grading evaluation method, "Comparison with the best assessment" unless another is installed. `comparison` is that method's strictness (Moodle's "Comparison of assessments"); left out, the form keeps the last one used ("fair" at first). Overridden grades stay. It returns the comparison used and the workshop as [`workshopInfo`](#workshopinfo) reads it afterwards, the grades included. The settings form is on the workshop's page (`mod/workshop/view.php`, posting to `mod/workshop/aggregate.php`), found by its class and filled by its field name. It throws `WorkshopError` outside the evaluation phase, when the person can't override grades (`mod/workshop:overridegrades`, a teacher's), or when the evaluation method has no comparison and one is given; `MoodleError` (`invalid-input`) for a comparison that isn't one of the five.

## overrideWorkshopGrade

Overrides a grade Moodle calculated in a workshop: a submission's grade, or an assessment's grade for assessing.

```ts
function overrideWorkshopGrade(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  override: WorkshopGradeOverride,
): Promise<{ changed: string; submission?: WorkshopSubmission; assessment?: WorkshopAssessment }>;

interface WorkshopGradeOverride {
  submissionId?: number;
  assessmentId?: number;
  grade: number | null;
  feedback?: string;
}
```

- `submissionId` or `assessmentId` (one of the two): the submission whose grade to override ("Override grade for submission", on the submission's page), or the assessment whose grade for assessing to override ("Override grade for assessment", in the "Assessment settings" of the assessment's page).
- `grade`: a whole number from 0 to the workshop's grade for submission (or for assessment); `null` removes the override, so the calculated grade counts again.
- `feedback`: the feedback for the author (a submission's) or for the reviewer (an assessment's), HTML; left out keeps what's there.

It returns the submission or the assessment afterwards, as `workshopInfo` reads it (`gradeOverride`, `gradingGradeOverride`). Moodle offers a submission's override in the evaluation phase only, and an assessment's in any phase but not on the person's own assessment while they can still change it (a teacher's own, in the evaluation phase). It throws `WorkshopError` where Moodle shows no override (the phase, the person's own assessment, or without `mod/workshop:overridegrades`), for a grade the form doesn't take, or for a submission or assessment that isn't the workshop's; `MoodleError` (`invalid-input`) without one of the two ids, or for a grade that isn't a whole number.

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

// A workshop: two reviewers for each submission, then open the assessment phase and assess every
// submission with an accumulative form of two criteria.
const allocated = await moodle.allocateRandomly(58, { perSubmission: 2 });
if (allocated.problems.length > 0) console.log(allocated.problems.join("\n"));
await moodle.setWorkshopPhase(58, "assessment");
const workshop = await moodle.workshopInfo(58);
for (const submission of workshop.submissions) {
  const result = await moodle.assessWorkshopSubmission(58, submission.id, {
    criteria: [{ grade: 8, comment: "Clear." }, { grade: 4 }],
    feedback: "<p>Good work.</p>",
  });
  console.log(submission.author, result.grade, "of", result.maxGrade);
}

// Then the evaluation phase: calculate the grades, and raise one.
await moodle.setWorkshopPhase(58, "evaluation");
const graded = await moodle.calculateWorkshopGrades(58, { comparison: "fair" });
const first = graded.submissions[0];
if (first) await moodle.overrideWorkshopGrade(58, { submissionId: first.id, grade: 70, feedback: "<p>Better than the reviews say.</p>" });
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

`assignmentSubmissions` is `others-personal`. `gradeSubmission` is `others-personal` and `others-write` (it reads the panel and decides about someone). `rubric` and `setGradingDefinition` are `course-content`, and `grantExtension`, `setWorkflowState` and `allocateMarker` are `others-write`. `forumGrades` is `others-personal`, `gradeForumUser` `others-personal` and `others-write`, and `rate` `others-write`. `workshopInfo` is `others-personal`, `setWorkshopPhase` `others-write` (it opens and closes participants' work), and `assessWorkshopSubmission` `others-personal` and `others-write`. `workshopAllocation` is `others-personal`, `allocateReviewer`, `removeReviewer` and `allocateRandomly` `others-personal` and `others-write` (they decide who assesses whose work), and `scheduleAllocation` `others-write`. `workshopSubmission` is `own` and `others-personal` (someone else's work too), `saveWorkshopSubmission` `own`; `workshopExamples`, `addWorkshopExample`, `editWorkshopExample` and `deleteWorkshopExample` are `course-content`, and `assessWorkshopExample` `course-content` and `own` (a teacher's reference assessment, or a participant's practice); `calculateWorkshopGrades` and `overrideWorkshopGrade` are `others-personal` and `others-write`. See [data categories](../concepts/data-categories.md).
