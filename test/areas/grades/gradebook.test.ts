import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { GradebookError, addGradeCategory, gradebookSetup, graderReport, updateGradeItem } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** The grader report as Moodle 5.2 renders it, reduced; made-up course 3. */
const GRADER = `<table id="user-grades"><tbody>
<tr class="heading"><th id="studentheader">Name</th>
<th class="item catlevel2 i12" data-itemid="12"><a class="gradeitemheader" href="${SITE}mod/quiz/view.php?id=27"><img class="itemicon" alt="Quiz">Quiz one</a></th>
<th class="categoryitem catlevel1 i18" data-itemid="18"><span class="gradeitemheader"><img class="itemicon" alt="Natural">Labs total</span></th>
<th class="courseitem catlevel1 i4" data-itemid="4"><span class="gradeitemheader">Course total</span></th></tr>
<tr class="userrow odd" data-uid="4"><th><a class="username" href="${SITE}user/view.php?id=4&amp;course=3"><span class="userinitials">AS</span>Ana Student</a></th>
<td class="gradecell" data-itemid="12"><span class="gradevalue">10.00</span></td><td class="gradecell" data-itemid="18"><span class="gradevalue">10.00</span></td><td class="gradecell" data-itemid="4"><span class="gradevalue">10.00</span></td></tr>
<tr class="userrow even" data-uid="5"><th><a class="username" href="${SITE}user/view.php?id=5&amp;course=3"><img alt="">Bruno Student</a></th>
<td class="gradecell" data-itemid="12"><span class="gradevalue">-</span></td><td class="gradecell" data-itemid="18"><span class="gradevalue">-</span></td><td class="gradecell" data-itemid="4"><span class="gradevalue">-</span></td></tr>
</tbody></table>`;

describe("graderReport", { skip: !browser && "no system browser" }, () => {
  it("reads columns by item id and link, and rows by user id, without empty grades", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/grade/report/grader/index.php": GRADER } });
    const report = await graderReport(context, SITE, 3);
    assert.deepEqual(report.columns, [
      { id: 12, name: "Quiz one", kind: "item", activityId: 27, activityType: "quiz" },
      { id: 18, name: "Labs total", kind: "category" },
      { id: 4, name: "Course total", kind: "course" },
    ]);
    assert.deepEqual(report.rows, [
      { userId: 4, fullName: "Ana Student", grades: [{ itemId: 12, grade: "10.00" }, { itemId: 18, grade: "10.00" }, { itemId: 4, grade: "10.00" }] },
      { userId: 5, fullName: "Bruno Student", grades: [{ itemId: 12 }, { itemId: 18 }, { itemId: 4 }] },
    ]);
    await context.close();
  });

  it("says why when Moodle refuses, and when it's recalculating", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/grade/report/grader/index.php": `<div data-rel="fatalerror"><p class="errormessage">Sorry, no permission (View grader report).</p></div>` } });
    await assert.rejects(graderReport(context, SITE, 3), /no permission \(View grader report\)/);
    await context.close();
    const busy = await browser!.newContext();
    await serveFakeMoodle(busy, { user: { id: 3, fullName: "Teacher" }, bodies: { "/grade/report/grader/index.php": `<p>Recalculating grades</p>` } });
    await assert.rejects(graderReport(busy, SITE, 3), /recalculating/);
    await busy.close();
  });
});

/**
 * A made-up gradebook: a Natural course category with a quiz, a manual item and, once added, a
 * "Labs" category; the setup page, the move action and the two dynamic forms change it as Moodle would.
 */
