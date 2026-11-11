# Answer a quiz

A program for a student that starts a quiz attempt (or continues the one in progress), shows its questions page by page at the terminal, saves the answers the person types, and finishes the attempt and prints its review when they confirm.

**Uses:** [quizzes](../areas/quizzes.md); see also [Working at a student's pace](../concepts/student-pace.md).

## The program

```ts
import { createInterface } from "node:readline/promises";
import { createMoodle, type AttemptPage } from "@falkenslab/moodle-driver";

// The quiz's course module id: an activity of type "quiz" in courseStructure() (mod/quiz/view.php?id=26).
const QUIZ_ID = 26;

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  // A person reads and answers at the terminal, at their own pace: the driver's reading pauses would only add to it.
  trail: "fast",
});
await moodle.logIn();

const info = await moodle.quizInfo(QUIZ_ID);
console.log(info.info.join("\n"));
if (!info.canStart) throw new Error(`The quiz can't be attempted: ${info.messages.join(" ")}`);

// Starts an attempt, or continues the open one; a time limit's clock starts here. The page it opens on comes back.
let at: AttemptPage = await moodle.startQuizAttempt(QUIZ_ID);
const attemptId = at.attemptId;
const prompt = createInterface({ input: process.stdin, output: process.stdout });

// One page at a time, as a person goes through the attempt, until it's at its summary (no `page`).
while (at.page !== undefined) {
  console.log(`\n--- Page ${at.page + 1} of ${at.pages} ---`);
  const answers: { slot: number; responses: Record<string, string> }[] = [];
  for (const question of at.questions) {
    console.log(`\n${question.number ?? ""} ${question.text}`);
    // Answers go by the fields' form names (q9:1_answer); `value` is what's saved already.
    const responses: Record<string, string> = {};
    for (const field of question.fields) {
      if (field.kind === "text") {
        const typed = await prompt.question(`  Answer${field.value ? ` [${field.value}]` : ""}: `);
        if (typed) responses[field.name] = typed;
      } else if (field.kind === "checkbox") {
        const typed = await prompt.question(`  [${field.value === "1" ? "x" : " "}] ${field.label ?? ""} (y/n) `);
        if (typed) responses[field.name] = /^y/i.test(typed) ? "1" : "0";
      } else {
        // Radios and drop-downs: leave out "clear my choice" (-1) and a drop-down's "Choose..." (0); a false is "0" too.
        const options = (field.options ?? []).filter((o) => o.value !== "-1" && !(field.kind === "select" && o.value === "0"));
        if (field.label) console.log(`  ${field.label}`);
        options.forEach((option, i) => console.log(`  ${i + 1}) ${option.label}${option.value === field.value ? " *" : ""}`));
        const chosen = options[Number(await prompt.question("  Number (empty to skip): ")) - 1];
        if (chosen) responses[field.name] = chosen.value;
      }
    }
    if (Object.keys(responses).length > 0) answers.push({ slot: question.slot, responses });
  }
  if (answers.length > 0) {
    // Saves this page as its "Next page" button does and gives the next page (or the summary); the attempt stays open.
    at = await moodle.answerQuizQuestions(attemptId, answers);
    console.log(`Saved answers to ${answers.length} question(s).`);
  } else if (at.page + 1 < at.pages) {
    // Nothing to save: on to the next page, as its link in the attempt's navigation does.
    at = await moodle.readAttempt(attemptId, { page: at.page + 1 });
  } else {
    break;
  }
}

// The summary's rows, when the attempt got there: each question's status, in the site's language.
if (at.summary) console.log("");
for (const row of at.summary ?? []) console.log(`${row.number}: ${row.status}`);

const confirm = await prompt.question("\nSubmit all and finish? (yes/no) ");
prompt.close();
if (/^y(es)?$/i.test(confirm.trim())) {
  const done = await moodle.finishQuizAttempt(attemptId);
  // The review is there only when the quiz's review options show it right after the attempt.
  if (!done.review) console.log(`${done.changed} The review isn't available yet.`);
  for (const row of done.review?.summary ?? []) console.log(`${row.label}: ${row.value}`);
  for (const q of done.review?.questions ?? []) console.log(`${q.number ?? "-"} ${q.state}${q.mark ? ` (${q.mark})` : ""}${q.rightAnswer ? `: ${q.rightAnswer}` : ""}`);
} else {
  console.log(`Attempt ${attemptId} stays open: run again to continue it.`);
}
```

## Step by step

1. `createMoodle` takes `trail: "fast"`: here a person is the one reading, so the pauses the realistic trail adds for a program that answers alone aren't needed. See [Working at a student's pace](../concepts/student-pace.md).
2. `logIn()` opens a window the first time for the person to log in.
3. `quizInfo(QUIZ_ID)` reads the quiz's page: its information lines, the person's attempts and `canStart`, which is false when the attempts are used up or the quiz is closed (`messages` says why).
4. `startQuizAttempt` presses the quiz's start (or continue) button, confirms the time limit's form if there is one, and gives the page the attempt opens on (page 0 for a new attempt, where it was left for one in progress): its `page`, the attempt's number of `pages` and that page's `questions`, each with its `slot` and its `fields`. It doesn't read the other pages: each page a program loads is a view in the course's logs.
5. On each page, the program shows the questions and asks for each field: a text, a tick, or an option's number. Then `answerQuizQuestions(attemptId, answers)` saves that page with its "Next page" button and gives where that leads: the next page, or the summary after the last one. A page left blank isn't saved: `readAttempt(attemptId, { page })` moves on to the next one. Moodle keeps what's saved, so stopping halfway loses nothing.
6. Past the last page, the attempt is at its summary: `at.page` is undefined and `at.summary` gives each question's status, which the program prints.
7. When the person confirms, `finishQuizAttempt` submits the attempt ("Submit all and finish") and returns the review, if the quiz shows it now: the summary (state, marks, grade) and each question's state, mark and right answer.

## What it prints

An example; the questions, labels and grades come from the site.

```text
Attempts allowed: 2
Time limit: 20 mins
Grading method: Highest grade

--- Page 1 of 2 ---

1 Recursion always needs a base case.
  1) True
  2) False
  Number (empty to skip): 1

