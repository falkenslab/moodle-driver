# Blocks

This area works the blocks on a course's page, the column beside its sections: reading them (`courseBlocks`), adding one (`addBlock`), changing its configuration (`configureBlock`), moving it (`moveBlock`) and deleting it (`deleteBlock`). The usual one is a text block (type `html`, "Text" in Moodle's interface) with a welcome or links; other types are Moodle's own (upcoming events, recent activity, latest announcements…). Anyone in the course reads the blocks the page shows them; changing them takes `moodle/site:manageblocks` in the course, which editing teachers have by default, and adding one also `block/<type>:addinstance`.

**Terms:** [block](../reference/glossary.md#block).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## How blocks work in Moodle

A block sits in a region of the page, and its weight orders it there (lower comes first). Boost, Moodle's default theme, gives course pages one region, `side-pre`, the block drawer; other themes may have more: Classic gives them `side-pre` and `side-post`, the left and right columns (as on Moodle 4.5). Blocks are changed in editing mode: "Add a block", and each block's actions menu (configure, move, hide, delete). A block can be hidden from students; only whom can edit the blocks see it then.

Moodle has no service open to AJAX that lists a course's blocks (`core_block_get_course_blocks` is for the mobile app), so the driver reads them from the course page, and changes them as its editing mode does: the block actions on the course page (`bui_addblock`, `bui_moveid`, `bui_deleteid`) and each block's configure form (`bui_editid`). The block types the page offers come from `core_block_fetch_addable_blocks`, the service the "Add a block" dialog calls. Editing mode is a setting of the person's session: the functions turn it on for the work and back off afterwards, when it was off, so the person's own tab finds the course as they left it.

## CourseBlock

The blocks `courseBlocks` lists and the writes return:

```ts
interface CourseBlock {
  id: number;
  type: string;
  title: string;
  region: string;
  weight?: number;
  visible: boolean;
  content?: string;
}
```

- `id`: the block instance's id, what the other functions take.
- `type`: the block's plugin name without `block_`: `html` for a text block, `calendar_upcoming`, `recent_activity`…
- `title`: its title as the page shows it; for a text block, the title it was given (`""` for none, though the page shows a placeholder in editing mode).
- `region`: the region it's in (`side-pre`).
- `weight`: its weight in the region, from its configure form; only for whom can edit the course's blocks.
- `visible`: false for a block hidden from students.
- `content`: a text block's content, HTML as the page shows it, its files as `pluginfile.php` URLs (`downloadFile` saves them with the session).

## courseBlocks

The blocks on a course's page, in each region's order.

```ts
function courseBlocks(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseBlock[]>;
```

Whom can edit the course's blocks get them all, hidden and empty ones too, with their weights: the page is read in editing mode, and each block's configure form gives its weight. Others get the blocks the page shows them, without weights. It throws `BlockError` when the course page can't be opened (no such course, or the person isn't in it).

## addBlock

Adds a block to the course's page, as "Add a block" does, and returns it.

```ts
function addBlock(context: BrowserContext, siteUrl: string, courseId: number, block: NewBlock): Promise<{ changed: string; block: CourseBlock }>;

interface NewBlock {
  type: string;
  region?: string;
  title?: string;
  content?: string;
  embed?: string[];
}
```

- `type`: the block type, `html` for a text block.
- `region`: one of the page's regions; by default its default one (`side-pre`). Moodle puts the block at the region's end.
- `title`, `content`: a text block's title and HTML content, set through its configure form after adding it.
- `embed`: local files the content names (`<img src="map.png">`), as absolute paths, uploaded and put in it as Moodle's editor does (see [Embedding files in rich text](files.md#embedding-files-in-rich-text)).

It throws `BlockError` when the person can't edit the course's blocks (naming `moodle/site:manageblocks`), when the page doesn't offer the type (not installed or disabled, already there and allowed once, as upcoming events is, or the person lacks `block/<type>:addinstance`; the message lists the types it offers), or for a region the page doesn't have. A title or content for a type whose form has no such field is `FormError`, and the block is taken off again.

## configureBlock

Changes a block's configuration through its configure form, and returns the block afterwards.

```ts
function configureBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number, changes: BlockChanges): Promise<{ changed: string; block: CourseBlock }>;

interface BlockChanges {
  title?: string;
  content?: string;
  embed?: string[];
  settings?: Record<string, FieldValue>;
}
```

- `title`, `content`, `embed`: a text block's, as in `addBlock` (the form's `config_title` and `config_text`).
- `settings`: any other field of the block's form by its name, as `setFields` takes them: `bui_visible: "0"` hides the block from students; other types' own fields start with `config_`.

It throws `BlockError` when the page has no such block or the person can't edit its blocks, and `FormError` naming a field the form doesn't have, or Moodle's reason when it refuses the form.

## moveBlock

Moves a block to a region and a weight in it, as the block's move action does, and returns it.

```ts
function moveBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number, to: { region?: string; weight?: number }): Promise<{ changed: string; block: CourseBlock }>;
```

- `region`: the region to move it to; by default the one it's in.
- `weight`: a whole number, lower first; Moodle shifts the blocks around it to make room. Without one, the block goes after the region's other blocks.

It throws `BlockError` when the page has no such block or region (Boost's course pages have only `side-pre`), or the person can't edit its blocks.

## deleteBlock

Deletes a block from the course's page, as its delete action does once confirmed.

```ts
function deleteBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number): Promise<{ changed: string }>;
```

It throws `BlockError` when the page has no such block, or the person can't delete it (it takes `moodle/site:manageblocks`, and `block/<type>:addinstance` for most types).

## Example

A teacher gives a course a welcome block with a map, puts it first, and later changes its text.

```ts
import { BlockError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const { block } = await moodle.addBlock(3, { type: "html", title: "Welcome", content: '<p>Start with the introduction. <img src="map.png" alt="Course map"></p>', embed: ["/home/ana/course/map.png"] });
  await moodle.moveBlock(3, block.id, { weight: -10 });
  await moodle.configureBlock(3, block.id, { content: '<p>Start with <a href="https://moodle.org/">the guide</a>.</p>' });

  for (const b of await moodle.courseBlocks(3)) console.log(b.id, b.type, b.title, b.weight);
} catch (error) {
  if (error instanceof BlockError) console.log(error.message);
  else throw error;
}
```

## Data categories

From `DATA_CATEGORIES` (see [Data categories](../concepts/data-categories.md)):

- `courseBlocks`, `addBlock`, `configureBlock`, `moveBlock`, `deleteBlock`: `course-content`.
