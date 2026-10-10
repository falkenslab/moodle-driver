// What a method returned, for a person at a terminal (tables and key-value lines) or for a script (JSON).

const MAX_CELL = 48;

const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
const isScalar = (value: unknown) => value === null || value === undefined || ["string", "number", "boolean"].includes(typeof value) || value instanceof Date;

function short(text: string, max = MAX_CELL): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function scalarText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.every(isScalar) ? value.map(scalarText).join(", ") : `[${value.length}]`;
  if (isPlainObject(value)) return JSON.stringify(value);
  return String(value);
}

/** Rows of objects as a table: a column per field, nested values summarized. */
function table(rows: Record<string, unknown>[]): string {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cells = rows.map((row) => columns.map((column) => short(scalarText(row[column]))));
  const widths = columns.map((column, i) => Math.max(column.length, ...cells.map((row) => row[i]!.length)));
  const line = (values: string[]) => values.map((value, i) => value.padEnd(widths[i]!)).join("  ").trimEnd();
  return [line(columns), line(widths.map((w) => "-".repeat(w))), ...cells.map(line)].join("\n");
}

function keyValues(object: Record<string, unknown>): string {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined);
  const width = Math.max(0, ...entries.filter(([, v]) => !isNested(v)).map(([key]) => key.length));
  const lines: string[] = [];
  const blocks: string[] = [];
  for (const [key, value] of entries) {
    if (isNested(value)) blocks.push(`${key}:\n${indent(human(value))}`);
    else lines.push(`${key.padEnd(width)}  ${short(scalarText(value), 100)}`);
  }
  return [...(lines.length > 0 ? [lines.join("\n")] : []), ...blocks].join("\n\n");
}

const isNested = (value: unknown) => (Array.isArray(value) && value.some((item) => !isScalar(item))) || (isPlainObject(value) && Object.values(value).some((v) => !isScalar(v)));
const indent = (text: string) => text.split("\n").map((line) => `  ${line}`).join("\n");

/** A value as a person reads it at a terminal. */
export function human(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (isScalar(value)) return scalarText(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)";
    if (value.every(isPlainObject)) return table(value);
    return value.map((item) => (isScalar(item) ? scalarText(item) : human(item))).join("\n");
  }
  const object = value as Record<string, unknown>;
  // A write says first what it did.
  if (typeof object.changed === "string") {
    const { changed, ...rest } = object;
    const after = Object.keys(rest).length > 0 ? `\n\n${keyValues(rest)}` : "";
    return `✔ ${changed}${after}`;
  }
  return keyValues(object);
}

/** What the command prints for a result: JSON for scripts, else for a person. */
export function render(value: unknown, json: boolean): string {
  if (json) return JSON.stringify(value ?? null, null, 2);
  return human(value);
}
