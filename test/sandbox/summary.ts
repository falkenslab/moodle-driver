// The sandbox suite's summary: per exported function, whether a test exercised it (passed or
// failed) or skipped it with a reason. Fails when a function of src/index.ts is in no test's name
// ("<function>: …"), unless only some files ran (--partial).
//   npx tsx test/sandbox/summary.ts <report.tap> [--partial]
import { readFileSync } from "node:fs";
import * as driver from "../../src/index.js";

const [file, flag] = process.argv.slice(2);
const partial = flag === "--partial";
const tap = readFileSync(file!, "utf8");

type Outcome = "passed" | "failed" | "skipped";
const seen = new Map<string, { outcome: Outcome; reasons: string[] }>();
// A test line, at any depth: "ok 3 - name", "not ok 4 - name", "ok 5 - name # SKIP reason".
for (const match of tap.matchAll(/^\s*(not ok|ok) \d+ - (.*?)(?: # (SKIP|TODO)\b ?(.*))?$/gm)) {
  const [, result, name, directive, reason] = match;
  const fn = /^([A-Za-z][\w.]*):/.exec(name!)?.[1];
  if (!fn) continue;
  const outcome: Outcome = result === "not ok" ? "failed" : directive ? "skipped" : "passed";
  const entry = seen.get(fn) ?? { outcome, reasons: [] };
  // Failed outranks passed, which outranks skipped.
  if (outcome === "failed" || (outcome === "passed" && entry.outcome === "skipped")) entry.outcome = outcome;
  if (outcome === "skipped" && reason) entry.reasons.push(reason);
  seen.set(fn, entry);
}

const isClass = (value: unknown) => typeof value === "function" && /^class\b/.test(Function.prototype.toString.call(value));
const functions = Object.entries(driver)
  .filter(([, value]) => typeof value === "function" && !isClass(value))
  .map(([name]) => name)
  .sort();
const missing = functions.filter((name) => !seen.has(name));

const count = (outcome: Outcome) => [...seen.values()].filter((entry) => entry.outcome === outcome).length;
console.log(`\nSandbox suite: ${functions.length} functions exported; ${count("passed")} passed, ${count("failed")} failed, ${count("skipped")} skipped, ${missing.length} not exercised.`);
for (const [name, entry] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
  if (entry.outcome === "failed") console.log(`  ✖ ${name}`);
}
for (const [name, entry] of [...seen].sort(([a], [b]) => (a < b ? -1 : 1))) {
  if (entry.outcome === "skipped") console.log(`  - ${name} skipped: ${[...new Set(entry.reasons)].join("; ") || "no reason given"}`);
}
if (missing.length > 0) console.log(`  Not exercised: ${missing.join(", ")}`);

const failed = count("failed") > 0 || (!partial && missing.length > 0) || [...seen.values()].some((entry) => entry.outcome === "skipped" && entry.reasons.length === 0);
process.exit(failed ? 1 : 0);
