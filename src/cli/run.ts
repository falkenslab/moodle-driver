// The `moodle` command (ADR-012): every method of the Moodle object from a terminal. `run` takes its
// surroundings as arguments, so tests run it against the fake Moodle.
import { commandName } from "./args.js";
import { closeSession, runLine, type CliDeps, type CliSession } from "./command.js";
import { shell } from "./shell.js";

export type { CliDeps } from "./command.js";

/** Runs one command line, or `moodle shell`; returns the exit status (0 done, 1 failed, 2 a command line that doesn't fit). */
export async function run(argv: string[], deps: CliDeps): Promise<number> {
  if (commandName(argv) === "shell") return shell(argv, deps);
  const session: CliSession = { defaults: {}, show: false };
  try {
    return await runLine(argv, deps, session);
  } finally {
    await closeSession(session);
  }
}
