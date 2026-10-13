// Generates the `moodle` command's table from the driver's types (ADR-012): one command per method of
// the Moodle object, with its parameters, their types, the values they allow and their doc comments.
// Writes src/cli/commands.generated.ts and docs/content/reference/commands.md. `--check` only compares
// (exit 1 when they're stale), for tests and CI.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");

const configFile = ts.readConfigFile(path.join(root, "tsconfig.build.json"), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();
const client = program.getSourceFile(path.join(root, "src", "client.ts"));
if (!client) throw new Error("src/client.ts not found");

// The object's methods that take a plain value from a command line. The rest (context, tab, visible,
// setVisible, saveSession, close) handle the browser itself: the command does that for the person;
// openScorm leaves the player on the working tab, which closes with the command.
const OWN = ["logIn", "publicSiteInfo", "backupContents", "callService"];
// Methods whose options the object fills in when not given (bound by hand in src/client.ts).
const OPTIONAL_LAST = { downloadFile: "destDir" };

function findVariable(name) {
  let found;
  ts.forEachChild(client, function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node;
    else ts.forEachChild(node, visit);
  });
  if (!found?.initializer) throw new Error(`${name} not found in src/client.ts`);
  return found.initializer;
}

// The functions bound as methods: SITE_FUNCTIONS' properties and DEFAULTED's names.
const functions = new Map();
for (const property of findVariable("SITE_FUNCTIONS").properties) {
  const symbol = checker.getShorthandAssignmentValueSymbol(property);
  functions.set(property.name.text, symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol);
}
let defaulted = findVariable("DEFAULTED");
if (ts.isAsExpression(defaulted)) defaulted = defaulted.expression;
for (const element of defaulted.elements) {
  const name = element.text;
  let symbol;
  ts.forEachChild(client, function visit(node) {
    if (ts.isImportSpecifier(node) && node.name.text === name) symbol = checker.getAliasedSymbol(checker.getSymbolAtLocation(node.name));
    else ts.forEachChild(node, visit);
  });
  functions.set(name, symbol);
}

const moodleInterface = (() => {
  let found;
  ts.forEachChild(client, (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === "Moodle") found = node;
  });
  return checker.getTypeAtLocation(found);
})();

const doc = (symbol) => ts.displayPartsToString(symbol.getDocumentationComment(checker)).replace(/\s+/g, " ").trim();
const isDate = (type) => type.getSymbol()?.getName() === "Date";
const isFunction = (type) => type.getCallSignatures().length > 0;
const isObjectLike = (type) => (type.flags & ts.TypeFlags.Object) !== 0 && !checker.isArrayType(type) && !isDate(type) && !isFunction(type);

function kind(type) {
  type = checker.getNonNullableType(type);
  if (type.isUnion()) {
    const parts = type.types;
    if (parts.every((t) => t.isStringLiteral())) return { kind: "enum", values: parts.map((t) => t.value) };
    if (parts.every((t) => t.flags & ts.TypeFlags.BooleanLiteral)) return { kind: "boolean" };
    if (parts.every((t) => t.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike))) return { kind: "string" };
    return { kind: "json" };
  }
  if (type.flags & ts.TypeFlags.NumberLike) return { kind: "number" };
  if (type.flags & ts.TypeFlags.StringLike) return { kind: "string" };
  if (type.flags & ts.TypeFlags.BooleanLike) return { kind: "boolean" };
  if (isDate(type)) return { kind: "date" };
  if (checker.isArrayType(type)) {
    const [element] = checker.getTypeArguments(type);
    if (element && element.flags & ts.TypeFlags.NumberLike) return { kind: "numbers" };
    if (element && element.flags & ts.TypeFlags.StringLike) return { kind: "strings" };
  }
  return { kind: "json" };
}

// The type as written where it's declared (`ActivityFields`, not an import path, which would name this
// machine's folders): what the API reference shows.
const typeText = (type, at) =>
  checker
    .typeToString(checker.getNonNullableType(type), at, ts.TypeFormatFlags.NoTruncation)
    .replace(/import\("[^"]*"(, \{ with: \{ "resolution-mode": "import" \} \})?\)\./g, "");

function isOptional(symbol, declaration) {
  const node = symbol.valueDeclaration ?? declaration;
  if (node && (ts.isParameter(node) || ts.isPropertySignature(node) || ts.isPropertyDeclaration(node))) {
    if (node.questionToken || (ts.isParameter(node) && node.initializer)) return true;
  }
  return (symbol.flags & ts.SymbolFlags.Optional) !== 0;
}

function paramSpec(symbol, at) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, at);
  const spec = { name: symbol.getName(), optional: isOptional(symbol), type: typeText(type, at), value: kind(type) };
  const description = doc(symbol);
  if (description) spec.description = description;
  return spec;
}

