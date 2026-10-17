# Databases

Database activities (module `data`), as a teacher sets them up: their fields (one per kind of data an entry holds), their templates (how entries are listed, shown, added and searched) and the site's presets that give a database both at once; and their [entries](#entries), as participants add them and teachers review, approve and move them in and out as CSV. Create the database itself with `createActivity({ type: "data", … })` (see [Activities and sections](activities.md)); rate its entries with `rate` (see [Grading](grading.md#rate)).

**Terms:** [database](../reference/glossary.md#database), [course module id](../reference/glossary.md#course-module-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Moodle doesn't open a database's setup to AJAX: everything goes through its fields, templates and presets pages (`mod/data/field.php`, `templates.php`, `preset.php`), read by their fields' names, the fields table's links and its icons, so it works in any interface language. They take Moodle's capability `mod/data:managetemplates`, which editing teachers have. Every function here throws `NotADatabaseError` when the id isn't a database, `DatabaseError` when Moodle refuses the person its setup (with Moodle's message) and `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## databaseFields

A database's fields, in the fields page's order, each read from its edit form.

```ts
function databaseFields(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabaseField[]>;

interface DatabaseField {
  id: number;
  name: string;
  type: DatabaseFieldType | string;
  description: string;
  required: boolean;
  options: DatabaseFieldOptions;
}
```

- `type`: one of `DATABASE_FIELD_TYPES`, Moodle's core types: `text` (short text), `textarea`, `number`, `date`, `menu` (dropdown list), `radiobutton`, `checkbox`, `multimenu` (multi-select list), `url`, `file`, `picture` (image) and `latlong` (coordinates). A field of another plugin comes with its plugin's name and no `options`.
- `required`: whether an entry needs it; a date field can't be required (Moodle's form for it has no such setting).
- `options`: the type's own settings, below. An empty list for a database without fields.

### Field options {#field-options}

Each type takes its own options; the others are refused:

