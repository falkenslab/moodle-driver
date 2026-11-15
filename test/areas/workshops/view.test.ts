import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { WorkshopError, workshopView } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";
import { html } from "./fakeWorkshop.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const user = (id: number, name: string) => `<a href="${SITE}user/view.php?id=${id}&amp;course=3" class="d-inline-block aabtn"><span class="userinitials size-35" title="${name}">XX</span></a>`;

/** A viewlet, the collapsible region Moodle 5.2 wraps each part of the page in. */
const viewlet = (id: string, inner: string) =>
  `<div id="workshop-viewlet-${id}" class="collapsibleregion "><div id="workshop-viewlet-${id}_sizer"><div id="workshop-viewlet-${id}_caption" class="collapsibleregioncaption"><a href="#">Caption</a></div><div id="workshop-viewlet-${id}_inner" class="collapsibleregioninner">${inner}</div></div></div>`;

/** The user plan as Moodle 5.2 renders it, reduced: the current phase's tasks in its `dd.active`. */
const plan = (active: number, tasks: string) =>
  `<h2 id="mod_workshop-userplanheading">Phase</h2><div class="userplan">${[10, 20, 30, 40, 50]
    .map((code) => `<dl class="phase"><dt class="phase${code} ${code === active ? "active" : "nonactive"}"><div><span class="phasetitle">Phase ${code}</span></div></dt><dd class="phase${code} ${code === active ? "active" : "nonactive"} phasetasks">${code === active ? tasks : ""}</dd></dl>`)
    .join("")}</div>`;

/** A submission's summary, as `render_workshop_submission_summary` renders it. */
const summary = (id: number, title: string, author: [number, string], status = "") =>
  `<div class="submission-summary${status ? ` ${status}` : ""}"><a class="title" href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=${id}">${title}</a><div class="author"><div class="picture">${user(author[0], author[1])}</div><div class="fullname">by <a href="${SITE}user/view.php?id=${author[0]}&amp;course=3">${author[1]}</a></div></div><div class="userdate created">submitted on <span>Sunday, 15 November 2026, 12:29 PM</span></div>${status ? `<div class="grade-status">${status === "graded" ? "Already graded" : "No grade yet"}</div>` : ""}</div>`;

/** A submission allocated to assess, with its "Assess" button to its assessment. */
const toAssess = (asid: number, id: number, title: string, author: [number, string], graded: boolean) =>
  `<div class="box py-3 generalbox assessment-summary ${graded ? "graded" : "notgraded"}">${summary(id, title, author, graded ? "graded" : "notgraded")}<div class="singlebutton"><form method="get" action="${SITE}mod/workshop/assessment.php"><input type="hidden" name="asid" value="${asid}"><button type="submit" class="btn btn-secondary">${graded ? "Re-assess" : "Assess"}</button></form></div></div>`;

/** Lucía's workshop page in its assessment phase (made up from Moodle 5.2's): her submission, two allocated, one of them assessed. */
const STUDENT_PAGE = `${plan(30, `<ul class="tasks"><li class=""><div class="title"><span class="accesshide">Task to do </span>Assess peers</div><div class="details">total: 2<br>pending: 1</div></li></ul>`)}
${viewlet("ownsubmission", `<div class="box py-3 generalbox ownsubmission">${summary(30, "Student work", [5, "Lucía Martín"])}</div>`)}
${viewlet("instructreviewers", `<div class="box py-3 generalbox instructions"><div class="no-overflow"><p>Reviewers: be kind.</p></div></div>`)}
${viewlet("assignedassessments", toAssess(50, 31, "Admin work", [2, "Admin User"], false) + toAssess(51, 32, "Marcos work", [7, "Marcos Ruiz"], true))}`;

/** A rubric's assessment form as a reviewer gets it in Moodle 5.2 (list layout), reduced; `header` is the assessment's grade line. */
const rubricForm = (asid: number, header: string) => `<div class="assessment-full"><div class="header"><div class="title">Your assessment</div><div class="reviewer"><div class="fullname">by <a href="${SITE}user/view.php?id=5&amp;course=3">Lucía Martín</a></div></div>${header}<div class="actions"></div></div>
<form class="assessmentform rubric list mform" action="${SITE}mod/workshop/assessment.php" method="post"><input type="hidden" name="asid" value="${asid}">
<input name="dimensionid__idx_0" type="hidden" value="11"><input name="gradeid__idx_0" type="hidden" value=""><input name="dimensionid__idx_1" type="hidden" value="12"><input name="gradeid__idx_1" type="hidden" value=""><input name="strategy" type="hidden" value="rubric">
<fieldset class="clearfix fitem" id="id_dimensionhdr__idx_0"><div id="id_dim_11_desc" class="fitem description rubric"><p>Clarity</p></div>
<label class="form-check-inline form-check-label fitem"><input type="radio" name="chosenlevelid__idx_0" id="id_chosenlevelid__idx_0_33" value="33"> Unclear </label><label class="form-check-inline form-check-label fitem"><input type="radio" name="chosenlevelid__idx_0" id="id_chosenlevelid__idx_0_34" value="34"> Clear </label></fieldset>
<fieldset class="clearfix fitem" id="id_dimensionhdr__idx_1"><div id="id_dim_12_desc" class="fitem description rubric"><p>Content</p></div>
<label class="form-check-inline form-check-label fitem"><input type="radio" name="chosenlevelid__idx_1" id="id_chosenlevelid__idx_1_35" value="35"> Missing </label><label class="form-check-inline form-check-label fitem"><input type="radio" name="chosenlevelid__idx_1" id="id_chosenlevelid__idx_1_36" value="36"> All </label></fieldset>
<textarea id="id_feedbackauthor_editor" name="feedbackauthor_editor[text]"></textarea>
<input type="submit" name="saveandcontinue" value="Save and continue"></form></div>`;

