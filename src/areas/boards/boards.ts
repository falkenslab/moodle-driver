// A board's columns (mod_board, the Brickfield plugin), read and written as the board's own page does:
// its view (view.php) names the board's instance id, owner and group in the call that starts its
// script; the plugin's AJAX services read the board (mod_board_get_board, mod_board_get_configuration)
// and delete or lock a column (mod_board_delete_column, mod_board_lock_column); a column is added or
// renamed through the plugin's own form scripts (column_create_ajax.php, column_update_ajax.php),
// which answer JSON: the form to show, or that it was saved. There is no service for those two.
// Every piece confirmed empirically (Moodle 5.2, mod_board 1.405.08) with a board without groups;
// group and single-user boards follow the plugin's code, checked against the fake only.
//
// A column's colour isn't the column's: the board's page paints each one with the site's list of
// colours (the plugin's setting column_colours, an administrator's), by the column's id modulo the
// list's length, so it is read and never set here.
import type { BrowserContext } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";
import { siteFetch } from "../../core/http.js";
import { NotLoggedInError, fetchSitePage } from "../../core/session.js";

/** The activity isn't a board (`board`, the mod_board plugin) the person can open, or there's no activity with that id. */
export class NotABoardError extends MoodleError {
  override name = "NotABoardError";
  constructor(message: string) {
    super(message, "not-a-board");
  }
}

/** Moodle refused something in a board: the person can't manage it, the column isn't in it, or it has notes that would be lost. */
export class BoardError extends MoodleError {
  override name = "BoardError";
  constructor(message: string) {
    super(message, "board");
  }
}

/** A column of a board, in the board's order. */
export interface BoardColumn {
  id: number;
  /** Its heading; a board that hides its headers shows those who don't manage it the column's position instead ("1", "2"…), and so does this. */
  name: string;
  /** The colour the board paints its heading with (`#1B998B`): the site's, by the column's id; a column has none of its own. */
  colour: string;
  /** Locked: participants can't add notes to it. */
  locked: boolean;
  /** How many notes it has: in every group and of every owner when the person manages the board, those the person can see otherwise (unless `groupId` or `ownerId` narrow it). */
  notes: number;
}

/** Which notes `boardColumns` counts. */
export interface BoardColumnsOptions {
  /** Only this group's notes, in a board with groups. */
  groupId?: number;
  /** Only this participant's notes, in a board in single-user mode (one board per participant). */
  ownerId?: number;
}

/** A column to add, or as `setBoardColumns` wants it. */
export interface BoardColumnInput {
  /** Its heading: up to 100 characters. */
  name: string;
  /** Locked, so participants can't add notes to it; left as it is (unlocked for a new one) unless given. */
  locked?: boolean;
}

/** A change to a column. */
export interface BoardColumnChanges {
  /** Its new heading: up to 100 characters. */
  name?: string;
  locked?: boolean;
}

/** What removing a column (or setting the columns) may take. */
export interface BoardColumnRemoval {
  /** Remove columns with notes too, their notes (and their comments and ratings) lost with them, as Moodle does; refused otherwise. */
  deleteNotes?: boolean;
}

/** What a change to a column did, its id and the board's columns afterwards. */
export interface BoardColumnChange {
  changed: string;
  columnId: number;
  columns: BoardColumn[];
}

/** What `setBoardColumns` did, and the board's columns afterwards. */
export interface BoardColumnsChange {
  changed: string;
  columns: BoardColumn[];
}

// mod_board's limit on a column's heading (board::LENGTH_COLNAME, the database field's size).
const NAME_LENGTH = 100;
// The plugin's default colours (board::get_default_colours), when the site's setting is unreadable.
const DEFAULT_COLOURS = ["1B998B", "2D3047", "FFFD82", "FF9B71", "E84855", "AF9BB6", "F18F01"];
const MANAGE = "it takes Moodle's capability mod/board:manageboard, which teachers have";

/** The board's page as the driver reads it: its instance id, the owner and group the page opened, and the owners a single-user board lets its managers choose. */
interface BoardPage {
  boardId: number;
  ownerId: number;
  groupId: number;
  owners: number[];
}

/** The settings mod_board_get_configuration gives (a JSON string), as far as the driver uses them. */
interface BoardSettings {
  board: { singleusermode?: number | string };
  isEditor: boolean;
  colours?: string[];
}

interface RawColumn {
  id: number;
  name: string;
  locked: boolean;
  notes: unknown[] | Record<string, unknown>;
}

