#!/usr/bin/env node
// The `moodle` command's entry point (`bin` in package.json): every method of the Moodle object from a
// terminal (ADR-012). The library itself prints nothing and reads no environment; this program does.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createMoodle } from "../client.js";
import { MoodleError } from "../core/errors.js";
import { hostBackground, spawnBackground } from "./background.js";
import { cliHome } from "./config.js";
import { run } from "./run.js";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

if (process.argv[2] === "__background") {
  // The background browser's process, started by `moodle open` (ADR-014): it lives as long as the browser.
  try {
    const { closed } = await hostBackground(process.argv[3]!, process.argv.includes("--show"));
    await closed;
  } catch (error) {
    process.stderr.write(`${error instanceof MoodleError ? `${error.code}: ` : ""}${(error as Error).message}\n`);
    process.exitCode = 1;
  }
} else {
  process.exitCode = await run(process.argv.slice(2), {
    createMoodle,
    stdout: (text) => process.stdout.write(`${text}\n`),
    stderr: (text) => process.stderr.write(`${text}\n`),
    env: process.env,
    cwd: process.cwd(),
    home: cliHome(process.env),
    interactive: process.stdout.isTTY === true,
    // Read on every line: `moodle shell`'s terminal may be resized.
    get columns() {
      return process.stdout.isTTY === true ? process.stdout.columns : undefined;
    },
    version,
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true && process.stdout.isTTY === true,
    startBackground: spawnBackground(fileURLToPath(import.meta.url)),
  });
}
