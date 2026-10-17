# Question banks

A course's question banks as Moodle 5 organizes them: shared banks are activities of their own (module `qbank`), and every quiz keeps a private bank. A teacher (anyone who can manage the course's questions) lists the banks, reads a bank's categories and questions, imports questions from GIFT or Moodle XML (a file or text) and exports them to a file, creates single questions through their type's form, edits them, sets them ready or draft, and deletes them; organizes the bank's categories (adding, renaming, moving and deleting them) and moves questions between them. Students have no access to banks. Questions in a bank are what [`addQuestionsToQuiz`](quizzes.md#addquestionstoquiz) puts in a quiz.

**Terms:** [question bank](../reference/glossary.md#question-bank), [question category](../reference/glossary.md#question-category), [slot](../reference/glossary.md#slot).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

A bank is identified by its activity id (`activityId`, a course module id): a qbank activity's, or the quiz's whose bank it is. Everything is read from Moodle's bank pages by field names, data attributes and icons, so it works in any interface language. Every function throws `NotLoggedInError` when there's no session; the others are `QuestionBankError` and, for forms, `FormError` (see [Errors](../concepts/errors.md)).

## The bank's module is checked first

Before opening a bank page, `questions`, `importQuestions`, `exportQuestions`, `createQuestion`, `updateQuestion`, `deleteQuestions` and the category functions check that the course module keeps questions (a `qbank` or a `quiz`), reading its module from its settings form, which changes nothing. This matters: Moodle creates a bank's default categories for any activity whose bank page is opened, so opening the bank of a page or a forum by mistake would leave categories behind. A module that keeps no questions throws `QuestionBankError` ("Activity 5 is a page, which has no question bank") without touching it; a module the person can't edit, or that doesn't exist, throws too. The module found is remembered per site and id for the rest of the program.

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
function questions(context: BrowserContext, siteUrl: string, activityId: number, options?: { limit?: number; offset?: number }): Promise<{ categories: BankCategory[]; questions: BankQuestion[] }>; // questions: ListPage<BankQuestion> with limit

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

With `limit` and `offset`, `questions` is a page of them, category by category, and `categories` all of them (see [Long lists](../concepts/calling-functions.md#long-lists)): the categories are read in order until the page is full, each one whole and cut (the counts the category filter shows aren't reliable enough to skip by). Up to 1000 questions are read per category. Throws `QuestionBankError` when the module keeps no questions (see above) or the person can't see its bank. The categories here are a flat list, ids and names only: [`questionCategories`](#questioncategories) gives the tree, with each category's parent, description and question count.

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

## exportQuestions

Exports a bank's questions, or a category's, to a local GIFT or Moodle XML file, through the bank's export form, and returns the file written.

```ts
function exportQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { format: "gift" | "xml"; categoryId?: number; file: string },
): Promise<DownloadedFile>;
```

- `format`: `"gift"` or `"xml"` (Moodle XML).
- `categoryId`: the category to export, its subcategories included; without it, the whole bank (its "Top" category, which holds them all).
- `file`: an absolute path, where the file is written (its folder is made if needed, and a file already there is replaced).

The result is `{ path, name, size, contentType }`, as [`downloadFile`](files.md) gives. The form is sent as Moodle's defaults leave it: the file names each question's category (and the bank, as `$module$`), so importing it without `categoryId` recreates those categories, and importing it with `categoryId` puts every question in that one. Moodle exports each question's latest version and leaves hidden questions out. The form is filled in a tab and sent with the person's session (Moodle's answer page would turn the tab into a download), and the file is fetched from the link in that answer. Errors: `QuestionBankError` for another format, a module that keeps no questions, a person who can't export the bank's questions (`moodle/question:viewall`, or `viewmine` for their own), a category not in the bank, or nothing to export ("Moodle didn't export category 15: No questions were found that could be exported. ..."); a `MoodleError` (`invalid-input`) when `file` isn't absolute.

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

## Categories

A bank's questions are kept in categories, which can hold subcategories. Every bank has a hidden "Top" category, the root of its tree: its top-level categories are inside it, starting with the default one Moodle makes ("Default for ..."). The category functions work through the bank's categories page, so they take Moodle's capability `moodle/question:managecategory` in the bank (editing teachers have it); without it they throw `QuestionBankError` naming it. A category that isn't in the bank throws `QuestionBankError` listing the bank's own.

### questionCategories

The bank's categories as its categories page shows them, parents before their subcategories.

```ts
function questionCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuestionCategory[]>;

interface QuestionCategory {
  id: number;
  name: string;
  parentId: number;
  description: string;
  questionCount: number;
}
```

- `parentId`: the category it's in. A top-level category's is the bank's Top, which isn't in the list (it's the first category `questions` lists).
- `description`: its description as HTML, `""` without one.
- `questionCount`: the questions directly in it, not in its subcategories.

It's a function of its own rather than more fields in `questions`, because the tree comes from another page, which takes the capability to manage categories: `questions` keeps working for anyone who can see the bank, and reads no page more.

### addQuestionCategory

Adds a category, as the categories page's "Add category" does, and returns it.

```ts
function addQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  options: { name: string; parentId?: number; description?: string },
): Promise<{ changed: string; category: QuestionCategory }>;
```

- `parentId`: the category it goes in; without it, the top level.
- `description`: HTML.

The page's own form is filled as its dialog does (Moodle's `core_form_dynamic_form`); Moodle's refusals by field come back as a `QuestionBankError` ("Moodle refused the category: name: ..."). An empty name or a parent not in the bank throws before anything is sent.

### editQuestionCategory

Changes a category as its "Edit settings" does, only what's given, and returns it afterwards.

```ts
function editQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  categoryId: number,
  changes: { name?: string; description?: string; parentId?: number },
): Promise<{ changed: string; category: QuestionCategory }>;
```

- `name`, `description` (HTML): renaming it, describing it.
- `parentId`: moving it, with its subcategories and questions, inside another category; the bank's Top (the top-level categories' `parentId`) moves it to the top level.

Moodle doesn't move a category into itself or one of its subcategories, nor the bank's only top-level category (a bank always keeps one): both throw `QuestionBankError`. So does giving nothing to change.

### deleteQuestionCategory

Deletes a category, as its delete action does.

```ts
function deleteQuestionCategory(context: BrowserContext, siteUrl: string, activityId: number, categoryId: number, options?: { moveTo?: number }): Promise<{ changed: string }>;
```

- `moveTo`: the bank's category its questions go to. Moodle asks for one before deleting a category with questions (hidden ones, and those quizzes use, included); without it the function throws `QuestionBankError` and nothing is deleted. An empty category needs none.

Its subcategories move up to its parent, as Moodle does. Moodle keeps the bank's only top-level category: deleting it throws `QuestionBankError`, as does moving the questions to the category itself.

### moveQuestions

Moves questions into a category of the bank, several at once, as the bank's bulk "Move to" action does (Moodle's `core_question_move_questions` service).

```ts
function moveQuestions(context: BrowserContext, siteUrl: string, activityId: number, questionIds: number[], categoryId: number): Promise<{ changed: string; questionIds: number[]; categoryId: number }>;
```

A question moved keeps its id and versions, and quizzes keep using it. Moodle checks each question: moving takes `moodle/question:moveall` (`moodle/question:movemine` for the person's own questions) and `moodle/question:add` in the bank; a refusal throws `QuestionBankError` naming them. Other errors: `QuestionBankError` when no ids are given or the category isn't in the bank; `MoodleServiceError` with Moodle's reason otherwise.

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

// A new version with a clearer text, kept as a draft until checked; and the questions imported above deleted again.
if (created.questionId) {
  const updated = await moodle.updateQuestion(bank.id, created.questionId, { text: "<p>Which of these loops never ends?</p>" });
  if (updated.questionId) await moodle.setQuestionStatus(updated.questionId, "draft");
}
const removed = await moodle.deleteQuestions(bank.id, imported.questions.map((q) => q.id));
console.log(removed.deleted, removed.hidden);

// A category for loops, the multichoice question moved into it, and the category saved as Moodle XML.
const { category } = await moodle.addQuestionCategory(bank.id, { name: "Loops", description: "<p>while and for</p>" });
if (created.questionId) await moodle.moveQuestions(bank.id, [created.questionId], category.id);
const saved = await moodle.exportQuestions(bank.id, { format: "xml", categoryId: category.id, file: "/tmp/loops.xml" });
console.log(saved.path, saved.size);
for (const c of await moodle.questionCategories(bank.id)) console.log(c.id, c.name, c.parentId, c.questionCount);
```

## Data categories

- `questionBanks`, `questions`, `importQuestions`, `exportQuestions`, `createQuestion`, `updateQuestion`, `deleteQuestions`, `setQuestionStatus`, `questionCategories`, `addQuestionCategory`, `editQuestionCategory`, `deleteQuestionCategory`, `moveQuestions`: `course-content` (what teachers write).

See [Data categories](../concepts/data-categories.md).
