import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CourseState, readActivityDetails, structureOf } from "../../src/index.js";
import { SITE, launchTestBrowser } from "../../src/testing/index.js";
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

