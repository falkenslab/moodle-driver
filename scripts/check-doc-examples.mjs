// Typechecks the documentation's examples against src/: every ```ts block that is a program (it
// awaits something or uses `moodle.`) is written to .doccheck/ and compiled with tsc, so a change
// to the API breaks the examples that use it. Blocks fenced as ```ts fragment are skipped: they're
// pieces of a program, not programs. A block that doesn't create its own `moodle` gets one declared.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = path.join(root, "docs", "content");
const out = path.join(root, ".doccheck");

function markdownFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : markdownFiles(full);
    return entry.name.endsWith(".md") ? [full] : [];
  });
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
const sources = new Map();
for (const file of markdownFiles(content)) {
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  let index = 0;
  for (const match of text.matchAll(/^```ts([^\n]*)\n([\s\S]*?)^```/gm)) {
    index++;
    const [, meta, code] = match;
    if (/\bfragment\b/.test(meta) || !/\bawait |\bmoodle\./.test(code)) continue;
    const ownMoodle = /\b(const|let|using) moodle\b/.test(code);
    // Under another name, so a block that imports `Moodle` itself doesn't clash with it.
    const prelude = (ownMoodle ? "" : 'import type { Moodle as DocCheckMoodle } from "@falkenslab/moodle-driver";\ndeclare const moodle: DocCheckMoodle;\n') + "export {};\n";
    const relative = path.relative(content, file).split(path.sep).join("/");
    const name = `${relative.replace(/\.md$/, "").replace(/[/\\]/g, "_")}_${index}.ts`;
    writeFileSync(path.join(out, name), prelude + code);
    // The block's first line in the Markdown file, for the report.
    const line = text.slice(0, match.index).split("\n").length + 1;
    sources.set(name, { file: `docs/content/${relative}`, line, offset: prelude.split("\n").length - 1 });
  }
}
writeFileSync(
  path.join(out, "tsconfig.json"),
  JSON.stringify({
    extends: "../tsconfig.json",
    compilerOptions: {
      noEmit: true,
      paths: {
        "@falkenslab/moodle-driver": ["../src/index.ts"],
        "@falkenslab/moodle-driver/internals": ["../src/internals.ts"],
        "@falkenslab/moodle-driver/testing": ["../src/testing/index.ts"],
      },
    },
    include: ["*.ts"],
  }),
);

let failed = false;
try {
  execFileSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", out], { encoding: "utf8", stdio: "pipe" });
} catch (error) {
  failed = true;
  // Point each error at the Markdown file and line it comes from.
  const report = String(error.stdout).replace(/^\.doccheck[/\\]([^(]+)\((\d+),(\d+)\)/gm, (all, name, row, column) => {
    const source = sources.get(name);
    return source ? `${source.file}:${source.line + Number(row) - 1 - source.offset}:${column}` : all;
  });
  process.stderr.write(report);
}
const checked = sources.size;
rmSync(out, { recursive: true, force: true });
if (failed) {
  process.stderr.write(`\nThe documentation's examples don't compile against src/ (${checked} checked).\n`);
  process.exit(1);
}
console.log(`${checked} documentation examples compile against src/.`);
