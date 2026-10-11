# Quizzes

Quizzes from both sides. A student reads a quiz's page, starts or continues an attempt, answers its questions page by page (at a person's pace by default) and finishes it, then reads the review. A teacher reads every attempt with its grade and marks per question (and the answers given), grades by hand what Moodle can't grade by itself (essays) or overrides a mark, reads which questions a quiz holds, adds questions from a bank (chosen or random), removes and moves them, sets their marks, pages and sections, and gives a student other dates, a time limit or more attempts with a user override. Quizzes are identified by their course module id (the `id` in `mod/quiz/view.php?id=`), attempts by Moodle's attempt id.

**Terms:** [quiz](../reference/glossary.md#quiz), [attempt](../reference/glossary.md#attempt), [slot](../reference/glossary.md#slot), [review](../reference/glossary.md#review), [override](../reference/glossary.md#override).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

Everything is read from Moodle's own pages by their structure (body ids, form names, classes, links), so it works in any interface language; texts such as dates, states and grades come as the site shows them, in its language. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)); the others are `QuizError`, and `FormError` where a form is involved.

## quizInfo

What the quiz's page says: its description, its information lines, its dates, the person's attempts and whether they can start one.

```ts
function quizInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuizInfo>;

interface QuizInfo {
  intro: string;
  info: string[];
  dates: Detail[];
  feedback?: string;
  attempts: { id: number; inProgress: boolean; details: Detail[] }[];
  canStart: boolean;
  messages: string[];
}

interface Detail {
  label: string;
  value: string;
}
```

- `intro`: the quiz's description as text.
- `info`: the lines under it, as shown ("Attempts allowed: 3", "Grading method: Highest grade").
- `dates`: the activity dates (opens, closes), each as a label and its value as shown.
- `feedback`: the overall feedback for the person's grade, when the page shows one.
- `attempts`: the person's attempts, each with its id, whether it's still in progress, and its summary rows (state, grade, marks...) as label and value.
- `canStart`: the page has the button to start an attempt (or continue the one in progress).
- `messages`: what the page says about attempting (no more attempts allowed, closed...).

Throws `QuizError` when the id isn't a quiz the person can open. Leaves no more trail than opening the quiz's page.

## startQuizAttempt

Starts an attempt, or continues the one in progress, exactly as the quiz page's button does, and gives its questions.

```ts
function startQuizAttempt(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ changed: string; attemptId: number; questions: Question[] }>;
```

A quiz with a time limit first asks for confirmation on a form of its own: the driver confirms it, which starts the clock. A quiz with a password isn't started: `QuizError` says it asks for one. `QuizError` also comes when the page has no start button (the person used all attempts, the quiz is closed), carrying the page's messages, and when the id isn't a quiz.

## Questions and their fields

An attempt's or review's questions come as `Question` objects, read from the page's form:

```ts
interface Question {
  slot: number;
  page?: number;
  number?: string;
  type: string;
  state: string;
  mark?: string;
  text: string;
  images: string[];
  fields: QuestionField[];
  feedback?: string;
  rightAnswer?: string;
  comment?: string;
}

interface QuestionField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
  value?: string;
}
```

- `slot`: the question's place in the quiz; answers are given by slot.
- `page`: the attempt page it's on (from 0); set when reading an attempt, not a review.
- `number`: the number shown ("1", "i" for a description).
- `type`: Moodle's question type ("truefalse", "multichoice", "match", "shortanswer"...).
- `state`: Moodle's state class ("notyetanswered", "answersaved", and in a review "correct", "incorrect", "partiallycorrect"...).
- `mark`: the mark line as shown ("Marked out of 1.00").
- `text`: the question's text, without what only screen readers get; `images` holds its images' URLs.
- `feedback` and `rightAnswer`: in a review, when the quiz's review options show them.
- `comment`: in a review, the teacher's comment from grading by hand, as the text of its paragraphs (without the page's "Comment:" label); a comment written without paragraphs comes with the label, as shown.

Each input of the question is a field with its form name, such as `q9:1_answer` (`q<usage>:<slot>_<name>`). Answering means giving values for those names:

