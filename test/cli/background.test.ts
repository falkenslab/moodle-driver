import assert from "node:assert/strict";
import { existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { after, before, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { createMoodle, type MoodleOptions } from "../../src/index.js";
import { BACKGROUND_FILE } from "../../src/browser/background.js";
import { hostBackground, LOCK_FILE } from "../../src/cli/background.js";
import { run, type CliDeps } from "../../src/cli/run.js";
import { SITE, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

// Only where a browser can be launched (Docker, CI).
const available = await launchTestBrowser().then(async (b) => (await b?.close(), b !== undefined));

let home: string;
let profileDir: string;
before(async () => {
  home = await mkdtemp(path.join(tmpdir(), "moodle-driver-background-"));
  profileDir = path.join(home, "sites", "moodle.test", "profiles", "ada");
  await mkdir(profileDir, { recursive: true });
  await writeFile(path.join(home, "sites", "moodle.test", "site.json"), JSON.stringify({ url: SITE, default: "ada" }));
  await writeFile(path.join(home, "config.json"), JSON.stringify({ site: SITE }));
});
after(async () => {
  await run(["close"], deps().deps).catch(() => undefined);
  await rm(home, { recursive: true, force: true });
});

const fake: FakeMoodleState = {
  user: { id: 4, fullName: "Ada Lovelace" },
  serviceCalls: [],
  services: {
    core_course_get_enrolled_courses_by_timeline_classification: () => ({ courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }] }),
  },
};

let launches = 0;
/** The command's surroundings: the background browser started in this process, the fake Moodle served on what it works with. */
function deps(input?: PassThrough) {
  const out: string[] = [];
  const err: string[] = [];
  const made: ("connected" | "launched")[] = [];
  const served = new WeakSet<BrowserContext>();
  const value: CliDeps = {
    createMoodle: (options: MoodleOptions) => {
      made.push("browser" in options ? "connected" : "launched");
      const moodle = createMoodle({ ...options, ...("browser" in options ? {} : { channel: "chromium" as const }) });
      const original = moodle.browser.context.bind(moodle.browser);
      moodle.browser.context = async (o) => {
        const context = await original(o);
        if (!served.has(context)) {
          served.add(context);
          await serveFakeMoodle(context, fake);
        }
        return context;
      };
      return moodle;
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: {},
    cwd: home,
    home,
    interactive: true,
    version: "9.9.9",
    input,
    startBackground: async (dir, headed) => {
      launches++;
      await hostBackground(dir, headed);
    },
    lockWaitMs: 300,
  };
  return { deps: value, out, err, made };
}

async function moodle(argv: string[]) {
  const d = deps();
  const status = await run(argv, d.deps);
  return { status, out: d.out.join("\n"), err: d.err.join("\n"), made: d.made };
}

describe("a background browser for separate commands", { skip: !available && "no browser to launch" }, () => {
  it("without one, a command launches its own browser as before", async () => {
    const result = await moodle(["list-courses"]);
    assert.equal(result.status, 0, result.err);
    assert.deepEqual(result.made, ["launched"]);
  });

  it("opens one, which every command then connects to without launching another", async () => {
    const opened = await moodle(["open"]);
    assert.equal(opened.status, 0, opened.err);
    assert.match(opened.out, /^✔ Opened a background browser on profile "ada" of http:\/\/moodle\.test\//);
    const file = path.join(profileDir, BACKGROUND_FILE);
    const record = JSON.parse(await readFile(file, "utf8")) as { endpoint: string; token: string; pid: number };
    assert.match(record.endpoint, /^ws:\/\/127\.0\.0\.1:/);
    assert.ok(record.token.length >= 40);
    // Readable only by the person.
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o077, 0);

    const again = await moodle(["open"]);
    assert.match(again.out, /^✔ Nothing: a background browser is already open/);
    for (const argv of [["list-courses"], ["list-courses", "--json"]]) {
      const result = await moodle(argv);
      assert.equal(result.status, 0, result.err);
      assert.deepEqual(result.made, ["connected"]);
      assert.match(result.out, /loops/);
    }
    assert.equal(launches, 1);
    assert.equal(existsSync(path.join(profileDir, LOCK_FILE)), false);
    const sites = await moodle(["sites", "--json"]);
    assert.equal((JSON.parse(sites.out) as { background: boolean }[])[0]!.background, true);
  });

  it("takes one command at a time: another waits, then says one is running", async () => {
    await writeFile(path.join(profileDir, LOCK_FILE), String(process.pid));
    const busy = await moodle(["list-courses"]);
    assert.deepEqual([busy.status, busy.err], [1, "browser-busy: Another command is working on the background browser of this profile: try again when it ends."]);
    // A lock left by a process that's gone is taken over.
    await writeFile(path.join(profileDir, LOCK_FILE), String(2 ** 22 + 7));
    assert.equal((await moodle(["list-courses"])).status, 0);
  });

  it("is used by moodle shell, a line at a time", async () => {
    const input = new PassThrough();
    const d = deps(input);
    const done = run(["shell"], d.deps);
    input.end("list-courses\nwho-am-i\n");
    assert.equal(await done, 0);
    assert.deepEqual(d.made, ["connected", "connected"]);
    assert.equal(launches, 1);
  });

  it("closes, and a stale file is removed", async () => {
    const closed = await moodle(["close"]);
    assert.equal(closed.status, 0, closed.err);
    assert.match(closed.out, /^✔ Closed the background browser/);
    assert.equal(existsSync(path.join(profileDir, BACKGROUND_FILE)), false);
    const none = await moodle(["close"]);
    assert.equal(none.status, 1);
    assert.match(none.err, /^not-found: there's no background browser/);

    // A process that's gone left its file: the command launches its own, and the file goes.
    await writeFile(path.join(profileDir, BACKGROUND_FILE), JSON.stringify({ endpoint: "ws://127.0.0.1:9/devtools/browser", token: "x", pid: 2 ** 22 + 7, channel: "chromium", headed: false }));
    const result = await moodle(["list-courses"]);
    assert.deepEqual([result.status, result.made], [0, ["launched"]]);
    assert.equal(existsSync(path.join(profileDir, BACKGROUND_FILE)), false);
  });
});
