import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Route } from "playwright-core";
import { activitySettings, editSection, updateActivity } from "../../../src/index.js";
import { completionValues, gradeItemsByActivity, parseRestrictions, readCompletion, restrictionsJson } from "../../../src/areas/activities/conditions.js";
import { type CourseState } from "../../../src/areas/courses/state.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

describe("restrictionsJson and parseRestrictions", () => {
  it("writes Moodle's tree as its form does: an eye per condition for all, one for any", () => {
    const grades = new Map([[41, 21]]);
    const all = JSON.parse(
      restrictionsJson(
        {
          conditions: [
            { type: "completion", activityId: 20, state: "complete" },
            { type: "grade", activityId: 41, min: 50 },
            { type: "date", from: "2026-01-01T00:00:00Z", until: new Date("2027-01-01T00:00:00Z") },
            { type: "group", groupId: 7 },
          ],
        },
        grades,
      ),
    );
    assert.deepEqual(all, {
      op: "&",
      c: [
        { type: "completion", cm: 20, e: 1 },
        { type: "grade", id: 21, min: 50 },
        { op: "&", c: [{ type: "date", d: ">=", t: 1767225600 }, { type: "date", d: "<", t: 1798761600 }] },
        { type: "group", id: 7 },
      ],
      showc: [true, true, true, true],
    });
    const any = JSON.parse(restrictionsJson({ match: "any", hidden: true, conditions: [{ type: "date", until: "2027-01-01T00:00:00Z" }, { type: "completion", activityId: 20, state: "complete-fail" }] }));
    assert.deepEqual(any, { op: "|", c: [{ type: "date", d: "<", t: 1798761600 }, { type: "completion", cm: 20, e: 3 }], show: false });
    assert.equal(restrictionsJson({ conditions: [] }), '{"op":"&","c":[],"showc":[]}');
  });

  it("refuses a grade condition on an activity without a grade item, a date that isn't one, and an unknown type", () => {
    assert.throws(() => restrictionsJson({ conditions: [{ type: "grade", activityId: 5 }] }), (error: Error & { code?: string }) => error.code === "not-found" && /Activity 5 has no grade item/.test(error.message));
    assert.throws(() => restrictionsJson({ conditions: [{ type: "date", from: "next week" }] }), (error: Error & { code?: string }) => error.code === "invalid-input");
    assert.throws(() => restrictionsJson({ conditions: [{ type: "date" }] }), /from, until or both/);
    assert.throws(() => restrictionsJson({ conditions: [{ type: "profile" } as never] }), /Unknown restriction type "profile"/);
  });

  it("reads the tree back in the same terms, and what it has no terms for as Moodle's own", () => {
    const items = new Map([[21, 41]]);
    const json = restrictionsJson(
      { conditions: [{ type: "grade", activityId: 41, min: 50, max: 90 }, { type: "date", from: "2026-01-01T00:00:00.000Z", until: "2027-01-01T00:00:00.000Z" }, { type: "group", groupId: 7 }] },
      new Map([[41, 21]]),
    );
    assert.deepEqual(parseRestrictions(json, items), {
      conditions: [{ type: "grade", activityId: 41, min: 50, max: 90 }, { type: "date", from: "2026-01-01T00:00:00.000Z", until: "2027-01-01T00:00:00.000Z" }, { type: "group", groupId: 7 }],
      match: "all",
      hidden: false,
    });
    const grouping = { type: "grouping", id: 3 };
    assert.deepEqual(parseRestrictions(JSON.stringify({ op: "|", c: [grouping, { type: "grade", id: 99 }], show: false })), {
      conditions: [{ type: "other", json: grouping }, { type: "other", json: { type: "grade", id: 99 } }],
      match: "any",
      hidden: true,
    });
    assert.equal(parseRestrictions('{"op":"&","c":[],"showc":[]}'), undefined);
    assert.equal(parseRestrictions(""), undefined);
    const negated = { op: "!&", c: [{ type: "group", id: 7 }], show: true };
    assert.deepEqual(parseRestrictions(JSON.stringify(negated)), { conditions: [{ type: "other", json: negated }], hidden: false });
  });
});

