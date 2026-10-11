import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { createMoodle } from "../../src/index.js";
import { tokenize } from "../../src/cli/args.js";
import { run, type CliDeps } from "../../src/cli/run.js";
import { complete } from "../../src/cli/shell.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

let home: string;
before(async () => {
  home = await mkdtemp(path.join(tmpdir(), "moodle-driver-shell-"));
  // A site logged in to before, with its default profile.
  await mkdir(path.join(home, "sites", "moodle.test", "profiles", "ada"), { recursive: true });
  await writeFile(path.join(home, "sites", "moodle.test", "site.json"), JSON.stringify({ url: SITE, default: "ada" }));
  await writeFile(path.join(home, "config.json"), JSON.stringify({ site: SITE }));
});
after(() => rm(home, { recursive: true, force: true }));

/** Runs `moodle shell` with `lines` typed one after another, counting the Moodle objects (browsers) it makes. */
async function shellSession(context: BrowserContext | undefined, lines: string[], argv: string[] = []) {
  const out: string[] = [];
  const err: string[] = [];
  const made: string[] = [];
  let closed = 0;
  let shown = false;
  const input = new PassThrough();
  const deps: CliDeps = {
    createMoodle: (options) => {
      made.push("profileDir" in options ? options.profileDir : "");
      return createMoodle({
        site: options.site,
        browser: fakeBrowserManager({
          context: async () => context!,
          visible: () => shown,
          setVisible: async (visible) => void (shown = visible),
          close: async () => void closed++,
        }),
      });
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: {},
    cwd: "/home/ada",
    home,
    interactive: true,
    version: "9.9.9",
    input,
  };
  const done = run(["shell", ...argv], deps);
  for (const line of lines) input.write(`${line}\n`);
  input.end();
  const status = await done;
  return { status, out: out.join("\n"), err: err.join("\n"), made, closed, shown };
}

function state(): FakeMoodleState {
  return {
    user: { id: 4, fullName: "Ada Lovelace" },
    serviceCalls: [],
    services: {
      core_course_get_enrolled_courses_by_timeline_classification: () => ({ courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }] }),
    },
  };
}

describe("moodle shell", () => {
  it("splits a line as a shell does, keeping JSON and Windows paths whole", () => {
    assert.deepEqual(tokenize(`submit-survey 34 '{"textfield_12":"Clear"}'`), ["submit-survey", "34", '{"textfield_12":"Clear"}']);
    assert.deepEqual(tokenize(`grade-submission 35 7 --feedback "<p>Well \\"argued\\".</p>"  --notify`), ["grade-submission", "35", "7", "--feedback", '<p>Well "argued".</p>', "--notify"]);
    assert.deepEqual(tokenize(String.raw`save-submission 45 --files C:\Users\ada\notes.md my\ file.txt ""`), ["save-submission", "45", "--files", String.raw`C:\Users\ada\notes.md`, "my file.txt", ""]);
    assert.throws(() => tokenize(`course-structure "3`), /quote isn't closed/);
  });

  it("completes command names and a command's options", () => {
    assert.deepEqual(complete("list-c"), [["list-courses"], "list-c"]);
    assert.ok(complete("")[0].includes("exit"));
    const [options] = complete("grade-submission 35 7 --no");
    assert.deepEqual(options, ["--notify"]);
    assert.ok(complete("list-courses --j")[0].includes("--json"));
    assert.deepEqual(complete("help course-st")[0], ["course-structure"]);
  });

  it("runs several commands on one browser, goes on after an error, helps, and closes it on exit", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    const fake = state();
    await serveFakeMoodle(context, fake);
    const session = await shellSession(context, [
      "list-courses",
      "course-structure",
      "list-courses --json",
      "help",
      "help list-courses",
      "exit",
      "list-courses",
    ]);
    assert.equal(session.status, 0);
    // One Moodle object for every line, closed once when the shell ends.
    assert.deepEqual(session.made, [path.join(home, "sites", "moodle.test", "profiles", "ada")]);
    assert.equal(session.closed, 1);
    assert.match(session.out, /^id +shortname +fullname/);
    assert.match(session.err, /course-structure needs <courseId>/);
    assert.match(session.out, /"shortname": "loops"/);
    assert.match(session.out, /show \/ hide/);
    assert.match(session.out, /Usage: moodle list-courses/);
    // Nothing after `exit` runs.
    assert.equal(fake.serviceCalls!.filter((c) => c.methodname === "core_course_get_enrolled_courses_by_timeline_classification").length, 2);
    assert.match(await readFile(path.join(home, "history"), "utf8"), /list-courses\ncourse-structure\n/);
    await context.close();
  });

  it("starts with the window shown, shows and hides it, and ends at the end of the input", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state());
    const shown = await shellSession(context, ["list-courses"], ["--show"]);
    assert.equal(shown.status, 0);
    assert.equal(shown.made.length, 1);
    assert.equal(shown.shown, true);
    const hidden = await shellSession(context, ["show", "hide", "list-courses"]);
    assert.deepEqual([hidden.status, hidden.made.length, hidden.shown], [0, 1, false]);
    await context.close();
  });

  it("switches site or profile with use, opening the browser again", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state());
    await mkdir(path.join(home, "sites", "moodle.test", "profiles", "student"), { recursive: true });
    const session = await shellSession(context, ["list-courses", "use --as student", "list-courses", "use https://elsewhere.test/", "list-courses"]);
    assert.equal(session.status, 0);
    assert.deepEqual(session.made, [path.join(home, "sites", "moodle.test", "profiles", "ada"), path.join(home, "sites", "moodle.test", "profiles", "student")]);
    assert.match(session.out, /Working on http:\/\/moodle\.test\/ as student/);
    assert.match(session.err, /No profile for https:\/\/elsewhere\.test\/ yet/);
    assert.equal(session.closed, 2);
    await context.close();
  });

  it("refuses a shell line that doesn't fit", async () => {
    const wrong = await shellSession(undefined, [], ["list-courses"]);
    assert.equal(wrong.status, 2);
    assert.match(wrong.err, /shell takes only the global options/);
    const allow = await shellSession(undefined, [], ["--allow", "mine"]);
    assert.deepEqual([allow.status, /Unknown data categories/.test(allow.err)], [2, true]);
  });
});
