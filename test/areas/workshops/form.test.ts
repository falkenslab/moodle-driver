import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { FormError, MoodleError, WorkshopError, setWorkshopForm, workshopForm, type WorkshopStrategy } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";
import { errorPage, html, plan } from "./fakeWorkshop.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface Level {
  id: number;
  grade: number;
  definition: string;
}
interface Dimension {
  id: number;
  description: string;
  /** Accumulative: points, or a scale's id negated, as Moodle stores it. */
  grade: number;
  weight: number;
  grade0: string;
  grade1: string;
  levels: Level[];
}
interface Workshop {
  strategy: WorkshopStrategy;
  dims: Dimension[];
  maps: Map<number, number>;
  layout: "list" | "grid";
  saves: number;
}

const SCALES: [number, string][] = [
  [2, "Default competence scale"],
  [1, "Separate and Connected ways of knowing"],
];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const select = (name: string, options: [string | number, string][], chosen: string | number | undefined, attrs = "") =>
  `<select class="form-select" name="${name}" id="id_${name}"${attrs}>${options.map(([value, text]) => `<option value="${value}"${String(value) === String(chosen) ? " selected" : ""}>${text}</option>`).join("")}</select>`;
const weights: [number, string][] = Array.from({ length: 17 }, (_, i) => [16 - i, String(16 - i)]);

/**
 * The strategy's editing form as Moodle 5.2 renders it (`workshop_edit_<strategy>_strategy_form`),
 * reduced to its fields: as many rows as `norepeats` (the saved ones and two blank by default, three
 * at least), a rubric criterion's levels (two blank more than saved, four at least), a mapping row
 * per error of the saved weights.
 */
function editForm(w: Workshop, norepeats: number, errors: Record<string, string> = {}): string {
  const rows: string[] = [];
  for (let i = 0; i < norepeats; i++) {
    const d = w.dims[i];
    let row = `<input name="dimensionid__idx_${i}" type="hidden" value="${d?.id ?? ""}">`;
    if (w.strategy === "rubric") {
      const count = d ? Math.max(d.levels.length + 2, 4) : 4;
      for (let j = 0; j < count; j++) row += `<input name="levelid__idx_${i}__idy_${j}" type="hidden" value="${d?.levels[j]?.id ?? ""}">`;
    }
    row += `<textarea id="id_description__idx_${i}_editor" name="description__idx_${i}_editor[text]">${esc(d?.description ?? "")}</textarea><input name="description__idx_${i}_editor[format]" type="hidden" value="1">`;
    if (w.strategy === "accumulative") {
      const scale = d && d.grade < 0 ? -d.grade : undefined;
      row += select(`grade__idx_${i}[modgrade_type]`, [["none", "None"], ["scale", "Scale"], ["point", "Point"]], scale ? "scale" : "point");
      row += select(`grade__idx_${i}[modgrade_scale]`, SCALES, scale, scale ? "" : ' disabled="disabled"');
      row += `<input type="text" name="grade__idx_${i}[modgrade_point]" id="id_grade__idx_${i}_modgrade_point" value="${d && d.grade > 0 ? d.grade : 10}"><div class="invalid-feedback" id="id_error_grade__idx_${i}">${errors[`grade__idx_${i}`] ?? ""}</div>`;
    }
    if (w.strategy === "numerrors") row += `<input type="text" name="grade0__idx_${i}" value="${esc(d?.grade0 ?? "No")}"><input type="text" name="grade1__idx_${i}" value="${esc(d?.grade1 ?? "Yes")}">`;
    if (w.strategy === "accumulative" || w.strategy === "numerrors") row += select(`weight__idx_${i}`, weights, d?.weight ?? 1);
    if (w.strategy === "rubric") {
      const count = d ? Math.max(d.levels.length + 2, 4) : 4;
      let prev = -1;
      for (let j = 0; j < count; j++) {
        const level = d?.levels[j];
        prev = level ? level.grade : prev + 1;
        row += `<div id="fgroup_id_level__idx_${i}__idy_${j}">${select(`grade__idx_${i}__idy_${j}`, Array.from({ length: 101 }, (_, g) => [100 - g, String(100 - g)]), prev)}<textarea name="definition__idx_${i}__idy_${j}">${esc(level?.definition ?? "")}</textarea><div class="invalid-feedback" id="fgroup_id_error_level__idx_${i}__idy_${j}">${errors[`level__idx_${i}__idy_${j}`] ?? ""}</div></div>`;
      }
    }
    rows.push(`<fieldset id="id_dimension${i}">${row}</fieldset>`);
  }
  let tail = "";
  if (w.strategy === "numerrors") {
    const total = Math.max(
      w.dims.reduce((sum, d) => sum + d.weight, 0),
      w.dims.length,
    );
    const percents: [string | number, string][] = [["", ""], ...Array.from({ length: 101 }, (_, g): [number, string] => [100 - g, `${100 - g}%`])];
    for (let e = 1; e <= total; e++) tail += select(`map__idx_${e}`, percents, w.maps.get(e) ?? "");
  }
  if (w.strategy === "rubric") tail += `<input type="radio" name="config_layout" value="list"${w.layout === "list" ? " checked" : ""}><input type="radio" name="config_layout" value="grid"${w.layout === "grid" ? " checked" : ""}>`;
  return `<form class="editstrategyform mform" action="${SITE}mod/workshop/editform.php" method="post"><input type="hidden" name="cmid" value="58"><input name="workshopid" type="hidden" value="7"><input name="strategy" type="hidden" value="${w.strategy}"><input name="norepeats" type="hidden" value="${norepeats}">
${rows.join("\n")}${tail}<input name="sesskey" type="hidden" value="s1">
<script>
// Moodle's form dependencies (hideIf): the scale menu is off unless the grade type is "scale".
document.querySelectorAll('select[name$="[modgrade_type]"]').forEach((type) => type.addEventListener("change", () => {
  document.querySelector('select[name="' + type.name.replace("modgrade_type", "modgrade_scale") + '"]').disabled = type.value !== "scale";
}));
</script>
<input type="submit" name="noadddims" value="Blanks for 2 more"><input type="submit" name="saveandcontinue" value="Save and continue editing"><input type="submit" name="saveandclose" value="Save and close"><input type="submit" name="cancel" value="Cancel"></form>`;
}

