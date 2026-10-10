import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MoodleServiceError, NotLoggedInError, courseStructure, listAssignments, pendingActivities } from "../../../src/index.js";
import { CourseState, readActivityDetails } from "../../../src/areas/courses/state.js";
import { structureOf } from "../../../src/areas/courses/structure.js";
import { SITE, ServiceFailure, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

// Shaped like Moodle 5.2's course state for a student; the data is made up.
const STATE: CourseState = {
  course: { id: "5", baseurl: `${SITE}course/view.php?id=5` },
  section: [
    { id: "10", number: 0, title: "General", visible: true, hasrestrictions: false, cmlist: ["20", "21"], sectionurl: `${SITE}course/section.php?id=10` },
    { id: "11", number: 1, title: "Unit 1 &amp; 2", visible: true, hasrestrictions: true, cmlist: ["22"] },
    { id: "12", number: 2, title: "Practice", visible: true, component: "mod_subsection", parentsectionid: "11", cmlist: [] },
  ],
  cm: [
    { id: "20", name: "Welcome", module: "page", url: `${SITE}mod/page/view.php?id=20`, visible: true, uservisible: true, accessvisible: true, sectionid: "10", istrackeduser: true, completionstate: 1, isoverallcomplete: true },
    { id: "21", name: "Quiz 1", module: "quiz", visible: true, uservisible: true, accessvisible: true, sectionid: "10", istrackeduser: true, completionstate: 3, isoverallcomplete: false },
    { id: "22", name: "Locked task", module: "assign", visible: true, uservisible: false, accessvisible: true, hascmrestrictions: true, sectionid: "11", istrackeduser: true, completionstate: 0 },
  ],
};

// The course page shows section 0's activities; section 1 has its own page.
const COURSE_PAGE = `<ul><li class="activity" data-for="cmitem" data-id="20"></li>
<li class="activity" data-for="cmitem" data-id="21"><div data-region="activity-dates"><div class="date-item"><span class="date-item-label">Opened:</span> Monday, 5 October</div><div class="date-item"><span class="date-item-label">Closes:</span> Friday, 9 October</div></div></li></ul>`;
const SECTION_PAGE = `<ul><li class="activity" data-for="cmitem" data-id="22"><div class="availabilityinfo">Not available unless: You achieve a pass in <a href="#">Quiz 1</a></div></li></ul>`;

describe("structureOf", () => {
  it("nests activities in their sections, with completion, availability and subsections", () => {
    const [general, unit, practice] = structureOf(STATE);
    assert.deepEqual(general?.activities.map((a) => [a.id, a.completion]), [
      [20, { state: "complete", complete: true }],
      [21, { state: "complete-fail", complete: false }],
    ]);
    assert.equal(unit?.title, "Unit 1 & 2");
    assert.equal(unit?.restricted, true);
    assert.deepEqual(unit?.activities[0] && { availableToMe: unit.activities[0].availableToMe, restricted: unit.activities[0].restricted, completion: unit.activities[0].completion }, {
      availableToMe: false,
      restricted: true,
      completion: { state: "incomplete", complete: false },
    });
    assert.equal(practice?.parentSectionId, 11);
  });
});

describe("readActivityDetails", { skip: !browser && "no system browser" }, () => {
  it("reads dates and restrictions as the page shows them", async () => {
    const page = await browser!.newPage();
    await page.setContent(COURSE_PAGE + SECTION_PAGE);
    assert.deepEqual(await readActivityDetails(page), [
      { id: 20, dates: [], restriction: undefined },
      { id: 21, dates: [{ label: "Opened", value: "Monday, 5 October" }, { label: "Closes", value: "Friday, 9 October" }], restriction: undefined },
      { id: 22, dates: [], restriction: "Not available unless: You achieve a pass in Quiz 1" },
    ]);
    await page.close();
  });
});

describe("courseStructure", { skip: !browser && "no system browser" }, () => {
  it("reads the state, and the course and section pages only with details", async () => {
    const context = await browser!.newContext();
    const state: FakeMoodleState = {
      user: { id: 3, fullName: "T" },
      pagesServed: [],
      bodies: { "/course/view.php": COURSE_PAGE, "/course/section.php": SECTION_PAGE },
      services: { core_courseformat_get_state: () => JSON.stringify(STATE) },
    };
    await serveFakeMoodle(context, state);
    const plain = await courseStructure(context, SITE, 5);
    assert.deepEqual(plain.course, { id: 5, url: `${SITE}course/view.php?id=5` });
    assert.deepEqual(plain.sections.map((s) => s.id), [10, 11, 12]);
    assert.equal(plain.sections[0]?.activities[1]?.dates, undefined);
    assert.deepEqual(state.pagesServed!.filter((p) => p.startsWith("/course/")), []);
    const { sections } = await courseStructure(context, SITE, 5, { details: true });
    assert.deepEqual(sections[0]?.activities[1]?.dates, [{ label: "Opened", value: "Monday, 5 October" }, { label: "Closes", value: "Friday, 9 October" }]);
    assert.equal(sections[1]?.activities[0]?.restriction, "Not available unless: You achieve a pass in Quiz 1");
    assert.deepEqual(state.pagesServed!.filter((p) => p.startsWith("/course/")), ["/course/view.php", "/course/section.php"]);
    await context.close();
  });

  it("passes Moodle's error for a course the person can't see", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, services: { core_courseformat_get_state: () => { throw new ServiceFailure("invalidrecordunknown"); } } });
    await assert.rejects(courseStructure(context, SITE, 6), (error: unknown) => error instanceof MoodleServiceError && error.errorcode === "invalidrecordunknown");
    await context.close();
  });
});

