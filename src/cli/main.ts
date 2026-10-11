#!/usr/bin/env node
// The `moodle` command's entry point (`bin` in package.json): every method of the Moodle object from a
// terminal (ADR-012). The library itself prints nothing and reads no environment; this program does.
import { readFileSync } from "node:fs";
import { createMoodle } from "../client.js";
import { cliHome, legacyHome } from "./config.js";
import { run } from "./run.js";

const { version } = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string };

process.exitCode = await run(process.argv.slice(2), {
  createMoodle,
  stdout: (text) => process.stdout.write(`${text}\n`),
  stderr: (text) => process.stderr.write(`${text}\n`),
  env: process.env,
  cwd: process.cwd(),
  home: cliHome(process.env),
  legacyHome: legacyHome(process.env),
  interactive: process.stdout.isTTY === true,
  version,
});
