import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { CourseState } from "../../../src/areas/courses/state.js";
import { assignmentsOf } from "../../../src/areas/courses/structure.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

// Shaped like Moodle 5.2's course state; the data is made up.
const STATE: CourseState = {
  section: [
    { id: "10", number: 0, title: "General" },
    { id: "11", number: 1, title: "Variables &amp; types" },
  ],
  cm: [
    { id: "20", name: "Notes", module: "page", url: `${SITE}mod/page/view.php?id=20`, visible: true, sectionid: "10" },
    { id: "21", name: "Exercise &#039;1&#039;", module: "assign", url: `${SITE}mod/assign/view.php?id=21`, visible: true, sectionid: "11" },
    { id: "22", name: "Draft task", module: "assign", url: `${SITE}mod/assign/view.php?id=22`, visible: false, sectionid: "10" },
  ],
};

describe("assignmentsOf", () => {
  it("keeps the assignments, with their sections, in the course's order", () => {
    assert.deepEqual(assignmentsOf(STATE), [
      { id: 21, name: "Exercise '1'", url: `${SITE}mod/assign/view.php?id=21`, visible: true, section: { number: 1, title: "Variables & types" } },
      { id: 22, name: "Draft task", url: `${SITE}mod/assign/view.php?id=22`, visible: false, section: { number: 0, title: "General" } },
    ]);
  });
});

