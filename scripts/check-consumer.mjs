// Typechecks a program that uses the driver against this checkout's dist/ instead of the version it
// installed from npm, so a change that breaks it shows before a release. Nothing in its folder
// changes: a temporary tsconfig extends its own and points the package's entries at dist/.
//
//   npm run build && node scripts/check-consumer.mjs ../some-program
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const consumer = process.argv[2] && path.resolve(process.argv[2]);
if (!consumer || !existsSync(path.join(consumer, "tsconfig.json"))) {
  console.error("Give the folder of a program with a tsconfig.json: node scripts/check-consumer.mjs ../some-program");
  process.exit(2);
}
const tsc = path.join(consumer, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(tsc)) {
  console.error(`${consumer} has no TypeScript installed: run npm install there first.`);
  process.exit(2);
}
if (!existsSync(path.join(root, "dist", "index.d.ts"))) {
  console.error("No dist/ to check against: run npm run build first.");
  process.exit(2);
}

/** The consumer's include, or TypeScript's default when it has none (or comments JSON can't read). */
function ownInclude() {
  try {
    return JSON.parse(readFileSync(path.join(consumer, "tsconfig.json"), "utf8")).include ?? ["**/*"];
  } catch {
    return ["**/*"];
  }
}

const posix = (p) => p.split(path.sep).join("/");
const dist = (file) => [posix(path.join(root, "dist", file))];
const work = mkdtempSync(path.join(tmpdir(), "moodle-driver-consumer-"));
try {
  const config = path.join(work, "tsconfig.json");
  writeFileSync(
    config,
    JSON.stringify({
      extends: posix(path.join(consumer, "tsconfig.json")),
      compilerOptions: {
        noEmit: true,
        typeRoots: [posix(path.join(consumer, "node_modules", "@types"))],
        paths: {
          "@falkenslab/moodle-driver": dist("index.d.ts"),
          "@falkenslab/moodle-driver/internals": dist("internals.d.ts"),
          "@falkenslab/moodle-driver/testing": dist("testing/index.d.ts"),
        },
      },
      // A tsconfig's include is relative to the file it's in: the consumer's own, made absolute.
      include: ownInclude().map((glob) => posix(path.join(consumer, glob))),
    }),
  );
  const result = spawnSync(process.execPath, [tsc, "-p", config], { stdio: "inherit" });
  if (result.status === 0) console.log(`${path.basename(consumer)} typechecks against this checkout's dist/.`);
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