/** Saves the posted form as `save_edit_strategy_form` does: an empty description deletes its row (an empty definition its level); errors as the form's validation gives them. */
function save(w: Workshop, form: URLSearchParams, nextId: () => number): Record<string, string> {
  const errors: Record<string, string> = {};
  const norepeats = Number(form.get("norepeats"));
  if (w.strategy === "rubric") {
    for (let i = 0; i < norepeats; i++) {
      if (!(form.get(`description__idx_${i}_editor[text]`) ?? "").trim()) continue;
      const seen = new Map<string, number>();
      for (let j = 0; form.has(`levelid__idx_${i}__idy_${j}`); j++) {
        if (!(form.get(`definition__idx_${i}__idy_${j}`) ?? "").trim()) continue;
        const grade = form.get(`grade__idx_${i}__idy_${j}`) ?? "";
        if (seen.has(grade)) errors[`level__idx_${i}__idy_${j}`] = errors[`level__idx_${i}__idy_${seen.get(grade)}`] = "Level grades must be unique within a criterion";
        seen.set(grade, j);
      }
    }
  }
  if (w.strategy === "accumulative") {
    for (let i = 0; i < norepeats; i++) {
      if (form.get(`grade__idx_${i}[modgrade_type]`) === "point" && Number(form.get(`grade__idx_${i}[modgrade_point]`)) > 100) errors[`grade__idx_${i}`] = "Invalid grade value. This must be an integer between 1 and 100";
    }
  }
  if (Object.keys(errors).length > 0) return errors;
  w.saves++;
  const dims: Dimension[] = [];
  for (let i = 0; i < norepeats; i++) {
    const description = form.get(`description__idx_${i}_editor[text]`) ?? "";
    if (!description.trim()) continue;
    const id = Number(form.get(`dimensionid__idx_${i}`)) || nextId();
    const type = form.get(`grade__idx_${i}[modgrade_type]`);
    const levels: Level[] = [];
    for (let j = 0; form.has(`levelid__idx_${i}__idy_${j}`); j++) {
      const definition = form.get(`definition__idx_${i}__idy_${j}`) ?? "";
      if (definition.trim()) levels.push({ id: Number(form.get(`levelid__idx_${i}__idy_${j}`)) || nextId(), grade: Number(form.get(`grade__idx_${i}__idy_${j}`)), definition });
    }
    dims.push({
      id,
      description,
      grade: type === "scale" ? -Number(form.get(`grade__idx_${i}[modgrade_scale]`)) : Number(form.get(`grade__idx_${i}[modgrade_point]`)),
      weight: Number(form.get(`weight__idx_${i}`) ?? 1),
      grade0: form.get(`grade0__idx_${i}`) ?? "",
      grade1: form.get(`grade1__idx_${i}`) ?? "",
      levels: levels.sort((a, b) => a.grade - b.grade),
    });
  }
  w.dims = dims;
  if (w.strategy === "numerrors") {
    for (let e = 1; form.has(`map__idx_${e}`); e++) {
      const value = form.get(`map__idx_${e}`) ?? "";
      if (value === "") w.maps.delete(e);
      else w.maps.set(e, Number(value));
    }
    const max = dims.reduce((sum, d) => sum + d.weight, 0);
    for (const e of [...w.maps.keys()]) if (e > max) w.maps.delete(e);
  }
  if (form.has("config_layout")) w.layout = form.get("config_layout") as "list" | "grid";
  return {};
}