// The object part of an options parameter, when it has one (`{ acceptStatement?: boolean } | boolean`).
function optionsObject(type) {
  type = checker.getNonNullableType(type);
  if (type.isUnion()) return type.types.find(isObjectLike);
  return isObjectLike(type) ? type : undefined;
}

function command(name, signature, skip, description) {
  const declaration = signature.getDeclaration();
  const parameters = signature.getParameters().slice(skip);
  const spec = { name, description, params: [] };
  parameters.forEach((symbol, i) => {
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const object = i === parameters.length - 1 ? optionsObject(type) : undefined;
    if (object) {
      const fields = checker
        .getPropertiesOfType(object)
        .filter((field) => !isFunction(checker.getNonNullableType(checker.getTypeOfSymbolAtLocation(field, declaration))))
        .map((field) => paramSpec(field, declaration));
      const open = checker.getIndexInfosOfType(object).length > 0;
      // A destructured parameter has no name of its own (`__3`): it's the options.
      const optionsName = symbol.getName().startsWith("__") ? "options" : symbol.getName();
      spec.options = { name: optionsName, optional: isOptional(symbol), open, fields };
    } else {
      const param = paramSpec(symbol, declaration);
      if (OPTIONAL_LAST[name] === param.name) param.optional = true;
      spec.params.push(param);
    }
  });
  return spec;
}

const commands = [];
// Sorted by code units, the same everywhere (localeCompare depends on the machine's locale data).
const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const leftOut = [];
for (const [name, symbol] of [...functions].sort(([a], [b]) => byName(a, b))) {
  const type = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? symbol.declarations[0]);
  const signatures = type.getCallSignatures();
  // A method that gives a browser tab (openSitePage, openForm) means nothing once the command exits.
  if (/\bPage\b/.test(checker.typeToString(signatures.at(-1).getReturnType()))) {
    leftOut.push(name);
    continue;
  }
  // The last overload is the current form (older ones stay accepted by the function).
  const signature = signatures[signatures.length - 1];
  commands.push(command(name, signature, 2, doc(symbol)));
}
for (const name of OWN) {
  const member = moodleInterface.getProperty(name);
  const signature = checker.getTypeOfSymbolAtLocation(member, member.valueDeclaration).getCallSignatures().at(-1);
  // Prefer the function's own doc comment when there's one (logIn's says more than the method's).
  commands.push(command(name, signature, 0, doc(member)));
}
commands.sort((a, b) => byName(a.name, b.name));

const ts_ = `// Generated by scripts/generate-cli-commands.mjs from the Moodle object's types: don't edit by hand,
// run \`npm run cli:generate\`.
import type { CommandSpec } from "./spec.js";

export const COMMANDS: readonly CommandSpec[] = ${JSON.stringify(commands, null, 2)};

/** Methods with no command: they give a browser tab, which means nothing once the command exits. */
export const LEFT_OUT: readonly string[] = ${JSON.stringify(leftOut)};
`;

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const cell = (text) => (text ?? "").replace(/\|/g, "\\|");
const usage = (c) =>
  [`moodle ${kebab(c.name)}`, ...c.params.map((p) => (p.optional ? `[${p.name}]` : `<${p.name}>`)), ...(c.options ? [c.options.optional ? "[--options]" : "--options"] : [])].join(" ");
const md = [
  "# Commands",
  "",
  "Every method of the `Moodle` object as a command of `moodle`, generated from the driver's types: the same names (also in kebab-case), arguments and options. See [The command line](../getting-started/command-line.md) for installing it, logging in and the global options.",
  "",
  "Each one can also be typed in `moodle shell`, without the `moodle` in front, on one browser kept open between commands (see [An interactive session](../getting-started/command-line.md#an-interactive-session)). After `moodle open`, separate `moodle` commands from any terminal work on one browser left open in the background, until `moodle close` (see [Watching separate commands act](../getting-started/command-line.md#watching-separate-commands-act)).",
  "",
  "Besides these, `moodle` has its own commands for the session and the browser: `login`, `sites`, `forget`, `shell`, `open`, `close` and `help` (see [The command line](../getting-started/command-line.md)).",
  "",
  ...commands.flatMap((c) => [
    `## ${c.name}`,
    "",
    c.description || "No description.",
    "",
    "```bash",
    usage(c),
    "```",
    "",
    ...(c.params.length + (c.options?.fields.length ?? 0) > 0
      ? [
          "| Argument | Type | Description |",
          "| --- | --- | --- |",
          ...c.params.map((p) => `| \`${p.name}\`${p.optional ? " (optional)" : ""} | \`${cell(p.type)}\` | ${cell(p.description)} |`),
          ...(c.options?.fields ?? []).map((f) => `| \`--${kebab(f.name)}\`${f.optional ? "" : " (required)"} | \`${cell(f.type)}\` | ${cell(f.description)} |`),
          ...(c.options?.open ? [`| \`--<name> <value>\` | | Any other field of \`${c.options.name}\` |`] : []),
          "",
        ]
      : []),
  ]),
].join("\n");

