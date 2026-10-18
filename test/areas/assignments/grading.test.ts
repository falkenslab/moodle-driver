import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { GradingError, NotAnAssignmentError, allocateMarker, assignmentSubmissions, gradeSubmission, grantExtension, rubric, setWorkflowState } from "../../../src/index.js";
import { PANEL, SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const DUE = 1_800_000_000;

/** The participants whose grading panel was opened, in order. */
const panelsOpened = (state: FakeMoodleState) =>
  (state.serviceCalls ?? []).filter((call) => call.methodname === "core_get_fragment").map((call) => Number((call.args.args as { name: string; value: string }[]).find((arg) => arg.name === "userid")?.value));

// A made-up assignment: instance cmid*10 in context cmid*100, two participants, one of them submitted.
function submissionsSite(activityId: number): FakeMoodleState {
  return {
    user: { id: 3, fullName: "Teacher" },
    serviceCalls: [],
    // Each course module gets its own grader page: the driver caches the ids per process.
    bodies: { "/mod/assign/view.php": `<div data-assignmentid="${activityId * 10}" data-contextid="${activityId * 100}"></div>` },
    services: {
      mod_assign_list_participants: () => [
        { id: 7, fullname: "Ada Lovelace", submitted: true, requiregrading: true, grantedextension: false, submissionstatus: "submitted" },
        { id: 8, fullname: "Alan Turing", submitted: false, requiregrading: false, grantedextension: true, submissionstatus: "" },
      ],
      mod_assign_get_participant: () => ({ allowsubmissionsfromdate: 0, duedate: DUE, cutoffdate: 0 }),
      core_get_fragment: () => ({ html: PANEL, javascript: "" }),
    },
  };
}

describe("assignmentSubmissions", { skip: !browser && "no system browser" }, () => {
  it("lists every participant, with the content of those who submitted", async () => {
    const context = await browser!.newContext();
    const state = submissionsSite(21);
    await serveFakeMoodle(context, state);
    const submissions = await assignmentSubmissions(context, SITE, 21);
    const [ada, alan] = submissions;
    assert.deepEqual([ada?.status, ada?.needsGrading, ada?.dueDate, ada?.allowSubmissionsFrom], ["submitted", true, new Date(DUE * 1000).toISOString(), undefined]);
    assert.deepEqual(ada?.content?.map((c) => c.plugin), ["onlinetext", "file", "onlinetext"]);
    assert.deepEqual([alan?.status, alan?.extensionGranted, alan?.content], ["none", true, undefined]);
    assert.equal(state.serviceCalls?.find((call) => call.methodname === "core_get_fragment")?.args.contextid, 2100);
    // Moodle's panel would create an empty submission for Alan, who has none.
    assert.deepEqual(panelsOpened(state), [7]);
    assert.equal(state.serviceCalls?.find((call) => call.methodname === "mod_assign_list_participants")?.args.assignid, 210);
    await context.close();
  });

  it("leaves the content out when asked, without loading it", async () => {
    const context = await browser!.newContext();
    const state = submissionsSite(22);
    await serveFakeMoodle(context, state);
    const submissions = await assignmentSubmissions(context, SITE, 22, { includeContent: false });
    assert.ok(submissions.every((s) => s.content === undefined));
    assert.equal(state.serviceCalls?.some((call) => call.methodname === "core_get_fragment"), false);
    await context.close();
  });

  it("pages over the participants, opening panels and reading dates only for the page's, and takes chosen ones", async () => {
    const context = await browser!.newContext();
    const state = submissionsSite(24);
    // Five participants who submitted, ids 11 to 15.
    state.services!.mod_assign_list_participants = () =>
      [11, 12, 13, 14, 15].map((id) => ({ id, fullname: `User ${id}`, submitted: true, requiregrading: true, grantedextension: false, submissionstatus: "submitted" }));
    await serveFakeMoodle(context, state);
    const dates = () => state.serviceCalls!.filter((call) => call.methodname === "mod_assign_get_participant").map((call) => call.args.userid);
    const first = await assignmentSubmissions(context, SITE, 24, { limit: 2 });
    assert.deepEqual([first.items.map((s) => s.userId), first.more], [[11, 12], true]);
    assert.deepEqual([panelsOpened(state), dates()], [[11, 12], [11, 12]]);
    const next = await assignmentSubmissions(context, SITE, 24, { limit: 2, offset: 2, includeContent: false });
    assert.deepEqual([next.items.map((s) => s.userId), next.more], [[13, 14], true]);
    const last = await assignmentSubmissions(context, SITE, 24, { limit: 2, offset: 4, includeContent: false });
    assert.deepEqual([last.items.map((s) => s.userId), last.more], [[15], false]);
    state.serviceCalls!.length = 0;
    assert.deepEqual((await assignmentSubmissions(context, SITE, 24, { userIds: [14, 12] })).map((s) => s.userId), [12, 14]);
    assert.deepEqual(panelsOpened(state), [12, 14]);
    assert.deepEqual((await assignmentSubmissions(context, SITE, 24, { includeContent: false })).map((s) => s.userId), [11, 12, 13, 14, 15]);
    await assert.rejects(assignmentSubmissions(context, SITE, 24, { userIds: [] }), /userIds is empty/);
    await context.close();
  });

  it("refuses an id that isn't an assignment", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { ...submissionsSite(23), bodies: {} });
    await assert.rejects(assignmentSubmissions(context, SITE, 23), (error: unknown) => error instanceof NotAnAssignmentError && /isn't an assignment/.test(error.message));
    await context.close();
  });
});