/** Text with Moodle's HTML entities decoded (get_board escapes a column's name, `&amp;` for `&`: confirmed empirically, Moodle 5.2, mod_board 1.405.08). */
const unescape = (text: string) =>
  text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&");

const decode = (html: string) =>
  unescape(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/** Moodle's message on an error page, from its HTML (`[data-rel="fatalerror"] .errormessage`). */
function errorMessage(html: string): string | undefined {
  if (!html.includes('data-rel="fatalerror"')) return undefined;
  const message = /class="errormessage"[^>]*>([\s\S]*?)<\/(?:p|div)>/.exec(html)?.[1];
  return message === undefined ? "" : decode(message);
}

/**
 * Reads the board's view: the arguments of the call that starts its script (`amd.initialize(boardid,
 * ownerid, groupid)`, from js_call_amd), and the owners its user menu offers (`select[name=ownerid]`).
 * Exported for the tests.
 */
export function readBoardPage(html: string): { boardId?: number; ownerId: number; groupId: number; owners: number[] } {
  const call = /mod_board\/main['"]\],\s*function\s*\(amd\)\s*\{\s*amd\.initialize\(\s*"?(\d+)"?\s*,\s*"?(\d+)"?\s*,\s*"?(\d+)"?\s*\)/.exec(html);
  const select = /<select\b[^>]*\bname="ownerid"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";
  const owners = Array.from(select.matchAll(/<option\b[^>]*\bvalue="(\d+)"/g), (m) => Number(m[1])).filter((id) => id > 0);
  return call ? { boardId: Number(call[1]), ownerId: Number(call[2]), groupId: Number(call[3]), owners } : { ownerId: 0, groupId: 0, owners };
}

async function openBoard(context: BrowserContext, siteUrl: string, activityId: number, ownerId?: number): Promise<BoardPage> {
  const read = async (owner?: number) => {
    const { html } = await fetchSitePage(context, siteUrl, `mod/board/view.php?id=${activityId}${owner ? `&ownerid=${owner}` : ""}`);
    const message = errorMessage(html);
    if (!/<body\b[^>]*\bid="page-mod-board-view"/.test(html) || (message !== undefined && /invalidcoursemodule|invalidaccessparameter/.test(html))) {
      throw new NotABoardError(`Activity ${activityId} isn't a board you can open${message ? ` (Moodle says: ${message})` : ""}: take its id and module ("board") from the course structure.`);
    }
    if (message !== undefined) throw new BoardError(`You can't open board ${activityId} (Moodle says: ${message}).`);
    return readBoardPage(html);
  };
  let page = await read(ownerId);
  // A single-user board opens on nobody for a manager who isn't a participant: the first owner it offers then.
  if (page.boardId === undefined && ownerId === undefined && page.owners.length > 0) page = await read(page.owners[0]);
  if (page.boardId === undefined) {
    throw new BoardError(`Board ${activityId} shows no board${ownerId ? ` for participant ${ownerId}` : ""}: in single-user mode it needs a participant whose board to show (ownerId), and it may have none yet.`);
  }
  return { boardId: page.boardId, ownerId: page.ownerId, groupId: page.groupId, owners: page.owners };
}

async function boardSettings(context: BrowserContext, siteUrl: string, page: BoardPage): Promise<BoardSettings> {
  const { settings } = await callService<{ settings: string }>(context, siteUrl, "mod_board_get_configuration", { id: page.boardId, ownerid: page.ownerId, groupid: page.groupId });
  return JSON.parse(settings) as BoardSettings;
}

function getBoard(context: BrowserContext, siteUrl: string, boardId: number, ownerId: number, groupId: number): Promise<RawColumn[]> {
  return callService<RawColumn[]>(context, siteUrl, "mod_board_get_board", { id: boardId, ownerid: ownerId, groupid: groupId });
}

const noteCount = (column: RawColumn) => (Array.isArray(column.notes) ? column.notes.length : Object.keys(column.notes ?? {}).length);

/** The board's columns, their notes counted as `BoardColumn.notes` says. */
async function readColumns(context: BrowserContext, siteUrl: string, page: BoardPage, settings: BoardSettings, { groupId, ownerId }: BoardColumnsOptions = {}): Promise<BoardColumn[]> {
  const singleUser = Number(settings.board.singleusermode ?? 0) !== 0;
  const colours = settings.colours && settings.colours.length > 0 ? settings.colours : DEFAULT_COLOURS;
  let reads: RawColumn[][];
  if (singleUser) {
    // One board per participant, the same columns on each: a manager's count adds every owner's notes.
    const owners = ownerId !== undefined ? [ownerId] : settings.isEditor && page.owners.length > 0 ? page.owners : [page.ownerId];
    reads = [];
    for (const owner of owners) reads.push(await getBoard(context, siteUrl, page.boardId, owner, 0));
  } else {
    // Group 0 is every group's notes for a manager; the page's group is the person's otherwise.
    reads = [await getBoard(context, siteUrl, page.boardId, 0, groupId ?? (settings.isEditor ? 0 : page.groupId))];
  }
  const first = reads.find((columns) => columns.length > 0) ?? reads[0] ?? [];
  return first.map((column) => ({
    id: Number(column.id),
    name: unescape(String(column.name)),
    colour: `#${colours[Number(column.id) % colours.length]}`,
    locked: Boolean(column.locked),
    notes: reads.reduce((sum, columns) => sum + noteCount(columns.find((c) => Number(c.id) === Number(column.id)) ?? { id: 0, name: "", locked: false, notes: [] }), 0),
  }));
}

/**
 * A board's columns, in the board's order: each one's id, heading, colour, whether it's locked and how
 * many notes it has (every group's and every participant's when the person manages the board; with
 * `groupId` or `ownerId`, that group's or that participant's). Reading the board's page logs a view of
 * it, as opening it does. Throws `NotABoardError` when the activity isn't a board the person can open,
 * `BoardError` when a single-user board has no participant to show.
 */
export async function boardColumns(context: BrowserContext, siteUrl: string, activityId: number, options: BoardColumnsOptions = {}): Promise<BoardColumn[]> {
  const page = await openBoard(context, siteUrl, activityId, options.ownerId);
  return readColumns(context, siteUrl, page, await boardSettings(context, siteUrl, page), options);
}

/** The board's page, its settings and its columns, for a write: refused unless the person manages the board. */
async function forWriting(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ page: BoardPage; settings: BoardSettings; columns: BoardColumn[] }> {
  const page = await openBoard(context, siteUrl, activityId);
  const settings = await boardSettings(context, siteUrl, page);
  if (!settings.isEditor) throw new BoardError(`You can't change board ${activityId}'s columns: ${MANAGE}.`);
  return { page, settings, columns: await readColumns(context, siteUrl, page, settings) };
}

function checkName(name: unknown): string {
  if (typeof name !== "string" || name.trim() === "") throw new MoodleError("A board column needs a name.", "invalid-input");
  // Moodle would cut a longer one silently.
  if (name.trim().length > NAME_LENGTH) throw new MoodleError(`A board column's name takes up to ${NAME_LENGTH} characters: "${name.trim().slice(0, 30)}…" has ${name.trim().length}.`, "invalid-input");
  return name.trim();
}

function findColumn(columns: BoardColumn[], activityId: number, columnId: number): BoardColumn {
  const column = columns.find((c) => c.id === columnId);
  if (!column) throw new BoardError(`Column ${columnId} isn't in board ${activityId}: take its id from boardColumns (${columns.map((c) => c.id).join(", ") || "no columns"}).`);
  return column;
}

/** The hidden fields of a form's HTML, and the error Moodle shows beside a field, if any. */
function readForm(html: string): { fields: Record<string, string>; error?: string } {
  const fields: Record<string, string> = {};
  for (const [input] of html.matchAll(/<input\b[^>]*>/g)) {
    if (!/\btype="hidden"/.test(input)) continue;
    const name = /\bname="([^"]*)"/.exec(input)?.[1];
    if (name) fields[name] = unescape(/\bvalue="([^"]*)"/.exec(input)?.[1] ?? "");
  }
  const error = /class="[^"]*invalid-feedback[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1];
  return error && decode(error) ? { fields, error: decode(error) } : { fields };
}