// The Moodle object's methods from the site functions, written out one by one: a mapped type binding
// them (`(...rest) => R`) is what the editor resolves, but the API reference showed it as
// `(...rest) => Promise` with no description, and the editor lost each function's doc comment.
const srcDir = path.join(root, "src").replace(/\\/g, "/").toLowerCase();
const methodType = (type) =>
  checker
    .typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseFullyQualifiedType)
    // The checker names modules by this machine's paths: relative imports instead.
    .replace(/import\("([^"]+)"(?:, \{ with: \{ "resolution-mode": "import" \} \})?\)/g, (_, spec) => {
      const file = spec.replace(/\\/g, "/");
      if (file.toLowerCase().startsWith(`${srcDir}/`)) return `import("./${file.slice(srcDir.length + 1)}.js")`;
      if (/\/node_modules\/playwright-core\//.test(file)) return 'import("playwright-core")';
      throw new Error(`A type from an unexpected module: ${file}`);
    });

// A declaration's own doc comment, as written, indented as an interface member.
function docComment(declaration) {
  const text = declaration.getSourceFile().getFullText();
  const ranges = ts.getLeadingCommentRanges(text, declaration.getFullStart()) ?? [];
  const range = ranges.filter((r) => text.slice(r.pos, r.pos + 3) === "/**").at(-1);
  if (!range) return undefined;
  return text
    .slice(range.pos, range.end)
    .split(/\r?\n/)
    .map((line, i) => (i === 0 ? `  ${line.trim()}` : `   ${line.trim()}`))
    .join("\n");
}

function methodSignature(name, signature) {
  const declaration = signature.getDeclaration();
  const params = signature
    .getParameters()
    .slice(2)
    .map((symbol) => {
      const node = symbol.valueDeclaration;
      const optional = node && ts.isParameter(node) && (node.questionToken || node.initializer) ? "?" : "";
      const rest = node && ts.isParameter(node) && node.dotDotDotToken ? "..." : "";
      let type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      if (optional) type = checker.getNonNullableType(type);
      // A destructured parameter has no name of its own (`__3`): it's the options.
      const paramName = symbol.getName().startsWith("__") ? "options" : symbol.getName();
      return `${rest}${paramName}${optional}: ${methodType(type)}`;
    });
  return `  ${name}(${params.join(", ")}): ${methodType(signature.getReturnType())};`;
}

const siteNames = findVariable("SITE_FUNCTIONS").properties.map((property) => property.name.text);
const methods = [...siteNames].sort(byName).flatMap((name) => {
  const symbol = functions.get(name);
  const signatures = checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration ?? symbol.declarations[0]).getCallSignatures();
  const fallbackDoc = signatures.map((signature) => docComment(signature.getDeclaration())).find(Boolean);
  return signatures.flatMap((signature) => [docComment(signature.getDeclaration()) ?? fallbackDoc ?? "", methodSignature(name, signature)].filter(Boolean));
});
const moodleMethods = `// Generated by scripts/generate-cli-commands.mjs from the driver's functions: don't edit by hand,
// run \`npm run cli:generate\`. src/client.ts checks it matches the functions.

/**
 * The methods a \`Moodle\` has from the driver's functions: each is the function of the same name
 * without its first two parameters (the browser context and the site), and its doc comment.
 */
export interface MoodleMethods {
${methods.join("\n")}
}
`;

const outputs = [
  [path.join(root, "src", "cli", "commands.generated.ts"), ts_],
  [path.join(root, "docs", "content", "reference", "commands.md"), md],
  [path.join(root, "src", "moodle-methods.generated.ts"), moodleMethods],
];
let stale = false;
for (const [file, content] of outputs) {
  let current = "";
  try {
    current = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  } catch {
    // Not generated yet.
  }
  if (current === content) continue;
  stale = true;
  if (!check) writeFileSync(file, content);
}
if (check && stale) {
  console.error("The command table is stale: run `npm run cli:generate`.");
  process.exit(1);
}
console.log(`${commands.length} commands${check ? " up to date" : stale ? " written" : ", nothing to change"}.`);
