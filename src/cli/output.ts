// What a method returned, for a person at a terminal (tables and key-value lines) or for a script (JSON).

const MAX_CELL = 48;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
const isScalar = (value: unknown) => value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value) || value instanceof Date;

function short(text: string, max = MAX_CELL): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** What names a thing: the first of these fields it has, else its id. */
const NAME_FIELDS = ["name", "shortname", "fullName", "fullname", "title", "id"];
function nameOf(object: Record<string, unknown>): string | undefined {
  const field = NAME_FIELDS.find((key) => (typeof object[key] === "string" && object[key] !== "") || typeof object[key] === "number");
  return field === undefined ? undefined : String(object[field]);
}

function scalarText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.every(isScalar) ? value.map(scalarText).join(", ") : `[${value.length}]`;
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
}

/** A table's cell: a thing, or a list of things, by their names (a participant's roles, a deadline's course). */
function cellText(value: unknown): string {
  if (isPlainObject(value)) return nameOf(value) ?? scalarText(value);
  if (Array.isArray(value) && !value.every(isScalar)) {
    const names = value.map((item) => (isPlainObject(item) ? nameOf(item) : isScalar(item) ? scalarText(item) : undefined));
    return names.every((name) => name !== undefined) ? names.join(", ") : scalarText(value);
  }
  return scalarText(value);
}

const ISO_DATE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})(?:\.\d+)?Z$/;
/** An ISO date in UTC without its milliseconds and `Z`, and its seconds when they're 0: `2026-10-22 23:00`. */
const narrowDate = (text: string) => text.replace(ISO_DATE, (_, day: string, time: string, seconds: string) => `${day} ${time}${seconds === ":00" ? "" : seconds}`);

/** Columns that tell rows apart: kept the longest. */
const KEY_COLUMNS = ["id", "userId", "activityId", "name", "fullName", "fullname", "title"];
/** A column with a cell longer than this holds long text (a sentence, a description): among the first to go. */
const LONG_CELL = 24;

/** Text as lines of at most `width` columns, broken between words. */
function wrap(text: string, width: number): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...lines, line].join("\n");
}

/**
 * Rows of objects as a table: a column per field, nested values summarized. Given the terminal's
 * `width`, a table wider than it shortens its dates, then leaves out columns until it fits (empty ones
 * first, then long texts and URLs, then the rest from the last; the ids and names last), saying which.
 */
function table(rows: Record<string, unknown>[], width?: number): string {
  let columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  let cells = rows.map((row) => columns.map((column) => short(cellText(row[column]))));
  const widthsOf = () => columns.map((column, i) => Math.max(column.length, ...cells.map((row) => row[i]!.length)));
  const total = () => widthsOf().reduce((sum, w) => sum + w, 0) + 2 * (columns.length - 1);
  const notes: string[] = [];
  const dated = new Set<string>();

  if (width !== undefined && total() > width) {
    const narrow = cells.map((row) => row.map(narrowDate));
    columns.forEach((column, c) => {
      if (narrow.some((row, r) => row[c] !== cells[r]![c])) dated.add(column);
    });
    cells = narrow;
  }
  if (width !== undefined && total() > width) {
    // What goes first: the lower the rank, the sooner; the later in the data, the sooner.
    const rank = (column: string, i: number) => {
      const values = cells.map((row) => row[i]!);
      if (KEY_COLUMNS.includes(column)) return 3;
      if (values.every((v) => v === "")) return 0;
      if (values.some((v) => v.length > LONG_CELL || /^https?:\/\//.test(v))) return 1;
      return 2;
    };
    const order = columns.map((column, i) => ({ column, rank: rank(column, i), i })).sort((a, b) => a.rank - b.rank || b.i - a.i);
    const left = new Set<string>();
    for (const { column } of order) {
      if (total() <= width || columns.length === 1) break;
      const i = columns.indexOf(column);
      left.add(column);
      columns = columns.filter((_, c) => c !== i);
      cells = cells.map((row) => row.filter((_, c) => c !== i));
    }
    const all = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    if (left.size > 0) notes.push(`Left out: ${all.filter((column) => left.has(column)).join(", ")} (--json has every column).`);
  }
  if (columns.some((column) => dated.has(column))) notes.push("Times in UTC.");

  const widths = widthsOf();
  const line = (values: string[]) => values.map((value, i) => value.padEnd(widths[i]!)).join("  ").trimEnd();
  const lines = [line(columns), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)];
  if (notes.length > 0) lines.push("", width === undefined ? notes.join(" ") : wrap(notes.join(" "), width));
  return lines.join("\n");
}

function keyValues(object: Record<string, unknown>, width?: number): string {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined);
  const keyWidth = Math.max(0, ...entries.filter(([, v]) => !isNested(v)).map(([key]) => key.length));
  const lines: string[] = [];
  const blocks: string[] = [];
  for (const [key, value] of entries) {
    if (isNested(value)) blocks.push(`${key}:\n${indent(human(value, width === undefined ? undefined : width - 2))}`);
    else lines.push(`${key.padEnd(keyWidth)}  ${short(scalarText(value), 100)}`);
  }
  return [...(lines.length > 0 ? [lines.join("\n")] : []), ...blocks].join("\n\n");
}

const isNested = (value: unknown) => (Array.isArray(value) && value.some((item) => !isScalar(item))) || (isPlainObject(value) && Object.values(value).some((v) => !isScalar(v)));
/** A `ListPage`: exactly `items` and `more`. */
const isListPage = (object: Record<string, unknown>): object is { items: unknown[]; more: boolean } =>
  Object.keys(object).length === 2 && Array.isArray(object.items) && typeof object.more === "boolean";
const indent = (text: string) => text.split("\n").map((line) => `  ${line}`).join("\n");

/** A value as a person reads it at a terminal `width` columns wide (any width when not given). */
export function human(value: unknown, width?: number): string {
  if (value === undefined || value === null) return "";
  if (isScalar(value)) return scalarText(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (value.every(isPlainObject)) return table(value, width);
    return value.map((item) => (isScalar(item) ? scalarText(item) : human(item, width))).join("\n");
  }
  const object = value as Record<string, unknown>;
  // A page of a long list (`limit`): its items, and a line when there are more.
  if (isListPage(object)) {
    const items = human(object.items, width);
    return object.more ? `${items}\n\n(more after these: ask again with a larger --offset)` : items;
  }
  // A write says first what it did.
  if (typeof object.changed === "string") {
    const { changed, ...rest } = object;
    const after = Object.keys(rest).length > 0 ? `\n\n${keyValues(rest, width)}` : "";
    return `✔ ${changed}${after}`;
  }
  return keyValues(object, width);
}

/** What the command prints for a result: JSON for scripts, else for a person at a terminal `width` columns wide. */
export function render(value: unknown, json: boolean, width?: number): string {
  if (json) return JSON.stringify(value ?? null, null, 2);
  return human(value, width);
}