/** A grading panel's form, as Moodle 5.2's fragment renders it, reduced; made up. */
function panel(grade: string, feedback: string | null): string {
  const comments = feedback === null ? "" : `<textarea name="assignfeedbackcomments_editor[text]" id="id_assignfeedbackcomments_editor">${feedback}</textarea><input type="hidden" name="assignfeedbackcomments_editor[format]" value="1">`;
  return `<div class="submissionstatustable"></div><form class="gradeform mform" action="${SITE}lib/ajax/service.php" method="post">
<input type="hidden" name="id" value="21"><input type="hidden" name="userid" value="0"><input type="hidden" name="sendstudentnotifications" value="1">
<input type="hidden" name="action" value="submitgrade"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="grade" value="${grade}">${comments}</form>`;
}

/** A made-up assignment (instance 210, context 2100) that keeps the last grade submitted. */
function gradingSite(withComments: boolean, refuse = false): { state: FakeMoodleState; submitted: Record<string, unknown>[] } {
  const saved = { grade: "", feedback: "" };
  const submitted: Record<string, unknown>[] = [];
  return {
    submitted,
    state: {
      user: { id: 3, fullName: "Teacher" },
      bodies: { "/mod/assign/view.php": `<div data-assignmentid="210" data-contextid="2100"></div>` },
      services: {
        core_get_fragment: () => ({ html: panel(saved.grade, withComments ? saved.feedback : null), javascript: "" }),
        mod_assign_submit_grading_form: (args) => {
          submitted.push(args);
          if (refuse) return [{ item: "grade", warningcode: "couldnotsavegrade", message: "Could not save grade." }];
          const form = new URLSearchParams(JSON.parse(String(args.jsonformdata)) as string);
          saved.grade = form.get("grade") ?? "";
          saved.feedback = form.get("assignfeedbackcomments_editor[text]") ?? "";
          return [];
        },
      },
    },
  };
}

describe("gradeSubmission", { skip: !browser && "no system browser" }, () => {
  it("submits the panel's form as the grader does and reads the grade back", async () => {
    const context = await browser!.newContext();
    const { state, submitted } = gradingSite(true);
    await serveFakeMoodle(context, state);
    const result = await gradeSubmission(context, SITE, 31, 7, { grade: 7.5, feedback: "<p>Good</p>", notify: false });
    assert.deepEqual(result, { changed: "Graded user 7 in assignment 31, with feedback.", grade: "7.5", feedback: "<p>Good</p>" });
    assert.deepEqual([submitted[0]?.assignmentid, submitted[0]?.userid], [210, 7]);
    const form = new URLSearchParams(JSON.parse(String(submitted[0]?.jsonformdata)) as string);
    assert.equal(form.get("sendstudentnotifications"), "0");
    assert.equal(form.get("action"), "submitgrade");
    await context.close();
  });

  it("throws GradingError when Moodle refuses the grade", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, gradingSite(true, true).state);
    await assert.rejects(gradeSubmission(context, SITE, 32, 7, { grade: "150" }), (error: unknown) => error instanceof GradingError && /Could not save grade\..*within the assignment's range/.test(error.message));
    await context.close();
  });

  it("refuses feedback an assignment doesn't take, saving nothing", async () => {
    const context = await browser!.newContext();
    const { state, submitted } = gradingSite(false);
    await serveFakeMoodle(context, state);
    await assert.rejects(gradeSubmission(context, SITE, 33, 7, { grade: "9", feedback: "<p>x</p>" }), /has no feedback comments/);
    assert.equal(submitted.length, 0);
    await context.close();
  });
});

