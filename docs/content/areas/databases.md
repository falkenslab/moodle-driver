# Databases

Database activities (module `data`), as a teacher sets them up: their fields (one per kind of data an entry holds), their templates (how entries are listed, shown, added and searched) and the site's presets that give a database both at once. Create the database itself with `createActivity({ type: "data", … })` (see [Activities and sections](activities.md)); its entries are added by participants through Moodle's own form, and rated with `rate` (see [Grading](grading.md#rate)).

**Terms:** [database](../reference/glossary.md#database), [course module id](../reference/glossary.md#course-module-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Moodle doesn't open a database's setup to AJAX: everything goes through its fields, templates and presets pages (`mod/data/field.php`, `templates.php`, `preset.php`), read by their fields' names, the fields table's links and its icons, so it works in any interface language. They take Moodle's capability `mod/data:managetemplates`, which editing teachers have. Every function throws `NotADatabaseError` when the id isn't a database, `DatabaseError` when Moodle refuses the person its setup (with Moodle's message) and `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

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
```

## Data categories

Every function here is `course-content`: `databaseFields`, `addDatabaseField`, `editDatabaseField`, `deleteDatabaseField`, `databaseTemplates`, `setDatabaseTemplate`, `databasePresets` and `applyDatabasePreset`. Deleting a field, or applying a preset, also deletes what entries had in the fields that go. See [Data categories](../concepts/data-categories.md).
