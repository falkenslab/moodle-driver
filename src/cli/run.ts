// The `moodle` command (ADR-012): every method of the Moodle object from a terminal. `run` takes its
// surroundings as arguments, so tests run it against the fake Moodle.
import { mkdirSync, rmSync } from "node:fs";
import { ALL_DATA_CATEGORIES, DATA_CATEGORIES, type DataCategory } from "../categories.js";
import type { Moodle, MoodleOptions } from "../client.js";
import { MoodleError } from "../core/errors.js";
import { NotLoggedInError } from "../core/session.js";
import { parseSiteUrl } from "../options.js";
import { UsageError, commandName, findCommand, kebab, methodArguments, splitLine } from "./args.js";
import { COMMANDS } from "./commands.generated.js";
import { forgetSite, listSites, loadConfig, loadSite, nameProfile, pendingProfile, profileFor, saveConfig, saveSite } from "./config.js";
import { render } from "./output.js";
import type { CommandSpec } from "./spec.js";

export interface CliDeps {
  createMoodle: (options: MoodleOptions) => Moodle;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** The command's home: the default site, and a folder per site with its profiles (ADR-013). */
  home: string;
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
    "  --as <name>        The profile on the site, by name (or MOODLE_AS; the site's default unless told)",
    "  --profile <dir>    A browser profile folder of your own (or MOODLE_PROFILE)",
    "  --json             Print JSON (the default when the output isn't a terminal)",
    "  --show             Show the browser while the command works",
    "  --allow <list>     Refuse commands that touch other data categories (own,course-content,…)",
    "  --help, --version",
    "",
    "The command's own:",
    `  ${"sites".padEnd(width)}  The sites and profiles logged in to, which is the default, and whether each has a session`,
    `  ${"forget".padEnd(width)}  Deletes a site and its sessions (forget <site>), or one account's profile (--as <name>)`,
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
  // A first login's provisional profile, removed if the login doesn't get to name it.
  let pending: string | undefined;
  try {
    const typed = commandName(argv);
    const own = typed === "sites" || typed === "forget";
    const command = typed && typed !== "help" && !own ? findCommand(COMMANDS, typed) : undefined;
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
    if (typed === "sites") {
      const text = render(listSites(deps.home), global.json || !deps.interactive);
      deps.stdout(text === "(none)" ? "No sites yet: `moodle login --site https://campus.example.org/`." : text);
      return 0;
    }
    if (typed === "forget") {
      const target = positionals[0];
      if (!target) throw new UsageError("forget needs <site>: `moodle sites` lists them.");
      const gone = forgetSite(deps.home, parseSiteUrl(target), global.as);
      if (gone.length === 0) {
        deps.stderr(`not-found: ${target}${global.as ? ` has no profile ${global.as}` : " isn't a site logged in to"}; \`moodle sites\` lists them.`);
        return 1;
      }
      deps.stdout(`✔ Deleted ${gone.join(", ")}`);
      return 0;
    }
    if (!command) throw new UsageError(`There's no command "${typed}". \`moodle help\` lists them.`);
    if (global.help) {
      deps.stdout(commandHelp(command));
      return 0;
    }

    const config = loadConfig(deps.home);
    const rawSite = global.site ?? deps.env.MOODLE_SITE ?? config.site;
    if (!rawSite) throw new UsageError("No site yet: log in first with `moodle login --site https://campus.example.org/`, or give --site.");
    const site = parseSiteUrl(rawSite);
    const ownProfile = global.profile ?? deps.env.MOODLE_PROFILE;
    const loggingIn = command.name === "logIn";
    const chosen = profileFor(deps.home, site, { profile: ownProfile, as: global.as ?? deps.env.MOODLE_AS });
    // A first login with no name for its profile: a provisional folder, named after the person's username once in.
    pending = !chosen && loggingIn ? pendingProfile(deps.home, site) : undefined;
    if (!chosen && !pending) {
      const names = listSites(deps.home).filter((p) => p.site === site).map((p) => p.profile);
      if (names.length > 0) throw new UsageError(`${site} has no default profile: pick one with --as (${names.join(", ")}), or make one the default with \`moodle login --as <name>\`.`);
      throw new UsageError(`No profile for ${site} yet: log in with \`moodle login --site ${site}\`.`);
    }
    const profileDir = chosen?.profileDir ?? pending!;
    // A profile logged in to for the first time has its folder from now on, browser or not.
    if (loggingIn) mkdirSync(profileDir, { recursive: true });

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
    if (loggingIn) {
      // The site becomes the default, and the profile logged in with becomes the site's.
      let name = chosen?.name;
      if (pending) {
        const userId = (result as { userId: number }).userId;
        const username = await moodle.whoAmI().then((me) => me.username).catch(() => undefined);
        await moodle.close();
        name = nameProfile(deps.home, site, pending, username ?? `user-${userId}`);
        pending = undefined;
      }
      const record = loadSite(deps.home, site);
      saveSite(deps.home, { url: site, default: ownProfile ? undefined : name, profileDir: ownProfile ?? record?.profileDir });
      saveConfig(deps.home, { ...config, site });
      if (name && deps.interactive) deps.stderr(`Profile "${name}" is the default for ${site}.`);
    }
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
    if (pending) rmSync(pending, { recursive: true, force: true });
  }
}


