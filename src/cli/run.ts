// The `moodle` command (ADR-012): every method of the Moodle object from a terminal. `run` takes its
// surroundings as arguments, so tests run it against the fake Moodle.
import { ALL_DATA_CATEGORIES, DATA_CATEGORIES, type DataCategory } from "../categories.js";
import type { Moodle, MoodleOptions } from "../client.js";
import { MoodleError } from "../core/errors.js";
import { NotLoggedInError } from "../core/session.js";
import { parseSiteUrl } from "../options.js";
import { UsageError, commandName, findCommand, kebab, methodArguments, splitLine } from "./args.js";
import { COMMANDS } from "./commands.generated.js";
import { defaultProfile, loadConfig, saveConfig } from "./config.js";
import { render } from "./output.js";
import type { CommandSpec } from "./spec.js";

export interface CliDeps {
  createMoodle: (options: MoodleOptions) => Moodle;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Where the command keeps its config and, by default, the browser profiles. */
  configDir: string;
  /** Whether stdout is a terminal: progress and readable output then, JSON to a pipe. */
  interactive: boolean;
  version: string;
}

const firstSentence = (text: string) => (/^.*?\.(\s|$)/.exec(text)?.[0] ?? text).trim().replace(/\.$/, "");

function overview(): string {
  const width = Math.max(...COMMANDS.map((c) => kebab(c.name).length));
  return [
    "moodle: every operation of moodle-driver, from a terminal.",
    "",
    "Usage: moodle <command> [arguments] [--options]",
    "",
    "Start with:  moodle login --site https://campus.example.org/",
    "Then:        moodle list-courses, moodle my-grades 3, moodle help <command>",
    "",
    "Global options:",
    "  --site <url>       The Moodle site (remembered after login; or MOODLE_SITE)",
    "  --profile <dir>    The browser profile folder (one per site by default; or MOODLE_PROFILE)",
    "  --json             Print JSON (the default when the output isn't a terminal)",
    "  --show             Show the browser while the command works",
    "  --allow <list>     Refuse commands that touch other data categories (own,course-content,…)",
    "  --help, --version",
    "",
    "Commands:",
    ...COMMANDS.map((c) => `  ${kebab(c.name).padEnd(width)}  ${firstSentence(c.description).slice(0, 90)}`),
  ].join("\n");
}

function commandHelp(command: CommandSpec): string {
  const usage = [`moodle ${kebab(command.name)}`, ...command.params.map((p) => (p.optional ? `[${p.name}]` : `<${p.name}>`)), ...(command.options ? ["[--options]"] : [])].join(" ");
  const lines = [`Usage: ${usage}`, "", command.description];
  if (command.params.length > 0) {
    lines.push("", "Arguments:");
    for (const p of command.params) lines.push(`  ${p.name}${p.optional ? " (optional)" : ""}  ${p.type}${p.description ? `  ${p.description}` : ""}`);
  }
  if (command.options) {
    lines.push("", `Options (--json '{…}' gives ${command.options.name} whole):`);
    for (const f of command.options.fields) lines.push(`  --${kebab(f.name)}${f.optional ? "" : " (required)"}  ${f.type}${f.description ? `  ${f.description}` : ""}`);
    if (command.options.open) lines.push(`  --<name> <value>  any other field of ${command.options.name}`);
  }
  const categories = categoriesOf(command.name);
  if (categories) lines.push("", `Data: ${categories.join(", ")}`);
  return lines.join("\n");
}

const categoriesOf = (name: string): readonly DataCategory[] | undefined => DATA_CATEGORIES[name] ?? DATA_CATEGORIES[`Moodle.${name}`];

/** Runs one command line; returns the exit status (0 done, 1 failed, 2 a command line that doesn't fit). */
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  let moodle: Moodle | undefined;
  try {
    const typed = commandName(argv);
    const command = typed && typed !== "help" ? findCommand(COMMANDS, typed) : undefined;
    const { global, positionals, flags } = splitLine(argv, command);
    if (global.version) {
      deps.stdout(deps.version);
      return 0;
    }
    if (typed === "help") {
      const about = positionals[0] ? findCommand(COMMANDS, positionals[0]) : undefined;
      if (positionals[0] && !about) throw new UsageError(`There's no command "${positionals[0]}".`);
      deps.stdout(about ? commandHelp(about) : overview());
      return 0;
    }
    if (!typed) {
      deps.stdout(overview());
      return global.help ? 0 : 2;
    }
    if (!command) throw new UsageError(`There's no command "${typed}". \`moodle help\` lists them.`);
    if (global.help) {
      deps.stdout(commandHelp(command));
      return 0;
    }

    const config = loadConfig(deps.configDir);
    const rawSite = global.site ?? deps.env.MOODLE_SITE ?? config.site;
    if (!rawSite) throw new UsageError("No site yet: log in first with `moodle login --site https://campus.example.org/`, or give --site.");
    const site = parseSiteUrl(rawSite);
    const profileDir = global.profile ?? deps.env.MOODLE_PROFILE ?? config.profiles?.[site] ?? defaultProfile(deps.configDir, site);

    if (global.allow) {
      const allowed = global.allow.split(",").map((c) => c.trim()) as DataCategory[];
      const unknown = allowed.filter((c) => !ALL_DATA_CATEGORIES.includes(c));
      if (unknown.length > 0) throw new UsageError(`Unknown data categories in --allow: ${unknown.join(", ")}. They are ${ALL_DATA_CATEGORIES.join(", ")}.`);
      const outside = (categoriesOf(command.name) ?? ["any"]).filter((c) => !allowed.includes(c));
      if (outside.length > 0) {
        deps.stderr(`refused: ${kebab(command.name)} touches ${outside.join(", ")}, outside --allow ${allowed.join(",")}.`);
        return 1;
      }
    }

    const args = methodArguments(command, positionals, flags, deps.cwd);
    const progress = deps.interactive ? (elapsed: number, total?: number) => deps.stderr(`  reading… ${Math.round(elapsed)}${total ? `/${Math.round(total)}` : ""} s`) : undefined;
    moodle = deps.createMoodle({ site, profileDir, headless: true, downloadBrowser: true, downloadDir: deps.cwd, onProgress: progress });
    if (global.show) await moodle.setVisible(true);
    const method = (moodle as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[command.name]!;
    const result = await method.apply(moodle, args);
    if (command.name === "logIn") saveConfig(deps.configDir, { ...config, site, profiles: { ...config.profiles, [site]: profileDir } });
    const text = render(result, global.json || !deps.interactive);
    if (text) deps.stdout(text);
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      deps.stderr(`${error.message}\n${error.message.includes("moodle help") ? "" : "`moodle help` lists the commands; `moodle help <command>` explains one."}`.trimEnd());
      return 2;
    }
    if (error instanceof NotLoggedInError) {
      deps.stderr(`${error.code}: ${error.message}\nLog in again with \`moodle login\`.`);
      return 1;
    }
    if (error instanceof MoodleError) {
      deps.stderr(`${error.code}: ${error.message}`);
      return 1;
    }
    deps.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await moodle?.close().catch(() => undefined);
  }
}


