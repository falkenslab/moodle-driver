# Question banks

A course's question banks as Moodle 5 organizes them: shared banks are activities of their own (module `qbank`), and every quiz keeps a private bank. A teacher (anyone who can manage the course's questions) lists the banks, reads a bank's categories and questions, imports questions from GIFT or Moodle XML (a file or text) and exports them to a file, creates single questions of any type through their type's form, edits them, sets them ready or draft, and deletes them; organizes the bank's categories (adding, renaming, moving and deleting them) and moves questions between them. Students have no access to banks. Questions in a bank are what [`addQuestionsToQuiz`](quizzes.md#addquestionstoquiz) puts in a quiz.

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

Creates one question in a bank through its type's edit form and returns its id, of any type the bank's "Add a question" dialog offers. Imports are the way for several questions; this is for one-offs.

```ts
function createQuestion(context: BrowserContext, siteUrl: string, activityId: number, input: QuestionInput): Promise<{ changed: string; questionId?: number }>;

interface QuestionInput {
  type: QuestionType; // one of QUESTION_TYPES
  name: string;
  text: string;
  answers?: { text: string; fraction: number; feedback?: string; tolerance?: number }[];
  correct?: boolean;
  pairs?: { question: string; answer: string }[];
  choose?: number;
  choices?: { text: string; group?: number; unlimited?: boolean }[];
  image?: string;
  drags?: { text?: string; image?: string; group?: number; unlimited?: boolean }[];
  markers?: { text: string; count?: number }[];
  drops?: DropZone[]; // { choice, left?, top?, label?, shape?, coords? }
  items?: string[];
  wildcards?: { name: string; min?: number; max?: number; decimals?: number; distribution?: "uniform" | "loguniform"; values?: number[] }[];
  sets?: number;
  coderunner?: { type: string; answer?: string; testCases: { code: string; expected: string; stdin?: string; extra?: string; useAsExample?: boolean; mark?: number }[] };
  formulas?: { randomVariables?: string; globalVariables?: string; parts: { answer: string; text?: string; mark?: number; unit?: string; localVariables?: string; gradingVariables?: string; gradingCriterion?: string; feedback?: string }[] };
  categoryId?: number;
  defaultMark?: number;
  fields?: Record<string, FieldValue>;
}
```

- `type`: one of `QUESTION_TYPES`: Moodle's own (`multichoice`, `truefalse`, `shortanswer`, `numerical`, `essay`, `calculated`, `calculatedsimple`, `calculatedmulti`, `match`, `randomsamatch`, `ddwtos`, `ddimageortext`, `ddmarker`, `gapselect`, `multianswer`, `ordering`, `description`) and the plugins' (`coderunner`, `formulas`, `gapfill`, `ddmatch`), made when the site has them. Other types are imported as GIFT or Moodle XML instead.
- `name`: the question's name in the bank; `text`: the question's text, as HTML, with its type's places in it: `[[1]]`, `[[2]]`… for the choices of `ddwtos` and `gapselect`, the answers of a Cloze question (`multianswer`: `{1:SHORTANSWER:=Paris}`), the `[gaps]` of a gap fill, the `{wildcards}` of a calculated question.
- `categoryId`: the category; without it, the one after the bank's "Top" (its default category).
- `defaultMark`: the question's default mark; Moodle's default otherwise (a Cloze question's is the sum of its answers', and a description has none).
- `fields`: any other field of the type's form by its name (`{ shuffleanswers: false }`, `{ answernumbering: "none" }`), set after the others: whatever the inputs don't model.

Each type's inputs, the required ones checked before the form opens (an empty list counts as missing):