/** An activity form's completion part, reduced and made up, as Moodle 5.2 renders an assignment's: the conditions stay disabled until "Add requirements" (2) is chosen. */
const COMPLETION_FORM = `<form class="mform" id="mform1" action="modedit.php" method="post">
<input type="hidden" name="course" value="3"><input type="hidden" name="modulename" value="assign"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="name" value="Task">
<textarea name="availabilityconditionsjson">{"op":"&amp;","c":[],"showc":[]}</textarea>
<input type="radio" name="completion" value="0" checked><input type="radio" name="completion" value="1"><input type="radio" name="completion" value="2">
<input type="checkbox" name="completionview" value="1" disabled>
<input type="hidden" name="completionsubmit" value="0" disabled><input type="checkbox" name="completionsubmit" value="1" checked disabled>
<input type="checkbox" name="completionusegrade" value="1" disabled>
<input type="radio" name="completionpassgrade" value="0" checked disabled><input type="radio" name="completionpassgrade" value="1" disabled>
<input type="checkbox" name="completionexpected[enabled]" value="1" disabled>
<select name="completionexpected[day]" disabled>${Array.from({ length: 31 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
<select name="completionexpected[month]" disabled>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select>
<select name="completionexpected[year]" disabled><option value="2026">2026</option><option value="2027">2027</option></select>
<select name="completionexpected[hour]" disabled>${Array.from({ length: 24 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}</select>
<select name="completionexpected[minute]" disabled>${Array.from({ length: 60 }, (_, i) => `<option value="${i}">${i}</option>`).join("")}</select>
<input type="submit" name="submitbutton2" value="Save and return"></form>
<script>
const form = document.getElementById("mform1");
const sync = () => {
  const auto = form.querySelector('[name="completion"][value="2"]').checked;
  for (const name of ["completionview", "completionsubmit", "completionusegrade", "completionexpected[enabled]"]) for (const f of form.querySelectorAll('[name="' + name + '"]')) f.disabled = !auto;
  const grade = auto && form.querySelector('[type="checkbox"][name="completionusegrade"]').checked;
  for (const f of form.querySelectorAll('[name="completionpassgrade"]')) f.disabled = !grade;
  const expected = auto && form.querySelector('[name="completionexpected[enabled]"]').checked;
  for (const f of form.querySelectorAll('select[name^="completionexpected"]')) f.disabled = !expected;
};
form.addEventListener("change", sync);
</script>`;

describe("completion in plain terms", { skip: !browser && "no system browser" }, () => {
  async function formPage() {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/course/modedit.php": COMPLETION_FORM } });
    const page = await context.newPage();
    await page.goto(`${SITE}course/modedit.php?update=35`);
    return { context, page };
  }

  it("maps the conditions to the module's fields, turning off those not given, and refuses one it doesn't have", async () => {
    const { context, page } = await formPage();
    assert.deepEqual(await completionValues(page, "manual"), { completion: 1 });
    const values = await completionValues(page, { passGrade: true, expected: "2026-11-30T17:00:00Z" });
    // Europe/Madrid, the fake's time zone: 18:00.
    assert.deepEqual(values, {
      completion: 2,
      completionview: false,
      completionsubmit: false,
      completionusegrade: true,
      completionpassgrade: 1,
      "completionexpected[enabled]": true,
      "completionexpected[day]": 30,
      "completionexpected[month]": 11,
      "completionexpected[year]": 2026,
      "completionexpected[hour]": 18,
      "completionexpected[minute]": 0,
    });
    await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { remove(): void } } }).document.querySelector('[type="checkbox"][name="completionsubmit"]').remove());
    await assert.rejects(completionValues(page, { submit: true, view: true }), (error: Error & { code?: string }) => error.code === "invalid-input" && /This assign has no completion condition submit/.test(error.message));
    await context.close();
  });

  it("reads the form's completion back in the same terms", async () => {
    const { context, page } = await formPage();
    assert.equal(await readCompletion(page), "none");
    await page.check('[name="completion"][value="2"]');
    await page.check('[name="completionusegrade"]');
    await page.check('[name="completionpassgrade"][value="1"]');
    assert.deepEqual(await readCompletion(page), { grade: true, passGrade: true, submit: true });
    await context.close();
  });
});