/** A teacher's site with a workshop of `strategy`: its editing form, and its page with `assessed` graded assessments in the report. */
async function workshopSite(strategy: WorkshopStrategy, dims: Dimension[] = [], assessed = 0) {
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" } });
  const w: Workshop = { strategy, dims, maps: new Map(), layout: "list", saves: 0 };
  let id = 100;
  await context.route(`${SITE}mod/workshop/editform.php**`, (route) => {
    const request = route.request();
    if (request.method() === "GET") {
      const norepeats = new URL(request.url()).searchParams.get("norepeats");
      return html(route, editForm(w, norepeats ? Number(norepeats) : Math.max(w.dims.length + 2, 3)), "page-mod-workshop-editform", 3);
    }
    const form = new URLSearchParams(request.postData() ?? "");
    const errors = save(w, form, () => ++id);
    // Saved, Moodle redirects to the form again, with its default rows.
    return html(route, editForm(w, Object.keys(errors).length > 0 ? Number(form.get("norepeats")) : Math.max(w.dims.length + 2, 3), errors), "page-mod-workshop-editform", 3);
  });
  const report = Array.from(
    { length: assessed },
    (_, n) =>
      `<tr><td class="participant">${`<a href="${SITE}user/view.php?id=${10 + n}&amp;course=3"></a>`}<span>Student ${n}</span></td><td class="submission"><a class="title" href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=${n + 1}">Work</a></td><td class="receivedgrade"><div><a class="grade" href="${SITE}mod/workshop/assessment.php?asid=${n + 1}"><span class="grade">80</span> <span class="gradinggrade">(-)</span></a></div></td><td class="submissiongrade">-</td><td class="givengrade">-</td></tr>`,
  ).join("");
  await context.route(`${SITE}mod/workshop/view.php**`, (route) => html(route, plan(30) + `<table class="grading-report"><tbody>${report}</tbody></table>`, "page-mod-workshop-view", 3));
  return { context, w };
}

/** A criterion read, without the id Moodle gave it. */
const noId = (c: object) => Object.fromEntries(Object.entries(c).filter(([key]) => key !== "id"));

const dim = (id: number, description: string, more: Partial<Dimension> = {}): Dimension => ({ id, description, grade: 10, weight: 1, grade0: "No", grade1: "Yes", levels: [], ...more });

describe("workshopForm", { skip: !browser && "no system browser" }, () => {
  it("reads each strategy's saved rows, leaving the blank ones out", async () => {
    const accumulative = await workshopSite("accumulative", [dim(1, "<p>Clear?</p>", { grade: 20, weight: 3 }), dim(2, "<p>Tidy?</p>", { grade: -2 })]);
    assert.deepEqual(await workshopForm(accumulative.context, SITE, 58), {
      activityId: 58,
      strategy: "accumulative",
      criteria: [
        { id: 1, description: "<p>Clear?</p>", maxGrade: 20, weight: 3 },
        { id: 2, description: "<p>Tidy?</p>", scaleId: 2, scale: "Default competence scale", weight: 1 },
      ],
    });
    await accumulative.context.close();

    const numerrors = await workshopSite("numerrors", [dim(1, "<p>Runs</p>", { weight: 2, grade0: "Nope" })]);
    numerrors.w.maps.set(1, 60);
    assert.deepEqual(await workshopForm(numerrors.context, SITE, 58), {
      activityId: 58,
      strategy: "numerrors",
      criteria: [{ id: 1, description: "<p>Runs</p>", weight: 2, errorWord: "Nope", successWord: "Yes" }],
      gradeMapping: [{ errors: 1, grade: 60 }],
    });
    await numerrors.context.close();

    const rubric = await workshopSite("rubric", [dim(1, "<p>Style</p>", { levels: [{ id: 11, grade: 0, definition: "Poor" }, { id: 12, grade: 5, definition: "Fine" }] })]);
    assert.deepEqual(await workshopForm(rubric.context, SITE, 58), {
      activityId: 58,
      strategy: "rubric",
      criteria: [{ id: 1, description: "<p>Style</p>", levels: [{ id: 11, grade: 0, definition: "Poor" }, { id: 12, grade: 5, definition: "Fine" }] }],
      layout: "list",
    });
    await rubric.context.close();
  });

  it("passes on Moodle's refusal", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Lucía Martín" } });
    await context.route(`${SITE}mod/workshop/editform.php**`, (route) => html(route, errorPage("Sorry, but you do not currently have permissions to do that (Edit assessment forms)."), "page-mod-workshop-editform"));
    await assert.rejects(workshopForm(context, SITE, 58), (error: Error) => error instanceof WorkshopError && /mod\/workshop:editdimensions/.test(error.message) && /Edit assessment forms/.test(error.message));
    await context.close();
  });
});

