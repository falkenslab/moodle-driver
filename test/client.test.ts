import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MOODLE_METHODS, MoodleUrlError, NotLoggedInError, createMoodle, type MoodleMethods } from "../src/index.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle } from "../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// Every bound method keeps a real signature: a function whose first parameters aren't (context, site) would bind as never.
type NeverMethods = { [K in keyof MoodleMethods]: MoodleMethods[K] extends never ? K : never }[keyof MoodleMethods];
const noneAreNever: [NeverMethods] extends [never] ? true : false = true;

describe("createMoodle", () => {
  it("normalizes the site, binds every site function, and refuses something that isn't a URL", () => {
    assert.equal(noneAreNever, true);
    const moodle = createMoodle({ site: "http://moodle.test/moodle?x=1", browser: fakeBrowserManager() });
    assert.equal(moodle.site, "http://moodle.test/moodle/");
    for (const name of MOODLE_METHODS) assert.equal(typeof moodle[name], "function", name);
    assert.throws(() => createMoodle({ site: "not a url", browser: fakeBrowserManager() }), MoodleUrlError);
  });

  it("calls the function with the browser's context and the site", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 4, fullName: "Ada Lovelace" },
      services: {
        core_course_get_enrolled_courses_by_timeline_classification: (args) => ({
          courses: args.classification === "past" ? [] : [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }],
        }),
        message_popup_get_popup_notifications: () => ({ notifications: [] }),
      },
    });
    let closed = false;
    const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, close: async () => void (closed = true) }) });
    assert.deepEqual((await moodle.listCourses()).map((c) => c.fullname), ["Loops"]);
    assert.deepEqual(await moodle.listCourses("past"), []);
    assert.deepEqual(await moodle.callService<{ notifications: unknown[] }>("message_popup_get_popup_notifications", { useridto: 0 }), { notifications: [] });
    assert.deepEqual(await moodle.logIn({ timeoutMs: 1000 }), { status: "already-logged-in", userId: 4, fullName: "Ada Lovelace" });
    await moodle.close();
    assert.equal(closed, true);
    await context.close();
  });

  it("passes the functions' errors as they are", { skip: !browser && "no system browser" }, async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {});
    const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context }) });
    await assert.rejects(moodle.whoAmI(), NotLoggedInError);
    await context.close();
  });
});
