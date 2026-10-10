# Quizzes

Quizzes from both sides. A student reads a quiz's page, starts or continues an attempt, answers its questions page by page (at a person's pace by default) and finishes it, then reads the review. A teacher reads every attempt with its grade and marks per question (and the answers given), reads which questions a quiz holds, adds questions from a bank (chosen or random), and gives a student other dates, a time limit or more attempts with a user override. Quizzes are identified by their course module id (the `id` in `mod/quiz/view.php?id=`), attempts by Moodle's attempt id.

The signatures below are the functions'; each is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Everything is read from Moodle's own pages by their structure (body ids, form names, classes, links), so it works in any interface language; texts such as dates, states and grades come as the site shows them, in its language. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)); the others are `QuizError`, and `FormError` where a form is involved.

## quizInfo

What the quiz's page says: its description, its information lines, its dates, the person's attempts and whether they can start one.

```ts
function quizInfo(context: BrowserContext, siteUrl: string, quizId: number): Promise<QuizInfo>;

interface QuizInfo {
  intro: string;
  info: string[];
  dates: Detail[];
  feedback?: string;
  attempts: { attemptId: number; inProgress: boolean; details: Detail[] }[];
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
function startQuizAttempt(context: BrowserContext, siteUrl: string, quizId: number): Promise<{ attemptId: number; questions: Question[] }>;
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
): Promise<{ attemptId: number; questions: Question[] }>;
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
// skipping "clear my choice" (-1) and a drop-down's "Choose..." (0).
const answers = questions.map((question) => {
  const responses: Record<string, string> = {};
  for (const field of question.fields) {
    if ((field.kind === "choice" || field.kind === "select") && field.options) {
      const option = field.options.find((o) => o.value !== "-1" && o.value !== "0") ?? field.options[0];
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
function quizResults(context: BrowserContext, siteUrl: string, quizId: number, options?: { responses?: boolean }): Promise<{
  quiz: { id: number };
  attempts: QuizAttemptResult[];
}>;

interface QuizAttemptResult {
  attemptId: number;
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

## quizStructure

A quiz's questions as its edit page lists them: slots in order, each with its page, question, type, name and mark.

```ts
function quizStructure(context: BrowserContext, siteUrl: string, quizId: number): Promise<{ quiz: { id: number }; slots: QuizSlot[] }>;

interface QuizSlot {
  slotId: number;
  number?: number;
  page: number;
  questionId?: number;
  type: string;
  name: string;
  mark?: string;
}
```

- `slotId`: Moodle's id for the slot; `number`: the question's number in the quiz.
- `page`: the page it's on, as the edit page numbers them (from 1).
- `questionId`: the bank question's id; missing for a random question.
- `type`: the question type, or `"random"` for a random question drawn from a category.
- `mark`: the slot's maximum mark as shown ("1.00").

Needs the right to edit the quiz; throws `QuizError` with Moodle's reason otherwise.

## addQuestionsToQuiz

Adds questions from a bank by id, and random questions from a bank category, as the edit page's "from question bank" and "a random question" actions post them. Returns the quiz's structure afterwards.

```ts
function addQuestionsToQuiz(
  context: BrowserContext,
  siteUrl: string,
  quizId: number,
  options: {
    questionIds?: number[];
    random?: { categoryId: number; count: number; includeSubcategories?: boolean };
    page?: number;
  },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[] }>;
```

- `questionIds` (default none): bank questions' ids, from [`questions`](question-banks.md).
- `random`: `count` random questions drawn from the category `categoryId` (from the bank's categories), with its subcategories when `includeSubcategories` is true (default false).
- `page` (default `0`): the page to add them to; `0` adds them at the end, as Moodle does.

Moodle doesn't let a quiz that already has attempts change its questions: the edit page then offers no add menu, and this throws `QuizError` before posting anything (make a new quiz, or delete its attempts in Moodle). It also throws `QuizError` when given neither questions nor a category, when Moodle answers the post with an error, and when no question was added (wrong ids or category).

## setQuizOverride

Sets a user override on a quiz through its override form: other opening and closing dates, a time limit, or a number of attempts for one student. What isn't given stays the quiz's.

```ts
function setQuizOverride(
  context: BrowserContext,
  siteUrl: string,
  quizId: number,
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

`quizInfo`, `startQuizAttempt`, `answerQuizQuestions` and `finishQuizAttempt` are built on `startAttempt` (returns only the attempt id), `saveAnswers` (takes a `beforeSave` callback with each page's questions), `finishAttempt` (returns nothing) and page readers (`readQuizView`, `readQuestions`, `readNavigation`, `readQuizReport`, `readQuizSlots`) that take a Playwright page a program opened itself. See the API reference and [Low-level access](../concepts/low-level.md).

## Data categories

- `quizInfo`: `course-content` and `own` (the quiz and the person's attempts).
- `startQuizAttempt`, `readAttempt`, `answerQuizQuestions`, `finishQuizAttempt`: `own`.
- `readReview`: `own` and `others-personal`, since a teacher may review someone else's attempt.
- `quizResults`: `others-personal`.
- `quizStructure`, `addQuestionsToQuiz`: `course-content`.
- `setQuizOverride`: `others-write`.

See [Data categories](../concepts/data-categories.md).
