# Grade pending submissions

A program for a teacher that goes through an assignment's submissions waiting for a grade, shows each one's content in the terminal, and saves the grade and feedback the teacher types, notifying the student. A second program does the same for an assignment graded with a rubric.

**Uses:** [grading](../areas/grading.md), [files](../areas/files.md).

## The program

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, FormError, GradingError } from "@falkenslab/moodle-driver";

// The assignment's activity id: the `id` in mod/assign/view.php?id=45, or courseStructure()'s activities.
const ASSIGNMENT_ID = 45;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

// One grading panel per participant with a submission: slow in a large course, but it brings the content.
const submissions = await moodle.assignmentSubmissions(ASSIGNMENT_ID);
// `needsGrading` is Moodle's "Requires grading": submitted, and not graded since.
const pending = submissions.filter((s) => s.needsGrading);
console.log(`${pending.length} of ${submissions.length} submissions need grading.`);

let graded = 0;
for (const submission of pending) {
  console.log(`\n== ${submission.fullName} (user ${submission.userId}), ${submission.status}`);
  // One entry per submission plugin: the online text's words, the uploaded files' links.
  for (const { plugin, text, files } of submission.content ?? []) {
    if (text) console.log(`[${plugin}]\n${text}`);
    for (const file of files) console.log(`[${plugin}] ${file.name}: ${file.url}`);
  }

  const grade = (await terminal.question("Grade (empty to skip): ")).trim();
  if (!grade) continue;
  const comment = (await terminal.question("Feedback: ")).trim();
  try {
    const result = await moodle.gradeSubmission(ASSIGNMENT_ID, submission.userId, {
      // As typed: "7.5", or "7,5" on a site that writes decimals with a comma.
      grade,
      ...(comment ? { feedback: `<p>${comment}</p>` } : {}),
      // Moodle notifies the student that there is feedback on the assignment.
      notify: true,
    });
    console.log(`${result.changed} Grade now: ${result.grade ?? "-"}`);
    graded++;
  } catch (error) {
    // A grade out of range, or a value Moodle's form refuses: report it and go on with the next one.
    if (error instanceof GradingError || error instanceof FormError) console.error(`Not saved: ${error.message}`);
    else throw error;
  }
}

terminal.close();
console.log(`\nGraded ${graded} of ${pending.length}.`);
```

## Step by step

1. `ASSIGNMENT_ID` is the assignment's activity id (course module id): the number in its URL, `mod/assign/view.php?id=45`, or the `id` of the activity in `courseStructure(courseId)`.
2. `logIn()` returns at once when the profile has a session. The first time, a browser window opens on the site's login page and the teacher logs in there; see [Logging in](../getting-started/logging-in.md).
3. `assignmentSubmissions` lists every participant, with the status, dates and, for submitted and draft submissions, the content per submission plugin. It reads one participant at a time, so a course of 100 students takes a while.
4. The program keeps the submissions Moodle says require grading and prints each one: the online text as plain text, and the uploaded files as links (download them with `moodle.downloadFile(url, folder)` to open them).
5. The teacher types a grade, or nothing to skip that student, and a comment. `gradeSubmission` fills the grader's panel for that student, submits it as Moodle's grader does and reads the panel back: `result.grade` is the grade saved.
6. With `notify: true`, Moodle notifies the student that feedback was posted (by its messaging, at the site's next cron run). The grade goes to the gradebook unless the assignment uses a marking workflow that hasn't released it.
7. `await using` closes the browser (and saves the session) when the program ends, also after an error.

## What it prints

An example run:

```text
3 of 24 submissions need grading.

== Ada Lovelace (user 7), submitted
[onlinetext]
A recursive function needs a base case. In my solution the base case is n = 0...
Grade (empty to skip): 8.5
Feedback: Clear base case; the complexity analysis is missing.
Graded user 7 in assignment 45, with feedback. Grade now: 8.50

== Alan Turing (user 9), submitted
[file] recursion.pdf: https://campus.example.org/pluginfile.php/312/assignsubmission_file/submission_files/88/recursion.pdf?forcedownload=1
Grade (empty to skip):

== Grace Hopper (user 12), submitted
[onlinetext]
I used a loop instead of recursion because...
Grade (empty to skip): 11
Feedback: Good.
Not saved: Moodle didn't save the grade: ... Check the grade is within the assignment's range or scale, and the fields' names.

