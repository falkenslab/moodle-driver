# Glossaries

Glossary activities (module `glossary`), as participants and teachers use them: their entries read, added, changed, deleted and approved, their categories, and their entries exported to and imported from Moodle's XML. Create the glossary itself with `createActivity({ type: "glossary", … })` (see [Activities and sections](activities.md)), with its settings by their form names (`defaultapproval: 0` for entries that wait for a teacher's approval, `displayformat`, `entbypage`…); rate its entries with `rate` (see [Grading](grading.md#rate)).

**Terms:** [glossary](../reference/glossary.md#glossary-activity), [course module id](../reference/glossary.md#course-module-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Of Moodle's glossary services only the one that reads a single entry is open to AJAX (the others are the mobile app's): the driver lists the entries from the glossary's page, reads each one through that service, and writes through the glossary's own pages, the entry form, the delete confirmation, the approval links, the categories, export and import pages, read by their links, fields and data, so it works in any interface language. Every function throws `NotAGlossaryError` when the id isn't a glossary the person can open, `GlossaryError` when Moodle refuses (with Moodle's message and the capability it takes) and `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## glossaryEntries

A glossary's entries, in the glossary's order (by concept), each read in full.

```ts
function glossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options?: GlossaryEntryOptions): Promise<GlossaryEntry[]>;

interface GlossaryEntryOptions {
  letter?: string;
  search?: string;
  pending?: boolean;
  limit?: number;
  offset?: number;
}

interface GlossaryEntry {
  id: number;
  concept: string;
  definition: string;
  aliases: string[];
  categoryIds?: number[];
  authorId: number;
  authorName: string;
  approved: boolean;
  attachments: GlossaryAttachment[];
  created?: string;
  modified?: string;
}

interface GlossaryAttachment {
  name: string;
  url: string;
  size: number;
  mimeType?: string;
}
```

- What the person sees, as on the glossary's page: approved entries and their own waiting for approval. A teacher doesn't see a student's waiting entry there: `pending: true` lists the entries waiting for approval instead, from the approval page, which takes Moodle's capability `mod/glossary:approve` (teachers have it).
- `letter`: the entries whose concept starts with it (one character); `search`: the entries whose concept, aliases or definition hold the words, as the glossary's search with "Search full text" ticked does; it goes with neither `letter` nor `pending`.
- `definition`: HTML, its images' URLs on the site; `attachments`' URLs download with `downloadFile` (see [Files](files.md)).
- `aliases`: the entry's other words (Moodle's "Keyword(s)"), as the glossary's page shows them; the "Entry list" display format shows none, so they come empty there.
- `categoryIds`: the categories the entry is in, read from the glossary's category view. Moodle's default display format, "Simple, dictionary style", has no category view, so there `categoryIds` is left out.
- `limit` and `offset` page the list as every long list does (see [Long lists](../concepts/calling-functions.md#long-lists)), reading only Moodle's pages the window needs.
- An entry the page names no id for is left out: a student's own entry waiting for approval, once Moodle's editing time for it is over, has no link that names it.

## addGlossaryEntry

Adds an entry as the person, through Moodle's entry form.

```ts
function addGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, input: GlossaryEntryInput): Promise<GlossaryEntryChange>;

interface GlossaryEntryInput {
  concept: string;
  definition: string;
  aliases?: string[];
  categoryIds?: number[];
  attachments?: string[];
  embed?: string[];
}

interface GlossaryEntryChange {
  changed: string;
  entryId: number;
  entry?: GlossaryEntry;
}
```

- `definition`: HTML; with `embed`, local files (absolute paths) the HTML names by their file names (`<img src="shot.png">`) are uploaded into it, as [`createActivity`](activities.md) embeds them.
- `attachments`: local files (absolute paths) attached to the entry.
- `categoryIds`: ids from `glossaryCategories`.
- Returns the entry's id and the entry as `glossaryEntries` reads it. A student's entry waits for approval when the glossary asks for it (`changed` says so); a teacher's is approved at once.

Throws `GlossaryError` when the glossary doesn't take entries from the person (it takes `mod/glossary:write`, which students and teachers have unless the glossary's permissions take it away) or a category isn't the glossary's, `FormError` with Moodle's reasons when it refuses the entry (its concept is already there, and the glossary takes no duplicates).

## editGlossaryEntry

Changes an entry through its form: only what's given.

```ts
function editGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, changes: GlossaryEntryChanges): Promise<GlossaryEntryChange>;

type GlossaryEntryChanges = Partial<GlossaryEntryInput>;
```

- `attachments` replaces the entry's attachments; `[]` removes them. `categoryIds: []` takes it out of every category.
- A student changes their own entries while Moodle's editing time lasts (the site's "maximum time to edit posts", 30 minutes by default), or always when the glossary lets them; a teacher (`mod/glossary:manageentries`) changes anyone's.
- An entry saved by someone who can approve it comes out approved, as Moodle saves it.

Throws `GlossaryError` naming the reason when Moodle refuses: someone else's entry, the editing time over, no such entry in the glossary.

## deleteGlossaryEntry

Deletes an entry with its files, as its delete link does after Moodle's confirmation; who may is as for `editGlossaryEntry`.

```ts
function deleteGlossaryEntry(context: BrowserContext, siteUrl: string, activityId: number, entryId: number): Promise<GlossaryEntryChange>;
```

## setGlossaryEntryApproved

Approves an entry waiting for approval, or takes an approval back, as the approval page's approve link and the entry's "Undo approval" do.

```ts
function setGlossaryEntryApproved(context: BrowserContext, siteUrl: string, activityId: number, entryId: number, approved: boolean): Promise<GlossaryEntryChange>;
```

An entry whose approval is taken back waits again, shown only to its author and to who can approve it. Throws `GlossaryError` when the person can't approve (`mod/glossary:approve`) or the glossary shows them no such entry.

## glossaryCategories

A glossary's categories, by id and name, ordered by name.

```ts
function glossaryCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<GlossaryCategory[]>;

interface GlossaryCategory {
  id: number;
  name: string;
}
```

Read from the glossary's category view, or, when its display format has none, from the entry form, which lists them too: `GlossaryError` when the person can't add entries there either.

## addGlossaryCategory

Adds a category, as the glossary's categories page does.

```ts
function addGlossaryCategory(context: BrowserContext, siteUrl: string, activityId: number, category: { name: string; autoLink?: boolean }): Promise<GlossaryCategoryChange>;

interface GlossaryCategoryChange {
  changed: string;
  categoryId: number;
  categories: GlossaryCategory[];
}
```

With `autoLink`, Moodle links the category's name wherever it appears in the course, as it links entries. Throws `GlossaryError` when the person can't manage the categories (`mod/glossary:managecategories`, which teachers have) or one has that name already (Moodle compares names ignoring case).

## exportGlossaryEntries

Saves a glossary's approved entries as Moodle's XML, with their aliases, categories and files, as the glossary's "Export entries" does; Moodle leaves the entries waiting for approval out.

```ts
function exportGlossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, options: { destDir: string }): Promise<DownloadedFile>;
```

`destDir` is an absolute folder; the file is saved under a free name there, never overwriting one, and returned as `downloadFile` returns files. It takes `mod/glossary:export`, which teachers have.

## importGlossaryEntries

Imports the entries of Moodle's XML (as `exportGlossaryEntries` saves it) into the glossary, through its import form.

```ts
function importGlossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, options?: { categories?: boolean }): Promise<GlossaryImport>;

interface GlossaryImport {
  changed: string;
  total: number;
  imported: number;
  rejected: number;
  categoriesAdded?: number;
}
```

- The entries come in as the person's, approved; with `categories`, their categories too, added when the glossary lacks them (`categoriesAdded` counts them).
- Moodle rejects an entry whose concept is already there (when the glossary takes no duplicates) or that has no concept or definition: `rejected` counts them.
- It takes `mod/glossary:import`, which teachers have; `GlossaryError` when Moodle can't read the file.

## Example

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.
const activityId = 61;

const { categoryId } = await moodle.addGlossaryCategory(activityId, { name: "Networks" });
const { entryId } = await moodle.addGlossaryEntry(activityId, {
  concept: "Router",
  definition: "<p>A device that forwards packets between networks.</p>",
  aliases: ["gateway"],
  categoryIds: [categoryId],
});
console.log(`Added entry ${entryId}`);

// The students' entries waiting for approval, approved one by one.
for (const entry of await moodle.glossaryEntries(activityId, { pending: true })) {
  console.log(`${entry.concept}, by ${entry.authorName}`);
  await moodle.setGlossaryEntryApproved(activityId, entry.id, true);
}
```

## Data categories

`glossaryEntries` and `exportGlossaryEntries` are `course-content` and `others-personal` (entries carry their authors and are often students' work); `addGlossaryEntry`, `glossaryCategories`, `addGlossaryCategory` and `importGlossaryEntries` are `course-content`; `editGlossaryEntry`, `deleteGlossaryEntry` and `setGlossaryEntryApproved` are `course-content` and `others-write`, since a teacher changes, deletes or approves someone else's entry with them. See [Data categories](../concepts/data-categories.md).
