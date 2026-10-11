// `moodle shell`: command lines typed one after another on one Moodle object, so the browser stays open
// between them and, with `--show`, a person watches each act in the same window. Each line runs as
// `moodle <line>` would (the same parsing and output, `runLine`).
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface, type Interface } from "node:readline";
import { GLOBAL_FLAGS, UsageError, findCommand, kebab, splitLine, tokenize } from "./args.js";
import { allowedCategories, closeSession, openSession, overview, report, runLine, targetOf, type CliDeps, type CliSession } from "./command.js";
import { COMMANDS } from "./commands.generated.js";

/** The shell's own words, besides the commands, `sites`, `forget` and `help`. */
const SHELL_WORDS = ["exit", "quit", "show", "hide", "use"];
const HISTORY_SIZE = 500;

const SHELL_HELP = [
  "In the shell, every command runs as `moodle <command>` would, on one browser kept open:",
  "  show / hide              Shows the browser and follows each page a command opens, or hides it",
  "  use <site> [--as name]   Works on another site or profile (the browser reopens on it)",
  "  login --as <name>        Logs in with another profile, and goes on with it",
  "  help [command], exit     Help, and leaving (also quit or Ctrl+D; Ctrl+C clears the line)",
  "",
].join("\n");

/** The command names and options a line can go on with, for Tab. */
export function complete(line: string): [string[], string] {
  const words = line.trimStart().split(/\s+/);
  const word = words[words.length - 1]!;
  if (words.length === 1) {
    const names = [...SHELL_WORDS, "help", "sites", "forget", "open", "close", ...COMMANDS.map((c) => kebab(c.name))].sort();
    return [names.filter((n) => n.startsWith(word)), word];
  }
  if (word.startsWith("-")) {
    const command = findCommand(COMMANDS, words[0]!);
    const options = [...(command?.options?.fields ?? []).map((f) => `--${kebab(f.name)}`), ...(command?.options ? ["--json"] : []), ...GLOBAL_FLAGS];
    return [[...new Set(options)].filter((o) => o.startsWith(word)).sort(), word];
  }
  if (words[0] === "help" && words.length === 2) return [COMMANDS.map((c) => kebab(c.name)).filter((n) => n.startsWith(word)), word];
  return [[], word];
}

/** The prompt: the site's host and the profile, when known. */
function prompt(deps: CliDeps, session: CliSession): string {
  try {
    const target = targetOf(deps, session);
    if (target) return `moodle ${new URL(target.site).host} ${target.name ?? path.basename(target.profileDir)}> `;
  } catch {
    // A site or profile that doesn't fit: the line that uses it will say why.
  }
  return "moodle> ";
}

function loadHistory(file: string): string[] {
  try {
    // readline wants the latest first.
    return readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-HISTORY_SIZE).reverse();
  } catch {
    return [];
  }
}

/** Lines as they're typed (or read from a script), one at a time: `undefined` once the input ends. */
function lineReader(rl: Interface): () => Promise<string | undefined> {
  const queued: string[] = [];
  let ended = false;
  let waiting: ((line: string | undefined) => void) | undefined;
  rl.on("line", (line) => {
    if (waiting) {
      const resolve = waiting;
      waiting = undefined;
      resolve(line);
    } else queued.push(line);
  });
  rl.on("close", () => {
    ended = true;
    waiting?.(undefined);
    waiting = undefined;
  });
  return () => {
    if (queued.length > 0) return Promise.resolve(queued.shift());
    if (ended) return Promise.resolve(undefined);
    return new Promise((resolve) => (waiting = resolve));
  };
}

/**
 * `moodle shell [--site …] [--as …] [--profile …] [--show] [--allow …] [--json]`: reads command lines
 * until `exit`, `quit` or the end of the input, running each on one Moodle object; closes the browser
 * (saving the session) when it ends. Exit status 0 when left normally, 2 for a shell line that doesn't fit.
 */