function fakeGradebook() {
  const items = [
    { id: 12, name: "Quiz one", parent: 2, icon: "quiz", max: 10, weight: 50, override: false },
    { id: 20, name: "Participation", parent: 2, icon: "core", max: 5, weight: 50, override: false },
  ];
  const categories = [{ id: 2, itemId: 4, name: "Course 3", parent: 0 }];
  const moves: string[] = [];
  const row = (attrs: string, name: string, weight: string, icon = "core") =>
    `<tr ${attrs}><td><img class="itemicon" src="${SITE}theme/image.php/boost/${icon}/1/monologo"><div class="rowtitle">${name}</div></td><td>${weight}</td></tr>`;
  const setup = () =>
    `<table id="grade_edit_tree_table"><tbody>${categories
      .map(
        (c) =>
          row(`data-category="cg${c.id}" data-aggregation="13" data-grademax="15" data-itemid="${c.itemId}"${c.parent ? ` data-parent-category="cg${c.parent}"` : ""}`, c.name, c.parent ? `<input type="text" name="weight_${c.itemId}" value="100">` : "") +
          items
            .filter((i) => i.parent === c.id)
            .map((i) =>
              row(
                `class="item" data-itemid="${i.id}" data-parent-category="cg${c.id}" data-grademax="${i.max}"`,
                i.name,
                `<input type="checkbox" name="weightoverride_${i.id}" value="1"${i.override ? " checked" : ""}><input type="text" name="weight_${i.id}" value="${i.weight}">`,
                i.icon,
              ),
            )
            .join(""),
      )
      .join("")}${row(`class="item" data-itemid="4" data-grademax="15"`, "Course total", "")}</tbody></table>`;
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    services: {
      core_form_dynamic_form: ({ form, formdata }) => {
        const data = new URLSearchParams(String(formdata));
        const submitted = data.has("sesskey");
        if (form === "core_grades\\form\\add_item") {
          const item = items.find((i) => i.id === Number(data.get("itemid")))!;
          if (!submitted) {
            const locked = item.icon !== "core" ? " disabled" : "";
            return {
              submitted: false,
              html: `<form class="mform"><input type="hidden" name="itemid" value="${item.id}"><input type="hidden" name="sesskey" value="s1"><input name="grademax" value="${item.max}"${locked}><input type="hidden" name="weightoverride" value="0"><input type="checkbox" name="weightoverride" value="1"><input name="aggregationcoef2" value="${item.weight}"></form>`,
            };
          }
          if (data.get("aggregationcoef2") && Number(data.get("aggregationcoef2")) > 100) {
            return { submitted: false, html: `<form class="mform"><div id="id_error_aggregationcoef2_abcdefghijklmno">Weight must be at most 100.</div></form>` };
          }
          if (data.getAll("weightoverride").includes("1")) Object.assign(item, { override: true, weight: Number(data.get("aggregationcoef2")) });
          if (data.has("grademax")) item.max = Number(data.get("grademax"));
          return { submitted: true, html: "" };
        }
        if (!submitted) {
          return { submitted: false, html: `<form class="mform"><input type="hidden" name="sesskey" value="s1"><input name="fullname" value=""><select name="aggregation"><option value="13">Natural</option></select></form>` };
        }
        categories.push({ id: 3, itemId: 18, name: data.get("fullname")!, parent: 2 });
        return { submitted: true, html: "" };
      },
    },
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}grade/edit/tree/index.php**`, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("action") === "move") {
        moves.push(`${url.searchParams.get("eid")}>${url.searchParams.get("moveafter")}`);
        const [kind, id] = [url.searchParams.get("eid")!.slice(0, 2), Number(url.searchParams.get("eid")!.slice(2))];
        const target = Number(url.searchParams.get("moveafter")!.slice(2));
        if (kind === "ig") items.find((i) => i.id === id)!.parent = target;
        else categories.find((c) => c.id === id)!.parent = target;
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-grade-edit-tree-index", body: setup() }) });
    });
  };
  return { state, routes, moves };
}

async function open(fake: ReturnType<typeof fakeGradebook>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, fake.state);
  await fake.routes(context);
  return context;
}

describe("gradebook setup", { skip: !browser && "no system browser" }, () => {
  it("reads categories and items, without the totals, by data attributes and field names", async () => {
    const context = await open(fakeGradebook());
    assert.deepEqual(await gradebookSetup(context, SITE, 3), {
      categories: [{ id: 2, itemId: 4, name: "Course 3", aggregation: "natural", maxGrade: 15 }],
      items: [
        { id: 12, name: "Quiz one", categoryId: 2, type: "quiz", maxGrade: 10, weight: 50, weightOverridden: false },
        { id: 20, name: "Participation", categoryId: 2, type: "manual", maxGrade: 5, weight: 50, weightOverridden: false },
      ],
    });
    await context.close();
  });

  it("adds a category, moves an item into it and overrides its weight", async () => {
    const fake = fakeGradebook();
    const context = await open(fake);
    const added = await addGradeCategory(context, SITE, 3, { name: "Labs", aggregation: "natural" });
    assert.deepEqual(added.category, { id: 3, itemId: 18, name: "Labs", parentId: 2, aggregation: "natural", maxGrade: 15, weight: 100 });
    const moved = await updateGradeItem(context, SITE, 3, 12, { category: 3, weight: 70 });
    assert.deepEqual(fake.moves, ["ig12>cg3"]);
    assert.deepEqual(moved.item, { id: 12, name: "Quiz one", categoryId: 3, type: "quiz", maxGrade: 10, weight: 70, weightOverridden: true });
    assert.match(moved.changed, /moved into category 3, weighted 70%/);
    await context.close();
  });

  it("refuses an activity's maximum, an aggregation the site doesn't offer, and passes Moodle's form errors", async () => {
    const context = await open(fakeGradebook());
    await assert.rejects(updateGradeItem(context, SITE, 3, 12, { maxGrade: 20 }), /set in the activity's settings/);
    await assert.rejects(addGradeCategory(context, SITE, 3, { name: "X", aggregation: "mean" }), /doesn't offer the mean aggregation; it offers: natural/);
    await assert.rejects(updateGradeItem(context, SITE, 3, 20, { weight: 150 }), (error: Error) => error instanceof GradebookError && /aggregationcoef2: Weight must be at most 100/.test(error.message));
    assert.equal((await updateGradeItem(context, SITE, 3, 20, { maxGrade: 8 })).item?.maxGrade, 8);
    await context.close();
  });
});
