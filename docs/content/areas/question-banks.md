# Question banks

A course's question banks as Moodle 5 organizes them: shared banks are activities of their own (module `qbank`), and every quiz keeps a private bank. A teacher (anyone who can manage the course's questions) lists the banks, reads a bank's categories and questions, imports questions from GIFT or Moodle XML (a file or text), creates single questions through their type's form, edits them, sets them ready or draft, and deletes them. Students have no access to banks. Questions in a bank are what [`addQuestionsToQuiz`](quizzes.md#addquestionstoquiz) puts in a quiz.

**Terms:** [question bank](../reference/glossary.md#question-bank), [question category](../reference/glossary.md#question-category), [slot](../reference/glossary.md#slot).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

A bank is identified by its activity id (`activityId`, a course module id): a qbank activity's, or the quiz's whose bank it is. Everything is read from Moodle's bank pages by field names, data attributes and icons, so it works in any interface language. Every function throws `NotLoggedInError` when there's no session; the others are `QuestionBankError` and, for forms, `FormError` (see [Errors](../concepts/errors.md)).

## The bank's module is checked first

Before opening a bank page, `questions`, `importQuestions`, `createQuestion`, `updateQuestion` and `deleteQuestions` check that the course module keeps questions (a `qbank` or a `quiz`), reading its module from its settings form, which changes nothing. This matters: Moodle creates a bank's default categories for any activity whose bank page is opened, so opening the bank of a page or a forum by mistake would leave categories behind. A module that keeps no questions throws `QuestionBankError` ("Activity 5 is a page, which has no question bank") without touching it; a module the person can't edit, or that doesn't exist, throws too. The module found is remembered per site and id for the rest of the program.

## questionBanks

A course's question banks, as its question banks page lists them: the shared ones and the activities' own.

```ts
function questionBanks(context: BrowserContext, siteUrl: string, courseId: number): Promise<QuestionBank[]>;

interface QuestionBank {
  id: number;
  name: string;
  type: string;
  shared: boolean;
}
```

- `id`: the bank's activity id (course module id), which the other functions take as `activityId`.
- `name`: the activity's name.
- `type`: the module, `"qbank"` for a shared bank, `"quiz"` for a quiz's own.
- `shared`: a shared bank's questions can be used anywhere in the course; an activity's only in that activity.

Throws `QuestionBankError` when the course doesn't exist or the person can't see its banks.

## questions

A bank's categories and every question in them, category by category.

```ts
function questions(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ categories: BankCategory[]; questions: BankQuestion[] }>;

interface BankCategory {
  id: number;
  name: string;
}

interface BankQuestion {
  id: number;
  name: string;
  type: string;
  status?: string;
  version?: string;
  categoryId: number;
}
```

- `categories`: from the bank page's category filter, in its order, names without their question count. Each bank lists its "Top" category first, which holds no questions, then its default one ("Default for ..." in English) and any others.
- `id`: the question's id, which `addQuestionsToQuiz` takes.
- `type`: the question type, from its icon ("multichoice", "truefalse", "shortanswer", "essay"...).
- `status`: `"ready"` or `"draft"`; `version`: as shown ("v1").
- `categoryId`: the category it's in.

Up to 1000 questions are read per category. Throws `QuestionBankError` when the module keeps no questions (see above) or the person can't see its bank.

## importQuestions

Imports questions into a bank from a GIFT or Moodle XML file, or from text, through the bank's import form, and returns the questions created.

```ts
function importQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { format: "gift" | "xml"; file?: string; text?: string; categoryId?: number },
): Promise<{ changed: string; questions: BankQuestion[] }>;
```

- `format`: `"gift"` or `"xml"` (Moodle XML).
- `file` or `text`, exactly one: an absolute path to a local file, or the questions as text. Text is uploaded as a file (`questions.txt` or `questions.xml`), as a person would upload one, from a temporary folder removed afterwards.
- `categoryId`: the bank category to import into; without it, Moodle's default for the form. When given, the file's own categories and contexts are ignored, so everything lands in that category.

The questions created are found by comparing the bank's questions before and after the import. When Moodle can't parse the file it imports nothing and shows its messages: they come back as a `QuestionBankError` ("Moodle didn't import the questions: There are no questions in the import file"). Other errors: `QuestionBankError` when both or neither of `file` and `text` are given, when the bank can't be imported into, or when the category isn't in the bank; a `MoodleError` when the file path isn't absolute or there's no file there; `FormError` when Moodle refuses the form.

## createQuestion

Creates one question in a bank through its type's edit form and returns its id. Imports are the way for several questions; this is for one-offs.

```ts
function createQuestion(context: BrowserContext, siteUrl: string, activityId: number, input: QuestionInput): Promise<{ changed: string; questionId?: number }>;

interface QuestionInput {
  type: QuestionType; // "multichoice" | "truefalse" | "shortanswer" | "numerical" | "essay"
  name: string;
  text: string;
  answers?: { text: string; fraction: number; feedback?: string; tolerance?: number }[];
  correct?: boolean;
  categoryId?: number;
  defaultMark?: number;
  fields?: Record<string, FieldValue>;
}
```

- `type`: one of `QUESTION_TYPES`; other types are imported as GIFT or Moodle XML instead.
- `name`: the question's name in the bank; `text`: the question's text, as HTML.
- `answers`: required for `multichoice`, `shortanswer` and `numerical`. `fraction` is the share of the mark (1 right, 0 wrong, negatives for penalties); Moodle only offers fixed grades (100%, 90%, 83.33%, 80%...), so each fraction is rounded to the nearest one the form offers (0.82 becomes 83.33%). `feedback` is the answer's feedback (HTML); `tolerance` is a numerical answer's accepted error. The form's blank answers are extended with "Blanks for more choices" when more are needed.
- `correct`: required for `truefalse`: the right answer.
- `categoryId`: the category; without it, the one after the bank's "Top" (its default category).
- `defaultMark`: the question's default mark; Moodle's default otherwise.
- `fields`: any other field of the type's form by its name (`{ shuffleanswers: false }`, `{ answernumbering: "none" }`), set after the others.

A multichoice question with more than one answer whose fraction is above 0 is created as multiple-answer (checkboxes), otherwise as single-answer. `questionId` is the id Moodle names after saving; it can be missing if Moodle lands elsewhere. Errors: `QuestionBankError` for a type it doesn't create, missing answers or right answer, a bank that keeps no questions or can't be added to, or a category not in the bank; `FormError` when the form has no field by a name in `fields` or Moodle refuses the values.

## updateQuestion

Changes a question of a bank through its type's edit form, with the inputs of `createQuestion`, only what's given.

```ts
function updateQuestion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questionId: number,
  input: Partial<Omit<QuestionInput, "type">>,
): Promise<{ changed: string; questionId?: number }>;
```

- `activityId`: the bank the question is in: Moodle's edit page works within a bank (its course module id).
- `input`: as in `createQuestion`, without `type` (a question keeps its type); what isn't given stays as it is.
- `answers`: for `multichoice`, `shortanswer` and `numerical`, the question's answers from now on: the form's other answers are blanked, and Moodle drops blank ones. A multichoice question becomes multiple-answer or single-answer as in `createQuestion`. Other types change their answers through `fields`.

Saving makes a new version of the question, with an id of its own: `questionId` is that new id, the one `questions` lists from then on (with its `version` one higher). Quizzes using the question's latest version get the new one; a quiz pinned to a version keeps it. Errors: `QuestionBankError` when nothing is given, the bank keeps no questions, or the question isn't one the person can edit there; `FormError` as in `createQuestion`.

## deleteQuestions

Deletes questions from a bank, every version of each, as the bank's delete action does (asking, then confirming).

```ts
function deleteQuestions(context: BrowserContext, siteUrl: string, activityId: number, questionIds: number[]): Promise<{ changed: string; deleted: number[]; hidden: number[] }>;
```

Moodle doesn't delete a question a quiz uses: it hides it instead (it disappears from the bank's list, and the quizzes keep it). `deleted` and `hidden` say what became of each id, checked afterwards by whether the question can still be opened. Throws `QuestionBankError` with Moodle's message when it refuses (a question that doesn't exist, or the person can't edit it), and when no ids are given.

## setQuestionStatus

Sets a question ready (quizzes can use it) or draft, as the bank's status menu does, through Moodle's `qbank_editquestion_set_status` service.

```ts
function setQuestionStatus(context: BrowserContext, siteUrl: string, questionId: number, status: "ready" | "draft"): Promise<{ changed: string; questionId: number; status: "ready" | "draft" }>;
```

Throws `QuestionBankError` for another status, or with Moodle's reason when it refuses; `MoodleServiceError` when the service fails (the question doesn't exist, or the person can't edit it).

## Example

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const banks = await moodle.questionBanks(3);
const bank = banks.find((b) => b.shared);
if (!bank) throw new Error("Course 3 has no shared question bank.");

const { categories } = await moodle.questions(bank.id);
// The first category is the bank's "Top", which holds no questions: its default one comes next.
const target = categories[1];

const imported = await moodle.importQuestions(bank.id, {
  format: "gift",
  text: "::Range:: range(3) ends at 2. {T}\n\n::Indent:: Python uses indentation for blocks. {T}",
  categoryId: target?.id,
});
console.log(imported.changed, imported.questions.map((q) => q.id));

const created = await moodle.createQuestion(bank.id, {
  type: "multichoice",
  name: "Infinite loop",
  text: "<p>Which loop never ends?</p>",
  answers: [
    { text: "while True: pass", fraction: 1, feedback: "Right." },
    { text: "for i in range(3): pass", fraction: -0.5 },
  ],
  defaultMark: 2,
});
console.log(created.changed);

// A new version with a clearer text, kept as a draft until checked; and two old questions gone.
if (created.questionId) {
  const updated = await moodle.updateQuestion(bank.id, created.questionId, { text: "<p>Which of these loops never ends?</p>" });
  if (updated.questionId) await moodle.setQuestionStatus(updated.questionId, "draft");
}
const removed = await moodle.deleteQuestions(bank.id, imported.questions.map((q) => q.id));
console.log(removed.deleted, removed.hidden);
```

## Data categories

- `questionBanks`, `questions`, `importQuestions`, `createQuestion`, `updateQuestion`, `deleteQuestions`, `setQuestionStatus`: `course-content` (what teachers write).

See [Data categories](../concepts/data-categories.md).