/** A grader panel with a rubric, reduced from Moodle 5.2's: two criteria with their levels, made up. */
const level = (criterion: number, id: number, definition: string, score: number, checked = false) =>
  `<td class="level"><input type="radio" name="advancedgrading[criteria][${criterion}][levelid]" value="${id}"${checked ? " checked" : ""}><div class="definition">${definition}</div><div class="score"><span class="scorevalue">${score}</span> points</div></td>`;
const rubricPanel = (graded: boolean) => `<form class="gradeform mform"><input type="hidden" name="action" value="submitgrade">
<div class="gradingform_rubric"><table><tr class="criterion" id="advancedgrading-criteria-1"><td class="description">Explains a loop</td><td class="levels"><table><tr>${level(1, 1, "No", 0)}${level(1, 2, "Partly", 1)}${level(1, 3, "Clearly", 2, graded)}</tr></table></td><td class="remark"><textarea name="advancedgrading[criteria][1][remark]"></textarea></td></tr>
<tr class="criterion" id="advancedgrading-criteria-2"><td class="description">Gives an example</td><td class="levels"><table><tr>${level(2, 4, "None", 0)}${level(2, 5, "Wrong", 1, graded)}</tr></table></td><td class="remark"><textarea name="advancedgrading[criteria][2][remark]"></textarea></td></tr></table></div>
<div id="fitem_id_currentgrade_x"><div class="felement">${graded ? "75.00" : "-"}</div></div>
<input type="hidden" name="sendstudentnotifications" value="1"></form>`;

describe("rubric", { skip: !browser && "no system browser" }, () => {
  function rubricSite(activityId: number) {
    const submitted: Record<string, unknown>[] = [];
    const state: FakeMoodleState = {
      user: { id: 3, fullName: "Teacher" },
      bodies: { "/mod/assign/view.php": `<div data-assignmentid="${activityId * 10}" data-contextid="${activityId * 100}"></div>` },
      services: {
        mod_assign_list_participants: () => [
          { id: 8, fullname: "Alan Turing", submitted: false, requiregrading: false, grantedextension: false, submissionstatus: "" },
          { id: 7, fullname: "Ada Lovelace", submitted: true, requiregrading: true, grantedextension: false, submissionstatus: "submitted" },
        ],
        core_get_fragment: () => ({ html: rubricPanel(submitted.length > 0), javascript: "" }),
        mod_assign_submit_grading_form: (args) => {
          submitted.push(args);
          return [];
        },
      },
    };
    return { state, submitted };
  }

  it("reads the grading method and the rubric's criteria and levels by id, from a participant with a submission", async () => {
    const context = await browser!.newContext();
    const site: FakeMoodleState = { ...rubricSite(41).state, serviceCalls: [] };
    await serveFakeMoodle(context, site);
    assert.deepEqual(await rubric(context, SITE, 41), {
      assignment: { id: 41 },
      method: "rubric",
      criteria: [
        { id: 1, description: "Explains a loop", levels: [{ id: 1, definition: "No", score: 0 }, { id: 2, definition: "Partly", score: 1 }, { id: 3, definition: "Clearly", score: 2 }] },
        { id: 2, description: "Gives an example", levels: [{ id: 4, definition: "None", score: 0 }, { id: 5, definition: "Wrong", score: 1 }] },
      ],
    });
    assert.deepEqual(panelsOpened(site), [7]);
    await context.close();
  });

  it("reads a marking guide's criteria with their maximum, shown beside the score input when grading", async () => {
    const context = await browser!.newContext();
    const { state } = rubricSite(43);
    // Moodle 5.2's guide in a grading panel: the maximum is "/4" after the score input, not a description score block.
    const guidePanel = `<form class="gradeform mform"><div class="gradingform_guide"><table><tr class="criterion" id="advancedgrading-criteria-11"><td class="criterionname"><div class="criterionshortname">Clarity</div><div class="criteriondescription">Is it clear</div><div class="criteriondescriptionmarkers">Look at the intro</div></td><td class="remark"><textarea name="advancedgrading[criteria][11][remark]"></textarea></td><td class="score"><input type="text" name="advancedgrading[criteria][11][score]"><div>/4</div></td></tr></table></div></form>`;
    state.services!.core_get_fragment = () => ({ html: guidePanel, javascript: "" });
    await serveFakeMoodle(context, state);
    assert.deepEqual((await rubric(context, SITE, 43)).criteria, [{ id: 11, description: "Clarity", details: "Is it clear", markers: "Look at the intro", maxScore: 4 }]);
    await context.close();
  });

  it("grades by levels and remarks, and gives the total Moodle computes", async () => {
    const context = await browser!.newContext();
    const { state, submitted } = rubricSite(42);
    await serveFakeMoodle(context, state);
    const result = await gradeSubmission(context, SITE, 42, 7, { rubric: { 1: 3, 2: 5 }, remarks: { 2: "Check the bounds." } });
    assert.equal(result.gradebookGrade, "75.00");
    const form = new URLSearchParams(JSON.parse(String(submitted[0]?.jsonformdata)) as string);
    assert.deepEqual([form.get("advancedgrading[criteria][1][levelid]"), form.get("advancedgrading[criteria][2][levelid]"), form.get("advancedgrading[criteria][2][remark]")], ["3", "5", "Check the bounds."]);
    await assert.rejects(gradeSubmission(context, SITE, 42, 7, { rubric: { 9: 1 } }), /no such field: advancedgrading\[criteria\]\[9\]\[levelid\]/);
    await context.close();
  });
});

