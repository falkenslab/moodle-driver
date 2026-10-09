import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { GradingError, NotAnAssignmentError, assignmentSubmissions, gradeSubmission } from "../../src/index.js";
import { PANEL, SITE, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const DUE = 1_800_000_000;

// A made-up assignment: instance cmid*10 in context cmid*100, two participants, one of them submitted.
function submissionsSite(cmid: number): FakeMoodleState {
  return {
    user: { id: 3, fullName: "Teacher" },
    serviceCalls: [],
    // Each course module gets its own grader page: the driver caches the ids per process.
    bodies: { "/mod/assign/view.php": `<div data-assignmentid="${cmid * 10}" data-contextid="${cmid * 100}"></div>` },
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
    const { assignment, submissions } = await assignmentSubmissions(context, SITE, 21);
    assert.deepEqual(assignment, { id: 21, instanceId: 210 });
    const [ada, alan] = submissions;
    assert.deepEqual([ada?.status, ada?.needsGrading, ada?.dueDate, ada?.allowSubmissionsFrom], ["submitted", true, new Date(DUE * 1000).toISOString(), undefined]);
    assert.deepEqual(ada?.content?.map((c) => c.plugin), ["onlinetext", "file", "onlinetext"]);
    assert.deepEqual([alan?.status, alan?.extensionGranted, alan?.content], ["none", true, undefined]);
    assert.equal(state.serviceCalls?.find((call) => call.methodname === "core_get_fragment")?.args.contextid, 2100);
    assert.equal(state.serviceCalls?.find((call) => call.methodname === "mod_assign_list_participants")?.args.assignid, 210);
    await context.close();
  });

  it("leaves the content out when asked, without loading it", async () => {
    const context = await browser!.newContext();
    const state = submissionsSite(22);
    await serveFakeMoodle(context, state);
    const { submissions } = await assignmentSubmissions(context, SITE, 22, { includeContent: false });
    assert.ok(submissions.every((s) => s.content === undefined));
    assert.equal(state.serviceCalls?.some((call) => call.methodname === "core_get_fragment"), false);
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
    const result = await gradeSubmission(context, SITE, 31, 7, { grade: "7.5", feedback: "<p>Good</p>", notify: false });
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
