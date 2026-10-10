import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, it } from "node:test";
import { MOODLE_METHODS } from "../../src/index.js";
import { UsageError, commandName, convert, findCommand, methodArguments, splitLine } from "../../src/cli/args.js";
import { COMMANDS, LEFT_OUT } from "../../src/cli/commands.generated.js";

const command = (name: string) => findCommand(COMMANDS, name)!;

describe("the command table", () => {
  it("has a command for every method of the Moodle object but those giving a browser tab, and the object's own that take plain values", () => {
    const names = new Set(COMMANDS.map((c) => c.name));
    const missing = [...MOODLE_METHODS, "logIn", "publicSiteInfo", "callService"].filter((name) => !names.has(name) && !LEFT_OUT.includes(name));
    assert.deepEqual(missing, []);
    assert.deepEqual(LEFT_OUT, ["openForm", "openSitePage"]);
  });

  it("is up to date with the driver's types", () => {
    const root = path.resolve(import.meta.dirname, "..", "..");
    execFileSync(process.execPath, [path.join(root, "scripts", "generate-cli-commands.mjs"), "--check"], { cwd: root, stdio: "pipe" });
  });
});

describe("reading the command line", () => {
  it("finds the command past global flags, in any spelling", () => {
    assert.equal(commandName(["--site", "https://x.test/", "--json", "my-grades", "3"]), "my-grades");
    assert.equal(command("my-grades").name, "myGrades");
    assert.equal(command("login").name, "logIn");
    assert.equal(command("WHOAMI").name, "whoAmI");
  });

  it("turns arguments and flags into the method's arguments", () => {
    const grade = command("grade-submission");
    const { global, positionals, flags } = splitLine(["grade-submission", "35", "7", "--grade", "8.5", "--feedback=<p>Good</p>", "--notify"], grade);
    assert.deepEqual(global, { json: false, show: false, help: false, version: false });
    assert.deepEqual(methodArguments(grade, positionals, flags, "/home/ada"), [35, 7, { grade: "8.5", feedback: "<p>Good</p>", notify: true }]);
  });

  it("converts each kind of value, local paths included", () => {
    const save = command("save-submission");
    const { positionals, flags } = splitLine(["save-submission", "45", "--files", "a.py,b.py", "--files", "/tmp/c.py"], save);
    assert.deepEqual(methodArguments(save, positionals, flags, "/home/ada"), [45, { files: [path.resolve("/home/ada", "a.py"), path.resolve("/home/ada", "b.py"), path.resolve("/tmp/c.py")] }]);
    const since = convert(["2026-11-30"], { name: "inactiveSince", optional: true, type: "Date", value: { kind: "date" } }, "/");
    assert.ok(since instanceof Date);
    assert.throws(() => convert(["past-ish"], { name: "classification", optional: true, type: "", value: { kind: "enum", values: ["past", "inprogress"] } }, "/"), UsageError);
  });

  it("reads a switch as on, off with --no-, or with an explicit value", () => {
    const submissions = command("assignment-submissions");
    for (const [line, expected] of [
      [["assignment-submissions", "35", "--no-include-content"], false],
      [["assignment-submissions", "35", "--include-content=false"], false],
      [["assignment-submissions", "35", "--include-content"], true],
    ] as const) {
      const { positionals, flags } = splitLine([...line], submissions);
      assert.deepEqual(methodArguments(submissions, positionals, flags, "/"), [35, { includeContent: expected }]);
    }
  });

  it("gives an open options object any field, typed as JSON when it reads as JSON", () => {
    const call = command("call-service");
    const { positionals, flags } = splitLine(["call-service", "core_group_get_course_groups", "--courseid", "3", "--name", "Group A"], call);
    assert.deepEqual(methodArguments(call, positionals, flags, "/"), ["core_group_get_course_groups", { courseid: 3, name: "Group A" }]);
  });

  it("refuses what doesn't fit, saying what would", () => {
    const grades = command("my-grades");
    assert.throws(() => methodArguments(grades, [], new Map(), "/"), /my-grades needs <courseId>/);
    assert.throws(() => methodArguments(grades, ["three"], new Map(), "/"), /courseId must be a number/);
    assert.throws(() => methodArguments(grades, ["3", "4"], new Map(), "/"), /takes 1 argument, not 2/);
    const grade = command("grade-submission");
    assert.throws(() => methodArguments(grade, ["35", "7"], new Map([["mark", ["8"]]]), "/"), /has no option --mark; its options are --grade/);
  });
});
