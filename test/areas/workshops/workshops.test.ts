import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { FormError, WorkshopError, assessWorkshopSubmission, setWorkshopPhase, workshopInfo } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const html = (route: Route, body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: moodlePage({ userId: 3, body: `<div id="region-main">${body}</div>`, bodyId }) });

/** The user plan as Moodle 5.2 renders it, reduced: one `dl.phase` per phase, the current one's `dt` active. */
const plan = (active: number) =>
  `<h2 id="mod_workshop-userplanheading">Phase</h2><div class="userplan">${[10, 20, 30, 40, 50]
    .map((code) => `<dl class="phase"><dt class="phase${code} ${code === active ? "active" : "nonactive"}"><div><span class="phasetitle">Phase ${code}</span></div></dt><dd class="phase${code} phasetasks"></dd></dl>`)
    .join("")}</div>`;

const user = (id: number, name: string, size = 35) =>
  `<a href="${SITE}user/view.php?id=${id}&amp;course=3" class="d-inline-block aabtn"><span class="userinitials size-${size}" title="${name}">XX</span></a>`;

/** An assessment in the report's received or given column, as `helper_grading_report_assessment` renders it. */
const assessment = (asid: number, grade: string, other: [number, string] | undefined, gradinggrade = "(-)", weight = "") =>
  `<div class="assessmentdetails"><a class="grade" href="${SITE}mod/workshop/assessment.php?asid=${asid}"><span class="grade">${grade}</span> <span class="gradinggrade">${gradinggrade}</span>${weight ? ` @ <span class="weight">${weight}</span>` : ""}</a>${
    other ? ` by <span class="user">${user(other[0], other[1], 16)}<span class="fullname">${other[1]}</span></span>` : ""
  }</div>`;

/**
 * The grading report of a workshop in its evaluation phase, made up from the real one: Lucía's
 * submission assessed by the teacher (not a participant, so only in her received column) and by
 * Marcos (also in his given column), Marcos without a submission, and a paging bar to page 1.
 */
const REPORT_PAGE_0 = `<div id="workshop-viewlet-gradereport"><nav><ul class="pagination"><li><a class="page-link" href="${SITE}mod/workshop/view.php?id=58&amp;sortby=lastname&amp;sorthow=ASC&amp;page=1">2</a></li></ul></nav>
<table class="grading-report table"><thead><tr><th>Name</th></tr></thead><tbody>
<tr><td class="participant cell c0" rowspan="2">${user(5, "Lucía Martín")}<span>Lucía Martín</span></td>
<td class="submission cell c1" rowspan="2"><a class="title" href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=1">Loops essay</a><div class="lastmodified">modified on <span>Sunday</span></div></td>
<td class="receivedgrade notnull cell c2" rowspan="1">${assessment(1, "67", [3, "Profesor Demo"])}</td>
<td class="submissiongrade cell c3" rowspan="2"><del>66,50</del><br><ins>70,00</ins></td>
<td class="givengrade null cell c4" rowspan="2">-</td><td class="gradinggrade cell c5" rowspan="2">-</td></tr>
<tr><td class="receivedgrade notnull cell c2" rowspan="1">${assessment(2, "66", [6, "Marcos López"], "(<del>15</del> / <ins>18</ins>)", "2")}</td></tr>
<tr><td class="participant cell c0" rowspan="1">${user(6, "Marcos López")}<span>Marcos López</span></td>
<td class="submission cell c1" rowspan="1"><div class="info">No submission found for this user</div></td>
<td class="receivedgrade null cell c2" rowspan="1">-</td><td class="submissiongrade cell c3" rowspan="1">-</td>
<td class="givengrade notnull cell c4" rowspan="1">${assessment(2, "66", [5, "Lucía Martín"], "(<del>15</del> / <ins>18</ins>)", "2")}</td><td class="gradinggrade cell c5" rowspan="1">18</td></tr>
</tbody></table></div>`;

const REPORT_PAGE_1 = `<table class="grading-report table"><tbody>
<tr><td class="participant cell c0" rowspan="1">${user(7, "Sara Gil")}<span>Sara Gil</span></td>
<td class="submission cell c1" rowspan="1"><a class="title" href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=4">Sara's essay</a></td>
<td class="receivedgrade null cell c2" rowspan="1">${assessment(5, "-", [5, "Lucía Martín"])}</td><td class="submissiongrade cell c3" rowspan="1">-</td>
<td class="givengrade null cell c4" rowspan="1">-</td><td class="gradinggrade cell c5" rowspan="1">-</td></tr></tbody></table>`;

