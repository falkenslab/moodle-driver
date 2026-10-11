// One command line of `moodle` (ADR-012), run on a session that may outlive it: `run` makes one for a
// single line, `moodle shell` keeps one for every line typed. Its surroundings come as arguments, so
// tests run it against the fake Moodle.
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { ALL_DATA_CATEGORIES, DATA_CATEGORIES, type DataCategory } from "../categories.js";
import type { Moodle, MoodleOptions } from "../client.js";
import { MoodleError } from "../core/errors.js";
import { NotLoggedInError } from "../core/session.js";
import { parseSiteUrl } from "../options.js";
import { UsageError, commandName, findCommand, kebab, methodArguments, splitLine, type GlobalFlags } from "./args.js";
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
  /** Where `moodle shell` reads its lines from: the terminal, or a script in tests. */
  input?: NodeJS.ReadableStream;
  /** Where `moodle shell` writes its prompt. */
  output?: NodeJS.WritableStream;
  /** Whether `input` is a terminal: a prompt, line editing, completion and Ctrl+C then. */
  terminal?: boolean;
}

/** What one `moodle` process keeps between its lines: one Moodle object, and what it was opened for. */
export interface CliSession {
  /** The global options a line doesn't give: the shell's own, then what `use` or `login` chose. */
  defaults: Partial<Pick<GlobalFlags, "site" | "as" | "profile" | "allow">> & { json?: boolean };
  /** Whether the browser shows a window (`--show`, `show`, `hide`). */
  show: boolean;
  open?: { moodle: Moodle; site: string; profileDir: string };
}

/** The site and profile a line works on. */
export interface Target {
  site: string;
  profileDir: string;
  /** The profile's name; none for a folder given with `--profile`. */
  name?: string;
  /** `--profile` or `MOODLE_PROFILE`: a folder of the person's own. */
  ownProfile?: string;
}

const firstSentence = (text: string) => (/^.*?\.(\s|$)/.exec(text)?.[0] ?? text).trim().replace(/\.$/, "");

