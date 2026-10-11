# Grades and gradebook

This area covers grades from both sides. A student (or anyone graded in a course) reads their own grade report with `myGrades`. A teacher reads everyone's grades with `graderReport` (or saves Moodle's export file with `exportGrades`), grades in the gradebook with `setGrade` (a manual item's grade, or an override of an activity's), reads how the gradebook is built with `gradebookSetup`, and changes it with `addGradeItem`, `updateGradeItem`, `deleteGradeItem`, `addGradeCategory`, `updateGradeCategory` and `deleteGradeCategory`. Grading a single submission is in [Grading](grading.md); a quiz's attempts and marks are in [Quizzes](quizzes.md).

**Terms:** [gradebook](../reference/glossary.md#gradebook), [grade item](../reference/glossary.md#grade-item), [grade category](../reference/glossary.md#grade-category), [scale](../reference/glossary.md#scale).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

Everything here is read from Moodle's own pages by their structure (cell classes, data attributes, links and field names), never by header texts, so it works on a site in any language. Grades come as the text Moodle shows ("8.00", "80.00 %", "B+"), not as numbers: the site's grade display settings decide their format.

## myGrades

The person's own user grade report for a course (`grade/report/user/index.php`), one row per line of the report.

```ts
function myGrades(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeRow[]>;

interface GradeRow {
  kind: "item" | "category" | "categoryTotal" | "courseTotal";
  name: string;
  activityId?: number;
  activityType?: string;
  grade?: string;
  range?: string;
  percentage?: string;
  weight?: string;
  letter?: string;
  feedback?: string;
  contribution?: string;
}
```

The rows come in the report's order:

- `kind`: `"category"` is a category's heading row, `"item"` a grade item (an activity's or a manual one), `"categoryTotal"` a category's total row and `"courseTotal"` the course total. The report shows a category's heading, then its items, then its total.
- `name`: the row's title as the report shows it ("Quiz 1", "Programming total", "Course total").
- `activityId` and `activityType`: for an activity's item, its course module id and module ("quiz", "assign"…), read from the row's link. Manual items, categories and totals have none.
- `grade`, `range`, `percentage`, `weight`, `letter`, `feedback`, `contribution`: the report's columns as text ("8.00", "0–10", "80.00 %", "Well done"). A column the site hides, an empty cell or Moodle's "-" leaves the field out, so a missing `grade` means not graded yet (or hidden from the person).

The grade cell's action menu, whose text is in the site's language, is stripped before reading.

It throws `NoGradeReportError` when the page has no grade report: the course doesn't exist, the person isn't graded there, or grades are hidden from them. A missing session is `NotLoggedInError`, as everywhere (see [Errors](../concepts/errors.md)).

