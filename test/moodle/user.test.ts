import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MoodleServiceError, NotLoggedInError, whoAmI } from "../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A made-up site where user 9 has role 4 in course 5; `teacher` decides what they can do. */
function moodle(teacher: boolean): FakeMoodleState {
  return {
    user: { id: 9, fullName: "Grace Hopper" },
    bodies: {
      "/user/view.php": `<div id="region-main"><dl><dt>Roles</dt><dd><a href="${SITE}user/index.php?contextid=12&amp;roleid=4">Non-editing teacher</a></dd></dl></div>`,
    },
    services: {
      core_user_get_users_by_field: () => [{ id: 9, username: "grace", fullname: "Grace Hopper", email: "grace@example.org", firstaccess: 1_790_000_000, lastaccess: 0 }],
      tool_mobile_get_public_config: () => ({ sitename: "Test campus" }),
      core_courseformat_get_state: ({ courseid }) => {
        if (courseid !== 5) throw new ServiceFailure("invalidrecordunknown");
        return JSON.stringify({ section: [{ id: "50", number: 0, title: "General" }], cm: [] });
      },
      core_courseformat_get_section_content_items: () => ({ content_items: teacher ? [{ name: "page" }] : [] }),
      gradereport_grader_get_users_in_report: () => {
        if (!teacher) throw new ServiceFailure("nopermissions");
        return { users: [] };
      },
    },
  };
}

describe("whoAmI", { skip: !browser && "no system browser" }, () => {
  it("tells who the person is, without a course", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, moodle(true));
    // As a program would serialize it: the fields left undefined go.
    assert.deepEqual(JSON.parse(JSON.stringify(await whoAmI(context, SITE))), {
      userId: 9,
      username: "grace",
      fullName: "Grace Hopper",
      email: "grace@example.org",
      language: "en",
      timeZone: "Europe/Madrid",
      firstAccess: new Date(1_790_000_000_000).toISOString(),
      site: { name: "Test campus", url: SITE },
    });
    await context.close();
  });

  it("adds the roles and abilities in a course", async () => {
    for (const teacher of [true, false]) {
      const context = await browser!.newContext();
      await serveFakeMoodle(context, moodle(teacher));
      const me = await whoAmI(context, SITE, 5);
      assert.deepEqual(me.course, { id: 5, roles: [{ id: 4, name: "Non-editing teacher" }], canEdit: teacher, canGrade: teacher });
      await context.close();
    }
  });

  it("passes Moodle's error for a course it can't see, and NotLoggedInError without a session", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, moodle(false));
    await assert.rejects(whoAmI(context, SITE, 6), (error: unknown) => error instanceof MoodleServiceError && error.errorcode === "invalidrecordunknown");
    await context.close();
    const loggedOut = await browser!.newContext();
    await serveFakeMoodle(loggedOut, {});
    await assert.rejects(whoAmI(loggedOut, SITE), NotLoggedInError);
    await loggedOut.close();
  });
});
