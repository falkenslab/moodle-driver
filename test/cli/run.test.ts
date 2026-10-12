import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { createMoodle } from "../../src/index.js";
import { run, type CliDeps } from "../../src/cli/run.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

let home: string;
before(async () => {
  home = await mkdtemp(path.join(tmpdir(), "moodle-driver-cli-"));
});
after(() => rm(home, { recursive: true, force: true }));

/** Runs a command line against `context`, collecting what it prints. */
async function moodle(context: BrowserContext | undefined, argv: string[], { interactive = true } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    createMoodle: (options) => createMoodle({ site: options.site, browser: fakeBrowserManager({ context: async () => context! }) }),
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: {},
    cwd: "/home/ada",
    home,
    interactive,
    version: "9.9.9",
  };
  const status = await run(argv, deps);
  return { status, out: out.join("\n"), err: err.join("\n") };
}

function state(): FakeMoodleState {
  return {
    user: { id: 4, fullName: "Ada Lovelace" },
    serviceCalls: [],
    services: {
      core_course_get_enrolled_courses_by_timeline_classification: () => ({ courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }] }),
      core_completion_update_activity_completion_status_manually: () => ({ status: true, warnings: [] }),
      // Three notifications, newest first, paged by the service's limit and offset.
      message_popup_get_popup_notifications: ({ limit, offset }) => {
        const all = [3, 2, 1].map((id) => ({ id, useridfrom: 3, subject: `Note ${id}`, fullmessage: "x", smallmessage: "", timecreated: 1_790_000_000 + id, read: false }));
        return { notifications: all.slice(offset as number, (limit as number) ? (offset as number) + (limit as number) : undefined), unreadcount: 3 };
      },
    },
  };
}

describe("the moodle command", () => {
  it("helps without a site: the overview, a command, the version", async () => {
    const overview = await moodle(undefined, ["help"]);
    assert.equal(overview.status, 0);
    assert.match(overview.out, /Usage: moodle <command>/);
    assert.match(overview.out, /\n {2}list-courses +The courses the person is enrolled in/);
    const one = await moodle(undefined, ["grade-submission", "--help"]);
    assert.match(one.out, /Usage: moodle grade-submission <activityId> <userId> \[--options\]/);
    assert.match(one.out, /--notify/);
    assert.match(one.out, /Data: others-personal, others-write/);
    assert.equal((await moodle(undefined, ["--version"])).out, "9.9.9");
  });

  it("asks for a site before anything that needs one, and explains a wrong line", async () => {
    const noSite = await moodle(undefined, ["list-courses"]);
    assert.deepEqual([noSite.status, /moodle login --site/.test(noSite.err)], [2, true]);
    // What anyone can ask needs no profile (the fake site isn't reachable without a browser: any error but that one).
    const open = await moodle(undefined, ["--site", SITE, "public-site-info"]);
    assert.doesNotMatch(open.err, /No profile/);
    const unknown = await moodle(undefined, ["--site", SITE, "list-cursos"]);
    assert.deepEqual([unknown.status, /no command "list-cursos"/.test(unknown.err)], [2, true]);
  });

  it("logs in, remembers the site, and reads as a table or as JSON", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state());
    const login = await moodle(context, ["login", "--site", SITE]);
    assert.equal(login.status, 0, login.err);
    assert.match(login.out, /status +already-logged-in/);
    const saved = JSON.parse(await readFile(path.join(home, "config.json"), "utf8")) as { site: string };
    assert.equal(saved.site, SITE);
    // The fake gives no username: the profile is named by the user's id.
    assert.deepEqual(JSON.parse(await readFile(path.join(home, "sites", "moodle.test", "site.json"), "utf8")), { url: SITE, default: "user-4" });

    // The site comes from the config now.
    const table = await moodle(context, ["list-courses"]);
    assert.equal(table.status, 0, table.err);
    assert.match(table.out, /^id +shortname +fullname/);
    assert.match(table.out, /\n3 +loops +Loops/);
    const json = await moodle(context, ["list-courses", "--json"]);
    assert.deepEqual((JSON.parse(json.out) as { id: number }[]).map((c) => c.id), [3]);
    // Not a terminal: JSON without asking.
    const piped = await moodle(context, ["list-courses"], { interactive: false });
    assert.equal((JSON.parse(piped.out) as unknown[]).length, 1);
    await context.close();
  });

  it("shows a page of a long list as its items, and says when there are more", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state());
    const first = await moodle(context, ["--site", SITE, "notifications", "--limit", "2"]);
    assert.equal(first.status, 0, first.err);
    assert.match(first.out, /^id +subject/);
    assert.match(first.out, /\n3 +Note 3.*\n2 +Note 2.*\n\n\(more after these: ask again with a larger --offset\)$/s);
    const last = await moodle(context, ["--site", SITE, "notifications", "--limit", "2", "--offset", "2"]);
    assert.match(last.out, /\n1 +Note 1/);
    assert.doesNotMatch(last.out, /more after these/);
    const json = await moodle(context, ["--site", SITE, "notifications", "--limit", "2", "--offset", "2", "--json"]);
    assert.deepEqual([(JSON.parse(json.out) as { items: { id: number }[]; more: boolean }).items.map((n) => n.id), JSON.parse(json.out).more], [[1], false]);
    await context.close();
  });

  it("says what a write changed, and refuses what --allow doesn't", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    const fake = state();
    await serveFakeMoodle(context, fake);
    const done = await moodle(context, ["--site", SITE, "set-completion", "5", "true"]);
    assert.equal(done.status, 0, done.err);
    assert.match(done.out, /^✔ /);
    assert.deepEqual(fake.serviceCalls!.at(-1)?.args, { cmid: 5, completed: true });
    const refused = await moodle(context, ["--site", SITE, "--allow", "own,course-content", "grade-submission", "35", "7", "--grade", "8"]);
    assert.deepEqual([refused.status, refused.err], [1, "refused: grade-submission touches others-personal, others-write, outside --allow own,course-content."]);
    await context.close();
  });

  it("exits 1 with the error's code when Moodle's session is gone", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {});
    const result = await moodle(context, ["--site", SITE, "list-courses"]);
    assert.equal(result.status, 1);
    assert.match(result.err, /^not-logged-in: .*\nLog in again with `moodle login`\.$/);
    await context.close();
  });
});
