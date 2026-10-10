# Activities and sections

Building a course: creating activities and resources of any type through Moodle's own activity form, reading and changing their settings, and renaming, showing, hiding, moving, duplicating and deleting activities and sections as the course page's editor does. It's for teachers with editing rights (Moodle's `moodle/course:manageactivities`); for anyone else Moodle refuses. Every change returns the course's structure afterwards, so a program can check what happened without another call.

The signatures below are the functions'; each is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

## What a change returns

Every function here except `activitySettings` and `courseActivityTypes` returns a `CourseChange`:

- `changed`: a sentence saying what was done (`Created page 812 "Loops" in section 2.`).
- `activityId`: the activity created or updated, when there is one.
- `newId`: the id of a duplicated activity or an added section.
- `url`: the activity's page, after creating or updating it.
- `sections`: the course's `CourseSection[]` after the change, as [courseStructure](courses.md) gives them (without details).

## createActivity

Creates an activity or resource of any type at the end of a section, through `course/modedit.php`, and saves it with "Save and return to course".

```ts
function createActivity(
  context: BrowserContext,
  siteUrl: string,
  input: ActivityFields & { courseId: number; sectionId: number; type: string; files?: string[] },
): Promise<CourseChange>;

interface ActivityFields {
  name?: string;
  description?: string; // HTML
  content?: string; // HTML: a page's content or a label's text
  url?: string; // a URL resource's target
  visibility?: "shown" | "hidden" | "stealth"; // ACTIVITY_VISIBILITIES
  settings?: Record<string, FieldValue>;
}
```

- `courseId`, `sectionId`: the course and the section's id (not its number), from the course structure.
- `type`: the module's name (`"page"`, `"assign"`, `"quiz"`, `"url"`, `"resource"`, `"folder"`, `"label"`…); `courseActivityTypes` lists what the person can add.
- `name`, `description`: the activity's name and description (shown on its page).
- `content`: a page's content (`page[text]`) or a label's text (`introeditor[text]`); for any other type it's an error.
- `url`: a URL resource's target (`externalurl`).
- `visibility`: `"hidden"` by default, so a teacher publishes after checking; `"stealth"` hides it from the course page but keeps it available by link, where the site allows it.
- `settings`: any other field of the form by its form name, such as `{ "duedate[enabled]": true, "duedate[day]": 23 }` or `{ completion: 1 }`. They're set after the common inputs, in the order given, and win over them for the same field.
- `files`: absolute local paths uploaded to the form's file area, for a file resource or a folder (see [files](files.md)).

`activityId` is the new activity's id, found by comparing the course before and after; when no new activity appears `changed` says so and `activityId` is undefined.

Errors:

- An `Error` when a file path isn't absolute or doesn't exist, when the course has no section with that id, when `content` is given for a type other than a page or label, or when the type's form takes no files.
- `FormError` when a field isn't in the form or is disabled (see below), when uploading fails, or when Moodle refuses the form; its `fields` hold Moodle's message per field (`{ field: "name", message: "You must supply a value here." }`).
- `NotLoggedInError` without a session.

## updateActivity

Changes an existing activity through its form: only what's given changes, and the files already there stay.

```ts
function updateActivity(context: BrowserContext, siteUrl: string, cmid: number, input: ActivityFields): Promise<CourseChange>;
```

It takes the same `ActivityFields` as `createActivity`, reading the activity's module and course from the form. Errors are the same `FormError` cases, and an `Error` for `content` on a type other than a page or label.

## activitySettings

An activity's settings as its form holds them, without submitting it: what a program reads before calling `updateActivity`.

```ts
function activitySettings(
  context: BrowserContext,
  siteUrl: string,
  cmid: number,
): Promise<{ id: number; module: string; courseId: number; name: string; description: string; fields: FormField[] }>;

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

`description` is the description editor's HTML. Each field in `fields` has:

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

## editActivity

Renames, shows or hides, or moves an activity, through the course editor's services (`core_update_inplace_editable`, `core_courseformat_update_course`).

```ts
function editActivity(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  cmid: number,
  changes: { name?: string; visibility?: ActivityVisibility; sectionId?: number; beforeActivityId?: number },
): Promise<CourseChange>;
```

`sectionId` moves the activity to the end of that section; `beforeActivityId` moves it before that activity. Each change given is made in turn (rename, then visibility, then move); with none, `changed` is `"Nothing to change."`.

## duplicateActivity and deleteActivity

```ts
function duplicateActivity(context: BrowserContext, siteUrl: string, courseId: number, cmid: number): Promise<CourseChange>;
function deleteActivity(context: BrowserContext, siteUrl: string, courseId: number, cmid: number): Promise<CourseChange>;
```

`duplicateActivity` makes a copy as the course page's "Duplicate" does (Moodle places it right after the original and names it with "(copy)"); `newId` is the copy's id. `deleteActivity` deletes the activity, with its participants' data (submissions, posts, attempts).

## addSection, editSection and deleteSection

```ts
function addSection(context: BrowserContext, siteUrl: string, courseId: number, options?: { name?: string; afterSectionId?: number }): Promise<CourseChange>;
function editSection(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  sectionId: number,
  changes: { name?: string; visible?: boolean; afterSectionId?: number },
): Promise<CourseChange>;
function deleteSection(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<CourseChange>;
```

- `addSection` adds a section after `afterSectionId`, or at the end without it; with `name` it renames it afterwards. `newId` is the new section's id.
- `editSection` renames, shows (`visible: true`) or hides it, or moves it after another section.
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
const sectionId = unit.newId!;

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

Every function here is `course-content`: `createActivity`, `updateActivity`, `activitySettings`, `editActivity`, `duplicateActivity`, `deleteActivity`, `addSection`, `editSection`, `deleteSection`, `courseActivityTypes`, and the lower-level `renameActivity`, `renameSection` and `courseFormat`. `readFormFields` is `none` (it parses a page already open); `editCourse`, the raw course editor action, is `any`. See [data categories](../concepts/data-categories.md).
