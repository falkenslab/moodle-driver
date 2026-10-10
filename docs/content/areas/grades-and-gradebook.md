# Grades and gradebook

This area covers grades from both sides. A student (or anyone graded in a course) reads their own grade report with `myGrades`. A teacher reads everyone's grades with `graderReport`, reads how the gradebook is built with `gradebookSetup`, and changes it with `updateGradeItem` and `addGradeCategory`. Grading a single submission is in [Grading](grading.md); a quiz's attempts and marks are in [Quizzes](quizzes.md).

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
  itemId: number;
  name: string;
  kind: "item" | "category" | "course";
  activityId?: number;
  activityType?: string;
}
```

- `group`: a group id (see `groups` in [Participants](participants.md)); without it, the report as it opens for the person.
- `columns`: one per grade item in the report's order, by its grade item id. `kind` is `"item"` for an activity or manual item, `"category"` for a category's total and `"course"` for the course total. An activity's column carries its course module id and module.
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

## Recalculation

Moodle recalculates a course's grades after some changes (a deleted activity, changed weights or aggregations). While it does, the grader report shows a progress bar instead of the table, and `graderReport` throws `GradebookError` saying so. Waiting a moment and calling again is enough; there is nothing to fix.

## Example

A teacher moves the labs into a new category, weights the first one, and reads the course totals; a student reads their own grades.

```ts
import { addGradeCategory, gradebookSetup, GradebookError, graderReport, myGrades, updateGradeItem } from "@falkenslab/moodle-driver";

// `browser` is a BrowserManager and `site` the site's URL, as in the getting-started pages.
const context = await browser.context();

const setup = await gradebookSetup(context, site, 3);
const { category } = await addGradeCategory(context, site, 3, { name: "Labs", aggregation: "natural" });
if (category) {
  const labs = setup.items.filter((i) => i.type === "assign" && i.name.startsWith("Lab"));
  for (const item of labs) {
    await updateGradeItem(context, site, 3, item.id, { category: category.id });
  }
  // Inside the Natural "Labs" category, the first lab counts for 40%.
  if (labs[0]) await updateGradeItem(context, site, 3, labs[0].id, { weight: 40 });
}

try {
  const report = await graderReport(context, site, 3);
  const total = report.columns.find((c) => c.kind === "course");
  for (const row of report.rows) {
    console.log(row.userId, row.grades.find((g) => g.itemId === total?.itemId)?.grade ?? "no grade");
  }
} catch (error) {
  if (error instanceof GradebookError) console.log(error.message);
  else throw error;
}

// As a student: the course total of the person's own report.
const mine = await myGrades(context, site, 3);
console.log(mine.find((row) => row.kind === "courseTotal")?.grade);
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `myGrades`: `own`.
- `graderReport`: `others-personal` (everyone's grades).
- `gradebookSetup`, `updateGradeItem`, `addGradeCategory`: `course-content` (the gradebook's structure, nobody's grades).
- `readGradeRows`, `readGraderReport`, `readGradebookSetup`: `none` (they parse a page the caller already opened).
