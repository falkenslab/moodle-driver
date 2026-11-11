import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Page } from "playwright-core";
import { FOLLOWED_PAGES, MOODLE_METHODS, createMoodle } from "../src/index.js";
import { UNFOLLOWED_METHODS } from "../src/followed-pages.js";
import { followPages } from "../src/core/session.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

describe("FOLLOWED_PAGES", () => {
  it("has a page, or says it has none, for every method of the Moodle object", () => {
    const missing = MOODLE_METHODS.filter((name) => !(name in FOLLOWED_PAGES) && !UNFOLLOWED_METHODS.includes(name as never));
    assert.deepEqual(missing, [], `give these a page in FOLLOWED_PAGES, or list them in UNFOLLOWED_METHODS (src/followed-pages.ts): ${missing.join(", ")}`);
  });

  it("names only methods, none both with a page and without", () => {
    for (const name of [...Object.keys(FOLLOWED_PAGES), ...UNFOLLOWED_METHODS]) assert.ok(MOODLE_METHODS.includes(name), name);
    for (const name of UNFOLLOWED_METHODS) assert.ok(!(name in FOLLOWED_PAGES), name);
  });

  it("builds each page from the call's arguments and result", () => {
    assert.equal(FOLLOWED_PAGES.gradeSubmission!([7, 4, { grade: 8 }], {} as never), "mod/assign/view.php?id=7&action=grader&userid=4");
    assert.equal(FOLLOWED_PAGES.editActivity!([3, 12, {}], {} as never), "course/view.php?id=3");
    assert.equal(FOLLOWED_PAGES.discussion!([9], {} as never), "mod/forum/discuss.php?d=9");
    assert.equal(FOLLOWED_PAGES.deadlines!([], [] as never), "calendar/view.php?view=upcoming");
    assert.equal(FOLLOWED_PAGES.createEvent!([{ courseId: 3, name: "Exam", start: new Date(0) }], { changed: "", event: { id: 1, name: "Exam", type: "course", start: "2026-10-18T10:00:00.000Z", courseId: 3 } }), "calendar/view.php?view=day&time=1792317600&course=3");
  });
});

// Shaped like Moodle 5.2's answers; the data is made up.
const COURSES = { courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }] };
const STATE = { section: [{ id: "10", number: 0, title: "General", cmlist: ["20"] }], cm: [{ id: "20", name: "Welcome", module: "page", visible: true, uservisible: true, accessvisible: true, sectionid: "10", istrackeduser: false }] };

describe("The Moodle object's methods", { skip: !browser && "no system browser" }, () => {
  async function setUp(visible: boolean, show: (url: string) => Promise<void>) {
    const context = await browser!.newContext();
    const state: FakeMoodleState = {
      user: { id: 4, fullName: "Ada Lovelace" },
      pagesServed: [],
      bodies: { "/course/view.php": `<ul><li class="activity" data-for="cmitem" data-id="20"></li></ul>` },
      services: {
        core_course_get_enrolled_courses_by_timeline_classification: () => COURSES,
        core_courseformat_get_state: () => JSON.stringify(STATE),
      },
    };
    await serveFakeMoodle(context, state);
    followPages(context, show);
    const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, visible: () => visible }) });
    return { context, moodle, state };
  }

  it("show the page of an AJAX call's work while the browser is visible", async () => {
    const shown: string[] = [];
    const { context, moodle } = await setUp(true, async (url) => void shown.push(url));
    assert.deepEqual((await moodle.listCourses()).map((c) => c.id), [3]);
    await moodle.courseStructure(3);
    assert.deepEqual(shown, [`${SITE}my/courses.php`, `${SITE}course/view.php?id=3`]);
    await context.close();
  });

  it("show nothing more after a call that showed its own page", async () => {
    const shown: string[] = [];
    const { context, moodle } = await setUp(true, async (url) => void shown.push(url));
    // With details, the course page is opened (and followed) by the function itself.
    await moodle.courseStructure(3, { details: true });
    assert.deepEqual(shown, [`${SITE}course/view.php?id=3`]);
    await context.close();
  });

  it("show nothing, and load no page, while the browser is hidden", async () => {
    const shown: string[] = [];
    const { context, moodle, state } = await setUp(false, async (url) => void shown.push(url));
    await moodle.listCourses();
    await moodle.courseStructure(3);
    assert.deepEqual(shown, []);
    assert.deepEqual(state.pagesServed!.filter((p) => ["/my/courses.php", "/course/view.php"].includes(p)), []);
    await context.close();
  });

  it("show the result's page last, after the pages the call worked in", async () => {
    const shown: string[] = [];
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 4, fullName: "Ada Lovelace" },
      bodies: { "/mod/h5pactivity/view.php": `<div data-activityname="Quick check"></div>`, "/mod/h5pactivity/report.php": `<div id="region-main"><p>No attempts yet</p></div>` },
    });
    followPages(context, async (url) => void shown.push(url));
    const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, visible: () => true }) });
    // h5pActivity reads the activity's page, then its report: the activity is what it shows at the end.
    await moodle.h5pActivity(20);
    assert.deepEqual(shown.slice(-2), [`${SITE}mod/h5pactivity/report.php?id=20`, `${SITE}mod/h5pactivity/view.php?id=20`]);
    await context.close();
  });

  it("return the call's result when the page can't be shown", async () => {
    const { context, moodle } = await setUp(true, async () => {
      throw new Error("the window was closed");
    });
    assert.deepEqual((await moodle.listCourses()).map((c) => c.id), [3]);
    await context.close();
  });
});