describe("setWorkshopForm", { skip: !browser && "no system browser" }, () => {
  it("sets an accumulative form in a new workshop, asking for the rows it needs", async () => {
    const site = await workshopSite("accumulative");
    const criteria = [1, 2, 3, 4].map((n) => ({ description: `<p>Aspect ${n}</p>` }));
    const result = await setWorkshopForm(site.context, SITE, 58, {
      strategy: "accumulative",
      criteria: [{ description: "<p>Clear?</p>", maxGrade: 20, weight: 2 }, { description: "<p>Tidy?</p>", scaleId: 1 }, ...criteria],
    });
    assert.equal(result.changed, "Set workshop 58's assessment form (Accumulative grading): 6 aspects.");
    assert.deepEqual(
      result.criteria.map(noId),
      [
        { description: "<p>Clear?</p>", maxGrade: 20, weight: 2 },
        { description: "<p>Tidy?</p>", scaleId: 1, scale: "Separate and Connected ways of knowing", weight: 1 },
        ...criteria.map((c) => ({ ...c, maxGrade: 10, weight: 1 })),
      ],
    );
    assert.equal(site.w.saves, 1);
    await site.context.close();
  });

  it("replaces a form in place: the first rows keep their ids, the rest are deleted", async () => {
    const site = await workshopSite("comments", [dim(1, "<p>Old one</p>"), dim(2, "<p>Old two</p>"), dim(3, "<p>Old three</p>")]);
    const result = await setWorkshopForm(site.context, SITE, 58, { strategy: "comments", criteria: [{ description: "<p>New</p>" }] });
    assert.equal(result.changed, "Replaced workshop 58's assessment form (Comments): 1 aspect.");
    assert.deepEqual(result.criteria, [{ id: 1, description: "<p>New</p>" }]);
    await site.context.close();
  });

  it("saves a rubric again until all its levels fit, and in their grades' order", async () => {
    const site = await workshopSite("rubric");
    const levels = [9, 0, 2, 4, 6, 8, 1].map((grade) => ({ grade, definition: `Level ${grade}` }));
    const result = await setWorkshopForm(site.context, SITE, 58, { strategy: "rubric", criteria: [{ description: "<p>Style</p>", levels }, { description: "<p>Content</p>", levels: [{ grade: 0, definition: "None" }] }], layout: "grid" });
    assert.deepEqual(
      result.criteria.map((c) => c.levels!.map((l) => l.grade)),
      [
        [0, 1, 2, 4, 6, 8, 9],
        [0],
      ],
    );
    assert.equal(result.layout, "grid");
    // Four levels at first, two more after each save.
    assert.equal(site.w.saves, 3);
    // Fewer levels later: the ones left over are deleted.
    const again = await setWorkshopForm(site.context, SITE, 58, { strategy: "rubric", criteria: [{ description: "<p>Style</p>", levels: [{ grade: 1, definition: "Some" }, { grade: 3, definition: "All" }] }] });
    assert.deepEqual(again.criteria, [{ id: result.criteria[0]!.id, description: "<p>Style</p>", levels: [{ id: result.criteria[0]!.levels![0]!.id, grade: 1, definition: "Some" }, { id: result.criteria[0]!.levels![1]!.id, grade: 3, definition: "All" }] }]);
    assert.equal(again.layout, "grid");
    await site.context.close();
  });

  it("sets a number-of-errors form, its grade mapping once the weights are saved", async () => {
    const site = await workshopSite("numerrors");
    const result = await setWorkshopForm(site.context, SITE, 58, {
      strategy: "numerrors",
      criteria: [{ description: "<p>Runs</p>", weight: 2, errorWord: "Fails", successWord: "Works" }, { description: "<p>Tested</p>" }],
      gradeMapping: [
        { errors: 3, grade: 10 },
        { errors: 1, grade: 70 },
      ],
    });
    assert.deepEqual(
      result.criteria.map(noId),
      [
        { description: "<p>Runs</p>", weight: 2, errorWord: "Fails", successWord: "Works" },
        { description: "<p>Tested</p>", weight: 1, errorWord: "No", successWord: "Yes" },
      ],
    );
    assert.deepEqual(result.gradeMapping, [
      { errors: 1, grade: 70 },
      { errors: 3, grade: 10 },
    ]);
    assert.equal(site.w.saves, 2);
    // Left out, the mapping is cleared.
    assert.deepEqual((await setWorkshopForm(site.context, SITE, 58, { strategy: "numerrors", criteria: [{ description: "<p>Runs</p>" }] })).gradeMapping, []);
    await site.context.close();
  });

  it("refuses a form of another strategy, naming the workshop's, and input Moodle wouldn't take", async () => {
    const site = await workshopSite("rubric");
    await assert.rejects(setWorkshopForm(site.context, SITE, 58, { strategy: "accumulative", criteria: [{ description: "<p>Clear?</p>" }] }), (error: Error) => error instanceof WorkshopError && /grades with the Rubric strategy \("rubric"\)/.test(error.message));
    const refused = (input: Parameters<typeof setWorkshopForm>[3], pattern: RegExp) => assert.rejects(setWorkshopForm(site.context, SITE, 58, input), (error: Error) => error instanceof MoodleError && error.code === "invalid-input" && pattern.test(error.message));
    await refused({ strategy: "rubric", criteria: [] }, /one criterion at least/);
    await refused({ strategy: "rubric", criteria: [{ description: "<p>A</p>", levels: [] }] }, /criterion 1 has no levels/);
    await refused({ strategy: "rubric", criteria: [{ description: "<p>A</p>", levels: [{ grade: 1, definition: "x" }, { grade: 1, definition: "y" }] }] }, /repeat a grade/);
    await refused({ strategy: "rubric", criteria: [{ description: "<p>A</p>", weight: 2, levels: [{ grade: 1, definition: "x" }] }] }, /"weight" is for Accumulative grading and Number of errors forms; this one is Rubric/);
    await refused({ strategy: "accumulative", criteria: [{ description: " " }] }, /aspect 1 has no description/);
    await refused({ strategy: "accumulative", criteria: [{ description: "<p>A</p>", weight: 17 }] }, /from 0 to 16/);
    await refused({ strategy: "numerrors", criteria: [{ description: "<p>A</p>" }], gradeMapping: [{ errors: 2, grade: 50 }] }, /from 1 to 1/);
    assert.equal(site.w.saves, 0);
    await site.context.close();
  });

  it("refuses a form already used to assess unless asked, and passes on Moodle's errors", async () => {
    const site = await workshopSite("accumulative", [dim(1, "<p>Clear?</p>")], 2);
    await assert.rejects(setWorkshopForm(site.context, SITE, 58, { strategy: "accumulative", criteria: [{ description: "<p>Clearer?</p>" }] }), (error: Error) => error instanceof WorkshopError && /has 2 assessments made with its form/.test(error.message));
    assert.equal(site.w.saves, 0);
    assert.equal((await setWorkshopForm(site.context, SITE, 58, { strategy: "accumulative", criteria: [{ description: "<p>Clearer?</p>" }], evenIfAssessed: true })).criteria[0]!.description, "<p>Clearer?</p>");
    await assert.rejects(setWorkshopForm(site.context, SITE, 58, { strategy: "accumulative", criteria: [{ description: "<p>A</p>", maxGrade: 500 }], evenIfAssessed: true }), FormError);
    await assert.rejects(setWorkshopForm(site.context, SITE, 58, { strategy: "accumulative", criteria: [{ description: "<p>A</p>", scaleId: 9 }], evenIfAssessed: true }), /Scale 9 isn't one workshop 58's course can use: 2 \("Default competence scale"\), 1/);
    await site.context.close();
  });
});
