// The session and the site, against the sandbox: the model for the other files.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMoodle, findMoodleSite, parseSiteUrl, publicSiteInfo, siteName } from "../../src/index.js";
import { readWwwroot } from "../../src/internals.js";
import { followPages } from "../../src/core/session.js";
import { COURSE, SERIES, SITE, as, scratchCourse, userId } from "./harness.js";

describe("session and site", () => {
  it("publicSiteInfo: the site's name and login page, without the browser", async () => {
    const info = await publicSiteInfo(SITE);
    assert.ok(info.name);
    // Moodle's own wwwroot, without the trailing slash the driver's site URLs have.
    assert.equal(info.url, SITE.slice(0, -1));
  });

  it("whoAmI: each account is who the sandbox says", async () => {
    const student = await as("student");
    const me = await student.whoAmI(COURSE);
    assert.equal(me.userId, await userId("student"));
    assert.ok(me.course?.roles.some((role) => role.id === 5));
  });

  it("siteName: the site's name from a logged-in page", async () => {
    const teacher = await as("teacher");
    assert.ok(await siteName(await teacher.context(), SITE));
  });

  it("moodleVersion: the sandbox's branch and release, as a student", async () => {
    const student = await as("student");
    const version = await student.moodleVersion();
    assert.equal(version.branch, SERIES);
    assert.ok(version.release?.startsWith(`${SERIES}.`), version.release);
  });

  it("parseSiteUrl: the sandbox's URL normalized", () => {
    assert.equal(parseSiteUrl(SITE.slice(0, -1)), SITE);
  });

  it("readWwwroot: the sandbox's wwwroot from a page's HTML", async () => {
    const html = await (await fetch(SITE)).text();
    assert.equal(readWwwroot(html), SITE.slice(0, -1));
  });

  it("findMoodleSite: finds the sandbox from one of its course URLs", async () => {
    const found = await findMoodleSite(`${SITE}course/view.php?id=${COURSE}`);
    assert.equal(found, SITE);
  });
});

describe("following AJAX calls", () => {
  // The teacher's browser as the person would watch it: visible, its follower loading each page in
  // the working tab as the browser manager's `show` does (headless here, so it can be looked at).
  it("createMoodle: AJAX methods leave their page in the working tab while visible, nothing while hidden", { timeout: 600_000 }, async () => {
    const teacher = await as("teacher");
    const context = await teacher.context();
    const tab = await teacher.tab();
    let watching = true;
    const watched = createMoodle({ site: SITE, browser: { ...teacher.browser, visible: () => watching } });
    // Only the calls looked at are followed (not the setting up), and best effort, as `show` does.
    const shown: string[] = [];
    let recording = false;
    followPages(context, async (url) => {
      if (!recording) return;
      shown.push(url);
      if (tab.url() !== url) await tab.goto(url, { waitUntil: "domcontentloaded" }).catch(() => undefined);
    });
    try {
      const course = await scratchCourse("following");
      // The page asked for, loaded in the tab by the time the call returns (where Moodle may redirect:
      // my/courses.php goes to the dashboard on a site without the "My courses" page).
      const shows = async (call: () => Promise<unknown>, path: string) => {
        shown.length = 0;
        await tab.goto("about:blank");
        recording = true;
        await call().finally(() => (recording = false));
        assert.deepEqual(shown, [new URL(path, SITE).href]);
        assert.ok(tab.url().startsWith(SITE), tab.url());
      };
      await shows(() => watched.listCourses(), "my/courses.php");
      await shows(() => watched.courseStructure(course.id), `course/view.php?id=${course.id}`);
      const forumId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "forum", name: "Driver check following", visibility: "shown" })).activityId!;
      const { discussionId } = await teacher.startDiscussion(forumId, { subject: "Driver check following", message: "<p>Followed.</p>" });
      await shows(() => watched.discussion(discussionId!), `mod/forum/discuss.php?d=${discussionId}`);
      const assignmentId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "assign", name: "Driver check following", visibility: "shown", settings: { assignsubmission_onlinetext_enabled: true } })).activityId!;
      const studentId = await userId("student");
      await shows(() => watched.gradeSubmission(assignmentId, studentId, { grade: 70, notify: false }), `mod/assign/view.php?id=${assignmentId}&action=grader&userid=${studentId}`);
      await shows(() => watched.editActivity(course.id, forumId, { name: "Driver check following, renamed" }), `course/view.php?id=${course.id}`);
      // Hidden: no page is loaded for a call.
      shown.length = 0;
      await tab.goto("about:blank");
      watching = false;
      recording = true;
      await watched.courseStructure(course.id).finally(() => (recording = false));
      assert.deepEqual(shown, []);
      assert.equal(tab.url(), "about:blank");
    } finally {
      followPages(context, (url) => teacher.browser.show(url));
    }
  });
});