export async function shell(argv: string[], deps: CliDeps): Promise<number> {
  const session: CliSession = { defaults: {}, show: false };
  try {
    const { global, positionals, flags } = splitLine(argv, undefined);
    if (global.help) {
      deps.stdout(`Usage: moodle shell [--site <url>] [--as <name>] [--profile <dir>] [--show] [--allow <list>] [--json]\n\n${SHELL_HELP}`.trimEnd());
      return 0;
    }
    if (positionals.length > 0 || flags.size > 0) throw new UsageError(`shell takes only the global options, not ${[...positionals, ...[...flags.keys()].map((f) => `--${kebab(f)}`)].join(" ")}.`);
    if (global.allow) allowedCategories(global.allow);
    session.defaults = { site: global.site, as: global.as, profile: global.profile, allow: global.allow, json: global.json };
    session.show = global.show;
  } catch (error) {
    return report(deps, error);
  }

  const input = deps.input ?? process.stdin;
  const terminal = deps.terminal ?? false;
  const historyFile = path.join(deps.home, "history");
  const rl = createInterface({ input, output: deps.output, terminal, completer: complete, history: loadHistory(historyFile), historySize: HISTORY_SIZE, removeHistoryDuplicates: true });
  const next = lineReader(rl);
  let busy = false;
  rl.on("SIGINT", () => {
    if (busy) {
      deps.stderr("A command can't be stopped halfway: it ends on its own (exit after it to leave).");
      return;
    }
    // Ctrl+C drops the line being typed, not the session.
    rl.write(null, { ctrl: true, name: "u" });
    deps.output?.write("^C\n");
    rl.setPrompt(prompt(deps, session));
    rl.prompt();
  });

  try {
    if (terminal) deps.stderr("moodle shell: commands as `moodle <command>`; `help` lists them, `exit` leaves.");
    if (session.show) {
      // The window opens at once, to watch from the first command.
      await openSession(deps, session).catch((error: unknown) => {
        session.show = false;
        report(deps, error);
      });
      // A background browser is only held while a line runs (ADR-014).
      if (session.open?.release) await closeSession(session);
    }
    for (;;) {
      if (terminal) {
        rl.setPrompt(prompt(deps, session));
        rl.prompt();
      }
      const line = await next();
      if (line === undefined) break;
      if (line.trim() === "") continue;
      try {
        mkdirSync(deps.home, { recursive: true });
        appendFileSync(historyFile, `${line.trim()}\n`, { mode: 0o600 });
      } catch {
        // History is a convenience: a home that can't take it doesn't stop the shell.
      }
      busy = true;
      try {
        if (await shellLine(line, deps, session)) break;
      } finally {
        busy = false;
        // A background browser is shared (ADR-014): connected for one line at a time, so commands from elsewhere get their turn.
        if (session.open?.release) await closeSession(session);
      }
    }
  } finally {
    rl.close();
    await closeSession(session);
  }
  return 0;
}

/** Runs one line of the shell; `true` when it says to leave. */
async function shellLine(line: string, deps: CliDeps, session: CliSession): Promise<boolean> {
  let tokens: string[];
  try {
    tokens = tokenize(line);
  } catch (error) {
    report(deps, error);
    return false;
  }
  const [word, ...rest] = tokens;
  switch (word) {
    case "exit":
    case "quit":
      return true;
    case "shell":
      deps.stderr("This is the shell already.");
      return false;
    case "help":
      if (rest.length === 0) {
        deps.stdout(`${SHELL_HELP}\n${overview()}`);
        return false;
      }
      break;
    case "show":
    case "hide":
      session.show = word === "show";
      try {
        if (session.show) await openSession(deps, session);
        else await session.open?.moodle.setVisible(false);
      } catch (error) {
        if (session.show) session.show = false;
        report(deps, error);
      }
      return false;
    case "use":
      try {
        const { global, positionals } = splitLine(tokens, undefined);
        if (positionals.length > 1) throw new UsageError("use takes one site: `use https://campus.example.org/ --as <name>`.");
        // A new site starts from its own default profile, unless one is named.
        const site = positionals[0] ?? global.site;
        session.defaults = { ...session.defaults, ...(site ? { site, as: undefined, profile: undefined } : {}), ...(global.as ? { as: global.as, profile: undefined } : {}), ...(global.profile ? { profile: global.profile } : {}) };
        const target = await openSession(deps, session);
        deps.stdout(`✔ Working on ${target.site} as ${target.name ?? target.profileDir}.`);
      } catch (error) {
        report(deps, error);
      }
      return false;
  }
  await runLine(tokens, deps, session);
  return false;
}