describe("workshopInfo", { skip: !browser && "no system browser" }, () => {
  it("reads the phase and every page of the report, merging each assessment's two sides", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" } });
    await context.route(`${SITE}mod/workshop/view.php**`, (route) =>
      html(route, plan(40) + (new URL(route.request().url()).searchParams.get("page") === "1" ? REPORT_PAGE_1 : REPORT_PAGE_0), "page-mod-workshop-view"),
    );
    assert.deepEqual(await workshopInfo(context, SITE, 58), {
      activityId: 58,
      phase: "evaluation",
      submissions: [
        { id: 1, title: "Loops essay", authorId: 5, author: "Lucía Martín", grade: 66.5, gradeOverride: 70 },
        { id: 4, title: "Sara's essay", authorId: 7, author: "Sara Gil" },
      ],
      assessments: [
        { id: 1, submissionId: 1, authorId: 5, author: "Lucía Martín", reviewerId: 3, reviewer: "Profesor Demo", grade: 67, weight: 1 },
        { id: 2, submissionId: 1, authorId: 5, author: "Lucía Martín", reviewerId: 6, reviewer: "Marcos López", grade: 66, gradingGrade: 15, gradingGradeOverride: 18, weight: 2 },
        { id: 5, submissionId: 4, authorId: 7, author: "Sara Gil", reviewerId: 5, reviewer: "Lucía Martín", weight: 1 },
      ],
    });
    await context.close();
  });

  it("gives empty lists where Moodle shows no report, and refuses another activity", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Lucía Martín" }, bodies: { "/mod/workshop/view.php": plan(20) } });
    assert.deepEqual(await workshopInfo(context, SITE, 58), { activityId: 58, phase: "submission", submissions: [], assessments: [] });
    await context.route(`${SITE}mod/workshop/view.php**`, (route) => html(route, "", "page-mod-forum-view"));
    await assert.rejects(workshopInfo(context, SITE, 46), WorkshopError);
    await context.close();
  });
});

describe("setWorkshopPhase", { skip: !browser && "no system browser" }, () => {
  it("confirms Moodle's question and reads the phase it lands on", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" } });
    const posted: URLSearchParams[] = [];
    let phase = 20;
    await context.route(`${SITE}mod/workshop/switchphase.php**`, (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        const target = new URL(request.url()).searchParams.get("phase");
        // The confirmation as `$OUTPUT->confirm` renders it: "Continue" posts, "Cancel" goes back to the workshop.
        return html(
          route,
          `<div role="main"><form method="post" action="${SITE}mod/workshop/switchphase.php"><input type="hidden" name="cmid" value="58"><input type="hidden" name="phase" value="${target}"><input type="hidden" name="confirm" value="1"><input type="hidden" name="sesskey" value="s1"><button type="submit">Continue</button></form><form method="get" action="${SITE}mod/workshop/view.php"><input type="hidden" name="id" value="58"><button type="submit">Cancel</button></form></div>`,
          "page-mod-workshop-switchphase",
        );
      }
      const form = new URLSearchParams(request.postData() ?? "");
      posted.push(form);
      phase = Number(form.get("phase"));
      // Moodle redirects to the workshop's page.
      return html(route, plan(phase), "page-mod-workshop-view");
    });
    assert.deepEqual(await setWorkshopPhase(context, SITE, 58, "assessment"), { changed: "Workshop 58 switched to the assessment phase.", phase: "assessment" });
    assert.deepEqual(Object.fromEntries(posted[0]!), { cmid: "58", phase: "30", confirm: "1", sesskey: "s1" });
    await assert.rejects(setWorkshopPhase(context, SITE, 58, "grading" as never), /one of setup, submission, assessment, evaluation, closed/);
    await context.close();
  });

  it("passes on Moodle's refusal", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 5, fullName: "Lucía Martín" },
      bodies: { "/mod/workshop/switchphase.php": '<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Switch phase).</p></div>' },
    });
    await assert.rejects(setWorkshopPhase(context, SITE, 58, "closed"), (error: Error) => error instanceof WorkshopError && /permissions to do that/.test(error.message));
    await context.close();
  });
});

