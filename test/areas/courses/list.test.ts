import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CourseError, FormError, MoodleCourse, NotLoggedInError, listCourses, toCourse, updateCourse } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";
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

describe("updateCourse", { skip: !browser && "no system browser" }, () => {
  /** The course settings form, reduced and made up, as Moodle 5.2's course/edit.php: a taken short name fails. */
  function fakeSettings() {
    const course = { id: 3, shortname: "loops", fullname: "Loops" };
    const posted: URLSearchParams[] = [];
    const form = (error = "") =>
      moodlePage({
        userId: 3,
        bodyId: "page-course-edit",
        body: `<form class="mform" method="post" action="${SITE}course/edit.php"><input type="hidden" name="id" value="3"><input name="fullname" value="${course.fullname}"><input name="shortname" value="${course.shortname}"><div id="id_error_shortname">${error}</div>
<textarea name="summary_editor[text]"></textarea><input type="submit" name="saveanddisplay" value="Save and display"></form>`,
      });
    const state: FakeMoodleState = {
      user: { id: 3, fullName: "Teacher" },
      services: {
        core_course_get_enrolled_courses_by_timeline_classification: () => ({ courses: [{ ...course, viewurl: `${SITE}course/view.php?id=3`, visible: true }] }),
      },
    };
    return { course, posted, form, state };
  }

  it("changes names and summary through the settings form and gives the course afterwards", async () => {
    const fake = fakeSettings();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, fake.state);
    await context.route(`${SITE}course/edit.php**`, (route) => {
      if (route.request().method() === "POST") {
        const data = new URLSearchParams(route.request().postData() ?? "");
        fake.posted.push(data);
        if (data.get("shortname") === "taken") return route.fulfill({ status: 200, contentType: "text/html", body: fake.form("Short name is already used for another course (Other)") });
        fake.course.fullname = data.get("fullname")!;
        return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-course-view" }) });
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: fake.form() });
    });
    const result = await updateCourse(context, SITE, 3, { fullName: "Loops and lists", summary: "<p>About loops.</p>" });
    assert.equal(result.course?.fullname, "Loops and lists");
    assert.equal(fake.posted[0]?.get("summary_editor[text]"), "<p>About loops.</p>");
    await assert.rejects(updateCourse(context, SITE, 3, { shortName: "taken" }), (error: Error) => error instanceof FormError && /shortname: Short name is already used/.test(error.message));
    await context.close();
  });

  it("refuses a course whose settings the person can't open", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/course/edit.php": `<div data-rel="fatalerror">No permission.</div>` } });
    await assert.rejects(updateCourse(context, SITE, 3, { fullName: "No" }), CourseError);
    await context.close();
  });
});

describe("forms without a session", { skip: !browser && "no system browser" }, () => {
  it("say the session ended, not that the person isn't allowed", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {});
    await assert.rejects(updateCourse(context, SITE, 3, { fullName: "No" }), NotLoggedInError);
    await context.close();
  });
});