describe("Following while the person watches (#101)", { skip: !browser && "no system browser" }, () => {
  /** A follower as a manager with a window has: a working tab, a function's tab handed over to it. */
  function watching(context: BrowserContext) {
    let work: Page | undefined;
    const follower = {
      watching: () => true,
      show: async (url: string) => {
        const tab = await follower.tab();
        if (tab.url() !== url) await tab.goto(url, { waitUntil: "domcontentloaded" });
      },
      adopt: async (page: Page) => {
        const previous = work;
        work = page;
        if (previous && previous !== page) await previous.close();
        return true;
      },
      tab: async () => (work && !work.isClosed() ? work : (work = await context.newPage())),
    };
    return follower;
  }

  async function setUp() {
    const context = await browser!.newContext();
    const state: FakeMoodleState = {
      user: { id: 4, fullName: "Ada Lovelace" },
      pagesServed: [],
      bodies: {
        "/course/view.php": `<ul><li class="activity" data-for="cmitem" data-id="20"></li></ul>`,
        "/mod/forum/discuss.php": `<a href="#" data-type="subscription-toggle" data-discussionid="9" data-targetstate="0">Unsubscribe</a>`,
      },
      services: {
        core_courseformat_get_state: () => JSON.stringify(STATE),
        mod_forum_get_discussion_posts: () => ({ posts: [], forumid: 5, courseid: 3 }),
      },
    };
    await serveFakeMoodle(context, state);
    const follower = watching(context);
    followPages(context, follower);
    const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, visible: () => true }) });
    return { context, moodle, state, follower };
  }

  it("hands a function's tab over as the working tab: the page loads once, and stays in sight", async () => {
    const { context, moodle, state, follower } = await setUp();
    await moodle.courseStructure(3, { details: true });
    assert.deepEqual(state.pagesServed!.filter((p) => p === "/course/view.php"), ["/course/view.php"]);
    assert.equal((await follower.tab()).url(), `${SITE}course/view.php?id=3`);
    await context.close();
  });

  it("loads a page read over HTTP in the working tab instead, once, and reads it from there", async () => {
    const { context, moodle, state, follower } = await setUp();
    const read = await moodle.discussion(9);
    assert.equal(read.discussion.subscribed, true, "read from the HTML the working tab loaded");
    assert.deepEqual(state.pagesServed!.filter((p) => p === "/mod/forum/discuss.php"), ["/mod/forum/discuss.php"], "the result page is that same load");
    assert.equal((await follower.tab()).url(), `${SITE}mod/forum/discuss.php?d=9`);
    await context.close();
  });
});
