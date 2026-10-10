import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readGradeRows } from "../../../src/areas/grades/user-report.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

/** A grade report row as Moodle 5.2 renders it, reduced; the data is made up. */
function item(activityId: number, type: string, name: string, grade: string, range: string, feedback = ""): string {
  const menu = `<div class="action-menu moodle-actionmenu"><a aria-label="Actions"><span class="visually-hidden">Actions</span></a><div class="dropdown-menu"><a>Grade analysis</a></div></div>`;
  return `<tr class="cat_1"><th class="level2 item column-itemname" scope="row"><span class="d-block">${type.toUpperCase()}</span><div class="rowtitle"><a class="gradeitemheader" href="${SITE}mod/${type}/view.php?id=${activityId}">${name}</a></div></th>
<td class="level2 item column-weight">-</td><td class="level2 item column-grade"><div><div>${grade}</div>${menu}</div></td><td class="level2 item column-range">${range}</td>
<td class="level2 item column-percentage">${grade === "-" ? "-" : "80.00 %"}</td><td class="level2 item column-feedback">${feedback}</td></tr>`;
}

const REPORT = `<table class="user-grade"><thead><tr><th class="column-itemname" scope="col">Grade item</th><th class="column-grade">Grade</th></tr></thead><tbody>
<tr><td class="level1 category column-itemname">Programming</td></tr>
${item(21, "quiz", "Quiz 1", "8.00", "0–10", "<p>Well done</p>")}
${item(22, "assign", "Task 1", "-", "0–10")}
${item(23, "assign", "Task 2", "-", "0–10")}
<tr><th class="level2 baggt column-itemname"><div class="categoryitem">Programming total</div></th><td class="level2 baggt item column-grade"><div>8.00</div></td></tr>
<tr class="cat_1 lastrow"><th class="level1 baggt column-itemname"><div class="courseitem">Course total</div></th><td class="level1 baggt item column-grade"><div>8.00</div></td><td class="level1 baggt item column-range">0–30</td></tr>
</tbody></table>`;

describe("readGradeRows", { skip: !browser && "no system browser" }, () => {
  it("reads items, categories and the totals by cell classes, without the action menus", async () => {
    const page = await browser!.newPage();
    await page.setContent(REPORT);
    const rows = await readGradeRows(page);
    assert.deepEqual(
      rows.map((r) => [r.kind, r.name, r.activityId, r.grade, r.range, r.feedback]),
      [
        ["category", "Programming", undefined, undefined, undefined, undefined],
        ["item", "Quiz 1", 21, "8.00", "0–10", "Well done"],
        ["item", "Task 1", 22, undefined, "0–10", undefined],
        ["item", "Task 2", 23, undefined, "0–10", undefined],
        ["categoryTotal", "Programming total", undefined, "8.00", undefined, undefined],
        ["courseTotal", "Course total", undefined, "8.00", "0–30", undefined],
      ],
    );
    assert.equal(rows[1]?.activityType, "quiz");
    await page.close();
  });
});