/** An accumulative assessment form as Moodle 5.2 renders it, reduced: a points menu and a comment per criterion, the overall feedback. */
const accumulativeForm = (asid: number, header: string) => `<div class="assessment-full"><div class="header"><div class="title">Your assessment</div>
<div class="reviewer"><div class="fullname">by <a href="${SITE}user/view.php?id=3&amp;course=3">Profesor Demo</a></div></div>${header}<div class="actions"></div></div>
<form class="assessmentform accumulative mform" action="${SITE}mod/workshop/assessment.php" method="post">
<input type="hidden" name="asid" value="${asid}"><input name="nodims" type="hidden" value="2"><input name="minusone" type="hidden" value="-1">
<input name="dimensionid__idx_0" type="hidden" value="1"><input name="gradeid__idx_0" type="hidden" value="">
<select name="grade__idx_0" id="id_grade__idx_0"><option value="-1">Choose...</option><option value="10">10 / 10</option><option value="8">8 / 10</option><option value="0">0 / 10</option></select>
<div class="invalid-feedback" id="id_error_grade__idx_0"></div>
<textarea name="peercomment__idx_0" id="id_peercomment__idx_0"></textarea>
<input name="dimensionid__idx_1" type="hidden" value="2"><input name="gradeid__idx_1" type="hidden" value="">
<select name="grade__idx_1" id="id_grade__idx_1"><option value="-1">Choose...</option><option value="1">Good</option><option value="2">Excellent</option></select>
<textarea name="peercomment__idx_1" id="id_peercomment__idx_1"></textarea>
<input name="strategy" type="hidden" value="accumulative"><input name="sesskey" type="hidden" value="s1">
<textarea id="id_feedbackauthor_editor" name="feedbackauthor_editor[text]"></textarea>
<select name="weight" id="id_weight"><option value="2">2</option><option value="1" selected>1</option></select>
<input type="submit" name="saveandclose" value="Save and close"><input type="submit" name="saveandcontinue" value="Save and continue"></form></div>`;

/** A submission's page, with the teacher's assessment of it when `asid` is given, and the "Assess" button otherwise. */
const submissionPage = (asid?: number) =>
  asid
    ? `<div class="assessment-full"><div class="header"><div class="title">Your assessment</div><div class="reviewer"><div class="fullname">by <a href="${SITE}user/view.php?id=3&amp;course=3">Profesor Demo</a></div></div>
<div class="grade">Grade: 64 of 80</div><div class="actions"><form method="post" action="${SITE}mod/workshop/assessment.php"><input type="hidden" name="asid" value="${asid}"><button type="submit">Re-assess</button></form></div></div></div>`
    : `<form method="post" action="${SITE}mod/workshop/submission.php"><input type="hidden" name="cmid" value="58"><input type="hidden" name="id" value="1"><input type="hidden" name="assess" value="1"><input type="hidden" name="sesskey" value="s1"><button type="submit">Assess</button></form>`;

async function assessSite(existing?: number) {
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" } });
  const saved: URLSearchParams[] = [];
  const allocated: URLSearchParams[] = [];
  await context.route(`${SITE}mod/workshop/submission.php**`, (route) => {
    const request = route.request();
    if (request.method() === "GET") return html(route, submissionPage(existing), "page-mod-workshop-submission");
    allocated.push(new URLSearchParams(request.postData() ?? ""));
    // Moodle adds the assessment and redirects to it.
    return html(route, accumulativeForm(9, '<div class="grade nograde">Not assessed yet</div>'), "page-mod-workshop-assessment");
  });
  await context.route(`${SITE}mod/workshop/assessment.php**`, (route) => {
    const request = route.request();
    if (request.method() === "GET") return html(route, accumulativeForm(existing ?? 9, '<div class="grade nograde">Not assessed yet</div>'), "page-mod-workshop-assessment");
    saved.push(new URLSearchParams(request.postData() ?? ""));
    return html(route, accumulativeForm(existing ?? 9, '<div class="grade">Grade: 64 of 80</div>'), "page-mod-workshop-assessment");
  });
  return { context, saved, allocated };
}