/**
 * Posts one of the plugin's column forms (column_create_ajax.php, column_update_ajax.php) as its
 * dialog does: an empty post renders it (its hidden fields: the ids, sesskey, the form's own mark),
 * then its fields are posted with the name. Moodle answers JSON: `submitted`, or the form again with
 * its error (confirmed empirically, Moodle 5.2, mod_board 1.405.08).
 */
async function postColumnForm(context: BrowserContext, siteUrl: string, path: string, name: string, activityId: number): Promise<void> {
  const url = new URL(`mod/board/${path}`, siteUrl).href;
  const post = async (body: string) => {
    const response = await siteFetch(context, url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" }, body });
    let answer: { data?: { status?: string; html?: string }; error?: string; errorcode?: string };
    try {
      answer = JSON.parse(response.body) as typeof answer;
    } catch {
      if (/notloggedin|login\/index\.php/.test(response.url + response.body.slice(0, 2000))) throw new NotLoggedInError();
      throw new MoodleError(`Board ${activityId}'s column form answered something that isn't the plugin's (HTTP ${response.status}).`, "unexpected-page");
    }
    if (answer.errorcode === "requireloginerror" || answer.errorcode === "sitepolicynotagreed") throw new NotLoggedInError();
    if (answer.error !== undefined || !answer.data?.status) {
      throw new BoardError(`Moodle refused board ${activityId}'s column (Moodle says: ${String(answer.error ?? "no answer")})${answer.errorcode === "nopermissions" ? `: ${MANAGE}` : ""}.`);
    }
    return answer.data;
  };
  const shown = await post("");
  if (shown.status !== "render") throw new MoodleError(`Board ${activityId}'s column form didn't show (${shown.status}).`, "unexpected-page");
  const { fields } = readForm(shown.html ?? "");
  if (!fields.sesskey) throw new MoodleError(`Board ${activityId}'s column form has no session key: log in again.`, "unexpected-page");
  const sent = await post(new URLSearchParams({ ...fields, name }).toString());
  if (sent.status !== "submitted") {
    const { error } = readForm(sent.html ?? "");
    throw new BoardError(`Moodle didn't save board ${activityId}'s column "${name}"${error ? ` (Moodle says: ${error})` : ""}.`);
  }
}

async function lockColumn(context: BrowserContext, siteUrl: string, columnId: number, locked: boolean): Promise<void> {
  await callService(context, siteUrl, "mod_board_lock_column", { id: columnId, status: locked });
}

/** Adds a column at the end of the board and gives its id, found as the one the board didn't have before. */
async function createColumn(context: BrowserContext, siteUrl: string, activityId: number, page: BoardPage, name: string, before: BoardColumn[]): Promise<number> {
  await postColumnForm(context, siteUrl, `column_create_ajax.php?boardid=${page.boardId}`, name, activityId);
  const after = await getBoard(context, siteUrl, page.boardId, page.ownerId, 0);
  const added = after.map((c) => Number(c.id)).filter((id) => !before.some((c) => c.id === id));
  if (added.length === 0) throw new BoardError(`The column "${name}" was sent, but it doesn't appear in board ${activityId}.`);
  return Math.max(...added);
}

/** Refuses removing columns with notes unless `deleteNotes`: their notes, comments and ratings would go with them. */
function checkRemoval(activityId: number, columns: BoardColumn[], { deleteNotes = false }: BoardColumnRemoval): void {
  if (deleteNotes) return;
  const withNotes = columns.filter((c) => c.notes > 0);
  if (withNotes.length > 0) {
    throw new BoardError(
      `Board ${activityId}'s ${withNotes.map((c) => `column ${c.id} "${c.name}" has ${c.notes} note${c.notes === 1 ? "" : "s"}`).join(", ")}: removing it deletes them (with their comments and ratings); pass deleteNotes to remove it anyway.`,
    );
  }
}

const summary = (columns: BoardColumn[]) => columns.map((c) => `"${c.name}"${c.locked ? " (locked)" : ""}`).join(", ");

/**
 * Adds a column at the end of a board, as the board's "+" does, locked when asked. Gives its id and the
 * board's columns afterwards. Throws `NotABoardError` when the activity isn't a board the person can
 * open, `BoardError` when the person can't manage it (mod/board:manageboard).
 */
export async function addBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, column: BoardColumnInput): Promise<BoardColumnChange> {
  const name = checkName(column?.name);
  const { page, settings, columns } = await forWriting(context, siteUrl, activityId);
  const columnId = await createColumn(context, siteUrl, activityId, page, name, columns);
  if (column.locked) await lockColumn(context, siteUrl, columnId, true);
  const after = await readColumns(context, siteUrl, page, settings);
  return { changed: `Added column ${columnId} "${name}"${column.locked ? ", locked," : ""} to board ${activityId}.`, columnId, columns: after };
}