- `multichoice`, `shortanswer`, `numerical`: `answers`, required. `fraction` is the share of the mark (1 right, 0 wrong, negatives for penalties); Moodle only offers fixed grades (100%, 90%, 83.33%, 80%...), so each fraction is rounded to the nearest one the form offers (0.82 becomes 83.33%). `feedback` is the answer's feedback (HTML); `tolerance` is a numerical answer's accepted error. A multichoice question with more than one answer whose fraction is above 0 is created as multiple-answer (checkboxes), otherwise as single-answer.
- `truefalse`: `correct`, required: the right answer.
- `essay`, `description`, `multianswer` (Cloze), `gapfill`: the text only.
- `calculated`, `calculatedsimple`, `calculatedmulti`: `answers`, required, each a formula of the wildcards (`{a} * {b}`; in `calculatedmulti`, written as `{={a} * {b}}`); `wildcards`, each one's range (`min`, `max`, `decimals`, `distribution`, Moodle's 1 to 10 by default) or its `values`, one per set of values; `sets`, how many sets Moodle draws (10 by default; 1 to 100; given `values` set it). The values given are written over the ones Moodle draws.
- `match`, `ddmatch`: `pairs`, required: each question and its answer; an answer with an empty question is a distractor. Moodle wants two questions and three answers at least.
- `randomsamatch`: `choose`, how many short-answer questions of its category it draws (the category must have them).
- `ddwtos`, `gapselect`: `choices`, required: `[[1]]` in the text is the first; `group` (1 by default) is a set of choices that go in the same places; `unlimited` (`ddwtos`) lets a choice be used more than once.
- `ddimageortext`: `image`, the background (a local file), `drags`, the draggable items (a word as `text`, or a local image file as `image`, with `text` as its alternative text; `group`, `unlimited`), and `drops`, where they go: `choice`, the item's number from 1 in the order given, `left` and `top`, in pixels of the image, and an optional `label`. All three required.
- `ddmarker`: `image`, `markers` (each with its `text`, and how many times it can be placed, `count`; unlimited by default) and `drops`: `choice`, the marker's number from 1, `shape` (`"circle"`, `"rectangle"` or `"polygon"`) and `coords` as Moodle's form takes them (a circle `"x,y;r"`, a rectangle `"x,y;width,height"`, a polygon `"x1,y1;x2,y2;…"`), inside the image. All three required.
- `ordering`: `items`, required, two at least, in the right order.
- `coderunner`: `coderunner`, required: its question `type` (the language and how it's run: `"python3"`, `"c_program"`…), a sample `answer` (CodeRunner checks it against the tests when saving) and `testCases`, each with its `code`, `expected` output and optional `stdin`, `extra`, `useAsExample`, `mark`.
- `formulas`: `formulas`, required: its `randomVariables` and `globalVariables`, and its `parts`, each with its `answer` and optional `text`, `mark`, `unit`, `localVariables`, `gradingVariables`, `gradingCriterion`, `feedback`.

An input another type takes is refused (`A match question doesn't take answers: it takes pairs.`), as are drop zones naming an item that isn't there and wildcards with different numbers of values. The form's blank rows are extended with its "Blanks for more" button when more are needed. A drag and drop onto an image's files go up to the form's file pickers, and its drop zones' menus, which the page's script fills only once it has drawn the image, are given the items' numbers. The calculated types take more than one page: `calculatedsimple` finds its wildcards and generates its sets on its own page; `calculated` and `calculatedmulti` are saved first and then go through Moodle's wizard (the wildcards' datasets, private to the question, then their values: sets added with its "Add" button, by tens and ones), so a question whose values page fails is in the bank already.

The plugin types' forms are read by the field names their plugins publish; the sandbox the driver is checked against has none of them, so a program working with one should check its result. On a site without the plugin, `createQuestion` throws `QuestionBankError` naming it ("This site has no CodeRunner question type (the qtype_coderunner plugin): its administrator would have to install it.").

`questionId` is the id Moodle names after saving; it can be missing if Moodle lands elsewhere. Errors: `QuestionBankError` for a type it doesn't create, a plugin the site doesn't have, a required input missing or another type's given, a bank that keeps no questions or can't be added to, or a category not in the bank; `FormError` when the form has no field by a name in `fields` or Moodle refuses the values (a match with too few pairs, a drop zone outside the image…), or a file can't be uploaded.

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
- `input`: as in `createQuestion`, without `type` (a question keeps its type); what isn't given stays as it is, and an input the question's type doesn't take is refused.
- A list given (`answers`, `pairs`, `choices`, `items`, `drags`, `markers`, `drops`, `testCases`, `parts`) is the question's from now on: the form's other rows are blanked, and Moodle drops blank ones. A multichoice question becomes multiple-answer or single-answer as in `createQuestion`. `image` replaces the background.
- `wildcards` and `sets` (calculated types): with `values`, the sets are added or deleted to as many and given those values; with ranges or `sets` only, every set is drawn again from them. Without either, the question's values stay (`calculated` and `calculatedmulti` still go through the wizard's pages, as Moodle's form does).

Saving makes a new version of the question, with an id of its own: `questionId` is that new id, the one `questions` lists from then on (with its `version` one higher). Quizzes using the question's latest version get the new one; a quiz pinned to a version keeps it. Errors: `QuestionBankError` when nothing is given, an input the type doesn't take, a wildcard the question doesn't have, the bank keeps no questions, or the question isn't one the person can edit there; `FormError` as in `createQuestion`.

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
