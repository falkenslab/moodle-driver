# Lessons

Going through a lesson activity page by page, as a student does: reading the page the person is on (content with its buttons, or a question with its form), answering it, and getting Moodle's feedback and the page that follows, until the end of the lesson. Moodle keeps where the person is, so a program reads and answers one page at a time with the lesson's course module id alone, across calls and runs. As the lesson's teacher, a program also builds its pages as Moodle's lesson editor does: content pages with buttons, question pages with answers, scores and jumps, and the structural pages, read back, moved and deleted. Lesson reports aren't covered.

**Terms:** [lesson page](../reference/glossary.md#lesson-page), [trail](../reference/glossary.md#trail).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

Pages are read from the lesson's forms and blocks (form actions, input names, classes), so it works in any interface language; texts come in the site's language. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)), and `LessonError` when the id isn't a lesson the person can open (or edit, for the teacher's functions).

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
function lessonPage(context: BrowserContext, siteUrl: string, activityId: number): Promise<LessonPage>;
```

The first time, this opens the lesson's first page, which starts the person's attempt as opening it in Moodle does. When the person has been through the lesson before, Moodle asks whether to go on from the last page they saw: the driver accepts, so it reads where the person was. A lesson that has ended for the person shows its end page (`kind: "end"`). A page that is none of content, question or feedback comes as `end` with Moodle's text (a lesson not open yet, for instance): check `text` before taking `end` as the lesson's real end.

## answerLessonPage

Answers the page the person is on, and returns what it did (`changed`), Moodle's feedback when it gives one and the page that follows.

```ts
function answerLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  answer: { button?: string | number; responses?: Record<string, string> },
  options?: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void },
): Promise<{ changed: string; feedback?: LessonPage; page: LessonPage }>;
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

## Building a lesson's pages