| Type | Options |
| --- | --- |
| `menu`, `radiobutton`, `checkbox`, `multimenu` | `choices`: the choices, in order (one per line in Moodle's form) |
| `text` | `autolink`: Moodle links the text where it appears elsewhere in the course |
| `url` | `autolink`: the URL is a link; `linkName`: the link's text instead of the URL; `newWindow`: it opens in a new window |
| `textarea` | `columns`, `rows`: its size; `maxBytes`: the largest file in it |
| `file` | `maxBytes`: the largest file |
| `picture` | `width`, `height`: in the single view, `listWidth`, `listHeight`: in the list view, in pixels (none is the image's own size); `maxBytes` |
| `latlong` | `services`: the map services coordinates link to, by Moodle's names (`"Google Maps"`, `"Google Earth"`, `"Geabios"`, `"OpenStreetMap"`, `"Multimap"`); `kmlLabel`: how Google Earth's KML files label entries, `"entry"` (their number), `"coordinates"` or a text field's id |
| `number`, `date` | none |

`maxBytes` is in bytes, 0 for the site's or course's limit; a file or image field takes one of the sizes its form offers (1048576 for 1 MB…), a text area any.

## addDatabaseField

Adds a field through Moodle's form for its type, as "Create a field" does.

```ts
function addDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, field: DatabaseFieldInput): Promise<{ changed: string; fieldId: number; fields: DatabaseField[] }>;

interface DatabaseFieldInput {
  type: DatabaseFieldType;
  name: string;
  description?: string;
  required?: boolean;
  options?: DatabaseFieldOptions;
}
```

- `name`: unique in the database; templates name the field by it (`[[name]]`).
- Returns the new field's id and every field afterwards.

Templates left at Moodle's default show the new field at once; Moodle appends it to a saved single, add entry or RSS template that has no `##otherfields##` tag, not to the list template. Throws `MoodleError` (`invalid-input`) before anything changes for a type that isn't Moodle's core, an option the type doesn't take, a choice field without choices, a required date or a size that isn't a whole number; `DatabaseError` with Moodle's reason when it refuses the field (a name the database already has, a maximum size its form doesn't offer).

## editDatabaseField

Changes a field through its edit form: what `changes` leaves out stays as it is, its options one by one.

```ts
function editDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, fieldId: number, changes: DatabaseFieldChanges): Promise<{ changed: string; fields: DatabaseField[] }>;

interface DatabaseFieldChanges {
  name?: string;
  description?: string;
  required?: boolean;
  options?: DatabaseFieldOptions;
}
```

Renaming a field renames its tag in the templates, as Moodle does. Its type can't change: delete it and add another. Throws `MoodleError` (`not-found`) when the database has no such field.

## deleteDatabaseField

Deletes a field, as its delete action confirmed does: what entries have in it goes too, and its tags leave the templates.

```ts
function deleteDatabaseField(context: BrowserContext, siteUrl: string, activityId: number, fieldId: number): Promise<{ changed: string; fields: DatabaseField[] }>;
```

## databaseTemplates

A database's templates, as its templates page shows them.

```ts
function databaseTemplates(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabaseTemplates>;

type DatabaseTemplates = Record<DatabaseTemplate, string>;
type DatabaseTemplate = "list" | "listHeader" | "listFooter" | "single" | "add" | "search" | "rss" | "rssTitle" | "css" | "js";
```

- `listHeader`, `list` (repeated for each entry) and `listFooter`: the list view; `single`: one entry; `add`: the add entry form; `search`: the advanced search; `rssTitle` and `rss`: the RSS feed; `css` and `js`: the database's own CSS and JavaScript.
- A template never saved gives Moodle's default for the fields it has; an empty header, footer, RSS title, CSS or JavaScript stays empty.

Moodle has no templates for a database without fields: `DatabaseError` until it has one.

## setDatabaseTemplate

Saves one template as it is, without Moodle's HTML editor in between (it would rewrite the HTML), as the templates page's Save does.

```ts
function setDatabaseTemplate(context: BrowserContext, siteUrl: string, activityId: number, template: DatabaseTemplate, html: string | null): Promise<{ changed: string; templates: DatabaseTemplates }>;
```

- Fields go in as `[[name]]`, Moodle's other tags as `##tag##` (`##edit##`, `##more##`, `##user##`…; the templates page lists them).
- `null` resets the template to Moodle's default; for `list`, its header and footer stay.
- Returns every template afterwards.

Throws `DatabaseError` when the database has no fields yet, or when Moodle doesn't keep the template: it says it saved an add entry template with a field's tag twice, and keeps the old one.

## databasePresets

The presets the database can be given: Moodle's own (image gallery, journal, proposals, resources) and those people saved on the site that the person can see.

```ts
function databasePresets(context: BrowserContext, siteUrl: string, activityId: number): Promise<DatabasePreset[]>;

interface DatabasePreset {
  id: string;
  name: string;
  description: string;
  userId?: number;
}
```

`id` is what `applyDatabasePreset` takes, Moodle's `<user id>/<short name>`: `"0/imagegallery"` for Moodle's own, with no `userId`.

## applyDatabasePreset

Gives the database a preset, as "Use this preset" and "Apply preset" do.

```ts
function applyDatabasePreset(context: BrowserContext, siteUrl: string, activityId: number, presetId: string): Promise<{ changed: string; fields: DatabaseField[] }>;
```

The preset's fields are added; a field with the same name and type as one of the preset's is kept, with what entries have in it, and every other field is deleted with its content. The preset's templates replace the database's; its other settings stay. Returns the fields afterwards. Throws `MoodleError` (`not-found`) for a preset `databasePresets` doesn't list.

## Entries

Moodle's services for entries (`mod_data_get_entries`, `mod_data_add_entry`…) are only for its mobile app: called with the person's session they answer `servicenotavailable`. The driver works entries through the pages a person uses: the list (`mod/data/view.php`) gives them in its own order, search and paging; each entry's single view gives its author, dates and approval; its edit form (`mod/data/edit.php`) gives and takes its values by field id, so it works in any interface language; `export.php` and `import.php` move them as CSV. Every function throws `NotADatabaseError` when the id isn't a database, `DatabaseError` when Moodle refuses the person (naming the capability it takes) and `NotLoggedInError` when there's no session.

### databaseEntries

A database's entries, in its list's order (the person's sort, or the database's), with what the person can see of each.

```ts
function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: DatabaseEntryOptions): Promise<DatabaseEntry[]>;
function databaseEntries(context: BrowserContext, siteUrl: string, activityId: number, options: DatabaseEntryOptions & { limit: number }): Promise<ListPage<DatabaseEntry>>;

interface DatabaseEntryOptions {
  search?: string;
  limit?: number;
  offset?: number;
}

interface DatabaseEntry {
  id: number;
  author?: { userId: number; name?: string };
  created?: string;
  modified?: string;
  approved: boolean;
  values?: DatabaseEntryField[];
}

interface DatabaseEntryField {
  fieldId: number;
  name?: string;
  value: string | string[] | DatabaseEntryFile[];
}

interface DatabaseEntryFile {
  name: string;
  url?: string;
}
```

- `search`: Moodle's simple search, entries with that text in any field or in their author's name.
- `limit` and `offset`: a page of them (see [Long lists](../concepts/calling-functions.md#long-lists)), read from the list's pages that hold it at the person's entries per page.
- `author`, `created`, `modified`, `approved`: from what Moodle's tags write in the single template (`##user##`, `##timeadded##`, `##timemodified##`, `##approvalstatus##` and the entry's actions): Moodle's default templates and its presets have them; a template without them leaves them out. `approved` is false while the entry waits for approval.
- `values`: each field's value, read from the entry's edit form, so only for entries the person can edit: all of them with `mod/data:manageentries` (teachers), their own for a student while Moodle lets them change it. A short text, number, dropdown list, radio buttons, URL or text area (HTML) is text; a date is `"YYYY-MM-DD"`; checkboxes and a multi-select list give their choices; coordinates are `[latitude, longitude]`, and a URL field that asks for a link text `[url, text]`; a file or image field gives its files, with the URL the single view shows. `name` comes from the form's labels; a date field outside Moodle's default add entry template has none.

Entries waiting for approval show only to their authors and to those who can approve. Moodle's list tells entries apart by their links (`##actionsmenu##`, `##more##`, `##moreurl##`): a list template without any of them gives `DatabaseError`. Each entry costs two page reads (its single view and its edit form), so use `limit` on big databases.

### addDatabaseEntry

Adds an entry through the database's "Add entry" form, as the person would.

```ts
function addDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, values: DatabaseEntryValues): Promise<{ changed: string; entryId: number }>;

type DatabaseEntryValues = Record<string, DatabaseEntryInput>;
type DatabaseEntryInput = string | number | Date | string[] | number[] | null;
```

- `values`: by field id (`"32"`) or name (`"Title"`). Text or a number for a short text, number, URL, text area (HTML), dropdown list or radio buttons; a `Date` or `"YYYY-MM-DD"` for a date; the choices for checkboxes and a multi-select list; `[latitude, longitude]` for coordinates; a local file's absolute path for a file or image field (it goes up to the field's draft area, as the file picker does), `null` to leave it empty.
- Fields left out stay as the form has them: a date field's form starts at today, and Moodle saves it.
- Returns the new entry's id.

Throws `MoodleError` (`invalid-input`) before anything is saved for a field the form hasn't (naming the fields it has) and a value it doesn't take (naming what it offers); `DatabaseError` with Moodle's messages when it refuses the entry (a required field without a value…), and when it refuses the person: adding takes `mod/data:writeentry`, within the database's dates and its limit of entries. An entry of someone who can't approve waits for approval when the database asks for it.

### editDatabaseEntry

Changes an entry through its edit form: what `values` leaves out stays as it is, files included.

```ts
function editDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, values: DatabaseEntryValues): Promise<{ changed: string; entryId: number }>;
```

`values` as for `addDatabaseEntry`; a file or image field's new file replaces the one it had. Throws as `addDatabaseEntry` does, and `DatabaseError` when Moodle doesn't let the person edit it: someone else's entry takes `mod/data:manageentries`, and authors change theirs only while Moodle lets them (not once approved, unless the database allows it).

### deleteDatabaseEntry

Deletes an entry, as its Delete action confirmed does: its values and files go with it.

```ts
function deleteDatabaseEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<{ changed: string }>;
```

Throws `DatabaseError` when Moodle doesn't delete it: the database has no such entry, or the person can't (someone else's takes `mod/data:manageentries`; authors delete theirs while Moodle lets them change it).

### setDatabaseEntryApproved

Approves an entry, or takes its approval back, as its Approve and Undo approval actions do.

```ts
function setDatabaseEntryApproved(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, approved: boolean): Promise<{ changed: string; approved: boolean }>;
```

Throws `DatabaseError` when Moodle doesn't do it: the person lacks `mod/data:approve`, or the database has no such entry.

### exportDatabaseEntries

Exports the entries to a CSV file, as the "Export entries" page does with a comma between values.

```ts
function exportDatabaseEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options?: DatabaseExportOptions): Promise<{ file: string; entries: number }>;

interface DatabaseExportOptions {
  userDetails?: boolean;
  times?: boolean;
  approval?: boolean;
}
```

- `file`: an absolute path; a file already there is replaced.
- A column per field Moodle exports, by the field's name: a date as Moodle's timestamp, an image or file field by its file's name (the files themselves go only in Moodle's zip, which the driver doesn't ask for); Moodle adds a tags column when tags are on.
- `userDetails`: the author's full name, username and email (it takes `mod/data:exportuserinfo`); `times`: when each entry was added and changed, as Moodle writes dates; `approval`: whether each is approved, for a database that asks for approval.
- Every entry of the person's group, approved or not. Returns the file and how many entries it holds.

Throws `DatabaseError` when Moodle refuses the export: it takes `mod/data:viewalluserpresets` (Moodle's export capability, which teachers have), and a database with fields; and when `userDetails` is asked without `mod/data:exportuserinfo`.

### importDatabaseEntries

Imports entries from a CSV file, as the "Import entries" page does.

```ts
function importDatabaseEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options?: { delimiter?: "comma" | "semicolon" | "tab" | "colon" }): Promise<{ changed: string; added: number }>;
```

- `file`: an absolute path to a UTF-8 CSV whose first row names the fields, as `exportDatabaseEntries` writes it. Moodle takes the user, time, approval and tags columns of its own export or skips them: a `Username` column makes that user the author, an `Approved` column sets the approval.
- `delimiter`: between values, a comma unless given.
- Returns how many entries Moodle added.

Throws `DatabaseError` when Moodle refuses the person (it takes `mod/data:manageentries`) or the file (a column that isn't a field…, with Moodle's message).

## Example

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.
const activityId = 52;

await moodle.addDatabaseField(activityId, { type: "text", name: "Title", required: true });
await moodle.addDatabaseField(activityId, { type: "menu", name: "Colour", options: { choices: ["Red", "Blue"] } });
await moodle.addDatabaseField(activityId, { type: "date", name: "Seen on" });
const { fields } = await moodle.addDatabaseField(activityId, { type: "picture", name: "Photo", options: { width: 320, listWidth: 80 } });
console.log(fields.map((f) => `${f.id} ${f.name} (${f.type})`).join("\n"));

await moodle.setDatabaseTemplate(activityId, "list", '<div class="entry">[[Title]]: [[Colour]], [[Seen on]] [[Photo]] ##more##</div>');
const templates = await moodle.databaseTemplates(activityId);
console.log(templates.single);

const { entryId } = await moodle.addDatabaseEntry(activityId, { Title: "A robin", Colour: "Red", "Seen on": "2026-10-17", Photo: "/home/ana/robin.jpg" });
await moodle.setDatabaseEntryApproved(activityId, entryId, true);
for (const entry of await moodle.databaseEntries(activityId, { search: "robin" })) {
  console.log(entry.id, entry.author?.name, entry.approved, entry.values?.map((v) => `${v.name}: ${JSON.stringify(v.value)}`).join(", "));
}
await moodle.exportDatabaseEntries(activityId, "/home/ana/sightings.csv", { times: true });
```

## Data categories

The setup functions are `course-content`: `databaseFields`, `addDatabaseField`, `editDatabaseField`, `deleteDatabaseField`, `databaseTemplates`, `setDatabaseTemplate`, `databasePresets` and `applyDatabasePreset`. Deleting a field, or applying a preset, also deletes what entries had in the fields that go. Of the entries: `databaseEntries` and `exportDatabaseEntries` are `others-personal` (others' entries, and their names); `addDatabaseEntry` is `course-content`; `editDatabaseEntry`, `deleteDatabaseEntry`, `setDatabaseEntryApproved` and `importDatabaseEntries` are `course-content` and `others-write` (someone else's entry, or entries in others' names). See [Data categories](../concepts/data-categories.md).