Graded 1 of 3.
```

## With a rubric

An assignment graded with a rubric takes a level per criterion instead of a grade. `rubric()` gives the criteria and their levels with the ids `gradeSubmission` takes; Moodle computes the grade from the levels chosen.

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, FormError, GradingError } from "@falkenslab/moodle-driver";

// An assignment whose grading method is a rubric (its "Advanced grading" page).
const ASSIGNMENT_ID = 52;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();
const terminal = createInterface({ input: process.stdin, output: process.stdout });

// Read once: the criteria are the same for every student.
const definition = await moodle.rubric(ASSIGNMENT_ID);
if (definition.method !== "rubric") throw new Error(`Assignment ${ASSIGNMENT_ID} is graded by "${definition.method}", not by a rubric.`);

for (const submission of (await moodle.assignmentSubmissions(ASSIGNMENT_ID)).filter((s) => s.needsGrading)) {
  console.log(`\n== ${submission.fullName}`);
  for (const { text } of submission.content ?? []) if (text) console.log(text);

  // Criterion id -> level id, chosen by the level's number as listed.
  const levels: Record<number, number> = {};
  for (const criterion of definition.criteria) {
    console.log(`\n${criterion.description}`);
    criterion.levels?.forEach((level, i) => console.log(`  ${i + 1}. (${level.score}) ${level.definition}`));
    const choice = Number(await terminal.question("Level: "));
    const level = criterion.levels?.[choice - 1];
    if (level) levels[criterion.id] = level.id;
  }
  // Moodle refuses a rubric with a criterion left without a level: skip the student instead.
  if (Object.keys(levels).length < definition.criteria.length) {
    console.log("Not every criterion has a level: skipped.");
    continue;
  }
  try {
    const result = await moodle.gradeSubmission(ASSIGNMENT_ID, submission.userId, { rubric: levels, feedback: "<p>See the rubric for each criterion.</p>", notify: true });
    // The grade Moodle computed from the levels, as the gradebook has it.
    console.log(`${result.changed} Gradebook: ${result.gradebookGrade ?? "-"}`);
  } catch (error) {
    if (error instanceof GradingError || error instanceof FormError) console.error(`Not saved: ${error.message}`);
    else throw error;
  }
}
terminal.close();
```

`rubric()` reads the grading form of the assignment's first participant, so the assignment needs at least one. A level's `score` is the rubric's points for it; the grade Moodle writes in the gradebook is those points scaled to the assignment's maximum grade, which is why the result's `gradebookGrade` is what to show. A criterion can also take a remark: `remarks: { [criterion.id]: "Missing the base case." }` beside `rubric`.

## Variations

- Grade from a list the teacher prepared instead of the terminal: a `Map` from user id to grade and comment, and `gradeSubmission` for each entry, with no prompts.
- Only look, without grading: `assignmentSubmissions(ASSIGNMENT_ID, { includeContent: false })` is much faster when only the statuses and dates are needed.
- Grade quietly: `notify: false` saves the grade without notifying the student, for a first pass to review before releasing.
- A marking guide instead of a rubric: `definition.method === "guide"`, and `guide: { [criterion.id]: score }` with each score up to the criterion's `maxScore`.

## When something goes wrong

- `NotAnAssignmentError`: the id isn't an assignment, or the person can't grade it (a student, or a teacher of another course). Check the activity id and the teacher's role in the course.
- `GradingError`: Moodle didn't save the grade, and its service doesn't say why. Usually a grade out of the assignment's range (11 when the maximum is 10) or not in its scale. `rubric()` also throws it for an assignment with no participants.
- `FormError`: a field isn't in the grading form, such as `grade` on an assignment graded by rubric, or a criterion or level id that doesn't exist; `error.fields` says which.
- `MoodleError` with code `not-available`: `feedback` was given and the assignment has feedback comments off. Nothing was saved: grade without `feedback`, or turn feedback comments on in the assignment's settings.
- `NotLoggedInError`: the session expired midway; run again, and `logIn()` opens the window. See [Errors](../concepts/errors.md).

## Data it touches

`assignmentSubmissions` reads students' work (`others-personal`), `rubric` is `course-content`, and `gradeSubmission` is `others-personal` and `others-write`: the program decides something about other people and Moodle tells them. See [Data categories](../concepts/data-categories.md).