2 What does factorial(4) return?
  Answer: 24
Saved answers to 2 question(s).

--- Page 2 of 2 ---

3 Which of these are loops in Python?
  [ ] for (y/n) y
  [ ] while (y/n) y
  [ ] repeat (y/n) n
Saved answers to 1 question(s).

1: Answer saved
2: Answer saved
3: Answer saved

Submit all and finish? (yes/no) yes
State: Finished
Marks: 3.00/3.00
Grade: 10.00 out of 10.00 (100%)
1 correct (Mark 1.00 out of 1.00): The correct answer is 'True'.
2 correct (Mark 1.00 out of 1.00): The correct answer is: 24
3 correct (Mark 1.00 out of 1.00): The correct answers are: for, while
```

## Variations

- Continue later: run it again. `startQuizAttempt` continues the open attempt, and each field's saved `value` shows marked (`*`, `[x]`, or in brackets).
- Answer from a file instead of the terminal: build the same `{ slot, responses }` list and save it in one call; with the default realistic trail, the driver then pauses on each page as a reader would.
- Read a past attempt's review: take its id from `info.attempts` (those with `inProgress: false`) and call `await moodle.readReview(id)`.
- Read the open attempt without starting anything: `await moodle.readAttempt(attemptId)` gives the page its tab is on (page 0 when no tab of it is open), and `await moodle.readAttempt(attemptId, { page: 1 })` its second page. Each page loaded is a view in the logs, so read only the pages the program needs.

## When something goes wrong

- `QuizError` from `startQuizAttempt`: the quiz asks for a password (not supported), there's no start button (attempts used up, closed), or the id isn't a quiz; the message carries the page's reasons.
- `QuizError` from `answerQuizQuestions`, `readAttempt` or `finishQuizAttempt`: the attempt isn't open any more (the time limit ran out, or it was finished elsewhere), or a slot isn't in it.
- `FormError` from `answerQuizQuestions`: a field name isn't on its page; that page and the following ones aren't saved, the earlier ones are.
- `NotLoggedInError`: the session expired while the person was answering. Call `moodle.logIn()` and run again: the attempt continues with what was saved. See [Errors](../concepts/errors.md).

## Data it touches

`quizInfo` is `course-content` and `own`; `startQuizAttempt`, `readAttempt`, `answerQuizQuestions` and `finishQuizAttempt` are `own`. See [data categories](../concepts/data-categories.md).