/**
 * Renames a board's column, locks or unlocks it, as its menu does; what isn't given stays. Gives the
 * board's columns afterwards. Throws `NotABoardError` when the activity isn't a board the person can
 * open, `BoardError` when the column isn't in it or the person can't manage it (mod/board:manageboard).
 */
export async function editBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, columnId: number, changes: BoardColumnChanges): Promise<BoardColumnChange> {
  const name = changes?.name === undefined ? undefined : checkName(changes.name);
  if (name === undefined && changes?.locked === undefined) throw new MoodleError("Nothing to change in the column: give a name or locked.", "invalid-input");
  const { page, settings, columns } = await forWriting(context, siteUrl, activityId);
  const column = findColumn(columns, activityId, columnId);
  const done: string[] = [];
  if (name !== undefined && name !== column.name) {
    await postColumnForm(context, siteUrl, `column_update_ajax.php?id=${columnId}`, name, activityId);
    done.push(`renamed "${column.name}" to "${name}"`);
  }
  if (changes.locked !== undefined && changes.locked !== column.locked) {
    await lockColumn(context, siteUrl, columnId, changes.locked);
    done.push(changes.locked ? "locked" : "unlocked");
  }
  const after = await readColumns(context, siteUrl, page, settings);
  return { changed: done.length > 0 ? `Column ${columnId} of board ${activityId}: ${done.join(", ")}.` : `Column ${columnId} of board ${activityId} was already as asked.`, columnId, columns: after };
}

