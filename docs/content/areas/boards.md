# Boards

Board activities (module `board`, the Brickfield plugin mod_board, which a site must have installed), as teachers set them up: a board's columns read, with how many notes each has, and set, added, renamed, locked and removed. Create the board itself with `createActivity({ type: "board", … })` (see [Activities and sections](activities.md)): it comes with three columns titled "Heading", which `setBoardColumns` replaces.

**Terms:** [board](../reference/glossary.md#board), [course module id](../reference/glossary.md#course-module-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

The driver reads the board's page for its instance id (the call that starts the board's script names it), then works as the board's page does: the plugin's AJAX services read the board and its settings, lock and delete columns, and its own column forms (`column_create_ajax.php`, `column_update_ajax.php`, which have no service) add and rename them. It works in any interface language. Every function throws `NotABoardError` when the id isn't a board the person can open, `BoardError` when Moodle refuses (with Moodle's message and the capability it takes) and `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)). Changing columns takes `mod/board:manageboard`, which teachers have.

## boardColumns

A board's columns, in the board's order.

```ts
function boardColumns(context: BrowserContext, siteUrl: string, activityId: number, options?: BoardColumnsOptions): Promise<BoardColumn[]>;

interface BoardColumnsOptions {
  groupId?: number;
  ownerId?: number;
}

interface BoardColumn {
  id: number;
  name: string;
  colour: string;
  locked: boolean;
  notes: number;
}
```

- `colour`: the colour the board paints the column's heading with, `#1B998B`. A column has no colour of its own: the board takes it from the site's list of column colours (the plugin's setting, an administrator's) by the column's id, so the driver reads it and never sets it.
- `locked`: participants can't add notes to the column.
- `notes`: how many notes the column has. For someone who manages the board, every group's and every participant's; for anyone else, the notes they can see. `groupId` counts one group's in a board with groups; `ownerId` one participant's in a board in single-user mode (one board per participant, the same columns on each).
- A board that hides its headers shows those who don't manage it each column's position ("1", "2"…) instead of its name, and so does `boardColumns`.
- Reading the board's page logs a view of it, as opening it does.
- `BoardError` when a board in single-user mode has nobody to show (no participants yet, or an `ownerId` it doesn't offer).

## setBoardColumns

Makes a board's columns these, in this order.

```ts
function setBoardColumns(context: BrowserContext, siteUrl: string, activityId: number, columns: (string | BoardColumnInput)[], options?: BoardColumnRemoval): Promise<BoardColumnsChange>;

interface BoardColumnInput {
  name: string;
  locked?: boolean;
}

interface BoardColumnRemoval {
  deleteNotes?: boolean;
}

interface BoardColumnsChange {
  changed: string;
  columns: BoardColumn[];
}
```

- The board's columns are renamed in place, one by one, the missing ones added at the end and the extra ones removed from the end, as a teacher would do by hand: a renamed column keeps its id and its notes.
- A column is a name, or a name and whether it's locked; without `locked` a column stays as it is (a new one unlocked).
- Names take up to 100 characters (Moodle would cut a longer one); an empty list or an empty name is `invalid-input`.
- Removing a column with notes is refused with `BoardError` before anything changes, unless `deleteNotes`: Moodle deletes its notes, with their comments and ratings, and there's no undo.

## addBoardColumn

Adds a column at the end of a board, as the board's "+" does.

```ts
function addBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, column: BoardColumnInput): Promise<BoardColumnChange>;

interface BoardColumnChange {
  changed: string;
  columnId: number;
  columns: BoardColumn[];
}
```

- `columnId` is the new column's; `columns` the board's afterwards.
- With `locked`, it's locked straight away.

## editBoardColumn

Renames a column, locks or unlocks it, as its menu does.

```ts
function editBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, columnId: number, changes: BoardColumnChanges): Promise<BoardColumnChange>;

interface BoardColumnChanges {
  name?: string;
  locked?: boolean;
}
```

- What isn't given stays; nothing given is `invalid-input`. A change to what the column already is changes nothing, and `changed` says so.
- `BoardError` when the column isn't in the board (take its id from `boardColumns`).

## removeBoardColumn

Removes a column, as its menu does.

```ts
function removeBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, columnId: number, options?: BoardColumnRemoval): Promise<BoardColumnChange>;
```

- A column with notes is refused with `BoardError` unless `deleteNotes`, as in `setBoardColumns`.
- `BoardError` when the column isn't in the board.

## Example

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.
const created = await moodle.createActivity({ courseId: 12, sectionId: 80, type: "board", name: "Retrospective", visibility: "hidden" });
const activityId = created.activityId!;

// Its three "Heading" columns become these, the last one locked.
await moodle.setBoardColumns(activityId, ["Went well", "To improve", { name: "Actions", locked: true }]);

for (const column of await moodle.boardColumns(activityId)) {
  console.log(`${column.name}${column.locked ? " (locked)" : ""}: ${column.notes} notes`);
}

const actions = (await moodle.boardColumns(activityId)).find((column) => column.name === "Actions")!;
await moodle.editBoardColumn(activityId, actions.id, { name: "Next steps", locked: false });
```

## Data categories

`boardColumns` is `course-content` and `others-aggregate` (the columns are the teacher's; the note counts are about everyone's notes, naming no one); `addBoardColumn` and `editBoardColumn` are `course-content`; `setBoardColumns` and `removeBoardColumn` are `course-content` and `others-write`, since removing a column with notes (when asked) deletes participants' notes. See [Data categories](../concepts/data-categories.md).