export function overview(): string {
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
    `  ${"shell".padEnd(width)}  Types commands one after another on one browser, kept open (with --show, watch each act)`,
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

/** The data categories of `--allow`, checked: a `UsageError` names the unknown ones. */
export function allowedCategories(allow: string): DataCategory[] {
  const allowed = allow.split(",").map((c) => c.trim()) as DataCategory[];
  const unknown = allowed.filter((c) => !ALL_DATA_CATEGORIES.includes(c));
  if (unknown.length > 0) throw new UsageError(`Unknown data categories in --allow: ${unknown.join(", ")}. They are ${ALL_DATA_CATEGORIES.join(", ")}.`);
  return allowed;
}

/** The site a line works on: `--site`, the session's, `MOODLE_SITE`, the last one logged in to. */
function siteOf(deps: CliDeps, session: CliSession, global: GlobalFlags): string | undefined {
  const raw = global.site ?? session.defaults.site ?? deps.env.MOODLE_SITE ?? loadConfig(deps.home).site;
  return raw ? parseSiteUrl(raw) : undefined;
}

/** The site and profile a line works on, as far as they're known: `undefined` before the first login. */
export function targetOf(deps: CliDeps, session: CliSession, global: GlobalFlags = { json: false, show: false, help: false, version: false }): Target | undefined {
  const site = siteOf(deps, session, global);
  if (!site) return undefined;
  const ownProfile = global.profile ?? session.defaults.profile ?? deps.env.MOODLE_PROFILE;
  const chosen = profileFor(deps.home, site, { profile: ownProfile, as: global.as ?? session.defaults.as ?? deps.env.MOODLE_AS });
  return chosen && { site, profileDir: chosen.profileDir, name: chosen.name, ownProfile };
}

/** Why a site has no profile to work with, and what to do. */
function noProfile(deps: CliDeps, site: string): UsageError {
  const names = listSites(deps.home).filter((p) => p.site === site).map((p) => p.profile);
  if (names.length > 0) return new UsageError(`${site} has no default profile: pick one with --as (${names.join(", ")}), or make one the default with \`moodle login --as <name>\`.`);
  return new UsageError(`No profile for ${site} yet: log in with \`moodle login --site ${site}\`.`);
}

/** The session's Moodle object for a site and profile: the open one when it's theirs, else a new one (the old one closed). */
async function moodleFor(deps: CliDeps, session: CliSession, site: string, profileDir: string): Promise<Moodle> {
  const open = session.open;
  if (open && open.site === site && open.profileDir === profileDir) return open.moodle;
  await closeSession(session);
  const progress = deps.interactive ? (elapsed: number, total?: number) => deps.stderr(`  reading… ${Math.round(elapsed)}${total ? `/${Math.round(total)}` : ""} s`) : undefined;
  const moodle = deps.createMoodle({ site, profileDir, headless: true, downloadBrowser: true, downloadDir: deps.cwd, onProgress: progress });
  session.open = { moodle, site, profileDir };
  if (session.show) await moodle.setVisible(true);
  return moodle;
}

/** Closes the session's browser, saving the session (ADR-003); the next line opens it again. */
export async function closeSession(session: CliSession): Promise<void> {
  const open = session.open;
  session.open = undefined;
  await open?.moodle.close().catch(() => undefined);
}

/** Opens the session's browser now, for its site and profile (`--show` and `show` in the shell, `use`). */
export async function openSession(deps: CliDeps, session: CliSession): Promise<Target> {
  const site = siteOf(deps, session, { json: false, show: false, help: false, version: false });
  if (!site) throw new UsageError("No site yet: log in first with `login --site https://campus.example.org/`.");
  const target = targetOf(deps, session);
  if (!target) throw noProfile(deps, site);
  const moodle = await moodleFor(deps, session, target.site, target.profileDir);
  if (session.show && !moodle.visible()) await moodle.setVisible(true);
  return target;
}

/** Prints an error as the command does, and says its exit status (2 a command line that doesn't fit, else 1). */
export function report(deps: CliDeps, error: unknown): number {
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
}

/**
 * Runs one command line on the session, leaving its browser open for the next line; returns the exit
 * status (0 done, 1 failed, 2 a command line that doesn't fit).
 */
export async function runLine(argv: string[], deps: CliDeps, session: CliSession): Promise<number> {
  // A first login's provisional profile, removed if the login doesn't get to name it.
  let pending: string | undefined;
  try {
    const typed = commandName(argv);
    const own = typed === "sites" || typed === "forget";
    const command = typed && typed !== "help" && !own ? findCommand(COMMANDS, typed) : undefined;
    const { global, positionals, flags } = splitLine(argv, command);
    const json = global.json || Boolean(session.defaults.json) || !deps.interactive;
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
      const text = render(listSites(deps.home), json);
      deps.stdout(text === "(none)" ? "No sites yet: `moodle login --site https://campus.example.org/`." : text);
      return 0;
    }
    if (typed === "forget") {
      const target = positionals[0];
      if (!target) throw new UsageError("forget needs <site>: `moodle sites` lists them.");
      // The browser may be on the profile going away.
      await closeSession(session);
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

    const site = siteOf(deps, session, global);
    if (!site) throw new UsageError("No site yet: log in first with `moodle login --site https://campus.example.org/`, or give --site.");
    const loggingIn = command.name === "logIn";
    const chosen = targetOf(deps, session, global);
    // A first login with no name for its profile: a provisional folder, named after the person's username once in.
    pending = !chosen && loggingIn ? pendingProfile(deps.home, site) : undefined;
    // What anyone can ask without logging in needs no browser, so no profile either.
    const browserless = command.name === "publicSiteInfo";
    if (!chosen && !pending && !browserless) throw noProfile(deps, site);
    // A browserless command never opens this folder: the object launches no browser until it needs one.
    const profileDir = chosen?.profileDir ?? pending ?? path.join(deps.home, "sites", ".none");
    // A profile logged in to for the first time has its folder from now on, browser or not.
    if (loggingIn) mkdirSync(profileDir, { recursive: true });

    const allow = global.allow ?? session.defaults.allow;
    if (allow) {
      const allowed = allowedCategories(allow);
      const outside = (categoriesOf(command.name) ?? ["any"]).filter((c) => !allowed.includes(c));
      if (outside.length > 0) {
        deps.stderr(`refused: ${kebab(command.name)} touches ${outside.join(", ")}, outside --allow ${allowed.join(",")}.`);
        return 1;
      }
    }

    const args = methodArguments(command, positionals, flags, deps.cwd);
    const moodle = await moodleFor(deps, session, site, profileDir);
    if (global.show && !moodle.visible()) await moodle.setVisible(true);
    const method = (moodle as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[command.name]!;
    const result = await method.apply(moodle, args);
    if (loggingIn) {
      // The site becomes the default, and the profile logged in with becomes the site's.
      let name = chosen?.name;
      if (pending) {
        const userId = (result as { userId: number }).userId;
        const username = await moodle.whoAmI().then((me) => me.username).catch(() => undefined);
        // The folder is renamed: the browser on it closes, and the next line opens it on the named one.
        await closeSession(session);
        name = nameProfile(deps.home, site, pending, username ?? `user-${userId}`);
        pending = undefined;
      } else if (!session.show && session.open) {
        // A window opened only to log in closes; the next line runs headless.
        await session.open.moodle.setVisible(false).catch(() => undefined);
      }
      const record = loadSite(deps.home, site);
      saveSite(deps.home, { url: site, default: chosen?.ownProfile ? undefined : name, profileDir: chosen?.ownProfile ?? record?.profileDir });
      saveConfig(deps.home, { ...loadConfig(deps.home), site });
      // The session goes on with the site and profile logged in to.
      session.defaults.site = site;
      if (name) session.defaults.as = name;
      if (name && deps.interactive) deps.stderr(`Profile "${name}" is the default for ${site}.`);
    }
    const text = render(result, json);
    if (text) deps.stdout(text);
    return 0;
  } catch (error) {
    return report(deps, error);
  } finally {
    if (pending) {
      if (session.open?.profileDir === pending) await closeSession(session);
      rmSync(pending, { recursive: true, force: true });
    }
  }
}
