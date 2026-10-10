# Submit an assignment

A program for a student that checks an assignment, saves online text and a file in their submission, and submits it for grading, asking the person first when the site wants them to accept a submission statement.

**Uses:** [assignments](../areas/assignments.md), [files](../areas/files.md).

## The program

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, SubmissionError } from "@falkenslab/moodle-driver";

// The assignment's course module id: an activity of type "assign" in courseStructure(), or listAssignments().
const ASSIGNMENT_ID = 45;
// Local files go as absolute paths.
const FILE = "/home/ada/work/factorial.py";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});
await moodle.logIn();

const assignment = await moodle.studentAssignment(ASSIGNMENT_ID);
for (const row of [...assignment.dates, ...assignment.status]) console.log(`${row.label}: ${row.value}`);

// canEdit: the page offers to add or edit the submission now (not submitted yet, not past its cut-off).
if (!assignment.canEdit) {
  console.log("\nThe submission can't be changed now.");
} else {
  // Saves a draft: the online text replaces what was there, the file is added to the ones already there.
  const saved = await moodle.saveSubmission(ASSIGNMENT_ID, {
    onlineText: "<p>My factorial is recursive, with 0 as the base case. The file has the tests.</p>",
    files: [FILE],
  });
  console.log(`\n${saved.changed} Files: ${saved.assignment.submittedFiles.map((f) => f.name).join(", ")}`);

  // canSubmit: the assignment asks students to click "Submit assignment", and there's a draft to submit.
  // Where it doesn't ask, Moodle took the saved draft as submitted already.
  if (saved.assignment.canSubmit) {
    try {
      console.log((await moodle.submitForGrading(ASSIGNMENT_ID)).changed);
    } catch (error) {
      // With canSubmit true, a SubmissionError here is the site's statement; its message carries the text.
      if (!(error instanceof SubmissionError)) throw error;
      console.log(`\n${error.message}`);
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await prompt.question("Do you accept this statement? (yes/no) ");
      prompt.close();
      if (/^y(es)?$/i.test(answer.trim())) {
        const submitted = await moodle.submitForGrading(ASSIGNMENT_ID, { acceptStatement: true });
        console.log(`${submitted.changed} State: ${submitted.assignment.submissionState}`);
      } else {
        console.log("Not submitted: the draft stays saved, and can be submitted later.");
      }
    }
  }
}
```

## Step by step

1. `logIn()` opens a window the first time for the person to log in, and answers at once afterwards.
2. `studentAssignment(ASSIGNMENT_ID)` reads the assignment as the student's page shows it. `dates` and `status` are label and value pairs in the site's language; `submissionState`, `canEdit` and `canSubmit` don't depend on it.
3. `saveSubmission` opens the edit page, uploads the file as the file picker does, sets the online text through its editor and saves. It returns `changed` and the assignment afterwards, so there's no need to read it again.
4. `submitForGrading` opens the confirmation page. When the site asks to accept a statement ("This submission is my own work…") it submits nothing and throws `SubmissionError` with the statement's text: the program shows it and asks the person at the terminal.
5. Only if the person answers yes does it call again with `{ acceptStatement: true }`, which ticks the statement and submits. Once submitted, the submission can't be edited unless the teacher reverts it to draft.

## What it prints

An example on a site with a submission statement; the labels and values come from the site.

```text
Due: Friday, 16 October 2026, 11:59 PM
Submission status: No attempt
Grading status: Not graded
Time remaining: 6 days 12 hours

Saved online text and 1 file in assignment 45's submission. Files: factorial.py

Submitting asks to accept this statement; call again with acceptStatement once the person agrees: This submission is my own work, except where I have acknowledged the use of the works of other people.
Do you accept this statement? (yes/no) yes
Submitted assignment 45 for grading. State: submitted
```

## Variations

- Only a file, or only text: give `files` or `onlineText` alone; an assignment that doesn't take one of them throws `SubmissionError` before saving anything.
- Check the files before anything opens, to tell the person early: `await checkLocalFiles([FILE])` (exported).
- Save a draft and stop: leave out `submitForGrading`; the teacher sees it as a draft.
- Download the files attached to the description first: `for (const f of assignment.descriptionFiles) await moodle.downloadFile(f.url, "/home/ada/work")`.

## When something goes wrong

- `SubmissionError` from `studentAssignment`: the id isn't an assignment the person can open. Take it from the course structure (module `"assign"`).
- `SubmissionError` from `saveSubmission`: nothing given, the submission can't be edited now (submitted already, past the cut-off date), or the assignment doesn't take files or online text.
- `SubmissionError` from `submitForGrading`: the statement to accept, as above, or nothing to submit (no draft, submitted already). The `code` is `submission` for all of them; checking `canSubmit` first is what leaves the statement as the one to expect.
- `MoodleError` with code `invalid-input` or `not-found`: the file's path isn't absolute or there's no file there, checked before opening anything.
- `FormError`: the upload failed (too big, a type the assignment doesn't accept, no upload repository on the site) or Moodle refused the form; `error.fields` has Moodle's messages. See [Errors](../concepts/errors.md).

## Data it touches

`studentAssignment` is `course-content` and `own`; `saveSubmission` and `submitForGrading` are `own`. See [data categories](../concepts/data-categories.md).
