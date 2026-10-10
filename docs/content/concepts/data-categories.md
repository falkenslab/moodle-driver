# Data categories

Some programs must not reach everything the person could: an assistant that builds a course but never reads students' work, a tool that may read grades but never change them. The driver can't decide that for them, but it declares, for every public function, which kinds of data it reads or writes, so a program can allow some kinds and refuse the rest without classifying the driver by hand.

## The categories

```ts
type DataCategory = "none" | "own" | "course-content" | "others-aggregate" | "others-personal" | "others-write" | "communication" | "any";
```

| Category | Meaning | Examples |
| --- | --- | --- |
| `none` | The session or the site, nothing of anyone's; also functions that only parse what the caller already fetched | `logIn`, `publicSiteInfo`, `readTexts` |
| `own` | The person's own data and actions | `myGrades`, `whoAmI`, `answerQuizQuestions`, `saveSubmission` |
| `course-content` | What teachers make: structure, activities and their settings, rubrics, questions | `courseStructure`, `createActivity`, `importQuestions`, `rubric` |
| `others-aggregate` | Counts that identify no one | `activitiesOverview` ("2 of 4 submitted"), `courseUpdates` |
| `others-personal` | Others' data or work: names, roles, submissions, posts, attempts, grades | `participants`, `assignmentSubmissions`, `discussion`, `quizResults` |
| `others-write` | Deciding about others: grades, feedback, extensions, overrides, completion | `gradeSubmission`, `grantExtension`, `setQuizOverride`, `overrideCompletion` |
| `communication` | Writing to or before others | `replyToPost`, `startDiscussion`, `sendMessage`, `setDiscussionState` |
| `any` | Generic primitives that reach whatever they're pointed at | `callService`, `openSitePage`, `openForm`, `setFields`, `BrowserManager.tab` |

A function that may touch several kinds lists them all (`gradeSubmission` reads a submission and decides a grade: `others-personal` and `others-write`); a program should take the strictest.

## DATA_CATEGORIES

```ts
import { DATA_CATEGORIES } from "@falkenslab/moodle-driver";

DATA_CATEGORIES.courseStructure; // ["course-content", "own"]
DATA_CATEGORIES.gradeSubmission; // ["others-personal", "others-write"]
DATA_CATEGORIES["BrowserManager.tab"]; // ["any"]
```

It has an entry for every function exported from the package, for every method of the browser manager (`BrowserManager.<method>`) and for the Moodle object's own methods (`Moodle.<method>`: `logIn`, `close`, `callService`, `tab`…). The object's other methods are the functions of the same name, under their names: `moodle.gradeSubmission` is `DATA_CATEGORIES.gradeSubmission`. The driver's tests fail when a new export has none, so the manifest can't fall behind the code.

## moduleCategories

Reading an activity reads different things depending on its module: a page holds only what a teacher wrote; an assignment, a forum or a quiz also holds participants' work. `moduleCategories(module)` answers per module:

```ts
import { moduleCategories } from "@falkenslab/moodle-driver";

moduleCategories("page"); // ["course-content"]
moduleCategories("forum"); // ["course-content", "others-personal"]
moduleCategories("someplugin"); // ["any"]: an unknown plugin could hold anything
```

## A policy on top

```ts
import { DATA_CATEGORIES, type DataCategory } from "@falkenslab/moodle-driver";

const allowed = new Set<DataCategory>(["none", "own", "course-content", "others-aggregate"]);

function mayCall(fn: string): boolean {
  const categories = DATA_CATEGORIES[fn];
  return categories !== undefined && categories.every((category) => allowed.has(category));
}

mayCall("createActivity"); // true
mayCall("assignmentSubmissions"); // false
```

moodle-mcp builds its tool scopes this way: the person chooses which kinds of tools exist for an agent, and each tool's scope follows from the categories of the driver functions it calls.
