# Activities and sections

Building a course: creating activities and resources of any type through Moodle's own activity form, reading and changing their settings, and renaming, describing, showing, hiding, moving, duplicating and deleting activities and sections as the course page's editor does. It's for teachers with editing rights (Moodle's `moodle/course:manageactivities`); for anyone else Moodle refuses. Every change returns the course's structure afterwards, so a program can check what happened without another call.

**Terms:** [section](../reference/glossary.md#section), [activity](../reference/glossary.md#activity), [module](../reference/glossary.md#module), [course module id](../reference/glossary.md#course-module-id), [instance id](../reference/glossary.md#instance-id), [changed](../reference/glossary.md#changed).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## What a change returns

Every function here except `activitySettings` and `courseActivityTypes` returns a `CourseChange`:

- `changed`: a sentence saying what was done (`Created page 812 "Loops" in section 2.`).
- `activityId`: the activity created, updated or duplicated (the copy), when there is one.
- `sectionId`: the section added, by `addSection`.
- `url`: the activity's page, after creating or updating it.
- `files`: a file resource's or folder's files, after `updateActivity` changed them (`DraftFile[]`, `{ name, size }`).
- `sections`: the course's `CourseSection[]` after the change, as [courseStructure](courses.md) gives them (without details).

## createActivity

Creates an activity or resource of any type at the end of a section, through `course/modedit.php`, and saves it with "Save and return to course".

```ts
function createActivity(
  context: BrowserContext,
  siteUrl: string,
  input: ActivityFields & { courseId: number; sectionId: number; type: string; files?: (string | DraftUpload)[] },
): Promise<CourseChange>;

interface ActivityFields {
  name?: string;
  description?: string; // HTML
  content?: string; // HTML: a page's content or a label's text
  url?: string; // a URL resource's target
  visibility?: "shown" | "hidden" | "stealth"; // ACTIVITY_VISIBILITIES
  restrictions?: Restrictions; // when students can open it
  completion?: Completion; // when it counts as complete
  settings?: Record<string, FieldValue>;
}
```

- `courseId`, `sectionId`: the course and the section's id (not its number), from the course structure.
- `type`: the module's name (`"page"`, `"assign"`, `"quiz"`, `"url"`, `"resource"`, `"folder"`, `"label"`…); `courseActivityTypes` lists what the person can add.
- `name`, `description`: the activity's name and description (shown on its page).
- `content`: a page's content (`page[text]`) or a label's text (`introeditor[text]`); for any other type it's an error.
- `url`: a URL resource's target (`externalurl`).
- `visibility`: `"hidden"` by default, so a teacher publishes after checking; `"stealth"` hides it from the course page but keeps it available by link, where the site allows it.
- `restrictions`, `completion`: when students can open it and when it counts as complete, in plain terms (see [Restrictions and completion](#restrictions-and-completion)).
- `settings`: any other field of the form by its form name, such as `{ "duedate[enabled]": true, "duedate[day]": 23 }` or `{ completion: 1 }`. They're set after the common inputs, in the order given, and win over them for the same field.
- `files`: absolute local paths uploaded to the form's file area, for a file resource or a folder (see [files](files.md)); a SCORM takes the first as its package (see [SCORM](scorm.md)). A `{ from, to }` (`DraftUpload`) gives a file another name or puts it in a folder's subfolder: `{ from: "/home/ada/notes.pdf", to: "week1/notes.pdf" }`.

`activityId` is the new activity's id, found by comparing the course before and after; when no new activity appears `changed` says so and `activityId` is undefined.

Errors:

- A `MoodleError` when a file path isn't absolute or doesn't exist (`invalid-input`, `not-found`), when the course has no section with that id (`not-found`), when `content` is given for a type other than a page or label (`invalid-input`), or when the type's form takes no files (`not-available`).
- `FormError` when a field isn't in the form or is disabled (see below), when uploading fails, or when Moodle refuses the form; its `fields` hold Moodle's message per field (`{ field: "name", message: "You must supply a value here." }`).
- `NotLoggedInError` without a session.

## updateActivity

Changes an existing activity through its form: only what's given changes, and the files already there stay unless `files` says otherwise.

```ts
function updateActivity(context: BrowserContext, siteUrl: string, activityId: number, input: ActivityFields & { files?: FileChanges }): Promise<CourseChange>;

interface FileChanges {
  add?: (string | DraftUpload)[]; // local paths, or { from, to } for another name or a subfolder
  remove?: string[]; // files by their path in the activity: "notes.pdf", "week1/notes.pdf"
  replace?: (string | DraftUpload)[]; // the whole new set
}
```

It takes the same `ActivityFields` as `createActivity`, reading the activity's module and course from the form. Errors are the same `FormError` cases, and a `MoodleError` (`invalid-input`) for `content` on a type other than a page or label.

### Changing a resource's or folder's files

`files` changes a file resource's or folder's files (a SCORM's package too) in the form's draft area before it's saved, as the file manager does: `remove` deletes files by their path in the activity, as `activitySettings` lists them; `add` uploads local files, and a file with the name of one already there replaces it (a new version of a PDF keeps its name and its links); `replace` removes every file and uploads the given ones. Folders in a folder are paths: `"week1/notes.pdf"`, created when a file goes there. The result's `files` are the activity's files afterwards, and `changed` says what was removed and added.

- A file to remove that the activity doesn't have: a `MoodleError` (`not-found`) naming the files it has, before anything is saved.
- `replace` with `add` or `remove`: a `MoodleError` (`invalid-input`).
- A type whose form has no files (a page, a quiz): a `MoodleError` (`not-available`).

```ts fragment
// A new version of the brief, and a folder that loses one file and gains another in a subfolder.
await moodle.updateActivity(812, { files: { add: ["/home/ada/brief.pdf"] } });
await moodle.updateActivity(815, { files: { remove: ["old-notes.pdf"], add: [{ from: "/home/ada/notes.pdf", to: "week1/notes.pdf" }] } });
```

## activitySettings

An activity's settings as its form holds them, without submitting it: what a program reads before calling `updateActivity`.

```ts
function activitySettings(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<{
  id: number;
  module: string;
  courseId: number;
  name: string;
  description: string;
  fields: FormField[];
  files?: DraftFile[];
  restrictions?: Restrictions;
  completion?: Completion;
}>;

interface FormField {
  name: string;
  type: "text" | "textarea" | "select" | "checkbox" | "radio" | "number" | "date" | "other";
  label?: string;
  value?: string | string[];
  checked?: boolean;
  options?: { value: string; label: string }[];
  disabled?: boolean;
}
```

`description` is the description editor's HTML. `files`, for a file resource, a folder or a SCORM (its package), are its files as `{ name, size }`: `name` is the path in the activity (`"week1/notes.pdf"`), as `updateActivity`'s `files.remove` takes it, and `size` is in bytes. `restrictions` (undefined without any) and `completion` (undefined when completion is off in the course) are in the terms `updateActivity` takes (see [Restrictions and completion](#restrictions-and-completion)). Each field in `fields` has:

- `name`: the form name `settings` takes.
- `type`: a date selector's parts (`duedate[day]`, `[month]`, `[year]`, `[hour]`, `[minute]`) are `"date"`; text, URL and email inputs are `"text"`; anything else unrecognized is `"other"`.
- `label`: as the form shows it, in the site's language; a date part is named after its row (`"Due date (day)"`).
- `value`: the text, the selected option (an array for a multiple select), or the checked radio's value; editors' HTML included.
- `checked`: for a checkbox.
- `options`: for a select or a radio group.
- `disabled`: present (`true`) when Moodle has the field disabled until another enables it.

Internal fields (the sesskey, ids, buttons, hidden fields) are left out, and so are keys with no value.

### Disabled fields

Moodle disables some fields until another one enables them: a date until its "Enable" checkbox is checked, a maximum grade until "Rescale existing grades" is chosen once there are grades. Moodle doesn't send a disabled field, so the change would be lost: `createActivity`, `updateActivity` and every form the driver fills throw `FormError` for a field still disabled when it's set. Fields are set one at a time in the order given, so put the enabling field first in the same call, as in `{ "grade[modgrade_rescalegrades]": "no", "grade[modgrade_point]": 20 }`.

`activitySettings` throws `ActivitySettingsError` when there's no form to read (not an activity, or not the person's to edit), with Moodle's own reason when its error page gives one (`Sorry, no permission (Manage activities).`).

## Restrictions and completion

`createActivity` and `updateActivity` take when an activity is available (`restrictions`) and when it counts as complete (`completion`) in plain terms, and build Moodle's fields from them: the availability tree its form keeps as JSON (`availabilityconditionsjson`), and the module's completion fields. `editSection` takes `restrictions` for a section. `activitySettings` gives both back in the same terms.

```ts
interface Restrictions {
  conditions: Restriction[]; // [] removes every restriction
  match?: "all" | "any"; // "all" by default
  hidden?: boolean; // while not met: hidden from students, or (false, the default) shown greyed out with the conditions
}

type Restriction =
  | { type: "date"; from?: Date | string; until?: Date | string } // ISO dates; from, until or both
  | { type: "grade"; activityId: number; min?: number; max?: number } // percentages of its maximum grade
  | { type: "completion"; activityId: number; state: CompletionState } // "complete", "incomplete", "complete-pass", "complete-fail"
  | { type: "group"; groupId: number }
  | { type: "other"; json: unknown }; // a condition the driver has no terms for, as Moodle keeps it

type Completion = "none" | "manual" | { view?: boolean; grade?: boolean; passGrade?: boolean; submit?: boolean; expected?: Date | string };
```

Restrictions:

- A date condition with `from` and `until` is one range: both must hold, whatever `match` says of the others. `from` is "from" in Moodle (`>=`) and `until` is "until" (`<`).
- A grade condition names the activity; Moodle's names its grade item, which the driver finds in the course's gradebook setup page (an activity with several grade items, such as a forum's whole-forum grade and its ratings, takes the first). `min` and `max` are percentages, as in Moodle's form (`min: 50` is at least half the maximum grade). An activity without a grade item is a `MoodleError` (`not-found`).
- `hidden: true` hides the activity or section from students who don't meet the conditions; otherwise the course page shows it greyed out with the conditions (Moodle's eye icon).
- Read back, a condition the driver has no terms for (a grouping, a user profile field, a nested set, a "must not" set) comes as `{ type: "other", json }`, Moodle's own node, and is written back as given; so is a grade condition whose grade item the driver can't map to an activity.
- Moodle saves a condition on a group the course doesn't have without complaint, so take group ids from the course's groups ([participants and groups](participants.md)); a completion condition's activity is checked against the course first (a `MoodleError`, `not-found`). A tree Moodle refuses when the form is saved is a `FormError` with its message on `availabilityconditionsjson`.

Completion:

- `"none"`: not tracked; `"manual"`: students mark it done ([setCompletion](completion.md#setcompletion)).
- An object: complete on its conditions, all of them: `view` (viewing it), `grade` (receiving a grade), `passGrade` (a passing grade; implies `grade`, and the activity needs a grade to pass, or Moodle refuses the form), `submit` (submitting: assignments and choices). `expected` is the date shown to students as when it's expected, not a condition. Conditions not given are turned off.
- A condition the module's form doesn't have (`submit` on a page) is a `MoodleError` (`invalid-input`) naming it, before anything is saved; a form without completion settings (completion off in the course or the site) is a `MoodleError` (`not-available`).
- The module's other conditions (a forum's number of posts, a quiz's attempts) stay as they are: set them through `settings` by their form names (`activitySettings` lists them). `settings` are set last and win over `completion` and `restrictions` for the same field.
- Once students have completed the activity, Moodle locks its completion settings: setting them then is a `FormError` for disabled fields.

```ts fragment
// A page that's complete on view, and a quiz open only to those who completed it, from Monday.
const intro = await moodle.createActivity({ courseId: 3, sectionId: 12, type: "page", name: "Read first", content: "<p>…</p>", completion: { view: true } });
await moodle.updateActivity(41, {
  restrictions: { conditions: [{ type: "completion", activityId: intro.activityId!, state: "complete" }, { type: "date", from: "2026-10-19T08:00:00Z" }] },
  completion: { grade: true, passGrade: true },
});
console.log((await moodle.activitySettings(41)).restrictions);
```

## Reordering

Activities and sections are moved with `editActivity` and `editSection`, as the course page's "Move" does:

- `editActivity(courseId, activityId, { beforeActivityId })` puts the activity right before another one, in that one's section.
- `editActivity(courseId, activityId, { sectionId })` puts it at the end of a section.
- `editSection(courseId, sectionId, { afterSectionId })` puts the section right after another one.

Ids come from the course structure (a section's `id`, not its `number`), and every call returns the structure afterwards, so a program can check the new order.

```ts fragment
// Course 3 is General (section 10), Unit 1 (11) with Intro (21) and Task (22), Unit 2 (12) with Quiz (23).
await moodle.editActivity(3, 23, { beforeActivityId: 21 }); // Unit 1: [Quiz, Intro, Task]
await moodle.editActivity(3, 21, { sectionId: 12 }); // Intro to the end of Unit 2
const after = await moodle.editSection(3, 12, { afterSectionId: 10 }); // Unit 2 before Unit 1
console.log(after.sections.map((s) => `${s.title}: ${s.activities.map((a) => a.name).join(", ")}`));
```

## editActivity

Renames, shows or hides, or moves an activity, through the course editor's services (`core_update_inplace_editable`, `core_courseformat_update_course`).

```ts
function editActivity(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  activityId: number,
  changes: { name?: string; visibility?: ActivityVisibility; sectionId?: number; beforeActivityId?: number },
): Promise<CourseChange>;
```

`sectionId` moves the activity to the end of that section; `beforeActivityId` moves it before that activity. Each change given is made in turn (rename, then visibility, then move); with none, `changed` is `"Nothing to change."`.

## duplicateActivity and deleteActivity

```ts
function duplicateActivity(context: BrowserContext, siteUrl: string, courseId: number, activityId: number): Promise<CourseChange>;
function deleteActivity(context: BrowserContext, siteUrl: string, courseId: number, activityId: number): Promise<CourseChange>;
```

`duplicateActivity` makes a copy as the course page's "Duplicate" does (Moodle places it right after the original and names it with "(copy)"); `activityId` is the copy's id. `deleteActivity` deletes the activity, with its participants' data (submissions, posts, attempts).

## addSection, editSection and deleteSection

```ts
function addSection(context: BrowserContext, siteUrl: string, courseId: number, options?: { name?: string; afterSectionId?: number; summary?: string }): Promise<CourseChange>;
function editSection(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  sectionId: number,
  changes: { name?: string; visible?: boolean; summary?: string; restrictions?: Restrictions; afterSectionId?: number },
): Promise<CourseChange>;
function deleteSection(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<CourseChange>;
```

- `addSection` adds a section after `afterSectionId`, or at the end without it; with `name` it renames it afterwards, and with `summary` it gives it a description. `sectionId` is the new section's id.
- `editSection` renames, describes (`summary`), restricts (`restrictions`, see [Restrictions and completion](#restrictions-and-completion)), shows (`visible: true`) or hides it, or moves it after another section.
- `summary` is the section's description, HTML as given (`""` removes it), shown on the course page under the section's name. No service changes it nor `restrictions`, so they're saved through the section's own form (`course/editsection.php`, its `summary_editor` and `availabilityconditionsjson`), in one save when both are given; the driver only takes a section of the given course: another course's is a `MoodleError` (`not-found`), and Moodle's refusals of the form a `FormError`. [courseStructure](courses.md) with `details` reads it back as `summary`.
- `deleteSection` deletes the section and every activity in it, with their participants' data.

Sections are renamed through the course format's in-place editor (`format_topics`, `format_weeks`…): the driver reads the course's format once from the course page's classes and keeps it for the process.

## Errors of the course editor

The editing functions (`editActivity`, `duplicateActivity`, `deleteActivity`, `addSection`, `editSection`, `deleteSection`) pass Moodle's refusals as `MoodleServiceError`, with its `errorcode`: an activity or section the course doesn't have is `invalidrecord`, and a person without the right to edit the course gets Moodle's own refusal the same way. No session is `NotLoggedInError`.

## courseActivityTypes

The activity and resource types the person can add to a course, from `core_course_get_course_content_items`.

```ts
function courseActivityTypes(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ type: string; title: string; purpose?: string }[]>;
```

`type` is what `createActivity` takes, `title` the name the activity chooser shows (in the site's language) and `purpose` Moodle's grouping (`"content"`, `"assessment"`, `"collaboration"`…) when it gives one. A type with several items (external tools) is listed once. Someone who can't edit the course gets an empty list.

## Example

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const unit = await moodle.addSection(3, { name: "Unit 4: Recursion" });
const sectionId = unit.sectionId!;

const page = await moodle.createActivity({
  courseId: 3,
  sectionId,
  type: "page",
  name: "What recursion is",
  content: "<p>A function that calls itself, with a base case.</p>",
});

const assignment = await moodle.createActivity({
  courseId: 3,
  sectionId,
  type: "assign",
  name: "Recursive factorial",
  description: "<p>Write <code>factorial(n)</code> recursively and upload the file.</p>",
  settings: { "duedate[enabled]": true, "duedate[day]": 30, "duedate[month]": 10, "duedate[year]": 2026, assignsubmission_file_enabled: true },
});

// Check the settings by name before changing them.
const settings = await moodle.activitySettings(assignment.activityId!);
console.log(settings.fields.filter((f) => f.disabled).map((f) => f.name));

await moodle.updateActivity(assignment.activityId!, { settings: { "grade[modgrade_point]": 10 } });
const after = await moodle.editActivity(3, page.activityId!, { visibility: "shown" });
console.log(after.changed);
```

## Data categories

Every function here is `course-content`: `createActivity`, `updateActivity`, `activitySettings`, `editActivity`, `duplicateActivity`, `deleteActivity`, `addSection`, `editSection`, `deleteSection`, `courseActivityTypes`, and the lower-level `renameActivity` and `renameSection` (in `/internals`); `editCourse`, the raw course editor action, is `any`. See [data categories](../concepts/data-categories.md).