describe("extensions", { skip: !browser && "no system browser" }, () => {
  /** The extension form as Moodle 5.2's, reduced and made up: a date selector in Madrid's time zone, prefilled with the extension. */
  function extensionForm(until?: { day: number; hour: number }) {
    const select = (part: string, values: number[], selected?: number) => `<select name="extensionduedate[${part}]">${values.map((v) => `<option value="${v}"${v === selected ? " selected" : ""}>${v}</option>`).join("")}</select>`;
    const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
    return moodlePage({
      userId: 3,
      bodyId: "page-mod-assign-view",
      body: `<form class="mform" method="post" action="${SITE}mod/assign/view.php"><input type="hidden" name="selectedusers" value="7"><input type="hidden" name="action" value="saveextension">
<input type="hidden" name="extensionduedate[enabled]" value="0"><input type="checkbox" name="extensionduedate[enabled]" value="1"${until ? " checked" : ""}>
${select("day", range(1, 31), until?.day ?? 1)}${select("month", range(1, 12), 10)}${select("year", [2026], 2026)}${select("hour", range(0, 23), until?.hour ?? 0)}${select("minute", range(0, 59), 30)}
<input type="submit" name="submitbutton" value="Save changes"></form>`,
    });
  }

  it("grants several participants an extension in their time zone, and submissions report its date", async () => {
    const posted: URLSearchParams[] = [];
    const context = await browser!.newContext();
    const state = submissionsSite(43);
    await serveFakeMoodle(context, state);
    await context.route(`${SITE}mod/assign/view.php**`, (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") {
        posted.push(new URLSearchParams(route.request().postData() ?? ""));
        return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-assign-view" }) });
      }
      if (url.searchParams.get("action") === "grantextension") return route.fulfill({ status: 200, contentType: "text/html", body: extensionForm(url.searchParams.get("userid") === "8" ? { day: 23, hour: 14 } : undefined) });
      return route.fallback();
    });
    await grantExtension(context, SITE, 43, [7, 9], new Date("2026-10-23T12:30:00Z"));
    const form = posted[0]!;
    assert.deepEqual([form.get("selectedusers"), form.getAll("extensionduedate[enabled]").at(-1), form.get("extensionduedate[day]"), form.get("extensionduedate[hour]"), form.get("extensionduedate[minute]")], ["7,9", "1", "23", "14", "30"]);
    const submissions = await assignmentSubmissions(context, SITE, 43, { includeContent: false });
    assert.equal(submissions.find((s) => s.userId === 8)?.extensionDueDate, "2026-10-23T12:30:00.000Z");
    assert.equal(submissions.find((s) => s.userId === 7)?.extensionDueDate, undefined);
    await assert.rejects(grantExtension(context, SITE, 43, [], new Date()), /Give the participants/);
    await context.close();
  });

  it("throws when Moodle refuses to save it, as it does for someone without the capability", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, submissionsSite(44));
    // Moodle 5.2 opens the form for a student and answers the save with its error page.
    await context.route(`${SITE}mod/assign/view.php**`, (route) => {
      if (route.request().method() === "POST") {
        const error = `<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Grant extension).</p></div>`;
        return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-assign-view", body: error }) });
      }
      if (new URL(route.request().url()).searchParams.get("action") === "grantextension") return route.fulfill({ status: 200, contentType: "text/html", body: extensionForm() });
      return route.fallback();
    });
    await assert.rejects(grantExtension(context, SITE, 44, [7], new Date("2026-10-23T12:30:00Z")), (error: unknown) => error instanceof NotAnAssignmentError && /do not currently have permissions/.test(error.message));
    await context.close();
  });
});

