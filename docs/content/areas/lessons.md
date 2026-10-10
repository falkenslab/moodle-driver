# Lessons

Going through a lesson activity page by page, as a student does: reading the page the person is on (content with its buttons, or a question with its form), answering it, and getting Moodle's feedback and the page that follows, until the end of the lesson. Moodle keeps where the person is, so a program reads and answers one page at a time with the lesson's course module id alone, across calls and runs. Teachers' editing of lessons and their reports aren't covered.

The signatures below are the functions'; each is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Pages are read from the lesson's forms and blocks (form actions, input names, classes), so it works in any interface language; texts come in the site's language. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)), and `LessonError` when the id isn't a lesson the person can open.

## The lesson page

Both functions give pages as `LessonPage` objects:

```ts
interface LessonPage {
  kind: "content" | "question" | "feedback" | "end";
  pageId?: number;
  title?: string;
  text: string;
  buttons?: { label: string; jumpTo: number }[];
  fields?: LessonField[];
  feedback?: { correct?: boolean; response?: string };
}

interface LessonField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
}
```

- `kind`: a `content` page (text and buttons), a `question` page (a form to answer), the `feedback` Moodle shows after an answer, or the lesson's `end`.
- `pageId`: the page's id; for feedback, the page its "Continue" goes to.
- `title`: the page's heading, when it has one.
- `text`: the page as shown: its content, the question, Moodle's messages, or at the end the score ("Your score is 1 (out of 1)").
- `buttons`: a content page's buttons, each with its label and the page it jumps to, as Moodle's jump codes: a page id, or `-1` for the next page, `-9` for the end of the lesson, and other negative codes for Moodle's other jumps.
- `fields`: a question page's inputs by form name: `choice` (radio buttons, give one of `options[].value`), `checkbox` (give `"1"` to tick), `select` (give an option's value), `text` (typed answer). Matching questions are drop-downs; essay and short answers are text.
- `feedback`: on a feedback page, whether Moodle took the answer as right (`correct`, missing when the page doesn't say) and the teacher's response to that answer.

## lessonPage

The page the person is on, without answering anything.

```ts
function lessonPage(context: BrowserContext, siteUrl: string, cmid: number): Promise<LessonPage>;
```

The first time, this opens the lesson's first page, which starts the person's attempt as opening it in Moodle does. When the person has been through the lesson before, Moodle asks whether to go on from the last page they saw: the driver accepts, so it reads where the person was. A lesson that has ended for the person shows its end page (`kind: "end"`). A page that is none of content, question or feedback comes as `end` with Moodle's text (a lesson not open yet, for instance): check `text` before taking `end` as the lesson's real end.

## answerLessonPage

Answers the page the person is on, and returns Moodle's feedback when it gives one and the page that follows.

```ts
function answerLessonPage(
  context: BrowserContext,
  siteUrl: string,
  cmid: number,
  answer: { button?: string | number; responses?: Record<string, string> },
  options?: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void },
): Promise<{ feedback?: LessonPage; page: LessonPage }>;
```

- `answer.button`: on a content page, the button to press, by its label (exactly as in `buttons[].label`) or its position (from 0).
- `answer.responses`: on a question page, the values by field name.
- `trail` (default `"realistic"`): with `"realistic"` the driver first waits the time a person needs to read the page (its text, labels and options, about 240 words a minute, between 3 and 90 seconds); `"fast"` answers at once. See [Student pace](../concepts/student-pace.md).
- `onProgress`: called every few seconds while waiting, with the seconds elapsed and the total.

What comes back:

- `feedback`: when Moodle shows a feedback page after the answer (a question's right or wrong response, its "Continue"), that page; its `pageId` says where it goes on to (the same question to try again, the next page, `-9` for the end). The driver then presses "Continue" as the person would.
- `page`: the page the person is on afterwards, which the next call answers. Reaching the end (`kind: "end"`) ends the attempt.

`LessonError` comes when the button isn't one of the content page's (the error lists them with their positions), when a question page gets no responses, and when the page can't be answered: the lesson has ended, or the page only goes on. `FormError` comes when a question's form has no field by a given name. The page is read and the reading pause is taken before these checks.

Moodle decides what follows each answer from the lesson's settings: a wrong answer may lead back to the same question, to another page, or on; a lesson may allow retakes or not. The driver follows what Moodle does and reports it.

## Example

```ts
import { LessonError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.
const lessonId = 39;

let page = await moodle.lessonPage(lessonId);
try {
  // Through the lesson: the first button on content pages, the first option on questions.
  for (let step = 0; step < 50 && page.kind !== "end"; step++) {
    console.log(`[${page.kind}] ${page.title ?? ""} ${page.text}`);
    let answer: { button?: number; responses?: Record<string, string> };
    if (page.kind === "content") {
      answer = { button: 0 };
    } else {
      const responses: Record<string, string> = {};
      for (const field of page.fields ?? []) responses[field.name] = field.options?.[0]?.value ?? "loop";
      answer = { responses };
    }
    const result = await moodle.answerLessonPage(lessonId, answer, {
      onProgress: (elapsed, total) => console.log(`  reading ${elapsed}/${total} s`),
    });
    if (result.feedback) console.log(`  ${result.feedback.feedback?.correct ? "right" : "not right"}: ${result.feedback.feedback?.response ?? ""}`);
    page = result.page;
  }
  console.log(page.text);
} catch (error) {
  if (error instanceof LessonError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `lessonPage`: `course-content` and `own` (the lesson and where the person is in it).
- `answerLessonPage`: `own`.
- The page reader `readLessonPage`: `none`.

See [Data categories](../concepts/data-categories.md).
