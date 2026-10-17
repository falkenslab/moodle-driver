import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { WorkshopError, calculateWorkshopGrades, overrideWorkshopGrade } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";
import { errorPage, html, plan } from "./fakeWorkshop.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface Grades {
  submission?: number;
  submissionOver?: number;
  gradingGrade?: number;
  gradingGradeOver?: number;
}

/** The grading report, reduced: Lucía's submission 12, assessed by Marcos (assessment 31). */
const report = (g: Grades) => {
  const shown = (grade?: number, over?: number) => (grade === undefined ? "-" : over === undefined ? grade.toFixed(2) : `<del>${grade.toFixed(2)}</del><br><ins>${over.toFixed(2)}</ins>`);
  return `<table class="grading-report"><tbody><tr><td class="participant"><a href="${SITE}user/view.php?id=5&amp;course=3"></a><span>Lucía Martín</span></td>
<td class="submission"><a class="title" href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=12">Loops essay</a></td>
<td class="receivedgrade"><div class="assessmentdetails"><a class="grade" href="${SITE}mod/workshop/assessment.php?asid=31"><span class="grade">56</span> <span class="gradinggrade">(${
    g.gradingGrade === undefined ? "-" : g.gradingGradeOver === undefined ? g.gradingGrade : `<del>${g.gradingGrade}</del> / <ins>${g.gradingGradeOver}</ins>`
  })</span></a> by <span class="user"><a href="${SITE}user/view.php?id=6&amp;course=3"></a><span class="fullname">Marcos López</span></span></div></td>
<td class="submissiongrade">${shown(g.submission, g.submissionOver)}</td></tr></tbody></table>`;
};

/** The grading evaluation settings form of the evaluation phase, as workshop_best_evaluation_settings_form renders it. */
const settingsForm = (comparison: string) =>
  `<form class="evalsettingsform best mform" method="post" action="${SITE}mod/workshop/aggregate.php"><input type="hidden" name="cmid" value="58"><input type="hidden" name="sesskey" value="s1">
<select name="comparison">${["9", "7", "5", "3", "1"].map((v) => `<option value="${v}"${v === comparison ? " selected" : ""}>level ${v}</option>`).join("")}</select>
<input type="submit" name="submit" value="Re-calculate grades"></form>`;

/** The override select of a feedback form: "Not overridden", then the grades from the maximum down. */
const overrideSelect = (name: string, max: number, current?: number) =>
  `<select name="${name}"><option value="">Not overridden</option>${Array.from({ length: max + 1 }, (_, i) => max - i)
    .map((v) => `<option value="${v}"${v === current ? " selected" : ""}>${v}</option>`)
    .join("")}</select>`;

async function site({ phase = 40, teacher = true }: { phase?: number; teacher?: boolean } = {}) {
  const context = await browser!.newContext();
  const userId = teacher ? 3 : 5;
  await serveFakeMoodle(context, { user: { id: userId, fullName: teacher ? "Profesor Demo" : "Lucía Martín" } });
  const grades: Grades = {};
  const posted: URLSearchParams[] = [];
  let comparison = "5";
  const view = () => plan(phase) + (teacher && phase === 40 ? settingsForm(comparison) : "") + (teacher ? report(grades) : "");
  await context.route(`${SITE}mod/workshop/view.php**`, (route) => html(route, view(), "page-mod-workshop-view", userId));
  await context.route(`${SITE}mod/workshop/aggregate.php**`, (route) => {
    const form = new URLSearchParams(route.request().postData() ?? "");
    posted.push(form);
    comparison = form.get("comparison") ?? comparison;
    grades.submission = 56;
    grades.gradingGrade = comparison === "7" ? 18 : 16;
    // Moodle redirects to the workshop's page (served in place).
    return html(route, view(), "page-mod-workshop-view", userId);
  });
  await context.route(`${SITE}mod/workshop/submission.php**`, (route) => {
    if (route.request().method() === "POST") {
      const form = new URLSearchParams(route.request().postData() ?? "");
      posted.push(form);
      grades.submissionOver = form.get("gradeover") === "" ? undefined : Number(form.get("gradeover"));
      return html(route, view(), "page-mod-workshop-view", userId);
    }
    const feedback =
      teacher && phase === 40
        ? `<form class="mform" method="post" action="${SITE}mod/workshop/submission.php?cmid=58&amp;id=12"><input name="submissionid" type="hidden" value="12"><input name="_qf__workshop_feedbackauthor_form" type="hidden" value="1">${overrideSelect("gradeover", 80, grades.submissionOver)}<textarea name="feedbackauthor_editor[text]"></textarea><input type="submit" name="save" value="Save and close"></form>`
        : "";
    return html(route, `<div class="submission-full"></div>${feedback}`, "page-mod-workshop-submission", userId);
  });
  await context.route(`${SITE}mod/workshop/assessment.php**`, (route) => {
    const asid = new URL(route.request().url()).searchParams.get("asid");
    if (asid === "99") return html(route, errorPage("Can't find data record in database table workshop_assessments.", "invalidrecord"), "page-mod-workshop-assessment", userId);
    if (route.request().method() === "POST") {
      const form = new URLSearchParams(route.request().postData() ?? "");
      posted.push(form);
      grades.gradingGradeOver = form.get("gradinggradeover") === "" ? undefined : Number(form.get("gradinggradeover"));
      return html(route, view(), "page-mod-workshop-view", userId);
    }
    const settings =
      teacher && asid === "31"
        ? `<form class="mform" method="post" action="${SITE}mod/workshop/assessment.php?asid=31"><input name="asid" type="hidden" value="31"><input name="_qf__workshop_feedbackreviewer_form" type="hidden" value="1"><select name="weight"><option value="1" selected>1</option></select>${overrideSelect("gradinggradeover", 20, grades.gradingGradeOver)}<textarea name="feedbackreviewer_editor[text]"></textarea><input type="submit" name="save" value="Save and close"></form>`
        : "";
    return html(route, `<form class="assessmentform mform frozen"></form>${settings}`, "page-mod-workshop-assessment", userId);
  });
  return { context, posted };
}

