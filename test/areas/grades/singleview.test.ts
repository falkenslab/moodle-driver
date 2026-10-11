import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { GradebookError, setGrade } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface FakeGrade {
  itemId: number;
  kind: "manual" | "activity" | "scale";
  grade: string;
  feedback: string;
  overridden: boolean;
  excluded: boolean;
  locked?: boolean;
  /** Without the range on its input (a site with unlimited grades): only Moodle checks it. */
  unbounded?: boolean;
}

/**
 * The single view report's user screen as Moodle 5.2 renders it, reduced: in editing mode a row per
 * item with `finalgrade_`, `feedback_`, `override_` (not for a manual item) and `exclude_` fields and
 * their `old` twins; out of it, only texts. The editing switch posts to editmode.php. Made-up user 5.
 */
function fakeSingleView(grades: FakeGrade[], { maxGrade = 10 } = {}) {
  const state = { editing: false, posts: [] as Record<string, string>[], modes: [] as string[] };
  const row = (g: FakeGrade) => {
    const s = `_${g.itemId}_5`;
    if (!state.editing) return `<tr><th class="gradeitem"><div class="rowtitle">Item ${g.itemId}</div></th><td class="grade">${g.grade || "-"}</td></tr>`;
    const disabled = (g.kind !== "manual" && !g.overridden) || g.locked ? " disabled" : "";
    const grade =
      g.kind === "scale"
        ? `<select name="finalgrade${s}"${disabled}>${[["-1", "No grade"], ["1", "Poor"], ["2", "Good"]].map(([v, t]) => `<option value="${v}"${(g.grade === "" ? "-1" : g.grade) === t || g.grade === v ? " selected" : ""}>${t}</option>`).join("")}</select>`
        : `<input type="number" name="finalgrade${s}" value="${g.grade}" step="any"${g.unbounded ? "" : ` min="0" max="${maxGrade}"`}${disabled}>`;
    return `<tr><th class="gradeitem"><div class="rowtitle">Item ${g.itemId}</div></th>
<td class="grade">${grade}<input type="hidden" name="oldfinalgrade${s}" value="${g.grade}"></td>
<td><input type="text" name="feedback${s}" value="${g.feedback}"${disabled}><input type="hidden" name="oldfeedback${s}" value="${g.feedback}"></td>
<td>${g.kind !== "manual" ? `<input type="checkbox" name="override${s}" value="1"${g.overridden ? " checked" : ""}${g.locked ? " disabled" : ""}><input type="hidden" name="oldoverride${s}" value="${g.overridden ? 1 : ""}">` : ""}</td>
<td><input type="checkbox" name="exclude${s}" value="1"${g.excluded ? " checked" : ""}><input type="hidden" name="oldexclude${s}" value="${g.excluded ? 1 : ""}"></td></tr>`;
  };
  const page = (notice = "") =>
    moodlePage({
      userId: 3,
      bodyId: "page-grade-report-singleview-index",
      body: `<form action="${SITE}editmode.php" method="post" class="editmode-switch-form"><input type="checkbox" name="setmode"${state.editing ? " checked" : ""}><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="context" value="30"></form>
${notice}<form method="post"><table id="singleview-grades"><tbody>${grades.map(row).join("")}</tbody></table>
${state.editing ? `<input type="hidden" name="sesskey" value="s1"><input type="submit" value="Save">` : ""}</form>`,
    });
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}editmode.php`, async (route) => {
      const mode = new URLSearchParams(route.request().postData() ?? "").get("setmode") ?? "0";
      state.modes.push(mode);
      state.editing = mode === "1";
      return route.fulfill({ status: 200, contentType: "text/html", body: "ok" });
    });
    await context.route(`${SITE}grade/report/singleview/index.php**`, async (route) => {
      let notice = "";
      if (route.request().method() === "POST") {
        const data = Object.fromEntries(new URLSearchParams(route.request().postData() ?? ""));
        state.posts.push(data);
        for (const g of grades) {
          const s = `_${g.itemId}_5`;
          if (g.kind !== "manual") g.overridden = data[`override${s}`] === "1";
          if (`finalgrade${s}` in data) {
            const value = data[`finalgrade${s}`]!;
            if (g.kind === "scale") g.grade = value === "-1" ? "" : value === "1" ? "Poor" : "Good";
            else if (Number(value) > maxGrade) notice = `<div class="alert alert-warning" role="alert">The grade for Item ${g.itemId} is more than the maximum allowed</div>`;
            else g.grade = value === "" ? "" : Number(value).toFixed(2);
          }
          if (`feedback${s}` in data) g.feedback = data[`feedback${s}`]!;
          g.excluded = data[`exclude${s}`] === "1";
        }
        if (!notice) notice = `<div class="alert alert-success" role="alert">Grades were set for 1 items</div>`;
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: page(notice) });
    });
  };
  return { state, routes };
}

async function open(fake: ReturnType<typeof fakeSingleView>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await fake.routes(context);
  return context;
}

describe("setGrade", { skip: !browser && "no system browser" }, () => {
  it("grades a manual item in editing mode, and turns editing back off", async () => {
    const fake = fakeSingleView([{ itemId: 30, kind: "manual", grade: "", feedback: "", overridden: false, excluded: false }]);
    const context = await open(fake);
    const set = await setGrade(context, SITE, 3, 30, 5, { grade: 8.5, feedback: "Well done" });
    assert.deepEqual(set.grade, { itemId: 30, userId: 5, grade: "8.50", feedback: "Well done", overridden: false, excluded: false });
    assert.equal(set.changed, "User 5's grade in item 30: graded 8.5, feedback set.");
    assert.equal(fake.state.posts[0]?.finalgrade_30_5, "8.5");
    assert.deepEqual(fake.state.modes, ["1", "0"]);
    assert.equal((await setGrade(context, SITE, 3, 30, 5, { grade: 8.5 })).changed, "Nothing to change.");
    await context.close();
  });

  it("overrides an activity's grade, and gives it back", async () => {
    const fake = fakeSingleView([{ itemId: 12, kind: "activity", grade: "7.00", feedback: "", overridden: false, excluded: false }]);
    const context = await open(fake);
    const set = await setGrade(context, SITE, 3, 12, 5, { grade: 9 });
    assert.equal(fake.state.posts[0]?.override_12_5, "1");
    assert.deepEqual(set.grade, { itemId: 12, userId: 5, grade: "9.00", overridden: true, excluded: false });
    assert.match(set.changed, /overridden, graded 9/);
    const back = await setGrade(context, SITE, 3, 12, 5, { override: false, excluded: true });
    assert.equal(back.grade.overridden, false);
    assert.equal(back.grade.excluded, true);
    assert.equal(fake.state.posts[1]?.override_12_5, undefined);
    await context.close();
  });

  it("takes a scale's item by name", async () => {
    const fake = fakeSingleView([{ itemId: 40, kind: "scale", grade: "", feedback: "", overridden: true, excluded: false }]);
    const context = await open(fake);
    assert.equal((await setGrade(context, SITE, 3, 40, 5, { grade: "Good" })).grade.grade, "Good");
    await assert.rejects(setGrade(context, SITE, 3, 40, 5, { grade: "Great" }), /uses a scale; give one of its items: "Poor", "Good"/);
    await context.close();
  });

  it("refuses what Moodle wouldn't take, and passes its warnings", async () => {
    const fake = fakeSingleView([
      { itemId: 30, kind: "manual", grade: "", feedback: "", overridden: false, excluded: false },
      { itemId: 12, kind: "activity", grade: "7.00", feedback: "", overridden: false, excluded: false, locked: true },
      { itemId: 31, kind: "manual", grade: "", feedback: "", overridden: false, excluded: false, unbounded: true },
    ]);
    const context = await open(fake);
    await assert.rejects(setGrade(context, SITE, 3, 30, 5, { override: true }), /manual item: its grades are set directly/);
    await assert.rejects(setGrade(context, SITE, 3, 12, 5, { grade: 5 }), /locked/);
    await assert.rejects(setGrade(context, SITE, 3, 99, 5, { grade: 5 }), /no grade item 99 for user 5/);
    await assert.rejects(setGrade(context, SITE, 3, 30, 5, { grade: 50 }), /takes grades from 0 to 10, not 50/);
    await assert.rejects(setGrade(context, SITE, 3, 31, 5, { grade: 50 }), (error: Error) => error instanceof GradebookError && /more than the maximum allowed/.test(error.message));
    await assert.rejects(setGrade(context, SITE, 3, 30, 5, {}), /Give a grade/);
    await context.close();
  });
});