describe("listAssignments", { skip: !browser && "no system browser" }, () => {
  it("asks for the course's state and keeps its assignments", async () => {
    const context = await browser!.newContext();
    const state: FakeMoodleState = { user: { id: 3, fullName: "T" }, serviceCalls: [], services: { core_courseformat_get_state: () => JSON.stringify(STATE) } };
    await serveFakeMoodle(context, state);
    assert.deepEqual((await listAssignments(context, SITE, 5)).map((a) => [a.id, a.section.title]), [[22, "Unit 1 & 2"]]);
    assert.deepEqual(state.serviceCalls?.[0], { methodname: "core_courseformat_get_state", args: { courseid: 5 } });
    await context.close();
  });
});

/** A grade report row as Moodle 5.2 renders it, reduced; the data is made up. */
function gradeRow(activityId: number, type: string, name: string, grade: string): string {
  return `<tr><th class="level2 item column-itemname" scope="row"><div class="rowtitle"><a class="gradeitemheader" href="${SITE}mod/${type}/view.php?id=${activityId}">${name}</a></div></th>
<td class="level2 item column-grade"><div>${grade}</div></td><td class="level2 item column-range">0–10</td></tr>`;
}
const REPORT = `<table class="user-grade"><tbody>${gradeRow(21, "quiz", "Quiz 1", "8.00")}${gradeRow(22, "assign", "Task 1", "-")}${gradeRow(23, "assign", "Task 2", "-")}</tbody></table>`;

describe("pendingActivities", { skip: !browser && "no system browser" }, () => {
  // The quiz is graded; task 1 is incomplete; task 2 is done; the page isn't graded nor tracked.
  const tracked = (track: boolean): CourseState => ({
    section: [{ id: "10", number: 0, title: "General", cmlist: ["20", "21", "22", "23"] }],
    cm: [
      { id: "20", name: "Notes", module: "page", visible: true, sectionid: "10" },
      { id: "21", name: "Quiz 1", module: "quiz", visible: true, sectionid: "10" },
      { id: "22", name: "Task 1", module: "assign", visible: true, sectionid: "10", ...(track ? { istrackeduser: true, completionstate: 0, isoverallcomplete: false } : {}) },
      { id: "23", name: "Task 2", module: "assign", visible: true, sectionid: "10", ...(track ? { istrackeduser: true, completionstate: 1, isoverallcomplete: true } : {}) },
    ],
  });
  const COURSE = `<ul><li class="activity" data-for="cmitem" data-id="22"><div data-region="activity-dates"><div class="date-item"><span class="date-item-label">Due:</span> Friday</div></div></li></ul>`;
  const site = (course: CourseState): FakeMoodleState => ({
    user: { id: 3, fullName: "S" },
    bodies: { "/grade/report/user/index.php": REPORT, "/course/view.php": COURSE },
    services: { core_courseformat_get_state: () => JSON.stringify(course) },
  });

  it("lists tracked activities not complete, with their dates", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, site(tracked(true)));
    const { completionTracked, pending } = await pendingActivities(context, SITE, 5);
    assert.equal(completionTracked, true);
    assert.deepEqual(pending.map((p) => [p.activityId, p.reason, p.completion]), [[22, "incomplete", "incomplete"]]);
    assert.deepEqual(pending[0]?.dates, [{ label: "Due", value: "Friday" }]);
    await context.close();
  });

  it("lists graded activities without a grade where completion isn't tracked", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, site(tracked(false)));
    const { completionTracked, pending } = await pendingActivities(context, SITE, 5);
    assert.equal(completionTracked, false);
    assert.deepEqual(pending.map((p) => [p.activityId, p.reason]), [[22, "not-graded"], [23, "not-graded"]]);
    await context.close();
  });

  it("throws NotLoggedInError without a session", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {});
    await assert.rejects(pendingActivities(context, SITE, 5), NotLoggedInError);
    await context.close();
  });
});
