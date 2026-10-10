// The command line, read: the command, its positional arguments and `--flags`, each turned into the
// value its parameter takes, by the command table.
import path from "node:path";
import type { CommandSpec, ParamSpec } from "./spec.js";

/** A command line that doesn't fit the command: printed with how to get help, exit status 2. */
export class UsageError extends Error {
  override name = "UsageError";
}

/** The command's own flags, set apart from the arguments. */
export interface GlobalFlags {
  site?: string;
  profile?: string;
  allow?: string;
  json: boolean;
  show: boolean;
  help: boolean;
  version: boolean;
}

const GLOBAL_VALUES = new Set(["site", "profile", "allow"]);
const GLOBAL_SWITCHES = new Set(["json", "show", "help", "version"]);
// Fields that name local files or folders: relative paths are taken from the current folder.
const PATH_FIELDS = new Set(["files", "file", "destDir"]);

export const camel = (name: string) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
export const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** The command named on the line, before any flags are read (they depend on it). */
export function commandName(argv: string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "-h") continue;
    if (token.startsWith("--")) {
      const name = camel(token.slice(2).split("=")[0]!);
      if (GLOBAL_VALUES.has(name) && !token.includes("=")) i++;
      continue;
    }
    return token;
  }
  return undefined;
}

/** The command for a name as typed: camelCase, kebab-case or any case (`login` is `logIn`). */
export function findCommand(commands: readonly CommandSpec[], typed: string): CommandSpec | undefined {
  const key = typed.replace(/-/g, "").toLowerCase();
  return commands.find((c) => c.name.toLowerCase() === key);
}

/** Splits the line into the global flags, the positional arguments and the command's flags. */
export function splitLine(argv: string[], command: CommandSpec | undefined) {
  const switches = new Set([...GLOBAL_SWITCHES, ...(command?.options?.fields ?? []).filter((f) => f.value.kind === "boolean").map((f) => f.name)]);
  const global: GlobalFlags = { json: false, show: false, help: false, version: false };
  const positionals: string[] = [];
  const flags = new Map<string, string[]>();
  let commandSeen = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "-h") {
      global.help = true;
      continue;
    }
    if (!token.startsWith("--") || token === "--") {
      if (!commandSeen) commandSeen = true;
      else positionals.push(token);
      continue;
    }
    const [rawName, inline] = splitOnce(token.slice(2), "=");
    let name = camel(rawName);
    let value: string | undefined = inline;
    if (name.startsWith("no") && /^no[A-Z]/.test(name) && switches.has(name[2]!.toLowerCase() + name.slice(3))) {
      name = name[2]!.toLowerCase() + name.slice(3);
      value = "false";
    }
    if (value === undefined) {
      if (switches.has(name)) value = "true";
      else {
        const next = argv[i + 1];
        if (next === undefined) throw new UsageError(`--${kebab(name)} needs a value.`);
        value = next;
        i++;
      }
    }
    if (GLOBAL_VALUES.has(name)) (global as unknown as Record<string, string>)[name] = value;
    else if (GLOBAL_SWITCHES.has(name)) (global as unknown as Record<string, boolean>)[name] = value !== "false";
    else flags.set(name, [...(flags.get(name) ?? []), value]);
  }
  return { global, positionals, flags };
}

function splitOnce(text: string, separator: string): [string, string | undefined] {
  const at = text.indexOf(separator);
  return at < 0 ? [text, undefined] : [text.slice(0, at), text.slice(at + 1)];
}

/** One value typed on the line, as its parameter takes it. */
export function convert(raw: string[], spec: ParamSpec, cwd: string): unknown {
  const label = spec.name;
  const one = raw[raw.length - 1]!;
  const local = (p: string) => (PATH_FIELDS.has(spec.name) ? path.resolve(cwd, p) : p);
  switch (spec.value.kind) {
    case "number": {
      const n = Number(one);
      if (one.trim() === "" || !Number.isFinite(n)) throw new UsageError(`${label} must be a number, not "${one}".`);
      return n;
    }
    case "boolean":
      if (["true", "1", "yes"].includes(one)) return true;
      if (["false", "0", "no"].includes(one)) return false;
      throw new UsageError(`${label} must be true or false, not "${one}".`);
    case "date": {
      const date = new Date(one);
      if (Number.isNaN(date.getTime())) throw new UsageError(`${label} must be a date (2026-11-30, or 2026-11-30T18:00:00Z), not "${one}".`);
      return date;
    }
    case "enum":
      if (!spec.value.values.includes(one)) throw new UsageError(`${label} must be one of ${spec.value.values.join(", ")}, not "${one}".`);
      return one;
    case "numbers":
      return raw.flatMap((r) => r.split(",")).map((r) => convert([r], { ...spec, value: { kind: "number" } }, cwd));
    case "strings":
      return raw.flatMap((r) => r.split(",")).map((r) => local(r.trim()));
    case "json":
      try {
        return JSON.parse(one);
      } catch {
        throw new UsageError(`${label} must be JSON (for example '{"a":1}' or '[1,2]'), not ${one}.`);
      }
    default:
      return local(one);
  }
}

// A field of an open options object (a service's arguments): JSON when it reads as JSON, else text.
function loose(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/** The arguments the method is called with, from the positional values and the flags. */
export function methodArguments(command: CommandSpec, positionals: string[], flags: Map<string, string[]>, cwd: string): unknown[] {
  const args: unknown[] = [];
  command.params.forEach((param, i) => {
    const raw = positionals[i];
    if (raw === undefined) {
      if (!param.optional) throw new UsageError(`${kebab(command.name)} needs <${param.name}>.`);
      args.push(undefined);
    } else args.push(convert([raw], param, cwd));
  });
  if (positionals.length > command.params.length) {
    throw new UsageError(`${kebab(command.name)} takes ${command.params.length} argument${command.params.length === 1 ? "" : "s"}, not ${positionals.length}: ${positionals.slice(command.params.length).join(" ")}.`);
  }
  const options = command.options;
  if (!options) {
    if (flags.size > 0) throw new UsageError(`${kebab(command.name)} takes no options: --${[...flags.keys()].map(kebab).join(", --")}.`);
    return trimTrailingUndefined(args);
  }
  let object: Record<string, unknown> = {};
  const whole = flags.get("json");
  if (whole) {
    const parsed = loose(whole[whole.length - 1]!);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new UsageError(`--json must be a JSON object with ${options.name}.`);
    object = { ...(parsed as Record<string, unknown>) };
  }
  for (const [name, raw] of flags) {
    if (name === "json") continue;
    const field = options.fields.find((f) => f.name === name);
    if (field) object[name] = convert(raw, field, cwd);
    else if (options.open) object[name] = loose(raw[raw.length - 1]!);
    else {
      const known = options.fields.map((f) => `--${kebab(f.name)}`).join(", ");
      throw new UsageError(`${kebab(command.name)} has no option --${kebab(name)}${known ? `; its options are ${known}` : ""}.`);
    }
  }
  const missing = options.fields.filter((f) => !f.optional && !(f.name in object));
  if (missing.length > 0 && (!options.optional || Object.keys(object).length > 0)) {
    throw new UsageError(`${kebab(command.name)} needs ${missing.map((f) => `--${kebab(f.name)}`).join(", ")}.`);
  }
  if (Object.keys(object).length > 0 || !options.optional) args.push(object);
  return trimTrailingUndefined(args);
}

function trimTrailingUndefined(args: unknown[]): unknown[] {
  while (args.length > 0 && args[args.length - 1] === undefined) args.pop();
  return args;
}
