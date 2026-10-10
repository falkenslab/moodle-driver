# Give a student more time

A program for a teacher that gives one student more time: an extension on an assignment, a week after the date they had, and a quiz override with a later closing date, a longer time limit and one more attempt.

**Uses:** [grading](../areas/grading.md), [quizzes](../areas/quizzes.md), [participants](../areas/participants.md).

## The program

```ts
import { createMoodle, FormError, NotAnAssignmentError, QuizError } from "@falkenslab/moodle-driver";

// The ids, from the course's pages or the driver:
const COURSE_ID = 3; // course/view.php?id=3, or listCourses()
const ASSIGNMENT_ID = 45; // mod/assign/view.php?id=45, or courseStructure(COURSE_ID)
const QUIZ_ID = 27; // mod/quiz/view.php?id=27
const STUDENT_ID = 7; // user/view.php?id=7, or participants(COURSE_ID)
const WEEK = 7 * 24 * 60 * 60 * 1000;

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();

// Make sure the id is the right person before changing their dates.
const student = (await moodle.participants(COURSE_ID)).find((p) => p.userId === STUDENT_ID);
if (!student) throw new Error(`User ${STUDENT_ID} isn't a participant of course ${COURSE_ID}.`);
console.log(`More time for ${student.fullName}`);

// The student's due date as it stands: an earlier extension or override already counts in it.
// Without content it's one request per participant, no grading panels.
const submission = (await moodle.assignmentSubmissions(ASSIGNMENT_ID, { includeContent: false })).find((s) => s.userId === STUDENT_ID);
if (!submission?.dueDate) throw new Error(`Assignment ${ASSIGNMENT_ID} has no due date for user ${STUDENT_ID}.`);
// A week after the date they have; Moodle's date selector keeps minutes, not seconds.
const until = new Date(Date.parse(submission.extensionDueDate ?? submission.dueDate) + WEEK);

try {
  console.log((await moodle.grantExtension(ASSIGNMENT_ID, [STUDENT_ID], until)).changed);
} catch (error) {
  // Moodle refuses a date before the assignment's due date, with its message by field.
  if (error instanceof FormError) console.error(error.fields.map((f) => `${f.field}: ${f.message}`).join("\n"));
  else if (error instanceof NotAnAssignmentError) console.error(error.message);
  else throw error;
}

try {
  // Only what's given changes; the opening date stays the quiz's.
  const override = await moodle.setQuizOverride(QUIZ_ID, STUDENT_ID, {
    close: new Date("2026-11-20T22:00:00Z"),
    timeLimitMinutes: 60,
    attempts: 2,
  });
  console.log(override.changed);
} catch (error) {
  // Also when the student has an override in this quiz already: that one is changed in Moodle.
  if (error instanceof QuizError || error instanceof FormError) console.error(error.message);
  else throw error;
}
```

## Step by step

1. The ids at the top come from the course's pages (each is the `id` in the URL) or from the driver: `listCourses()` for the course, `courseStructure(COURSE_ID)` for the activities (their `id` is the course module id the functions take), `participants(COURSE_ID)` for the student.
2. `logIn()` returns at once with a saved session, or opens a window for the teacher to log in the first time.
3. `participants` confirms the user id is a participant and gives their name for the log: changing someone's dates by a wrong id is easy to miss.
4. `assignmentSubmissions` with `includeContent: false` reads every participant's dates, with their overrides and extensions applied. The program takes the student's current date (an extension's, if they already had one) and adds a week.
5. `grantExtension` fills the assignment's extension form, as "Grant extension" in the submissions page does. The date is written in the teacher's time zone in Moodle, so `until` is the exact moment. Granting again replaces an earlier extension. The student sees the new date on the assignment's page.
6. `setQuizOverride` adds a user override through the quiz's "Overrides" page: a closing date, a time limit of 60 minutes and 2 attempts in all, for this student only. The quiz's other settings stay as they are.
7. Each write answers with its `changed` sentence, which the program prints. `await using` closes the browser at the end.

## What it prints

An example run:

```text
More time for Ada Lovelace
Extension until 2026-11-13T22:59:00.000Z granted to user 7 in assignment 45.
Override for user 7 in quiz 27: closes 2026-11-20T22:00:00.000Z, 60 minutes, 2 attempts.
```

## Variations

- Several students at once: `grantExtension(ASSIGNMENT_ID, [7, 9, 12], until)` grants the same date to all of them, as the bulk action does; quiz overrides are one call per student.
- Check the extension took: read the submissions again and print `extensionDueDate` for the student.
- Unlimited attempts: `attempts: 0`. Only a later opening date: `{ open: new Date("2026-11-16T08:00:00Z") }`.
- A whole group: `participants(COURSE_ID, { group: groupId })` gives the user ids for `grantExtension`, with the group id from `groups(COURSE_ID)`.

## When something goes wrong

- `FormError` from `grantExtension`: Moodle refused the form, for example a date before the assignment's due date, with its message in `error.fields`. Also when the teacher's time zone in Moodle isn't one the driver knows.
- `NotAnAssignmentError`: the extension form can't be opened: the id isn't an assignment, or the person isn't allowed to grant extensions.
- `QuizError` from `setQuizOverride`: the id isn't a quiz the person can add overrides to, or the student can't get one: not a participant, or already overridden in this quiz. Moodle's form only adds overrides; change an existing one in Moodle's "Overrides" page.
- `FormError` from `setQuizOverride`: Moodle refused the values, such as a closing date before the opening date.
- `NotLoggedInError`: the session expired; run again to log in. See [Errors](../concepts/errors.md).

## Data it touches

`participants` and `assignmentSubmissions` read others' data (`others-personal`); `grantExtension` and `setQuizOverride` are `others-write`: the program changes what a student may do. See [Data categories](../concepts/data-categories.md).
