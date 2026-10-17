# Competencies

This area works a course's competencies: the frameworks it can draw them from (`competencyFrameworks`), the course's competencies and the activities linked to them (`courseCompetencies`), adding and removing them (`addCourseCompetency`, `removeCourseCompetency`), linking them to an activity (`setActivityCompetencies`), and a participant's rating in one (`competencyRating`, `rateCompetency`). Anyone in the course reads its competencies; managing them and rating participants takes Moodle's competency capabilities in the course, which editing teachers have by default. Frameworks, learning plans and templates are made at site level: the driver only reads frameworks.

**Terms:** [competency](../reference/glossary.md#competency).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## How competencies work in Moodle

A competency framework (made by an administrator, for the site or a category) is a tree of competencies with a scale: "Not yet competent", "Competent", for example, with the ratings that count as proficient. A teacher adds some of a framework's competencies to a course (its "Competencies" page) and links them to the course's activities (each activity's "Competencies" settings). A participant is then rated in each of the course's competencies, by hand or by a rule when they complete a linked activity; each rating is kept as evidence, with the teacher's note. A course's rating can be pushed to the participant's learning plans, as the course's competency settings say.

Competencies are a site feature an administrator turns on (Site administration > Advanced features > Enable competencies). The driver uses the services Moodle's own competency pages call, all open to AJAX (Moodle 5.2): `core_competency_list_competency_frameworks` and `core_competency_list_competencies`, the course competencies page's `tool_lp_data_for_course_competencies_page`, `core_competency_add_competency_to_course` and `core_competency_remove_competency_from_course`, the user competency page's `tool_lp_data_for_user_competency_summary_in_course` and `core_competency_grade_competency_in_course`. Moodle has no service that links a competency to an activity: `setActivityCompetencies` saves the activity's settings form with its course competencies field.

## competencyFrameworks

The visible frameworks a course can draw its competencies from (the site's and its categories'), each with its competencies.

```ts
function competencyFrameworks(context: BrowserContext, siteUrl: string, courseId: number): Promise<CompetencyFramework[]>;

interface CompetencyFramework {
  id: number;
  shortName: string;
  idNumber: string;
  description: string;
  competencies: Competency[];
}

interface Competency {
  id: number;
  shortName: string;
  idNumber: string;
  description: string;
  parentId: number;
}
```

- `description`: HTML, as Moodle formats it.
- `competencies`: the whole tree, parents before their children; `parentId` is the competency it's under, 0 at the top. Their `id` is what `addCourseCompetency` takes.

It takes `moodle/competency:competencyview`, which teachers have.

## courseCompetencies

A course's competencies, as its competencies page lists them.

```ts
function courseCompetencies(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompetency[]>;

interface CourseCompetency {
  id: number;
  shortName: string;
  idNumber: string;
  description: string;
  framework: { id: number; name: string };
  activities: { id: number; name: string }[];
}
```

- `framework`: the framework it comes from, by its short name.
- `activities`: the course's activities linked to it, by course module id.

It takes `moodle/competency:coursecompetencyview`, which students and teachers have.

## addCourseCompetency

Adds a framework's competency to a course, and returns the course's competencies afterwards.

```ts
function addCourseCompetency(context: BrowserContext, siteUrl: string, courseId: number, competencyId: number): Promise<CourseCompetencyChange>;

interface CourseCompetencyChange {
  changed: string;
  courseId: number;
  competencyId: number;
  competencies: CourseCompetency[];
}
```

A competency already in the course is left as it is (`changed` says so). It takes `moodle/competency:coursecompetencymanage`; a competency that doesn't exist is a `CompetencyError` with Moodle's reason.

## removeCourseCompetency

Removes a competency from a course, and returns the course's competencies afterwards.

```ts
function removeCourseCompetency(context: BrowserContext, siteUrl: string, courseId: number, competencyId: number): Promise<CourseCompetencyChange>;
```

Moodle unlinks it from the course's activities too, and keeps the ratings already given. A competency not in the course is left out (`changed` says so). It takes `moodle/competency:coursecompetencymanage`.

## setActivityCompetencies

Sets which of its course's competencies an activity is linked to, all at once, through the activity's settings form.

```ts
function setActivityCompetencies(context: BrowserContext, siteUrl: string, activityId: number, competencyIds: number[]): Promise<ActivityCompetencyChange>;

interface ActivityCompetencyChange {
  changed: string;
  activityId: number;
  competencyIds: number[];
}
```

The competencies not given are unlinked, and `[]` unlinks them all. Only the course's competencies can be linked: add one with `addCourseCompetency` first. The form's other settings, the rule on completion among them, stay as they are. `competencyIds` afterwards is read back from the course's competencies.

It throws `CompetencyError` for a competency that isn't the course's, for an activity Moodle doesn't show the form of, and when the person can't link competencies (it takes `moodle/competency:coursecompetencymanage`, and editing the activity).

## competencyRating

A participant's rating in one of the course's competencies, as their competency page in the course shows it.

```ts
function competencyRating(context: BrowserContext, siteUrl: string, courseId: number, userId: number, competencyId: number): Promise<CompetencyRating>;

interface CompetencyRating {
  courseId: number;
  userId: number;
  competencyId: number;
  rating: { value: number; name: string } | null;
  proficient: boolean | null;
  scale: CompetencyScaleItem[];
  evidence: CompetencyEvidence[];
  canRate: boolean;
}

interface CompetencyScaleItem {
  value: number;
  name: string;
  proficient: boolean;
}

interface CompetencyEvidence {
  id: number;
  action: "log" | "complete" | "override";
  description: string;
  note: string;
  rating: { value: number; name: string } | null;
  by?: { id: number; name: string };
  created: string;
}
```

- `rating`, `proficient`: the participant's rating in the course and whether it's proficient; `null` while unrated.
- `scale`: the competency's scale, `value` 1 for its first item; `proficient` as the framework (or the competency) configures it.
- `evidence`: the evidence in the course, the latest first: `override` a rating given by hand, `complete` a rule completing it, `log` a record without a rating. `description` is Moodle's, in the site's language; `note` is the teacher's (plain text, `""` without one); `created` is ISO.
- `canRate`: whether the person may rate them.

A teacher reads anyone's in the course (it takes `moodle/competency:usercompetencyview`); a student reads their own.

## rateCompetency

Rates a participant in one of the course's competencies, as the rating dialog on their competency page does, and returns the rating afterwards.

```ts
function rateCompetency(context: BrowserContext, siteUrl: string, courseId: number, userId: number, competencyId: number, input: CompetencyRatingInput): Promise<{ changed: string; rating: CompetencyRating }>;

interface CompetencyRatingInput {
  rating: number | string;
  note?: string;
}
```

- `rating`: a scale item's value (1 for the first) or its name, in any case.
- `note`: kept with the rating, as its evidence.

The new rating replaces the course's; Moodle also pushes it to the participant's learning plans when the course's competency settings say so. A rating that isn't on the scale is a `MoodleError` with code `invalid-input`, checked before anything is sent. It takes `moodle/competency:competencygrade`, and the participant must be enrolled as someone who can be rated (a student).

## Errors

Every function throws `CompetenciesDisabledError` (code `competencies-disabled`) on a site with competencies off, and `CompetencyError` (code `competency`) naming the capability when the person lacks it, or with Moodle's reason otherwise (a competency that isn't the course's, a participant who can't be rated).

## Example

A teacher adds a framework's first competency to a course, links it to an activity, and rates a student in it with a note.

```ts
import { CompetenciesDisabledError, CompetencyError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const [framework] = await moodle.competencyFrameworks(3);
  const competency = framework?.competencies[0];
  if (competency) {
    await moodle.addCourseCompetency(3, competency.id);
    await moodle.setActivityCompetencies(42, [competency.id]);

    const { rating } = await moodle.rateCompetency(3, 57, competency.id, { rating: "Competent", note: "Explained the task to the group." });
    console.log(rating.rating?.name, rating.proficient ? "proficient" : "not proficient");
  }
  for (const c of await moodle.courseCompetencies(3)) console.log(c.shortName, c.framework.name, c.activities.map((a) => a.name));
} catch (error) {
  if (error instanceof CompetenciesDisabledError || error instanceof CompetencyError) console.log(error.message);
  else throw error;
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `competencyFrameworks`, `courseCompetencies`, `addCourseCompetency`, `removeCourseCompetency`, `setActivityCompetencies`: `course-content`.
- `competencyRating`: `own` and `others-personal` (the person's own rating, or a participant's).
- `rateCompetency`: `others-personal` and `others-write`.