describe("group submissions and the marking workflow", { skip: !browser && "no system browser" }, () => {
  /** A grading panel with Moodle 5.2's workflow state, two marker slots and "apply to all group members", reduced and made up. */
  const workflowPanel = (state: string) => {
    const option = (value: string, text: string, selected: string) => `<option value="${value}"${value === selected ? " selected" : ""}>${text}</option>`;
    const states = ["", "inmarking", "readyforreview", "inreview", "readyforrelease", "released"].map((s) => option(s, s || "Not marked", state)).join("");
    return `<form class="gradeform mform"><input type="hidden" name="action" value="submitgrade"><input type="text" name="grade" value="">
<select name="workflowstate">${states}</select>
<select name="allocatedmarker[0]">${option("", "Choose...", "3")}${option("3", "Teacher Uno", "3")}</select><select name="allocatedmarker[1]">${option("", "Choose...", "")}${option("3", "Teacher Uno", "")}</select>
<select name="applytoall">${option("0", "No", "1")}${option("1", "Yes", "1")}</select></form>`;
  };

  function workflowSite(activityId: number) {
    const submitted: URLSearchParams[] = [];
    let saved = "";
    const state: FakeMoodleState = {
      user: { id: 3, fullName: "Teacher" },
      serviceCalls: [],
      bodies: { "/mod/assign/view.php": `<div data-assignmentid="${activityId * 10}" data-contextid="${activityId * 100}"></div>` },
      services: {
        mod_assign_list_participants: () => [
          { id: 5, fullname: "Lucía Martín", submitted: true, requiregrading: true, grantedextension: false, submissionstatus: "submitted", groupid: 4, groupname: "Driver group" },
          { id: 7, fullname: "Alan Turing", submitted: false, requiregrading: false, grantedextension: false, submissionstatus: "" },
        ],
        mod_assign_get_participant: () => ({ allowsubmissionsfromdate: 0, duedate: 0, cutoffdate: 0 }),
        core_get_fragment: () => ({ html: workflowPanel(saved), javascript: "" }),
        mod_assign_submit_grading_form: (args) => {
          const form = new URLSearchParams(JSON.parse(String(args.jsonformdata)) as string);
          submitted.push(form);
          saved = form.get("workflowstate") ?? "";
          return [];
        },
      },
    };
    return { state, submitted };
  }

  it("gives each participant's group, workflow state and markers, the panel's only with a submission", async () => {
    const context = await browser!.newContext();
    const { state } = workflowSite(61);
    await serveFakeMoodle(context, state);
    const [lucia, alan] = await assignmentSubmissions(context, SITE, 61);
    assert.deepEqual([lucia?.group, lucia?.workflowState, lucia?.markers], [{ id: 4, name: "Driver group" }, "notmarked", [{ id: 3, name: "Teacher Uno" }]]);
    assert.deepEqual([alan?.status, alan?.group, alan?.workflowState, alan?.markers], ["none", undefined, undefined, undefined]);
    assert.deepEqual(panelsOpened(state), [5]);
    await context.close();
  });

  it("grades for the whole group with a workflow state, and refuses a state it doesn't offer", async () => {
    const context = await browser!.newContext();
    const { state, submitted } = workflowSite(62);
    await serveFakeMoodle(context, state);
    const result = await gradeSubmission(context, SITE, 62, 5, { grade: 7, workflowState: "readyforrelease", applyToGroup: true });
    assert.equal(result.changed, "Graded user 5 and their group in assignment 62, workflow state readyforrelease.");
    assert.equal(result.workflowState, "readyforrelease");
    assert.deepEqual([submitted[0]?.get("workflowstate"), submitted[0]?.get("applytoall")], ["readyforrelease", "1"]);
    await gradeSubmission(context, SITE, 62, 5, { grade: 7, workflowState: "notmarked", applyToGroup: false });
    assert.deepEqual([submitted[1]?.get("workflowstate"), submitted[1]?.get("applytoall")], ["", "0"]);
    await assert.rejects(gradeSubmission(context, SITE, 62, 5, { workflowState: "graded" as "released" }), /isn't a marking workflow state/);
    await context.close();
  });

  it("refuses a workflow state or group grading where the assignment has neither", async () => {
    const context = await browser!.newContext();
    const { state, submitted } = gradingSite(true);
    await serveFakeMoodle(context, state);
    await assert.rejects(gradeSubmission(context, SITE, 63, 7, { grade: 5, workflowState: "released" }), (error: unknown) => error instanceof GradingError && /doesn't use the marking workflow/.test(error.message));
    await assert.rejects(gradeSubmission(context, SITE, 63, 7, { grade: 5, applyToGroup: true }), (error: unknown) => error instanceof GradingError && /doesn't take group submissions/.test(error.message));
    assert.equal(submitted.length, 0);
    await context.close();
  });

  /** Moodle 4.5's grading panel with the workflow and allocation: one marker select, allocatedmarker. */
  const panel45 = `<form class="gradeform mform"><input type="text" name="grade" value=""><select name="workflowstate"><option value="" selected>Not marked</option><option value="inmarking">In marking</option></select>
<select name="allocatedmarker"><option value="">Choose...</option><option value="3" selected>Teacher Uno</option></select></form>`;

  /** The batch forms as Moodle 5.2's (4.5's with `moodle45`), reduced and made up; `markers` 0 is its error page for too few markers. */
  async function batchSite(context: BrowserContext, { markers = 1, multi = false, workflow = true, moodle45 = false } = {}) {
    const posted: URLSearchParams[] = [];
    // The grading panel says whether the assignment uses the workflow and allocation: PANEL has neither.
    const state: FakeMoodleState = {
      user: { id: 3, fullName: "Teacher" },
      serviceCalls: [],
      services: {
        // Only participant 6 has a submission.
        mod_assign_list_participants: () => [5, 6].map((id) => ({ id, fullname: `User ${id}`, submitted: id === 6, requiregrading: false, grantedextension: false, submissionstatus: id === 6 ? "submitted" : "" })),
        core_get_fragment: () => ({ html: moodle45 ? panel45 : workflow ? workflowPanel("") : PANEL, javascript: "" }),
      },
    };
    await serveFakeMoodle(context, state);
    const page = (body: string, bodyId: string) => moodlePage({ userId: 3, bodyId, body });
    await context.route(`${SITE}mod/assign/view.php**`, (route: Route) => {
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      const id = Number(new URL(route.request().url()).searchParams.get("id"));
      if (new URL(route.request().url()).searchParams.get("action") === "grader") return html(page(`<div data-assignmentid="${id * 10}" data-contextid="${id * 100}"></div>`, "page-mod-assign-grader"));
      if (route.request().method() === "POST") {
        posted.push(new URLSearchParams(route.request().postData() ?? ""));
        return html(page("", "page-mod-assign-grading"));
      }
      const url = new URL(route.request().url());
      const hidden = `<input type="hidden" name="id" value="${url.searchParams.get("id")}"><input type="hidden" name="selectedusers" value="${url.searchParams.get("selectedusers")}">`;
      if (url.searchParams.get("action") === "viewbatchsetmarkingworkflowstate") {
        const states = ["inmarking", "readyforreview", "inreview", "readyforrelease", "released"].map((s) => `<option value="${s}">${s}</option>`).join("");
        const context_ = multi ? `<select name="workflowcontext"><option value="mark">Mark</option><option value="grade">Grade</option></select>` : "";
        return html(page(`<form class="mform" method="post" action="${SITE}mod/assign/view.php">${hidden}<input type="hidden" name="action" value="setbatchmarkingworkflowstate">${context_}<select name="markingworkflowstate">${states}</select>
<select name="sendstudentnotifications"><option value="0">No</option><option value="1">Yes</option></select><input type="submit" name="submitbutton" value="Save"></form>`, "page-mod-assign-viewbatchsetmarkingworkflowstate"));
      }
      if (markers === 0) return html(page(`<div data-rel="fatalerror"><p class="errormessage">There are not enough markers (1) to meet the required number for this assignment (2).</p></div>`, "page-mod-assign-viewbatchmarkingallocation"));
      const slots = Array.from({ length: markers }, (_, i) => `<select name="allocatedmarker${moodle45 ? "" : i + 1}"><option value="">Choose...</option><option value="3">Teacher Uno</option></select>`).join("");
      return html(page(`<form class="mform" method="post" action="${SITE}mod/assign/view.php">${hidden}<input type="hidden" name="action" value="setbatchmarkingallocation">${slots}<input type="submit" name="submitbutton" value="Save"></form>`, "page-mod-assign-viewbatchmarkingallocation"));
    });
    return Object.assign(posted, { state });
  }

  it("releases submissions as the batch form does, notifying when asked", async () => {
    const context = await browser!.newContext();
    const posted = await batchSite(context, { multi: true });
    const result = await setWorkflowState(context, SITE, 64, [5, 6], "released", { notify: true });
    assert.equal(result.changed, "Set the marking workflow state of users 5, 6 to released in assignment 64, notifying them.");
    assert.deepEqual(
      ["selectedusers", "action", "workflowcontext", "markingworkflowstate", "sendstudentnotifications"].map((name) => posted[0]?.get(name)),
      ["5,6", "setbatchmarkingworkflowstate", "grade", "released", "1"],
    );
    await assert.rejects(setWorkflowState(context, SITE, 64, [5], "inmarking", { notify: true }), /only when releasing/);
    await assert.rejects(setWorkflowState(context, SITE, 64, [], "released"), /Give the participants/);
    assert.equal(posted.length, 1);
    await context.close();
  });

  it("refuses the batch actions where the assignment has no marking workflow or allocation, saving nothing", async () => {
    const context = await browser!.newContext();
    const posted = await batchSite(context, { workflow: false });
    await assert.rejects(setWorkflowState(context, SITE, 67, [5], "released"), (error: unknown) => error instanceof GradingError && /doesn't use the marking workflow/.test(error.message));
    await assert.rejects(allocateMarker(context, SITE, 67, [5], 3), (error: unknown) => error instanceof GradingError && /doesn't allocate markers/.test(error.message));
    assert.equal(posted.length, 0);
    await context.close();
  });

  it("allocates a marker, and says why Moodle won't", async () => {
    const context = await browser!.newContext();
    const posted = await batchSite(context);
    assert.equal((await allocateMarker(context, SITE, 65, [5, 6], 3)).changed, "Allocated marker 3 to users 5, 6 in assignment 65.");
    // The panel that says the assignment allocates markers is 6's, who has a submission: 5's would create one.
    assert.deepEqual(panelsOpened(posted.state), [6]);
    assert.deepEqual([posted[0]?.get("allocatedmarker1"), posted[0]?.get("action")], ["3", "setbatchmarkingallocation"]);
    await assert.rejects(allocateMarker(context, SITE, 65, [5], 9), /User 9 can't mark/);
    await assert.rejects(allocateMarker(context, SITE, 65, [5], [3, 3]), /uses 1 marker per submission/);
    await context.close();
    const refused = await browser!.newContext();
    await batchSite(refused, { markers: 0 });
    await assert.rejects(allocateMarker(refused, SITE, 66, [5], 3), (error: unknown) => error instanceof GradingError && /not enough markers \(1\)/.test(error.message));
    await refused.close();
  });

  it("allocates the one marker of Moodle 4.5's forms", async () => {
    const context = await browser!.newContext();
    const posted = await batchSite(context, { moodle45: true });
    assert.equal((await allocateMarker(context, SITE, 65, [6], 3)).changed, "Allocated marker 3 to user 6 in assignment 65.");
    assert.equal(posted[0]?.get("allocatedmarker"), "3");
    await assert.rejects(allocateMarker(context, SITE, 65, [6], [3, 3]), /uses 1 marker per submission/);
    await context.close();
  });
});

describe("feedback files", { skip: !browser && "no system browser" }, () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-feedback-"));
    await writeFile(path.join(dir, "corrected.pdf"), "%PDF-1.4\n");
  });
  after(() => rm(dir, { recursive: true, force: true }));

  /**
   * A made-up assignment (instance 510) whose grading panel has Moodle 5.2's feedback files manager
   * (`files_<userid>_filemanager`), with the draft area behind it and the grading page that carries
   * the upload repository; `withFiles` false is an assignment without feedback files.
   */
  async function feedbackSite(context: BrowserContext, withFiles = true) {
    const saved: string[] = ["old.pdf"];
    let draft: string[] = [];
    const submitted: Record<string, unknown>[] = [];
    const deleted: string[] = [];
    const panel = () => {
      // Each panel prepares a fresh draft area with the saved files, as Moodle's does.
      draft = [...saved];
      const files = withFiles ? `<input value="77" name="files_7_filemanager" type="hidden" id="id_files_7_filemanager" />` : "";
      return `<form class="gradeform mform"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="action" value="submitgrade"><input type="text" name="grade" value="">${files}</form>`;
    };
    await serveFakeMoodle(context, {
      user: { id: 3, fullName: "Teacher" },
      bodies: { "/mod/assign/view.php": `<div data-assignmentid="510" data-contextid="5100"></div><script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>` },
      services: {
        // Without submitting: grading her made the empty submission ("new") Moodle's panel creates.
        mod_assign_list_participants: () => [{ id: 7, fullname: "Ada Lovelace", submitted: false, requiregrading: false, grantedextension: false, submissionstatus: "new" }],
        mod_assign_get_participant: () => ({ allowsubmissionsfromdate: 0, duedate: 0, cutoffdate: 0 }),
        core_get_fragment: () => ({ html: panel(), javascript: "" }),
        mod_assign_submit_grading_form: (args) => {
          submitted.push(args);
          saved.splice(0, saved.length, ...draft);
          return [];
        },
      },
    });
    await context.route(`${SITE}repository/draftfiles_ajax.php**`, (route: Route) => {
      const form = new URLSearchParams(route.request().postData() ?? "");
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      assert.deepEqual([form.get("sesskey"), form.get("itemid")], ["s1", "77"]);
      const action = new URL(route.request().url()).searchParams.get("action");
      if (action === "list") return json({ list: draft.map((name) => ({ filename: name, filepath: "/", type: "file", url: `${SITE}draftfile.php/13/user/draft/77/${name}` })) });
      const selected = JSON.parse(form.get("selected") ?? "[]") as { filename: string }[];
      deleted.push(...selected.map((file) => file.filename));
      draft = draft.filter((name) => !selected.some((file) => file.filename === name));
      return json(selected.map(() => "/"));
    });
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      draft.push(/filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return { saved, submitted, deleted };
  }

  it("replaces the participant's feedback files and gives them back", async () => {
    const context = await browser!.newContext();
    const { saved, deleted } = await feedbackSite(context);
    const result = await gradeSubmission(context, SITE, 51, 7, { grade: "8", feedbackFiles: [path.join(dir, "corrected.pdf")] });
    assert.equal(result.changed, "Graded user 7 in assignment 51, with 1 feedback file.");
    assert.deepEqual(result.feedbackFiles, [{ name: "corrected.pdf", url: `${SITE}draftfile.php/13/user/draft/77/corrected.pdf` }]);
    assert.deepEqual([saved, deleted], [["corrected.pdf"], ["old.pdf"]]);
    const [ada] = await assignmentSubmissions(context, SITE, 51);
    assert.deepEqual(ada?.feedbackFiles?.map((file) => file.name), ["corrected.pdf"]);
    await context.close();
  });

  it("removes them all with an empty list, and leaves them without one", async () => {
    const context = await browser!.newContext();
    const { saved } = await feedbackSite(context);
    await gradeSubmission(context, SITE, 52, 7, { grade: "8" });
    assert.deepEqual(saved, ["old.pdf"]);
    await gradeSubmission(context, SITE, 52, 7, { grade: "8", feedbackFiles: [] });
    assert.deepEqual(saved, []);
    await context.close();
  });

  it("refuses files for an assignment without feedback files, saving nothing", async () => {
    const context = await browser!.newContext();
    const { submitted } = await feedbackSite(context, false);
    await assert.rejects(gradeSubmission(context, SITE, 53, 7, { grade: "8", feedbackFiles: [path.join(dir, "corrected.pdf")] }), (error: unknown) => error instanceof GradingError && /has no feedback files/.test(error.message));
    assert.equal(submitted.length, 0);
    const [ada] = await assignmentSubmissions(context, SITE, 53);
    assert.equal(ada?.feedbackFiles, undefined);
    await context.close();
  });
});