[`pendingActivities`](courses.md#pendingactivities) uses this report to find graded activities without a grade yet when a course doesn't track completion.

## graderReport

Everyone's grades in a course as the teacher's grader report shows them (`grade/report/grader/index.php`), page by page until no new rows come, optionally in one group.

```ts
function graderReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { group?: number }): Promise<GraderReport>;

interface GraderReport {
  columns: GradeColumn[];
  rows: { userId: number; fullName: string; grades: { itemId: number; grade?: string }[] }[];
}

interface GradeColumn {
  id: number;
  name: string;
  kind: "item" | "category" | "course";
  activityId?: number;
  activityType?: string;
}
```

- `group`: a group id (see `groups` in [Participants](participants.md)); without it, the report as it opens for the person.
- `columns`: one per grade item in the report's order, its `id` the grade item's id. `kind` is `"item"` for an activity or manual item, `"category"` for a category's total and `"course"` for the course total. An activity's column carries its course module id and module.
- `rows`: one per participant, by user id and full name only (no emails or other identity fields). Each grade refers to a column by `itemId`; a cell with no grade ("-") has no `grade` field.

It throws `GradebookError` when Moodle refuses the page (the message carries Moodle's reason, such as "no permission (View grader report)") or the course doesn't exist, and also when the report table isn't there because Moodle is recalculating the course's grades: see [Recalculation](#recalculation).

## gradebookSetup

How a course's gradebook is built, read from the "Gradebook setup" page (`grade/edit/tree/index.php`): its categories and its grade items.

```ts
function gradebookSetup(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ categories: GradebookCategory[]; items: GradebookItem[] }>;

interface GradebookCategory {
  id: number;
  itemId: number;
  name: string;
  parentId?: number;
  aggregation?: GradeAggregation;
  maxGrade?: number;
  weight?: number;
}

interface GradebookItem {
  id: number;
  name: string;
  categoryId?: number;
  type: string;
  maxGrade?: number;
  weight?: number;
  weightOverridden: boolean;
}
```

- A category's `id` is the category's own; `itemId` is the grade item holding its total (the column id in `graderReport`). The course's top category has no `parentId`; the others have their parent's id.
- `aggregation`: how the category combines its children, one of `GRADE_AGGREGATIONS` (below).
- `weight`: in percent, where the parent aggregates with weights that can be edited (Natural); otherwise left out.
- An item's `type` is the module of an activity's item ("assign", "quiz"…) or `"manual"` for an item made in the gradebook. `categoryId` is the category holding it. `weightOverridden` is whether the teacher fixed its weight instead of letting Natural compute it.

Category and course totals are their categories' `itemId`, so they don't appear again among `items`. It throws `GradebookError` with Moodle's message when the page isn't the setup (not allowed to manage grades, or no such course).

## updateGradeItem

Changes one grade item: moves it into a category, sets its weight, or sets its maximum grade. Returns a sentence saying what changed and the item as the setup shows it afterwards.

```ts
function updateGradeItem(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  itemId: number,
  changes: { category?: number; weight?: number; maxGrade?: number },
): Promise<{ changed: string; item?: GradebookItem }>;
```

- `category`: a category id from `gradebookSetup`; the item moves to the start of that category, as the setup page's "Move" action does.
- `weight`: the item's weight in its category, in percent. It overrides Natural's automatic weight (`weightOverridden` becomes `true`).
- `maxGrade`: a manual item's maximum grade. An activity's maximum is set in the activity's own settings (see [Activities](activities.md)), so for an activity's item it throws `GradebookError` before sending anything.

Options left out are left as they are; with none, `changed` is "Nothing to change.". The weight and the maximum go through Moodle's own dynamic form for grade items (`core_form_dynamic_form`), so Moodle validates them as in the modal: a value it refuses (a weight over 100, say) comes back as `GradebookError` with each field and Moodle's message ("aggregationcoef2: Weight must be at most 100"). A weight on an item whose category doesn't aggregate with editable weights throws `GradebookError` asking to change the category's aggregation first. A move Moodle doesn't carry out (a wrong id) also throws `GradebookError`.

## addGradeCategory

Adds a grade category at the course's top level, or inside another category, and returns it as the setup shows it.

```ts
function addGradeCategory(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { name: string; aggregation?: GradeAggregation; parentId?: number },
): Promise<{ changed: string; category?: GradebookCategory }>;
```

- `name`: the category's full name.
- `aggregation`: one of `GRADE_AGGREGATIONS`; without it, the site's default.
- `parentId`: a category id to move the new category into; without it, it stays at the top level.

`GRADE_AGGREGATIONS` lists the aggregations by name, mapped to Moodle's constants: `mean`, `median`, `lowest`, `highest`, `mode`, `weighted-mean`, `simple-weighted-mean`, `mean-with-extra-credits`, `natural`. An administrator can hide aggregations from teachers: asking for one the site doesn't offer throws `GradebookError` naming the ones it offers ("The site doesn't offer the mean aggregation; it offers: natural."). Moodle's form errors come back as `GradebookError` too.

## updateGradeCategory

Changes a grade category: renames it, changes its aggregation, sets its weight in its parent, or moves it into another category. Returns a sentence saying what changed and the category afterwards.

```ts
function updateGradeCategory(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  categoryId: number,
  changes: { name?: string; aggregation?: GradeAggregation; weight?: number; parentId?: number },
): Promise<{ changed: string; category?: GradebookCategory }>;
```

- `weight`: in percent, overriding Natural's automatic weight, as `updateGradeItem` does for an item. A parent that doesn't aggregate with editable weights throws `GradebookError`.
- `parentId`: moves the category to the start of that category.
- `aggregation`: as in `addGradeCategory`, refused with the offered ones named when the site hides it.

The course's own category (the one without `parentId`) has no weight and can't be moved: asking for either throws `GradebookError`. Name, aggregation and weight go through Moodle's dynamic form for categories, so its errors come back as `GradebookError` with each field.

## deleteGradeCategory

Deletes a grade category, as the setup page's "Delete" does. Moodle moves what it held (items and categories) into its parent, and the grades of its total go with it.

```ts
function deleteGradeCategory(context: BrowserContext, siteUrl: string, courseId: number, categoryId: number): Promise<{ changed: string }>;
```

The course's own category can't be deleted, and an id the setup doesn't have throws `GradebookError` before anything is sent.

## addGradeItem

Adds a manual grade item: one graded in the gradebook rather than by an activity (participation, an oral exam). Returns it as the setup shows it.

```ts
function addGradeItem(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options: { name: string; maxGrade?: number; scaleId?: number; categoryId?: number; hidden?: boolean },
): Promise<{ changed: string; item?: GradebookItem }>;
```

- `maxGrade`: out of how much; Moodle's default (100) when left out.
- `scaleId`: graded on a scale instead (a scale the course can use; another one throws `GradebookError` naming those it offers). Not together with `maxGrade`.
- `categoryId`: the category to put it in; at the course's top level without it.
- `hidden`: hidden from students.

It goes through Moodle's dynamic form for grade items, so Moodle's form errors come back as `GradebookError`. Grade it with `setGrade`.

## deleteGradeItem

Deletes a manual grade item and its grades.

```ts
function deleteGradeItem(context: BrowserContext, siteUrl: string, courseId: number, itemId: number): Promise<{ changed: string }>;
```

An activity's item goes with its activity (deleting it from the gradebook would only have Moodle make it again), so for one it throws `GradebookError` before sending anything; so does an id the setup doesn't have.

## setGrade

Sets a person's grade in one grade item as a teacher does in the gradebook's single view report (`grade/report/singleview/index.php`, the person's screen): a manual item takes the grade; an activity's or a category's item is overridden. Feedback and excluding the grade from the totals go the same way. Returns a sentence saying what changed and the grade afterwards.

```ts
function setGrade(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  itemId: number,
  userId: number,
  options: { grade?: number | string | null; feedback?: string; override?: boolean; excluded?: boolean },
): Promise<{ changed: string; grade: GradebookGrade }>;

interface GradebookGrade {
  itemId: number;
  userId: number;
  grade?: string;
  feedback?: string;
  overridden: boolean;
  excluded: boolean;
}
```

- `itemId`: a grade item's id (a column of `graderReport`, an item of `gradebookSetup`); `userId`: a participant's, as `graderReport`'s rows give it.
- `grade`: a number for a value item, or a scale item's name or value ("Good", `2`) for a scale; `null` empties it. An item's range comes with its field, so a grade out of it throws `GradebookError` naming the range before anything is sent ("takes grades from 0.00 to 10.00").
- `feedback`: text; an empty string removes it.
- `override`: for an activity's or category's item only. A grade or feedback there overrides the activity's (Moodle requires it, and keeps the override until it's taken off), so `override` can be left out; `override: false` alone gives the grade back to the activity. Feedback given with the override stays when it's taken off (confirmed empirically, Moodle 5.2): remove it first with `feedback: ""`. On a manual item it throws `GradebookError`.
- `excluded`: leave the grade out of the category and course totals.

At least one option must be given. When the grade already is as asked, nothing is sent and `changed` is "Nothing to change.". `grade` comes as the report shows it ("8.50", the scale item's name).

The report's fields only show in editing mode: when the person's editing mode is off, it's turned on for the change through the page's own switch and back off afterwards. A locked grade, an item or person the course's gradebook doesn't have, and Moodle's warnings when saving (a grade out of range on a site with unlimited grades) throw `GradebookError`. Grading an assignment's submission, with its rubric and feedback files, is [`gradeSubmission`](grading.md); an override here is what Moodle shows in the gradebook over the assignment's own grade.

## exportGrades

Saves a course's grades as Moodle exports them for a teacher ("Export" in the gradebook): a spreadsheet, comma-separated text or XML, the file a secretariat or a spreadsheet expects. `graderReport` gives the same grades as data.

```ts
function exportGrades(context: BrowserContext, siteUrl: string, courseId: number, options: ExportGradesOptions): Promise<DownloadedFile>;

interface ExportGradesOptions {
  format: "xlsx" | "ods" | "csv" | "xml";
  itemIds?: number[];
  groupId?: number;
  display?: ("real" | "percentage" | "letter")[];
  feedback?: boolean;
  destDir?: string;
}
```

- `format`: `xlsx` (Moodle's "Excel spreadsheet" export), `ods`, `csv` (its plain text export, comma-separated) or `xml`; `GRADE_EXPORT_FORMATS` lists them.
- `itemIds`: the grade items to include (ids from `graderReport` or `gradebookSetup`); all of them when left out. One the export doesn't offer throws `GradebookError` naming those it does.
- `groupId`: only that group's members, as the export page's group menu chooses them (see `groups` in [Participants](participants.md)).
- `display`: how each grade is written, one column per way; the site's default when left out. XML takes exactly one.
- `feedback`: add each grade's feedback.
- `destDir`: the folder to save the file in, an absolute path. The [Moodle object](../concepts/calling-functions.md) uses its `downloadDir` when it's left out; the function throws without one.

It fills the export page's form (`grade/export/<plugin>/index.php`) and saves the file Moodle sends under Moodle's own name ("mcp-content Grades-20261011_1805-comma_separated.csv"), never overwriting one: `(2)` is added as `downloadFile` does. It returns the same `DownloadedFile` (`path`, `name`, `size`). Besides the grades, Moodle's export carries each person's first and last names, ID number, institution, department and email address.

An administrator can disable export formats: asking for one the site doesn't offer throws `GradebookError` naming those it does ("The site doesn't export grades as xlsx; it exports as: csv, ods, xml."), read from the gradebook's navigation menu. Moodle's XML export takes only items with an ID number: when the course has none, or `itemIds` names one without, it throws `GradebookError` before sending anything. A course the person can't export (no permission) throws `GradebookError` with Moodle's reason.

## Recalculation

Moodle recalculates a course's grades after some changes (a deleted activity, changed weights or aggregations). While it does, the grader report shows a progress bar instead of the table, and `graderReport` throws `GradebookError` saying so. Waiting a moment and calling again is enough; there is nothing to fix.

## Example

A teacher moves the labs into a new category, weights the first one, grades a manual item, overrides a quiz's grade, and reads the course totals; a student reads their own grades.

```ts
import { GradebookError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const setup = await moodle.gradebookSetup(3);
const { category } = await moodle.addGradeCategory(3, { name: "Labs", aggregation: "natural" });
if (category) {
  const labs = setup.items.filter((i) => i.type === "assign" && i.name.startsWith("Lab"));
  for (const item of labs) {
    await moodle.updateGradeItem(3, item.id, { category: category.id });
  }
  // Inside the Natural "Labs" category, the first lab counts for 40%.
  if (labs[0]) await moodle.updateGradeItem(3, labs[0].id, { weight: 40 });
}

// A manual item graded in the gradebook, and an override of a quiz's grade for one student.
const { item } = await moodle.addGradeItem(3, { name: "Participation", maxGrade: 10 });
if (item) await moodle.setGrade(3, item.id, 5, { grade: 8.5, feedback: "Active in every class" });
const quiz = setup.items.find((i) => i.type === "quiz");
if (quiz) await moodle.setGrade(3, quiz.id, 5, { grade: 7 });

try {
  const report = await moodle.graderReport(3);
  const total = report.columns.find((c) => c.kind === "course");
  for (const row of report.rows) {
    console.log(row.userId, row.grades.find((g) => g.itemId === total?.id)?.grade ?? "no grade");
  }
} catch (error) {
  if (error instanceof GradebookError) console.log(error.message);
  else throw error;
}

// As a student: the course total of the person's own report.
const mine = await moodle.myGrades(3);
console.log(mine.find((row) => row.kind === "courseTotal")?.grade);
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `myGrades`: `own`.
- `graderReport`, `exportGrades`: `others-personal` (everyone's grades; the export adds their emails).
- `gradebookSetup`, `updateGradeItem`, `addGradeItem`, `addGradeCategory`, `updateGradeCategory`, `deleteGradeCategory`: `course-content` (the gradebook's structure, nobody's grades).
- `deleteGradeItem`: `course-content` and `others-write` (a manual item's grades go with it).
- `setGrade`: `others-personal` and `others-write` (reads and decides a person's grade).
