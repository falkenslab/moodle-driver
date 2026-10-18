import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MoodleError, moodleVersion } from "../../src/index.js";
import { compareBranches, requireMoodle } from "../../src/core/version.js";
import { SITE, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

describe("compareBranches", () => {
  it("orders branches by number, not by text", () => {
    assert.equal(compareBranches("4.5", "5.0"), -1);
    assert.equal(compareBranches("5.2", "5.2"), 0);
    assert.equal(compareBranches("5.10", "5.2"), 1);
  });
});

describe("moodleVersion and requireMoodle", { skip: !browser && "no system browser" }, () => {
  async function site(state: Partial<FakeMoodleState>) {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, ...state });
    return context;
  }

  it("reads the release from LTI's platform configuration, once per context", async () => {
    const state: Partial<FakeMoodleState> = { release: "5.2.4 (Build: 20261005)" };
    const context = await site(state);
    assert.deepEqual(await moodleVersion(context, SITE), { branch: "5.2", release: "5.2.4 (Build: 20261005)" });
    state.release = "4.5.15 (Build: 20261005)";
    assert.equal((await moodleVersion(context, SITE)).branch, "5.2");
    await context.close();
  });

  it("tells 4.5 by its modules when the release is hidden; a 5.x or older site stays unknown", async () => {
    for (const [components, branch] of [[["mod/subsection"], "4.5"], [["mod/subsection", "mod/qbank"], "unknown"], [[], "unknown"]] as const) {
      const context = await site({ components: [...components] });
      assert.deepEqual(await moodleVersion(context, SITE), { branch });
      await context.close();
    }
  });

  it("refuses what the site's Moodle is too old for, naming the minimum and the version; unknown lets it through", async () => {
    const old = await site({ release: "4.5.15 (Build: 20261005)" });
    await assert.rejects(requireMoodle(old, SITE, "5.0", "something"), (error: unknown) => error instanceof MoodleError && error.code === "not-available" && error.message === "something needs Moodle 5.0 or later; this site runs 4.5.");
    await requireMoodle(old, SITE, "4.5", "something");
    await old.close();
    const unknown = await site({});
    await requireMoodle(unknown, SITE, "5.0", "something");
    await unknown.close();
  });
});