describe("calculateWorkshopGrades", { skip: !browser && "no system browser" }, () => {
  it("submits the evaluation settings with the comparison and reads the grades", async () => {
    const { context, posted } = await site();
    const result = await calculateWorkshopGrades(context, SITE, 58, { comparison: "lax" });
    assert.equal(posted[0]?.get("comparison"), "7");
    assert.equal(posted[0]?.get("submit"), "Re-calculate grades");
    assert.equal(result.changed, "Workshop 58's grades calculated (comparison: lax): 1 of 1 submission(s) graded.");
    assert.equal(result.comparison, "lax");
    assert.equal(result.phase, "evaluation");
    assert.deepEqual(result.submissions, [{ id: 12, title: "Loops essay", authorId: 5, author: "Lucía Martín", grade: 56 }]);
    assert.equal(result.assessments[0]?.gradingGrade, 18);
    // Without a comparison, the form's own.
    assert.equal((await calculateWorkshopGrades(context, SITE, 58)).comparison, "lax");
    await assert.rejects(calculateWorkshopGrades(context, SITE, 58, { comparison: "loose" as never }), /one of very strict, strict, fair, lax, very lax/);
    await context.close();
  });

  it("refuses outside the evaluation phase and without the capability", async () => {
    const early = await site({ phase: 30 });
    await assert.rejects(calculateWorkshopGrades(early.context, SITE, 58), (error: Error) => error instanceof WorkshopError && /assessment phase: Moodle calculates grades in the evaluation phase/.test(error.message));
    await early.context.close();
    const student = await site({ teacher: false });
    await assert.rejects(calculateWorkshopGrades(student.context, SITE, 58), /mod\/workshop:overridegrades/);
    await student.context.close();
  });
});

describe("overrideWorkshopGrade", { skip: !browser && "no system browser" }, () => {
  it("overrides a submission's grade with feedback, then removes it", async () => {
    const { context, posted } = await site();
    await calculateWorkshopGrades(context, SITE, 58);
    const result = await overrideWorkshopGrade(context, SITE, 58, { submissionId: 12, grade: 70, feedback: "<p>Better than that.</p>" });
    assert.equal(result.changed, "The grade for submission 12 of workshop 58 overridden: 70.");
    assert.deepEqual(result.submission, { id: 12, title: "Loops essay", authorId: 5, author: "Lucía Martín", grade: 56, gradeOverride: 70 });
    const form = posted[posted.length - 1]!;
    assert.equal(form.get("gradeover"), "70");
    assert.equal(form.get("feedbackauthor_editor[text]"), "<p>Better than that.</p>");
    assert.equal(form.get("save"), "Save and close");
    const removed = await overrideWorkshopGrade(context, SITE, 58, { submissionId: 12, grade: null });
    assert.equal(removed.submission?.gradeOverride, undefined);
    await assert.rejects(overrideWorkshopGrade(context, SITE, 58, { submissionId: 12, grade: 81 }), /from 0 to 80; not 81/);
    await assert.rejects(overrideWorkshopGrade(context, SITE, 58, { submissionId: 12, grade: 7.5 }), /whole number/);
    await assert.rejects(overrideWorkshopGrade(context, SITE, 58, { submissionId: 12, assessmentId: 31, grade: 1 }), /one of the two/);
    await context.close();
  });

  it("overrides an assessment's grade for assessing", async () => {
    const { context, posted } = await site();
    await calculateWorkshopGrades(context, SITE, 58);
    const result = await overrideWorkshopGrade(context, SITE, 58, { assessmentId: 31, grade: 20 });
    assert.equal(posted[posted.length - 1]?.get("gradinggradeover"), "20");
    assert.equal(result.assessment?.gradingGrade, 16);
    assert.equal(result.assessment?.gradingGradeOverride, 20);
    await assert.rejects(overrideWorkshopGrade(context, SITE, 58, { assessmentId: 32, grade: 10 }), (error: Error) => error instanceof WorkshopError && /no grade override for assessment 32/.test(error.message));
    await assert.rejects(overrideWorkshopGrade(context, SITE, 58, { assessmentId: 99, grade: 10 }), /Can't find data record/);
    await context.close();
  });

  it("says where Moodle shows no override: another phase, a student", async () => {
    const early = await site({ phase: 30 });
    await assert.rejects(overrideWorkshopGrade(early.context, SITE, 58, { submissionId: 12, grade: 10 }), /evaluation phase only/);
    await early.context.close();
    const student = await site({ teacher: false });
    await assert.rejects(overrideWorkshopGrade(student.context, SITE, 58, { submissionId: 12, grade: 10 }), /mod\/workshop:overridegrades/);
    await student.context.close();
  });
});
