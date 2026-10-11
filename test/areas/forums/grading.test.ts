import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { GradingError, NotAForumError, forumGrades, gradeForumUser } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** The forum page's "Grade users" button as Moodle 5.2 renders it, reduced; made-up forum in context 88. */
const button = (subtype = "point", component = "core_grades") =>
  `<button type="button" data-grade-action="launch" data-contextid="88" data-cmid="54" data-course-id="3" data-grading-component="${component}" data-grading-component-subtype="${subtype}" data-gradable-itemtype="forum" data-grade-only-active-users="1">Grade users</button>`;

/** Gradable users and the point grading panel's services, keeping the grades they're given. */
function fakeForum(body = button()) {
  const grades = new Map<number, number>([[4, 6]]);
  const stored: Record<string, unknown>[] = [];
  const panel = (userId: number) => ({
    templatename: "core_grades/grades/grader/gradingpanel/point",
    hasgrade: grades.has(userId),
    grade: { grade: grades.get(userId) ?? null, usergrade: grades.has(userId) ? `${grades.get(userId)!.toFixed(2)} / 10.00` : "-", maxgrade: "10", gradedby: "Teacher", timecreated: 1791741600, timemodified: 1791741600 },
    warnings: [],
  });
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    bodies: { "/mod/forum/view.php": body },
    serviceCalls: [],
    services: {
      core_grades_get_gradable_users: () => ({ users: [{ id: 4, fullname: "Ana Student" }, { id: 5, fullname: "Bruno Student" }], warnings: [] }),
      core_grades_grader_gradingpanel_point_fetch: ({ gradeduserid }) => panel(Number(gradeduserid)),
      core_grades_grader_gradingpanel_point_store: (args) => {
        stored.push(args);
        const grade = new URLSearchParams(String(args.formdata)).get("grade");
        if (grade === "") grades.delete(Number(args.gradeduserid));
        else grades.set(Number(args.gradeduserid), Number(grade));
        return panel(Number(args.gradeduserid));
      },
    },
  };
  return { state, stored };
}

describe("whole-forum grading", { skip: !browser && "no system browser" }, () => {
  it("reads everyone's forum grade through the grader's services", async () => {
    const fake = fakeForum();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, fake.state);
    assert.deepEqual(await forumGrades(context, SITE, 54), {
      activityId: 54,
      method: "point",
      maxGrade: 10,
      grades: [
        { userId: 4, fullName: "Ana Student", grade: "6.00 / 10.00", value: 6, gradedBy: "Teacher", gradedAt: "2026-10-11T18:00:00.000Z" },
        { userId: 5, fullName: "Bruno Student" },
      ],
    });
    assert.deepEqual(fake.state.serviceCalls!.find((c) => c.methodname === "core_grades_get_gradable_users")?.args, { courseid: 3, groupid: 0, onlyactive: true });
    await context.close();
  });

  it("grades a person, takes the grade away, and refuses one out of range", async () => {
    const fake = fakeForum();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, fake.state);
    const graded = await gradeForumUser(context, SITE, 54, 5, { grade: 8, notify: true });
    assert.equal(graded.changed, "User 5 graded 8.00 / 10.00 in forum 54, notified.");
    assert.equal(graded.grade.value, 8);
    assert.deepEqual(fake.stored[0], { component: "mod_forum", contextid: 88, itemname: "forum", gradeduserid: 5, notifyuser: true, formdata: "grade=8" });
    assert.deepEqual((await gradeForumUser(context, SITE, 54, 5, { grade: null })).grade, { userId: 5 });
    assert.equal(fake.stored[1]?.formdata, "grade=");
    await assert.rejects(gradeForumUser(context, SITE, 54, 5, { grade: 11 }), /takes grades from 0 to 10, not 11/);
    await context.close();
  });

  it("says when the forum isn't graded as a whole, or uses advanced grading", async () => {
    for (const [body, expected] of [
      ["", /isn't graded as a whole/],
      [button("rubric", "gradingform_rubric"), /advanced grading method \(gradingform_rubric\)/],
    ] as const) {
      const context = await browser!.newContext();
      await serveFakeMoodle(context, fakeForum(body).state);
      await assert.rejects(forumGrades(context, SITE, 54), (error: Error) => error instanceof GradingError && expected.test(error.message));
      await context.close();
    }
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
    await context.route(`${SITE}mod/forum/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-view" }) }));
    await assert.rejects(forumGrades(context, SITE, 27), NotAForumError);
    await context.close();
  });
});
