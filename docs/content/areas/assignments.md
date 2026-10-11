# Assignments

The student's side of an assignment: reading it as the student's page shows it, saving a submission (online text, files or both) and submitting it for grading. Everything goes through the assignment's own pages and forms (`mod/assign/view.php`), as the person would, so Moodle logs it and applies its own rules (dates, cut-off, attempts, the submission statement). The teacher's side (everyone's submissions, grading, extensions) is in [grading](grading.md); an assignment's id comes from the [course structure](courses.md) or `listAssignments`.

**Terms:** [assignment](../reference/glossary.md#assignment), [submission](../reference/glossary.md#submission).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## studentAssignment

The assignment as the student's page shows it.

```ts
function studentAssignment(context: BrowserContext, siteUrl: string, activityId: number): Promise<StudentAssignment>;

interface StudentAssignment {
  description: string;
  descriptionFiles: { name: string; url: string }[];
  dates: { label: string; value: string }[];
  status: { label: string; value: string }[];
  submissionState?: string;
  graded: boolean;
  submittedFiles: { name: string; url: string }[];
  feedback: { label: string; value: string }[];
  feedbackFiles: { name: string; url: string }[];
  canEdit: boolean;
  canSubmit: boolean;
}
```

- `description`: the assignment's description as text.
- `descriptionFiles`: files attached to the description (`pluginfile.php` links, for [downloadFile](files.md)).
- `dates`: the activity's dates as the page shows them (`{ label: "Due", value: "Friday, 30 October 2026, 11:59 PM" }`).
- `status`: the submission status table, row by row (attempt number, submission status, grading status, time remaining, last modified…), labels and values as the page shows them.
- `submissionState`: Moodle's state for the submission, read from the status cell's class in any language: `"new"`, `"draft"`, `"submitted"`, `"reopened"`…; absent when the page has none.
- `graded`: the grading status says it's graded.
- `submittedFiles`: the files in the person's submission.
- `feedback`: the feedback table, row by row (grade, graded on, graded by, feedback comments), when there's feedback.
- `feedbackFiles`: the files the teacher attached to the feedback (a corrected PDF, an audio comment), `pluginfile.php` links for [downloadFile](files.md); read from the feedback files plugin's block, so links in the feedback comments aren't among them.
- `canEdit`: the page offers to add or edit the submission now.
- `canSubmit`: the page offers to submit it for grading now (a draft in an assignment that asks students to click submit).

Labels and values are in the site's language; `submissionState`, `graded`, `canEdit` and `canSubmit` don't depend on it.

It throws `SubmissionError` when the id isn't an assignment the person can open (Moodle shows another module's page or an error), and `NotLoggedInError` without a session.

## saveSubmission

Saves the submission's online text and adds files, as "Save changes" on the edit page does, and returns what it saved (`changed`) and the assignment afterwards.

```ts
function saveSubmission(context: BrowserContext, siteUrl: string, activityId: number, input: { onlineText?: string; files?: string[] }): Promise<{ changed: string; assignment: StudentAssignment }>;
```

- `onlineText`: HTML, which replaces the online text through its editor.
- `files`: absolute local paths, uploaded to the submission's file area as the file picker does; the files already there stay (see [files](files.md)).

It saves a draft: in an assignment that asks students to click submit, the submission stays a draft until `submitForGrading`. In one that doesn't, Moodle takes the saved submission as submitted.

Errors (`SubmissionError` unless said otherwise):

- Neither online text nor files given.
- The edit page can't be opened: submitted already, past its cut-off date, or not the person's to submit.
- Files given to an assignment that doesn't take file submissions, or online text to one that doesn't take it; nothing is saved.
- A `MoodleError` (`invalid-input`, `not-found`) when a file path isn't absolute or doesn't exist, checked before opening anything.
- `FormError` when the upload fails (the site has no upload repository enabled, a file too big or of a type the assignment doesn't accept) or Moodle refuses the form, with its messages by field.

## submitForGrading

Submits the saved submission for grading and returns `changed` and the assignment afterwards.

```ts
function submitForGrading(context: BrowserContext, siteUrl: string, activityId: number, options?: { acceptStatement?: boolean } | boolean): Promise<{ changed: string; assignment: StudentAssignment }>;
```

Some sites ask students to accept a statement before submitting ("This submission is my own work…"). When the confirmation form has that statement and `acceptStatement` isn't `true` (it's `false` by default; a bare boolean, as before 0.2, is accepted too), nothing is submitted and it throws `SubmissionError` with the statement's text, so the program can show it to the person and call again with `{ acceptStatement: true }` once they agree. Without a statement, `acceptStatement` is ignored.

It throws `SubmissionError` when there's nothing to submit now: no draft, submitted already, or the assignment doesn't ask students to click submit. A submitted assignment can't be edited again unless the teacher reverts it to draft or reopens it.

## Example

```ts
import { SubmissionError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const assignment = await moodle.studentAssignment(45);
console.log(assignment.description);
for (const date of assignment.dates) console.log(`${date.label}: ${date.value}`);

if (assignment.canEdit) {
  const { assignment: saved } = await moodle.saveSubmission(45, {
    onlineText: "<p>My factorial is recursive, with 0 as the base case.</p>",
    files: ["/home/ada/work/factorial.py"],
  });
  console.log(saved.submissionState, saved.submittedFiles.map((f) => f.name));

  if (saved.canSubmit) {
    try {
      await moodle.submitForGrading(45);
    } catch (error) {
      if (!(error instanceof SubmissionError)) throw error;
      // The site asks to accept a statement: show it and ask the person before calling again.
      console.log(error.message);
    }
  }
}
```

## Data categories

`studentAssignment` is `course-content` and `own`; `saveSubmission` and `submitForGrading` are `own`. See [data categories](../concepts/data-categories.md).
