import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { firefox } from "playwright-core";
import { createBrowserManager } from "../../src/browser/manager.js";
import { createMoodle } from "../../src/index.js";
import { SITE, serveFakeMoodle } from "../../src/testing/index.js";

// Only where Playwright's Firefox is there to launch (the test container has it).
const available = await firefox.launch({ headless: true }).then(
  async (browser) => (await browser.close(), true),
  () => false,
);

let profileDir: string;
before(async () => {
  profileDir = await mkdtemp(path.join(tmpdir(), "moodle-driver-firefox-"));
});
after(async () => {
  await rm(profileDir, { recursive: true, force: true });
});

describe("Firefox as the browser", { skip: !available && "no Firefox to launch" }, () => {
  it("works Moodle through Playwright's Firefox, and keeps the session across launches", async () => {
    const options = { profileDir, channel: "firefox" as const, headless: true, downloadBrowser: false };
    const first = createBrowserManager(options);
    const context = await first.context();
    assert.equal(first.openChannel(), "firefox");
    await serveFakeMoodle(context, {
      user: { id: 4, fullName: "Ada Lovelace" },
      services: {
        core_course_get_enrolled_courses_by_timeline_classification: () => ({ courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }] }),
      },
    });
    const moodle = createMoodle({ site: SITE, browser: first });
    assert.deepEqual((await moodle.listCourses()).map((c) => c.fullname), ["Loops"]);
    await context.addCookies([{ name: "MoodleSession", value: "s3cret", domain: "moodle.test", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }]);
    await moodle.close();

    // The session cookie comes back in the next launch on the profile (ADR-003).
    const second = createBrowserManager(options);
    const reopened = await second.context();
    assert.deepEqual((await reopened.cookies(SITE)).map((c) => [c.name, c.value]), [["MoodleSession", "s3cret"]]);
    await second.close();
  });
});
