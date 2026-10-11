import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { MoodleError, createMoodle, siteProfileDir } from "../../src/index.js";
import { cliHome, legacyHome, listSites, migrate, tidy } from "../../src/cli/config.js";
import { run, type CliDeps } from "../../src/cli/run.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const temps: string[] = [];
after(() => Promise.all(temps.map((dir) => rm(dir, { recursive: true, force: true }))));
async function temp(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-home-"));
  temps.push(dir);
  return dir;
}

describe("the command's home", () => {
  it("is ~/.moodle-driver on every system, or MOODLE_DRIVER_HOME", () => {
    assert.equal(cliHome({}, "/home/ada"), path.join("/home/ada", ".moodle-driver"));
    assert.equal(cliHome({ MOODLE_DRIVER_HOME: "/srv/moodle" }, "/home/ada"), "/srv/moodle");
    assert.equal(legacyHome({ APPDATA: "C:\\Users\\ada\\AppData\\Roaming" }, "win32", "C:\\Users\\ada"), path.join("C:\\Users\\ada\\AppData\\Roaming", "moodle-driver"));
    assert.equal(legacyHome({}, "linux", "/home/ada"), path.join("/home/ada", ".config", "moodle-driver"));
  });

  it("gives each site a folder, and each account on it a profile", () => {
    const home = path.join("/home/ada", ".moodle-driver");
    assert.equal(siteProfileDir("https://campus.example.org", { home }), path.join(home, "sites", "campus.example.org", "profiles", "default"));
    assert.equal(siteProfileDir("http://localhost:8080/moodle/", { as: "teacher", home }), path.join(home, "sites", "localhost_8080", "profiles", "teacher"));
    assert.equal(siteProfileDir(SITE, { as: "default", home }), siteProfileDir(SITE, { home }));
    assert.equal(siteProfileDir(SITE), path.join(cliHome({}), "sites", "moodle.test", "profiles", "default"));
    assert.throws(() => siteProfileDir(SITE, { as: "../x", home }), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
  });

  it("moves what an older version kept, once, and keeps a profile folder of the person's own where it is", async () => {
    const base = await temp();
    const legacy = path.join(base, "old");
    const home = path.join(base, "new");
    const own = path.join(base, "elsewhere");
    await mkdir(path.join(legacy, "profiles", "moodle.test"), { recursive: true });
    await writeFile(path.join(legacy, "profiles", "moodle.test", "moodle-session.json"), "[]");
    await writeFile(
      path.join(legacy, "config.json"),
      JSON.stringify({ site: SITE, profiles: { [SITE]: path.join(legacy, "profiles", "moodle.test"), "https://other.example.org/": own } }),
    );
    assert.equal(migrate(home, legacy), `Moved moodle's sites and sessions from ${legacy} to ${home}.`);
    assert.ok(existsSync(path.join(home, "sites", "moodle.test", "profiles", "default", "moodle-session.json")));
    assert.deepEqual(JSON.parse(await readFile(path.join(home, "config.json"), "utf8")), { site: SITE });
    assert.deepEqual(JSON.parse(await readFile(path.join(home, "sites", "other.example.org", "site.json"), "utf8")), { url: "https://other.example.org/", profileDir: own });
    assert.equal(existsSync(legacy), false);
    // Only once: the home is there now.
    assert.equal(migrate(home, legacy), undefined);
  });

  it("moves a site's profile/ from an early build to profiles/default", async () => {
    const home = await temp();
    await mkdir(path.join(home, "sites", "moodle.test", "profile"), { recursive: true });
    await writeFile(path.join(home, "sites", "moodle.test", "profile", "moodle-session.json"), "[]");
    tidy(home);
    assert.ok(existsSync(path.join(siteProfileDir(SITE, { home }), "moodle-session.json")));
    assert.equal(existsSync(path.join(home, "sites", "moodle.test", "profile")), false);
  });
});

/** Runs a command line with the home given, collecting what it prints and the profile each browser got. */
async function moodle(home: string, context: BrowserContext | undefined, argv: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const profiles: string[] = [];
  const deps: CliDeps = {
    createMoodle: (options) => {
      profiles.push("profileDir" in options ? options.profileDir : "");
      return createMoodle({ site: options.site, browser: fakeBrowserManager({ context: async () => context! }) });
    },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env,
    cwd: "/home/ada",
    home,
    interactive: false,
    version: "9.9.9",
  };
  const status = await run(argv, deps);
  return { status, out: out.join("\n"), err: err.join("\n"), profiles };
}

describe("sites and accounts from the command", { skip: !browser && "no system browser" }, () => {
  it("logs in per site and per account, lists them, and forgets one", async () => {
    const home = await temp();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Ada Lovelace" } });

    const first = await moodle(home, context, ["login", "--site", SITE]);
    assert.equal(first.status, 0, first.err);
    assert.deepEqual(first.profiles, [siteProfileDir(SITE, { home })]);
    const teacher = await moodle(home, context, ["login", "--site", SITE, "--as", "teacher"]);
    assert.deepEqual(teacher.profiles, [siteProfileDir(SITE, { as: "teacher", home })]);
    // The site remembers the account last logged in with; another one is a flag (or MOODLE_AS) away.
    assert.deepEqual((await moodle(home, context, ["who-am-i"])).profiles, [siteProfileDir(SITE, { as: "teacher", home })]);
    assert.deepEqual((await moodle(home, context, ["who-am-i"], { MOODLE_AS: "default" })).profiles, [siteProfileDir(SITE, { home })]);
    assert.deepEqual((await moodle(home, context, ["who-am-i", "--profile", "/tmp/mine"])).profiles, ["/tmp/mine"]);

    const sites = JSON.parse((await moodle(home, undefined, ["sites"])).out) as { site: string; profile: string; default: boolean }[];
    assert.deepEqual(
      sites.map((s) => [s.site, s.profile, s.default]),
      [
        [SITE, "default", false],
        [SITE, "teacher", true],
      ],
    );
    assert.deepEqual(listSites(home).map((s) => s.path), [siteProfileDir(SITE, { home }), siteProfileDir(SITE, { as: "teacher", home })]);

    const forgotTeacher = await moodle(home, undefined, ["forget", SITE, "--as", "teacher"]);
    assert.deepEqual([forgotTeacher.status, forgotTeacher.out], [0, `✔ Deleted ${siteProfileDir(SITE, { as: "teacher", home })}`]);
    assert.deepEqual((await moodle(home, context, ["who-am-i"])).profiles, [siteProfileDir(SITE, { home })]);
    const forgotSite = await moodle(home, undefined, ["forget", SITE]);
    assert.equal(forgotSite.status, 0, forgotSite.err);
    assert.equal(existsSync(path.join(home, "sites", "moodle.test")), false);
    assert.deepEqual(JSON.parse(await readFile(path.join(home, "config.json"), "utf8")), {});
    const again = await moodle(home, undefined, ["forget", SITE]);
    assert.deepEqual([again.status, /isn't a site logged in to/.test(again.err)], [1, true]);
    await context.close();
  });
});