- `choice`: radio buttons (single choice, true/false); give one of `options[].value`. A single-choice question also has a "clear my choice" option with the value `-1`.
- `checkbox`: one per option of a multiple-answer question; give `"1"` to tick it and `"0"` to untick it. Its `label` is the option's text.
- `select`: a drop-down (matching questions' rows, labelled by the row's text); give one of `options[].value`.
- `text`: a typed answer (short answer, numerical, essay); give the text.

`value` is the current answer, so a program can see what's already saved.

## readAttempt

Every question of an attempt in progress, going through all its pages, each with the page it's on.

```ts
function readAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<Question[]>;
```

Throws `QuizError` when the attempt isn't open: it's finished (read its review instead) or it isn't the person's.

## answerQuizQuestions

Saves answers in an attempt in progress without finishing it, and gives its questions afterwards.

```ts
function answerQuizQuestions(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  answers: { slot: number; responses: Record<string, string> }[],
  options?: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void },
): Promise<{ changed: string; attemptId: number; questions: Question[] }>;
```

- `answers`: per slot, the values by field name (see [Questions and their fields](#questions-and-their-fields)).
- `trail` (default `"realistic"`): with `"realistic"`, on each page the driver first waits the time a person needs to read that page's questions and options (about 240 words a minute, between 3 and 90 seconds a page), then saves; with `"fast"` it saves at once. See [Student pace](../concepts/student-pace.md).
- `onProgress`: called every few seconds while waiting, with the seconds elapsed and the page's total, so a program can tell its caller it's still working.

The answers are grouped by the page their slot is on, and each page is filled and saved in order with its "Next page" button, as a person moves through the attempt; pages without answers aren't visited. Moodle keeps everything saved, so answers can be given in several calls and changed later while the attempt is open.

Errors: `QuizError` when the attempt isn't open, or when a slot isn't in it (checked before anything is saved); `FormError` when a page has no field by a given name, in which case that page and the ones after it aren't saved (the pages before it already are).

## finishQuizAttempt

Submits the attempt for grading, as "Submit all and finish" does (without its confirmation dialog), and gives its review when the quiz shows one.

```ts
function finishQuizAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<{
  changed: string;
  attemptId: number;
  finished: true;
  review?: { summary: Detail[]; questions: Question[] };
}>;
```

`review` is missing when the quiz's review options don't show it right after the attempt. Throws `QuizError` when the attempt can't be finished: it's already finished, or it isn't the person's. Unanswered questions are submitted as they are, as Moodle does.

## readReview

A finished attempt's review, as far as the quiz's review options let the person see it: the summary table (state, dates, marks, grade) and the questions with their state, mark, feedback and right answer.

```ts
function readReview(context: BrowserContext, siteUrl: string, attemptId: number): Promise<{ summary: Detail[]; questions: Question[] }>;
```

A teacher can read a student's attempt this way too. Throws `QuizError` when the review isn't available: the attempt isn't finished, isn't the person's (for a student), or the quiz doesn't show reviews yet.

## A student's attempt from start to finish

```ts
import { QuizError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.
const quizId = 26;

const info = await moodle.quizInfo(quizId);
if (!info.canStart) throw new Error(`Can't attempt: ${info.messages.join(" ")}`);

const { attemptId, questions } = await moodle.startQuizAttempt(quizId);

// Choose an answer for each question: here, the first option of every choice and select field,
// skipping "clear my choice" (-1) and a drop-down's "Choose..." (0); a true/false radio's "0" is "False", a real answer.
const answers = questions.map((question) => {
  const responses: Record<string, string> = {};
  for (const field of question.fields) {
    if ((field.kind === "choice" || field.kind === "select") && field.options) {
      const option = field.options.find((o) => o.value !== "-1" && !(field.kind === "select" && o.value === "0")) ?? field.options[0];
      if (option) responses[field.name] = option.value;
    }
  }
  return { slot: question.slot, responses };
});

try {
  const answered = await moodle.answerQuizQuestions(attemptId, answers, {
    onProgress: (elapsed, total) => console.log(`Reading... ${elapsed}/${total} s`),
  });
  console.log(answered.questions.map((q) => `${q.number}: ${q.state}`).join(", "));

  const done = await moodle.finishQuizAttempt(attemptId);
  for (const row of done.review?.summary ?? []) console.log(`${row.label}: ${row.value}`);
} catch (error) {
  if (error instanceof QuizError) console.error(error.message);
  else throw error;
}
```

## quizResults

A quiz's attempts as its results report (the overview) shows them to a teacher: per attempt the user, state, dates, grade and the mark per question; with `responses`, also the answer per question from the responses report. Every page of the report is read.

```ts
function quizResults(context: BrowserContext, siteUrl: string, activityId: number, options?: { responses?: boolean }): Promise<{
  quiz: { id: number };
  attempts: QuizAttemptResult[];
}>;

interface QuizAttemptResult {
  id: number;
  userId: number;
  fullName: string;
  state?: string;
  started?: string;
  completed?: string;
  duration?: string;
  grade?: string;
  questions: { slot: number; mark?: string; response?: string; result?: string }[];
}
```

- `responses` (default `false`): also read the responses report and add each question's `response`, which costs a second pass over the report.
- `state`, `started`, `completed`, `duration` and `grade` are as the report shows them, in the site's language ("Finished", "9 Oct 1:30 PM", "50 secs", "5.00"); a missing grade ("-") is left out.
- `questions[].mark`: the mark as shown ("-" left out); `result`: how it was marked ("correct", "incorrect", "partiallycorrect", "notanswered", "requiresgrading"...).

People come as user id and full name: hiding who they are is the calling program's job. The report lists the attempts of enrolled users. Throws `QuizError` with Moodle's message when the person can't see the report (a student, or the id isn't a quiz).

## questionsToGrade

The questions of a quiz that wait for grading by hand, as its manual grading report lists them, each with the finished attempts whose answer requires grading.

```ts
function questionsToGrade(context: BrowserContext, siteUrl: string, activityId: number): Promise<{
  quiz: { id: number };
  questions: QuestionToGrade[];
}>;

interface QuestionToGrade {
  slot: number;
  questionId?: number;
  name: string;
  type: string;
  toGrade: number;
  graded: number;
  total: number;
  attempts: { id: number; userId: number; fullName: string }[];
}
```

- `slot`, `questionId`, `name`, `type`: the question, as in the quiz (`type` is "essay" for most).
- `toGrade`, `graded`, `total`: the report's counts: attempts waiting for a grade, already graded by hand, and in all.
- `attempts`: the attempts waiting, with the attempt's id (what `gradeQuizQuestion` and `readReview` take) and its person; they come from the results report (the question's result `requiresgrading` in [`quizResults`](#quizresults)), since the grading report itself names attempts only by person.

Moodle's report lists the questions that need grading by hand, not the ones graded automatically. Throws `QuizError` with Moodle's message when the person can't grade the quiz.

## gradeQuizQuestion

Grades one question of a finished attempt by hand, with a comment, through Moodle's comment form (the review's "Make comment or override mark"): an essay waiting for its grade, or any question whose mark the teacher overrides.

```ts
function gradeQuizQuestion(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  slot: number,
  options: { mark: number; comment?: string },
): Promise<{ changed: string; attemptId: number; slot: number; mark: number; maxMark?: number; grade?: string }>;
```

- `mark`: in the question's points in the quiz, from 0 to its maximum (`maxMark` in the result).
- `comment` (HTML): the teacher's comment the student sees in the review; without it, the comment the question already has stays.
- `grade`: the attempt's grade afterwards, as the results report shows it ("9.17"); Moodle updates the quiz's grade in the gradebook too.

No AJAX service grades a question, so this fills the comment form and posts it as its Save button does. Errors: `FormError` with Moodle's message on the field `mark` when the mark is outside the question's range or isn't a number Moodle reads; `QuizError` when the form can't be opened (the attempt isn't finished, the slot isn't in it, or the person can't grade; Moodle's reason comes in the message), or when the question has no mark (a description).

```ts
// Grade every essay waiting in quiz 47 with half its marks, and a comment.
const { questions } = await moodle.questionsToGrade(47);
for (const question of questions) {
  for (const attempt of question.attempts) {
    const result = await moodle.gradeQuizQuestion(attempt.id, question.slot, { mark: 2.5, comment: "<p>Seen; let's talk in class.</p>" });
    console.log(result.changed);
  }
}
```

## quizStructure

A quiz's questions as its edit page lists them: slots in order, each with its page, question, type, name and mark, and the quiz's sections.

```ts
function quizStructure(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;

interface QuizSlot {
  id: number;
  slot: number;
  number?: number;
  page: number;
  questionId?: number;
  type: string;
  name: string;
  mark?: string;
}

interface QuizSection {
  id: number;
  heading: string;
  firstSlot: number;
  shuffle: boolean;
}
```

- `id`: Moodle's id for the slot; `slot`: its place in the quiz, from 1, which the functions that change a slot take; `number`: the question's number as shown (descriptions have none).
- `page`: the page it's on, as the edit page numbers them (from 1).
- `questionId`: the bank question's id; missing for a random question.
- `type`: the question type, or `"random"` for a random question drawn from a category.
- `mark`: the slot's maximum mark as shown ("1.00").
- `sections`: every quiz has at least one, starting at slot 1; `heading` is empty for an untitled one, `shuffle` says whether its questions come in a random order in each attempt.

Needs the right to edit the quiz; throws `QuizError` with Moodle's reason otherwise.

## addQuestionsToQuiz

Adds questions from a bank by id, and random questions from a bank category, as the edit page's "from question bank" and "a random question" actions post them. Returns the quiz's structure afterwards.

```ts
function addQuestionsToQuiz(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: {
    questionIds?: number[];
    random?: { categoryId: number; count: number; includeSubcategories?: boolean };
    page?: number;
  },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

- `questionIds` (default none): bank questions' ids, from [`questions`](question-banks.md).
- `random`: `count` random questions drawn from the category `categoryId` (from the bank's categories), with its subcategories when `includeSubcategories` is true (default false).
- `page` (default `0`): the page to add them to; `0` adds them at the end, as Moodle does.

Moodle doesn't let a quiz that already has attempts change its questions: the edit page then offers no add menu, and this throws `QuizError` before posting anything (make a new quiz, or delete its attempts in Moodle). It also throws `QuizError` when given neither questions nor a category, when Moodle answers the post with an error, and when no question was added (wrong ids or category).

## Changing a quiz's structure

These change a quiz as its edit page does, and return its structure afterwards: `{ changed, quiz, slots, sections }`. Slots are given by their place (`QuizSlot.slot`, from 1), as `quizStructure` lists them; places change after a slot is removed or moved, so read them again from the result. Moodle doesn't let a quiz with attempts change its questions, their order or its pages: these throw `QuizError` with Moodle's notice before changing anything (make a new quiz, or delete its attempts in Moodle). Moodle's own refusals (removing the only slot of a section, a page out of range for a move) come as `QuizError` with its message.

### editQuizSlot

Changes a slot's maximum mark, and moves it: after another slot and on a page, as dragging it does.

```ts
function editQuizSlot(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  slot: number,
  changes: { maxMark?: number; moveAfter?: number; page?: number },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

- `maxMark`: the points the question is worth in this quiz, through Moodle's `mod_quiz_update_slots` service. Moodle allows it after attempts too, and regrades them (and the gradebook).
- `moveAfter`: the slot to put it after, `0` to make it the first.
- `page`: the page to put it on; by default the page of the slot it goes after (page 1 when first). Moodle accepts a page from that slot's to the next slot's.

### removeQuizSlot

Removes a slot from a quiz, as its delete icon does; the question stays in its bank.

```ts
function removeQuizSlot(context: BrowserContext, siteUrl: string, activityId: number, slot: number): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

### setQuizPages

Repaginates a quiz, or sets its page breaks exactly after the slots given.

```ts
function setQuizPages(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  pages: { perPage: number } | { breaksAfter: number[] },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }>;
```

- `perPage`: questions a page, `0` for all on one page, as the edit page's "Repaginate" does. Each section starts a page of its own all the same.
- `breaksAfter`: the slots after which a page ends, and no others; each break added or removed is one of the edit page's page break requests.

### addQuizSection

Adds a section starting at a slot, with its heading, and whether its questions are shuffled.

```ts
function addQuizSection(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  section: { firstSlot: number; heading: string; shuffle?: boolean },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[]; sectionId: number }>;
```

A section starts at a page, as in Moodle: `firstSlot` must be the first slot of its page (add a page break before it with `setQuizPages` first), and the quiz can't already have a section there. `shuffle` defaults to false.

```ts
// Quiz 49, not attempted yet: drop slot 4, put slot 3 first worth 2 points, two pages, and a second part.
await moodle.removeQuizSlot(49, 4);
await moodle.editQuizSlot(49, 3, { moveAfter: 0, maxMark: 2 });
await moodle.setQuizPages(49, { breaksAfter: [2] });
const { slots, sections } = await moodle.addQuizSection(49, { firstSlot: 3, heading: "Part B", shuffle: true });
console.log(slots.map((s) => `${s.slot}. ${s.name} (page ${s.page}, ${s.mark})`), sections);
```

## setQuizOverride

Sets a user override on a quiz through its override form: other opening and closing dates, a time limit, or a number of attempts for one student. What isn't given stays the quiz's.

```ts
function setQuizOverride(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  options: { open?: Date; close?: Date; timeLimitMinutes?: number; attempts?: number },
): Promise<{ changed: string }>;
```

- `open`, `close`: dates, filled in the person's time zone in Moodle, as Moodle reads its date selectors.
- `timeLimitMinutes`: the time limit in minutes.
- `attempts`: the attempts allowed, `0` for unlimited.

The form only offers users who can get an override: a user who isn't a participant, or who already has an override in this quiz, gets a `QuizError` (change an existing override in Moodle). `QuizError` also comes when the form can't be opened (not a quiz, or not allowed). `FormError` comes when Moodle refuses the values (a close date before the open date) or when the person's time zone isn't one the driver knows.

```ts

// Who did what, with their answers.
const { attempts } = await moodle.quizResults(27, { responses: true });
for (const attempt of attempts) {
  console.log(`${attempt.fullName}: ${attempt.grade ?? "not graded"}`);
  for (const q of attempt.questions) console.log(`  Q${q.slot} ${q.result ?? ""} ${q.response ?? ""}`);
}

// One more week and an extra attempt for user 7.
await moodle.setQuizOverride(27, 7, { close: new Date("2026-11-30T18:00:00Z"), attempts: 3 });

// Two questions from the bank and three random ones, in a quiz nobody has attempted yet.
const { changed, slots } = await moodle.addQuestionsToQuiz(41, { questionIds: [22, 23], random: { categoryId: 14, count: 3 } });
console.log(changed, slots.length);
```

## Lower-level pieces

The single steps these are built on (starting an attempt, saving a page, finishing) and the page readers aren't exported: they change with Moodle's pages. A program that needs something else goes through `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## Data categories

- `quizInfo`: `course-content` and `own` (the quiz and the person's attempts).
- `startQuizAttempt`, `readAttempt`, `answerQuizQuestions`, `finishQuizAttempt`: `own`.
- `readReview`: `own` and `others-personal`, since a teacher may review someone else's attempt.
- `quizResults`, `questionsToGrade`: `others-personal`.
- `gradeQuizQuestion`: `others-personal` and `others-write`.
- `quizStructure`, `addQuestionsToQuiz`, `removeQuizSlot`, `setQuizPages`, `addQuizSection`: `course-content`.
- `editQuizSlot`: `course-content` and `others-write` (a new maximum mark regrades the attempts already made).
- `setQuizOverride`: `others-write`.

See [Data categories](../concepts/data-categories.md).
