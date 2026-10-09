import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MoodleCourse, NotLoggedInError, listCourses, toCourse } from "../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

// Shaped like Moodle 5.2's answer; the data is made up.
const RAW: MoodleCourse[] = [
  {
    id: 7,
    shortname: "PRG &amp; DB",
    fullname: "Programming &#039;101&#039; &amp; databases",
    coursecategory: "Computing &gt; First year",
    viewurl: `${SITE}course/view.php?id=7`,
    visible: false,
    startdate: 1_790_000_000,
    enddate: 0,
    progress: 40,
    hasprogress: true,
    timeaccess: 1_791_000_000,
  },
  { id: 2, shortname: "sandbox", fullname: "Sandbox", viewurl: `${SITE}course/view.php?id=2`, visible: true, startdate: 0, progress: null, hasprogress: false, timeaccess: null },
];

describe("toCourse", () => {
  it("decodes names, turns dates to ISO and leaves out what Moodle marks as none", () => {
    assert.deepEqual(toCourse(RAW[0]!), {
      id: 7,
      shortname: "PRG & DB",
      fullname: "Programming '101' & databases",
      category: "Computing > First year",
      url: `${SITE}course/view.php?id=7`,
      visible: false,
      startDate: new Date(1_790_000_000_000).toISOString(),
      endDate: undefined,
      progress: 40,
      lastAccess: new Date(1_791_000_000_000).toISOString(),
    });
    const plain = toCourse(RAW[1]!);
    assert.equal(plain.startDate, undefined);
    assert.equal(plain.progress, undefined);
    assert.equal(plain.lastAccess, undefined);
  });
});

describe("listCourses", { skip: !browser && "no system browser" }, () => {
  const services = { core_course_get_enrolled_courses_by_timeline_classification: () => ({ courses: RAW, nextoffset: 2 }) };

  it("lists the courses, including those hidden from the dashboard by default", async () => {
    const context = await browser!.newContext();
    const state: FakeMoodleState = { user: { id: 3, fullName: "T" }, services, serviceCalls: [] };
    await serveFakeMoodle(context, state);
    const courses = await listCourses(context, SITE);
    assert.deepEqual(courses.map((c) => [c.id, c.fullname]), [[7, "Programming '101' & databases"], [2, "Sandbox"]]);
    assert.equal(state.serviceCalls?.[0]?.args.classification, "allincludinghidden");
    await listCourses(context, SITE, "past");
    assert.equal(state.serviceCalls?.[1]?.args.classification, "past");
    await context.close();
  });

  it("throws NotLoggedInError without a session", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { services });
    await assert.rejects(listCourses(context, SITE), NotLoggedInError);
    await context.close();
  });
});
