import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { MoodleError, createMoodle, siteProfileDir } from "../../src/index.js";
import { cliHome, listSites } from "../../src/cli/config.js";
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
  });

  it("gives each account on a site a named profile, the default named in site.json", async () => {
    const home = await temp();
    assert.equal(siteProfileDir("http://localhost:8080/moodle/", { as: "teacher", home }), path.join(home, "sites", "localhost_8080", "profiles", "teacher"));
    assert.throws(() => siteProfileDir(SITE, { as: "../x", home }), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
    assert.throws(() => siteProfileDir(SITE, { home }), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
    await mkdir(path.join(home, "sites", "moodle.test"), { recursive: true });
    await writeFile(path.join(home, "sites", "moodle.test", "site.json"), JSON.stringify({ url: SITE, default: "ada" }));
    assert.equal(siteProfileDir(SITE, { home }), path.join(home, "sites", "moodle.test", "profiles", "ada"));
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

const readJson = async (file: string) => JSON.parse(await readFile(file, "utf8")) as unknown;

describe("sites and accounts from the command", { skip: !browser && "no system browser" }, () => {
  it("names a first login's profile after the Moodle username, and keeps the default in site.json", async () => {
    const home = await temp();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 4, fullName: "Ada Lovelace" },
      services: { core_user_get_users_by_field: () => [{ id: 4, username: "ada.lovelace", fullname: "Ada Lovelace" }] },
    });
    const profiles = path.join(home, "sites", "moodle.test", "profiles");

    const first = await moodle(home, context, ["login", "--site", SITE]);
    assert.equal(first.status, 0, first.err);
    // Logged in with a provisional folder, then named after the username; nothing provisional left.
    assert.match(first.profiles[0]!, /[/\\]profiles[/\\]\.login-\d+$/);
    assert.deepEqual(readdirSync(profiles), ["ada.lovelace"]);
    assert.deepEqual(await readJson(path.join(home, "sites", "moodle.test", "site.json")), { url: SITE, default: "ada.lovelace" });
    assert.deepEqual(await readJson(path.join(home, "config.json")), { site: SITE });
    assert.deepEqual((await moodle(home, context, ["who-am-i"])).profiles, [path.join(profiles, "ada.lovelace")]);

    // Another account, by name: it becomes the default; --as or MOODLE_AS picks either.
    assert.deepEqual((await moodle(home, context, ["login", "--as", "teacher"])).profiles, [path.join(profiles, "teacher")]);
    assert.deepEqual(await readJson(path.join(home, "sites", "moodle.test", "site.json")), { url: SITE, default: "teacher" });
    assert.deepEqual((await moodle(home, context, ["who-am-i"])).profiles, [path.join(profiles, "teacher")]);
    assert.deepEqual((await moodle(home, context, ["who-am-i"], { MOODLE_AS: "ada.lovelace" })).profiles, [path.join(profiles, "ada.lovelace")]);
    assert.deepEqual((await moodle(home, context, ["who-am-i", "--profile", "/tmp/mine"])).profiles, ["/tmp/mine"]);

    const sites = JSON.parse((await moodle(home, undefined, ["sites"])).out) as { site: string; profile: string; default: boolean }[];
    assert.deepEqual(
      sites.map((s) => [s.profile, s.default]),
      [
        ["ada.lovelace", false],
        ["teacher", true],
      ],
    );
    assert.deepEqual(listSites(home).map((s) => s.path), [path.join(profiles, "ada.lovelace"), path.join(profiles, "teacher")]);

    // Forgetting the default leaves the site without one: commands ask for a login or a name.
    const forgot = await moodle(home, undefined, ["forget", SITE, "--as", "teacher"]);
    assert.deepEqual([forgot.status, forgot.out], [0, `✔ Deleted ${path.join(profiles, "teacher")}`]);
    const none = await moodle(home, context, ["who-am-i"]);
    assert.deepEqual([none.status, none.err.split("\n")[0]], [2, `${SITE} has no default profile: pick one with --as (ada.lovelace), or make one the default with \`moodle login --as <name>\`.`]);
    assert.deepEqual((await moodle(home, context, ["--as", "ada.lovelace", "who-am-i"])).profiles, [path.join(profiles, "ada.lovelace")]);
    // A login without a name finds the username's profile again.
    assert.equal((await moodle(home, context, ["login"])).status, 0);
    assert.deepEqual(readdirSync(profiles), ["ada.lovelace"]);
    assert.equal(siteProfileDir(SITE, { home }), path.join(profiles, "ada.lovelace"));

    const gone = await moodle(home, undefined, ["forget", SITE]);
    assert.equal(gone.status, 0, gone.err);
    assert.equal(existsSync(path.join(home, "sites", "moodle.test")), false);
    assert.deepEqual(await readJson(path.join(home, "config.json")), {});
    await context.close();
  });

  it("remembers a profile folder of the person's own, and names an account by id when Moodle hides the username", async () => {
    const home = await temp();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Ada Lovelace" } });
    const own = path.join(home, "my-profile");
    assert.equal((await moodle(home, context, ["login", "--site", SITE, "--profile", own])).status, 0);
    assert.deepEqual(await readJson(path.join(home, "sites", "moodle.test", "site.json")), { url: SITE, profileDir: own });
    assert.deepEqual((await moodle(home, context, ["who-am-i"])).profiles, [own]);
    assert.deepEqual(JSON.parse((await moodle(home, undefined, ["sites"])).out).map((s: { profile: string; default: boolean }) => [s.profile, s.default]), [["--profile", true]]);

    // No username from Moodle (the fake has no user service): the profile is named by the user's id.
    const other = await temp();
    assert.equal((await moodle(other, context, ["login", "--site", SITE])).status, 0);
    assert.deepEqual(readdirSync(path.join(other, "sites", "moodle.test", "profiles")), ["user-4"]);
    await context.close();
  });
});