A lesson is created like any activity (`createActivity` with `type: "lesson"`, see [Activities and sections](activities.md)); its pages are added here, as its teacher adds them in Moodle's lesson editor ("Edit" in the lesson). These functions take a teacher's role in the course (Moodle's `mod/lesson:edit`). Moodle's lesson services aren't open to the AJAX calls the driver makes, so it works the editor's pages: the editor's view for the pages' order, titles and contents, each page's form for its type, answers, scores and jumps, and the editor's move and delete links.

```ts
type LessonPageType = "content" | "multichoice" | "truefalse" | "shortanswer" | "numerical" | "matching" | "essay" | "cluster" | "end-of-cluster" | "end-of-branch";
type LessonJump = number | "this-page" | "next-page" | "previous-page" | "end-of-lesson" | "unseen-in-branch" | "random-in-branch" | "random-branch" | "unseen-in-cluster";

interface LessonPageDefinition {
  id: number;
  type: LessonPageType;
  title: string;
  contents: string;
  buttons?: { label: string; jumpTo: LessonJump }[];
  answers?: LessonAnswer[];
  multipleAnswers?: boolean;
  caseSensitive?: boolean;
}

interface LessonAnswer {
  text?: string;
  response?: string;
  score?: number;
  jumpTo?: LessonJump;
  others?: boolean;
}
```

- `type`: a `content` page (Moodle's content page, once called a branch table: text and buttons), a page of one of Moodle's lesson question types, or a structural page: a `cluster` and its `end-of-cluster` (Moodle picks questions at random between them), or an `end-of-branch` (where a content page's branch goes back to it). `LESSON_PAGE_TYPES` lists them.
- `contents`: the page's HTML, as the editor's expanded view shows it.
- `buttons`: a content page's buttons, in order, each with its label and where it leads.
- `answers`: a question page's answers, in order. Multichoice, true/false and matching answers are HTML (Moodle's editor wraps a plain text in `<p>`); short answer and numerical ones are plain text (a numerical answer may be a range, `"1:5"`). Each has the `response` shown after it, its `score` (with the lesson's custom scoring) and its `jumpTo`. A true/false page has two, the true one first. A matching page's first two rows are the responses to a right and a wrong match (their `text`, with their jump and score); its pairs follow, each `text` the item and `response` the answer that matches it. A short answer or numerical page's row for any other answer comes last with `others: true` and no `text`, when Moodle's "All other answers" is on. An essay, cluster, end of cluster or end of branch has a single row: its jump (and an essay's score).
- `jumpTo`: a page of the lesson by its id, or one of Moodle's jumps by name. `LESSON_JUMPS` gives their codes: `"this-page"` 0, `"next-page"` -1, `"previous-page"` -40, `"end-of-lesson"` -9, `"unseen-in-branch"` -50, `"random-in-branch"` -60, `"random-branch"` -70, `"unseen-in-cluster"` -80. Moodle offers the branch jumps on content pages and the pages of their branches, and the cluster jump inside a cluster.
- `multipleAnswers`: a multichoice page whose question has more than one right answer. `caseSensitive`: a short answer page's "Case sensitive".

## lessonPages

The lesson's pages, in order, as its teacher defines them.

```ts
function lessonPages(context: BrowserContext, siteUrl: string, activityId: number): Promise<LessonPageDefinition[]>;
```

It reads the editor's expanded view and each page's form, one page load per page. Moodle remembers whether the person last looked at the editor collapsed or expanded: when it was collapsed, the driver opens the expanded view to read it and then asks for the collapsed one again, so the person finds the editor as they left it. A lesson without pages is `[]`. A student, or anyone who can't edit the lesson, gets `LessonError`.

## addLessonPage

Adds a page to the lesson and returns what it did (`changed`), the new page's id (`pageId`) and the lesson's page ids in order afterwards (`pageIds`).

```ts
function addLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: LessonPageInput,
  options?: { after?: number },
): Promise<{ changed: string; pageId: number; pageIds: number[] }>;

interface LessonPageInput {
  type: LessonPageType;
  title?: string;
  contents?: string;
  embed?: string[];
  buttons?: { label: string; jumpTo?: LessonJump }[];
  answers?: LessonAnswer[];
  multipleAnswers?: boolean;
  caseSensitive?: boolean;
  fields?: Record<string, FieldValue>;
}
```

- `after`: the page it goes after; `0` puts it first. By default it goes last.
- `title`: required, but for the structural pages, which Moodle names itself ("Cluster", "End of branch"…).
- `contents`: the page's HTML. Local files it names (`<img src="diagram.png">`) are given in `embed` (absolute paths) and uploaded with the page, as the editor's image button does; the same goes for the HTML of answers and responses.
- `buttons` (content pages) and `answers` (every other type), as `lessonPages` gives them. A jump left out is the form's own: the next page for a question's first answer, this page for its other answers and for a content page's first button.
- `fields`: any other field of the page's form, by name (a content page's `layout` and `display`, for instance).

Moodle makes a cluster, an end of cluster or an end of branch at once, without a form (an end of branch goes after the pages of a content page's branch, and its jump is that content page); when a title, contents or a jump is given, the driver then saves them on the new page. A page put first offers no other pages to jump to in Moodle's form: the driver saves it, then sets those jumps on the saved page.

Checked before anything is saved, as `LessonError`: the type; a title; a jump to a page the lesson doesn't have, or a jump name that isn't one; `after` a page of the lesson; more answers or buttons than the lesson takes a page (its "Maximum number of answers/branches" setting); answers on a content page or buttons on a question; a true/false page with other than two answers; a score when the lesson doesn't use custom scoring (Moodle sets the scores itself then: turn on "Custom scoring" in the lesson's settings); a jump Moodle doesn't offer on that page (the branch jumps outside a branch, for instance). Moodle's own checks come as `FormError` with its messages by field (a question page without contents, a multichoice page with fewer than two answers).

## editLessonPage

Changes a page through its form with what's given, and returns `changed` and the page's id. A page keeps its type.

```ts
function editLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  pageId: number,
  changes: Partial<Omit<LessonPageInput, "type">>,
): Promise<{ changed: string; pageId: number }>;
```

Given `buttons` or `answers` replace them all: the form's other rows are blanked, and Moodle drops blank ones (a short answer or numerical page's row for other answers is turned off unless given again). The checks are `addLessonPage`'s.

## moveLessonPage

Moves a page after another (`after`, `0` for first), as the editor's move link does, and returns `changed` and the page ids in order.

```ts
function moveLessonPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, after: number): Promise<{ changed: string; pageIds: number[] }>;
```

Jumps to pages by id keep pointing at the same pages; "next page" and "previous page" follow the page to its new neighbours.

## deleteLessonPage

Deletes a page, as the editor's delete link does once confirmed, and returns `changed` and the page ids left.

```ts
function deleteLessonPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number): Promise<{ changed: string; pageIds: number[] }>;
```

Other pages' answers that jumped to it are left as Moodle leaves them: check them with `lessonPages`.

## Example: a branching lesson

```ts
// `moodle` is the object from createMoodle(), logged in as the course's teacher.
const courseId = 12;
const [section] = await moodle.courseStructure(courseId);
const { activityId } = await moodle.createActivity({ courseId, sectionId: section!.id, type: "lesson", name: "Loops", visibility: "shown" });
const lessonId = activityId!;

const start = await moodle.addLessonPage(lessonId, {
  type: "content",
  title: "Loops",
  contents: "<p>A loop repeats a block of code.</p>",
  buttons: [
    { label: "Take the question", jumpTo: "next-page" },
    { label: "Leave", jumpTo: "end-of-lesson" },
  ],
});
const right = await moodle.addLessonPage(lessonId, { type: "content", title: "Well done", contents: "<p>That's it.</p>", buttons: [{ label: "Finish", jumpTo: "end-of-lesson" }] });
const wrong = await moodle.addLessonPage(lessonId, { type: "content", title: "Not quite", contents: "<p>Read it again.</p>", buttons: [{ label: "Back", jumpTo: start.pageId }] });
await moodle.addLessonPage(lessonId, { type: "end-of-branch", answers: [{ jumpTo: start.pageId }] });

// The question goes right after the first page; each answer leads elsewhere.
await moodle.addLessonPage(
  lessonId,
  {
    type: "multichoice",
    title: "Which loop walks a list?",
    contents: "<p>Which loop walks a list?</p>",
    answers: [
      { text: "for", response: "<p>Right.</p>", score: 1, jumpTo: right.pageId },
      { text: "while", response: "<p>It can, but not by itself.</p>", score: 0, jumpTo: wrong.pageId },
    ],
  },
  { after: start.pageId },
);

for (const page of await moodle.lessonPages(lessonId)) {
  const leads = (page.buttons ?? page.answers ?? []).map((row) => String(row.jumpTo)).join(", ");
  console.log(`${page.id} ${page.type} "${page.title}" -> ${leads}`);
}
```

## Data categories

- `lessonPage`: `course-content` and `own` (the lesson and where the person is in it).
- `answerLessonPage`: `own`.
- `lessonPages`, `addLessonPage`, `editLessonPage`, `moveLessonPage`, `deleteLessonPage`: `course-content`.

See [Data categories](../concepts/data-categories.md).