/** A site serving the workshop's page as `page`, and the assessments by id; counts the requests for each and what's posted. */
async function viewSite(page: string, assessments: Record<number, string> = {}) {
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 5, fullName: "Lucía Martín" } });
  const opened: string[] = [];
  const posted: string[] = [];
  await context.route(`${SITE}mod/**`, (route: Route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") posted.push(url.pathname);
    opened.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/mod/workshop/view.php" && url.searchParams.get("id") === "58") return html(route, page, "page-mod-workshop-view");
    if (url.pathname === "/mod/workshop/view.php") return html(route, "<p>A forum.</p>", "page-mod-forum-view");
    const asid = Number(url.searchParams.get("asid"));
    if (url.pathname === "/mod/workshop/assessment.php" && assessments[asid]) return html(route, assessments[asid], "page-mod-workshop-assessment");
    return route.fulfill({ status: 404, body: "" });
  });
  return { context, opened, posted };
}

describe("workshopView", { skip: !browser && "no system browser" }, () => {
  it("reads a participant's tasks, instructions, own submission and allocated submissions, the form from an assessment, without saving anything", async () => {
    const { context, opened, posted } = await viewSite(STUDENT_PAGE, {
      50: rubricForm(50, `<div class="grade nograde">Not assessed yet</div>`),
      51: rubricForm(51, `<div class="grade">Grade: 64.00 of 80.00</div>`),
    });
    const view = await workshopView(context, SITE, 58);
    assert.deepEqual(view, {
      activityId: 58,
      phase: "assessment",
      tasks: [{ title: "Assess peers", state: "todo", details: ["total: 2", "pending: 1"] }],
      instructions: { reviewers: "<p>Reviewers: be kind.</p>" },
      ownSubmission: { id: 30, title: "Student work" },
      toAssess: [
        { assessmentId: 50, submissionId: 31, title: "Admin work", authorId: 2, author: "Admin User", assessed: false },
        { assessmentId: 51, submissionId: 32, title: "Marcos work", authorId: 7, author: "Marcos Ruiz", assessed: true, grade: 64, maxGrade: 80 },
      ],
      form: {
        strategy: "rubric",
        criteria: [
          { description: "<p>Clarity</p>", grades: [{ grade: 1, label: "Unclear" }, { grade: 2, label: "Clear" }], comment: false },
          { description: "<p>Content</p>", grades: [{ grade: 1, label: "Missing" }, { grade: 2, label: "All" }], comment: false },
        ],
        feedback: true,
      },
    });
    assert.deepEqual(posted, []);
    assert.deepEqual(opened, ["/mod/workshop/view.php?id=58", "/mod/workshop/assessment.php?asid=50", "/mod/workshop/assessment.php?asid=51"]);
    await context.close();
  });

  it("reads the submission phase: the instructions for authors, nothing submitted nor to assess, no form", async () => {
    const page = `${plan(20, `<ul class="tasks"><li class=""><div class="title"><span class="accesshide">Task to do </span><a href="${SITE}mod/workshop/submission.php?cmid=58&amp;id">Submit your work</a></div><div class="details"></div></li></ul>`)}
${viewlet("instructauthors", `<div class="box py-3 generalbox instructions"><div class="no-overflow"><p>Authors: write it.</p></div></div>`)}
${viewlet("ownsubmission", `<div class="box py-3 generalbox ownsubmission"><div>You have not submitted your work yet</div></div>`)}`;
    const { context, opened } = await viewSite(page);
    assert.deepEqual(await workshopView(context, SITE, 58), {
      activityId: 58,
      phase: "submission",
      tasks: [{ title: "Submit your work", state: "todo", details: [] }],
      instructions: { authors: "<p>Authors: write it.</p>" },
      toAssess: [],
    });
    assert.deepEqual(opened, ["/mod/workshop/view.php?id=58"]);
    await context.close();
  });

  it("gives a teacher with nothing allocated their tasks, and refuses an activity that isn't a workshop", async () => {
    const page = `${plan(30, `<ul class="tasks"><li class=""><div class="title"><span class="accesshide">Task to do </span><a href="${SITE}mod/workshop/switchphase.php?cmid=58&amp;phase=40">Switch to the next phase</a></div><div class="details"></div></li></ul>`)}
${viewlet("instructreviewers", `<div class="box py-3 generalbox instructions"><div class="no-overflow"><p>Reviewers: be kind.</p></div></div>`)}
${viewlet("assignedassessments", `<div class="box py-3 generalbox assessment-none"><div class="alert alert-danger" role="alert"> You have no assigned submission to assess </div></div>`)}`;
    const { context } = await viewSite(page);
    const view = await workshopView(context, SITE, 58);
    assert.deepEqual([view.tasks, view.toAssess, view.ownSubmission, view.form], [[{ title: "Switch to the next phase", state: "todo", details: [] }], [], undefined, undefined]);
    await assert.rejects(workshopView(context, SITE, 59), WorkshopError);
    await context.close();
  });
});