/**
 * Removes a board's column, as its menu does. A column with notes is refused unless `deleteNotes`:
 * Moodle deletes its notes, their comments and ratings with it, and there's no undo. Gives the board's
 * columns afterwards. Throws `NotABoardError` when the activity isn't a board the person can open,
 * `BoardError` when the column isn't in it, has notes, or the person can't manage it
 * (mod/board:manageboard).
 */
export async function removeBoardColumn(context: BrowserContext, siteUrl: string, activityId: number, columnId: number, options: BoardColumnRemoval = {}): Promise<BoardColumnChange> {
  const { page, settings, columns } = await forWriting(context, siteUrl, activityId);
  const column = findColumn(columns, activityId, columnId);
  checkRemoval(activityId, [column], options);
  await callService(context, siteUrl, "mod_board_delete_column", { id: columnId });
  const after = await readColumns(context, siteUrl, page, settings);
  return { changed: `Removed column ${columnId} "${column.name}" from board ${activityId}${column.notes > 0 ? `, with its ${column.notes} note${column.notes === 1 ? "" : "s"}` : ""}.`, columnId, columns: after };
}

/**
 * Makes a board's columns these, in this order (a name, or a name and whether it's locked): the board's
 * columns renamed in place, one by one, the missing ones added at the end, the extra ones removed from
 * the end, as a teacher would do by hand. A new board comes with three columns titled "Heading", which
 * this replaces. Removing a column with notes is refused before anything changes, unless
 * `deleteNotes`; renaming keeps a column's notes. Gives the board's columns afterwards. Throws
 * `NotABoardError` when the activity isn't a board the person can open, `BoardError` when a column to
 * remove has notes or the person can't manage the board (mod/board:manageboard).
 */
export async function setBoardColumns(context: BrowserContext, siteUrl: string, activityId: number, columns: (string | BoardColumnInput)[], options: BoardColumnRemoval = {}): Promise<BoardColumnsChange> {
  if (!Array.isArray(columns) || columns.length === 0) throw new MoodleError("A board needs at least one column.", "invalid-input");
  const wanted = columns.map((c) => (typeof c === "string" ? { name: checkName(c) } : { name: checkName(c?.name), locked: c.locked }));
  const { page, settings, columns: before } = await forWriting(context, siteUrl, activityId);
  checkRemoval(activityId, before.slice(wanted.length), options);
  let current = before;
  for (const [i, want] of wanted.entries()) {
    const column = before[i];
    if (column) {
      if (want.name !== column.name) await postColumnForm(context, siteUrl, `column_update_ajax.php?id=${column.id}`, want.name, activityId);
      if (want.locked !== undefined && want.locked !== column.locked) await lockColumn(context, siteUrl, column.id, want.locked);
    } else {
      const columnId = await createColumn(context, siteUrl, activityId, page, want.name, current);
      current = [...current, { id: columnId, name: want.name, colour: "", locked: false, notes: 0 }];
      if (want.locked) await lockColumn(context, siteUrl, columnId, true);
    }
  }
  for (const column of before.slice(wanted.length)) await callService(context, siteUrl, "mod_board_delete_column", { id: column.id });
  const after = await readColumns(context, siteUrl, page, settings);
  return { changed: `Board ${activityId}'s columns are now ${summary(after)} (were ${summary(before)}).`, columns: after };
}