describe("assessWorkshopSubmission", { skip: !browser && "no system browser" }, () => {
  it("adds the teacher's assessment with Assess, fills the strategy's form and reads the grade", async () => {
    const site = await assessSite();
    const result = await assessWorkshopSubmission(site.context, SITE, 58, 1, {
      criteria: [{ grade: 8, comment: "Clear" }, { grade: "Excellent" }],
      feedback: "<p>Good work.</p>",
      fields: { weight: "2" },
    });
    assert.deepEqual(result, { changed: "Submission 1 of workshop 58 assessed: 64 of 80.", assessmentId: 9, grade: 64, maxGrade: 80 });
    assert.equal(site.allocated[0]?.get("assess"), "1");
    const form = site.saved[0]!;
    assert.equal(form.get("asid"), "9");
    assert.equal(form.get("grade__idx_0"), "8");
    assert.equal(form.get("peercomment__idx_0"), "Clear");
    assert.equal(form.get("grade__idx_1"), "2");
    assert.equal(form.get("feedbackauthor_editor[text]"), "<p>Good work.</p>");
    assert.equal(form.get("weight"), "2");
    assert.equal(form.get("saveandcontinue"), "Save and continue");
    await site.context.close();
  });

  it("changes an assessment the person already made, and refuses a grade the criterion doesn't take", async () => {
    const site = await assessSite(7);
    assert.equal((await assessWorkshopSubmission(site.context, SITE, 58, 1, { criteria: [{ grade: 10 }] })).assessmentId, 7);
    assert.equal(site.allocated.length, 0);
    await assert.rejects(assessWorkshopSubmission(site.context, SITE, 58, 1, { criteria: [{ grade: 9 }] }), (error: Error) => error instanceof WorkshopError && /takes "10" \("10 \/ 10"\), "8" \("8 \/ 10"\), "0"/.test(error.message));
    await assert.rejects(assessWorkshopSubmission(site.context, SITE, 58, 1, { criteria: [{}, {}, { grade: 1 }] }), /has 2 criteria; 3 were given/);
    await site.context.close();
  });

  it("says when Moodle offers no assessment, and passes on the form's errors", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" }, bodies: { "/mod/workshop/submission.php": "<p>Submission</p>" } });
    await assert.rejects(assessWorkshopSubmission(context, SITE, 58, 1, { criteria: [{ grade: 8 }] }), /only open in the assessment phase/);
    await context.close();

    const site = await assessSite(7);
    await site.context.route(`${SITE}mod/workshop/assessment.php**`, (route) =>
      html(route, accumulativeForm(7, "").replace('id="id_error_grade__idx_0"></div>', 'id="id_error_grade__idx_0">You must select a grade</div>'), "page-mod-workshop-assessment"),
    );
    await assert.rejects(assessWorkshopSubmission(site.context, SITE, 58, 1, { criteria: [{ comment: "Unfinished" }] }), FormError);
    await site.context.close();
  });
});

/** A rubric's assessment form (list layout): a radio per level, labelled by its definition. */
describe("assessWorkshopSubmission with a rubric", { skip: !browser && "no system browser" }, () => {
  it("chooses a level by its position or its definition", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" } });
    const saved: URLSearchParams[] = [];
    const rubric = `<div class="assessment-full"><div class="header"><div class="reviewer"><div class="fullname"><a href="${SITE}user/view.php?id=3">Profesor Demo</a></div></div><div class="grade">Grade: 40 of 80</div></div>
<form class="assessmentform rubric mform" action="${SITE}mod/workshop/assessment.php" method="post"><input type="hidden" name="asid" value="7"><input name="dimensionid__idx_0" type="hidden" value="1"><input name="dimensionid__idx_1" type="hidden" value="2">
<label class="form-check-label"><input type="radio" name="chosenlevelid__idx_0" id="l1" value="11"> Poor</label><label class="form-check-label"><input type="radio" name="chosenlevelid__idx_0" id="l2" value="12"> Fine</label>
<input type="radio" name="chosenlevelid__idx_1" id="l3" value="21"><label for="l3">None</label><input type="radio" name="chosenlevelid__idx_1" id="l4" value="22"><label for="l4">Some</label>
<input name="strategy" type="hidden" value="rubric"><input type="submit" name="saveandcontinue" value="Save and continue"></form></div>`;
    await context.route(`${SITE}mod/workshop/submission.php**`, (route) => html(route, submissionPage(7), "page-mod-workshop-submission"));
    await context.route(`${SITE}mod/workshop/assessment.php**`, (route) => {
      if (route.request().method() === "POST") saved.push(new URLSearchParams(route.request().postData() ?? ""));
      return html(route, rubric, "page-mod-workshop-assessment");
    });
    const result = await assessWorkshopSubmission(context, SITE, 58, 1, { criteria: [{ grade: 2 }, { grade: "None" }] });
    assert.equal(result.grade, 40);
    assert.equal(saved[0]?.get("chosenlevelid__idx_0"), "12");
    assert.equal(saved[0]?.get("chosenlevelid__idx_1"), "21");
    await assert.rejects(assessWorkshopSubmission(context, SITE, 58, 1, { criteria: [{ grade: 3 }] }), /takes 1 \("Poor"\), 2 \("Fine"\); not "3"/);
    await assert.rejects(assessWorkshopSubmission(context, SITE, 58, 1, { feedback: "<p>Hi</p>" }), /has no overall feedback/);
    await context.close();
  });
});