describe("gradeItemsByActivity", { skip: !browser && "no system browser" }, () => {
  it("maps each activity to its grade item by the setup page's links, the first when it has several", async () => {
    const context = await browser!.newContext();
    // The gradebook setup's rows, reduced, as Moodle 5.2 renders them (made up).
    const rows = `<table id="grade_edit_tree_table">
<tr data-itemid="4" data-category="cg2"><td><a href="${SITE}grade/edit/tree/action.php?id=3&eid=cg2">Hide</a></td></tr>
<tr data-itemid="12"><td><a href="${SITE}mod/quiz/view.php?id=27">Quiz</a></td></tr>
<tr data-itemid="17"><td><a href="index.php?id=3&action=moveselect&eid=ig17">Move</a><a href="${SITE}mod/forum/view.php?id=35">Forum</a></td></tr>
<tr data-itemid="18"><td><a href="${SITE}mod/forum/view.php?id=35">Forum ratings</a></td></tr></table>`;
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/grade/edit/tree/index.php": rows } });
    assert.deepEqual([...(await gradeItemsByActivity(context, SITE, 3))], [[27, 12], [35, 17]]);
    await context.close();
  });
});

describe("restrictions and completion through the forms", { skip: !browser && "no system browser" }, () => {
  it("updateActivity sets them, activitySettings reads them, editSection restricts a section", async () => {
    const context = await browser!.newContext();
    const course: CourseState = {
      section: [{ id: "10", number: 0, title: "General", cmlist: ["20", "35"] }],
      cm: [
        { id: "20", name: "Notes", module: "page", visible: true, sectionid: "10" },
        { id: "35", name: "Task", module: "assign", visible: true, sectionid: "10" },
      ],
    };
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodyClasses: { "/course/view.php": "format-topics" }, services: { core_courseformat_get_state: () => JSON.stringify(course), core_courseformat_update_course: () => "[]" } });
    const posts: Record<string, URLSearchParams[]> = { modedit: [], editsection: [] };
    let saved = '{"op":"&","c":[],"showc":[]}';
    await context.route(`${SITE}course/modedit.php**`, (route: Route) => {
      if (route.request().method() === "POST") {
        const form = new URLSearchParams(route.request().postData() ?? "");
        posts.modedit!.push(form);
        saved = form.get("availabilityconditionsjson") ?? saved;
      }
      const body = COMPLETION_FORM.replace('{"op":"&amp;","c":[],"showc":[]}', saved.replaceAll("&", "&amp;"));
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body }) });
    });
    await context.route(`${SITE}course/editsection.php**`, (route: Route) => {
      if (route.request().method() === "POST") posts.editsection!.push(new URLSearchParams(route.request().postData() ?? ""));
      const form = `<form class="mform" action="editsection.php" method="post"><input type="hidden" name="course" value="5"><textarea name="summary_editor[text]"></textarea><textarea name="availabilityconditionsjson"></textarea><input type="submit" name="submitbutton" value="Save"></form>`;
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body: form }) });
    });

    await updateActivity(context, SITE, 35, { restrictions: { conditions: [{ type: "completion", activityId: 20, state: "complete" }] }, completion: { view: true, submit: true } });
    const sent = posts.modedit![0]!;
    assert.equal(sent.get("availabilityconditionsjson"), '{"op":"&","c":[{"type":"completion","cm":20,"e":1}],"showc":[true]}');
    assert.deepEqual([sent.get("completion"), sent.get("completionview"), sent.getAll("completionsubmit"), sent.get("completionusegrade")], ["2", "1", ["0", "1"], null]);
    // Moodle would save a condition on an activity the course doesn't have: refused before saving.
    await assert.rejects(updateActivity(context, SITE, 35, { restrictions: { conditions: [{ type: "completion", activityId: 99, state: "complete" }] } }), /Course 3 has no activity 99/);
    assert.equal(posts.modedit!.length, 1);
    // settings still win over them for the same field.
    await updateActivity(context, SITE, 35, { completion: "manual", settings: { completion: 0 } });
    assert.equal(posts.modedit![1]!.get("completion"), "0");

    const settings = await activitySettings(context, SITE, 35);
    assert.deepEqual(settings.restrictions, { conditions: [{ type: "completion", activityId: 20, state: "complete" }], match: "all", hidden: false });
    assert.equal(settings.completion, "none");

    const section = await editSection(context, SITE, 5, 10, { summary: "<p>Unit</p>", restrictions: { hidden: true, conditions: [{ type: "group", groupId: 7 }] } });
    assert.equal(section.changed, "Section 10 description set, restrictions set.");
    assert.equal(posts.editsection!.length, 1);
    assert.equal(posts.editsection![0]!.get("availabilityconditionsjson"), '{"op":"&","c":[{"type":"group","id":7}],"showc":[false]}');
    await context.close();
  });
});
