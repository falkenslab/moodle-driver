import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { SubmissionError, saveSubmission, studentAssignment, submitForGrading } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-submission-"));
  await writeFile(path.join(dir, "work.txt"), "my work\n");
});
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

/**
 * A made-up assignment (cmid 30) whose pages follow Moodle 5.2's; `statement` asks to accept one, in
 * the edit form without `drafts` (saving is submitting then) and on the confirmation page with them.
 */
function fakeAssignment(statement = false, files = true, drafts = true) {
  const state = { stage: "new" as "new" | "draft" | "submitted", text: "", files: [] as string[], posts: [] as URLSearchParams[] };
  const page = (body: string, bodyId: string) => moodlePage({ userId: 4, body, bodyId });
  const action = (name: string) => `<form method="get" action="${SITE}mod/assign/view.php"><input type="hidden" name="id" value="30"><input type="hidden" name="action" value="${name}"><button>x</button></form>`;
  const view = () => {
    const rows = [
      `<tr><th>Submission status</th><td class="submissionstatus${state.stage}">${state.stage}</td></tr>`,
      `<tr><th>Grading status</th><td class="submissionnotgraded">Not graded</td></tr>`,
      state.text ? `<tr><th>Online text</th><td>${state.text}</td></tr>` : "",
      state.files.length ? `<tr><th>Files</th><td>${state.files.map((f) => `<a href="${SITE}pluginfile.php/9/assignsubmission_file/submission_files/1/${f}">${f}</a>`).join("")}</td></tr>` : "",
    ].join("");
    const actions = state.stage === "submitted" ? (drafts ? "" : action("editsubmission")) : action("editsubmission") + (state.stage === "draft" ? action("submit") : "");
    return page(
      `<div class="activity-description" id="intro"><p>Write a program.</p><a href="${SITE}pluginfile.php/9/mod_assign/introattachment/0/template.docx">template.docx</a></div>
<div data-region="activity-dates"><div class="date-item"><span class="date-item-label">Due:</span> Friday</div></div>
<table class="submissionstatustable">${rows}</table>${actions}`,
      "page-mod-assign-view",
    );
  };
  const box = `<div class="form-check"><input type="hidden" name="submissionstatement" value="0"><input type="checkbox" name="submissionstatement" value="1"> This is my own work.</div>`;
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/assign/view.php**`, (route: Route) => {
      const request = route.request();
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      const actionParam = new URL(request.url()).searchParams.get("action");
      if (request.method() === "POST") {
        const form = new URLSearchParams(request.postData() ?? "");
        state.posts.push(form);
        if (form.get("action") === "savesubmission") {
          state.stage = drafts ? "draft" : "submitted";
          if (form.has("onlinetext_editor[text]")) state.text = form.get("onlinetext_editor[text]")!.replace(/<[^>]+>/g, "");
        } else if (form.get("action") === "confirmsubmit" && state.stage === "draft") state.stage = "submitted";
        return html(view());
      }
      if (actionParam === "editsubmission") {
        if (state.stage === "submitted" && drafts) return html(page("<p>Not allowed</p>", "page-mod-assign-view"));
        const fileField = files ? `<input type="hidden" name="files_filemanager" value="321">` : "";
        return html(
          page(
            `<form class="mform" method="post" action="${SITE}mod/assign/view.php"><input type="hidden" name="action" value="savesubmission">${statement && !drafts ? box : ""}<textarea name="onlinetext_editor[text]"></textarea><input type="hidden" name="onlinetext_editor[format]" value="1">${fileField}<input type="submit" name="submitbutton" value="Save changes"></form>
<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`,
            "page-mod-assign-editsubmission",
          ),
        );
      }
      if (actionParam === "submit") {
        // Moodle 5.2 shows the confirmation whatever the submission's state (confirmed empirically on the sandbox).
        return html(page(`<form class="mform" method="post" action="${SITE}mod/assign/view.php"><input type="hidden" name="action" value="confirmsubmit">${statement ? box : ""}<input type="submit" name="submitbutton" value="Continue"></form>`, "page-mod-assign-submit"));
      }
      return html(view());
    });
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      state.files.push(/filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
  };
  return { state, routes };
}

describe("studentAssignment, saveSubmission and submitForGrading", { skip: !browser && "no system browser" }, () => {
  async function site(statement = false, files = true, drafts = true) {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const assignment = fakeAssignment(statement, files, drafts);
    await assignment.routes(context);
    return { context, state: assignment.state };
  }

  it("reads, saves a draft with text and files, and submits it", async () => {
    const { context, state } = await site();
    const before = await studentAssignment(context, SITE, 30);
    assert.deepEqual([before.submissionState, before.canEdit, before.canSubmit, before.graded], ["new", true, false, false]);
    assert.equal(before.description, "Write a program.\n\ntemplate.docx");
    assert.deepEqual(before.descriptionFiles, [{ name: "template.docx", url: `${SITE}pluginfile.php/9/mod_assign/introattachment/0/template.docx` }]);
    assert.deepEqual(before.dates, [{ label: "Due", value: "Friday" }]);
    assert.deepEqual(before.status[1], { label: "Grading status", value: "Not graded" });
    // Before the first save, nothing on a student's pages tells whether there are drafts.
    assert.deepEqual([before.drafts, before.statement], [undefined, undefined]);
    const saved = await saveSubmission(context, SITE, 30, { onlineText: "<p>My answer</p>", files: [path.join(dir, "work.txt")] });
    assert.equal(saved.changed, "Saved online text and 1 file in assignment 30's submission, a draft until it's submitted for grading.");
    const draft = saved.assignment;
    assert.deepEqual([draft.submissionState, draft.canSubmit, draft.drafts], ["draft", true, true]);
    assert.deepEqual(draft.submittedFiles.map((f) => f.name), ["work.txt"]);
    assert.equal(state.posts[0]?.get("onlinetext_editor[text]"), "<p>My answer</p>");
    const { changed, assignment: submitted } = await submitForGrading(context, SITE, 30);
    assert.equal(changed, "Submitted assignment 30 for grading.");
    assert.deepEqual([submitted.submissionState, submitted.canEdit], ["submitted", false]);
    await context.close();
  });

  it("reads the dates as Moodle 4.5 draws them, their labels in a strong", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const body = `<div class="activity-description" id="intro"><p>Write.</p></div>
<div data-region="activity-dates" class="activity-dates"><div><strong>Opened:</strong> Monday</div><div><strong>Due:</strong> Friday</div></div>
<table class="submissionstatustable"><tr><th>Submission status</th><td class="submissionstatusnew">No submission</td></tr></table>`;
    await context.route(`${SITE}mod/assign/view.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, body, bodyId: "page-mod-assign-view" }) }));
    assert.deepEqual((await studentAssignment(context, SITE, 30)).dates, [
      { label: "Opened", value: "Monday" },
      { label: "Due", value: "Friday" },
    ]);
    await context.close();
  });

  it("asks to accept the site's statement before submitting", async () => {
    const { context, state } = await site(true);
    await saveSubmission(context, SITE, 30, { onlineText: "<p>x</p>" });
    const draft = await studentAssignment(context, SITE, 30);
    assert.deepEqual([draft.drafts, draft.statement], [true, "This is my own work."]);
    await assert.rejects(submitForGrading(context, SITE, 30, false), (error: unknown) => error instanceof SubmissionError && /This is my own work/.test(error.message));
    assert.equal(state.stage, "draft");
    assert.equal((await submitForGrading(context, SITE, 30, { acceptStatement: true })).assignment.submissionState, "submitted");
    assert.deepEqual(state.posts.at(-1)?.getAll("submissionstatement"), ["0", "1"]);
    await context.close();
  });

  it("without drafts, reads the edit form's statement before saving, and saving asks to accept it (#113)", async () => {
    const { context, state } = await site(true, true, false);
    const before = await studentAssignment(context, SITE, 30);
    assert.deepEqual([before.drafts, before.statement], [false, "This is my own work."]);
    await assert.rejects(saveSubmission(context, SITE, 30, { onlineText: "<p>x</p>" }), (error: unknown) => error instanceof SubmissionError && /Saving submits assignment 30 and asks to accept this statement.*This is my own work/.test(error.message));
    assert.equal(state.posts.length, 0);
    const saved = await saveSubmission(context, SITE, 30, { onlineText: "<p>x</p>", acceptStatement: true });
    assert.equal(saved.changed, "Saved online text in assignment 30's submission, submitted for grading.");
    assert.deepEqual([saved.assignment.submissionState, saved.assignment.canEdit, saved.assignment.drafts], ["submitted", true, false]);
    assert.deepEqual(state.posts.at(-1)?.getAll("submissionstatement"), ["0", "1"]);
    await context.close();
  });

  it("without drafts nor a statement, tells there are no drafts once submitted (#113)", async () => {
    const { context } = await site(false, true, false);
    assert.equal((await studentAssignment(context, SITE, 30)).drafts, undefined);
    await saveSubmission(context, SITE, 30, { onlineText: "<p>x</p>" });
    const after = await studentAssignment(context, SITE, 30);
    assert.deepEqual([after.drafts, after.statement], [false, undefined]);
    await context.close();
  });

  it("refuses an empty save, files where the assignment takes none, and editing once submitted", async () => {
    const { context, state } = await site(false, false);
    await assert.rejects(saveSubmission(context, SITE, 30, {}), /Give online text, files or both/);
    await assert.rejects(saveSubmission(context, SITE, 30, { files: [path.join(dir, "work.txt")] }), /doesn't take file submissions/);
    assert.equal(state.posts.length, 0);
    await saveSubmission(context, SITE, 30, { onlineText: "<p>x</p>" });
    await submitForGrading(context, SITE, 30, false);
    await assert.rejects(saveSubmission(context, SITE, 30, { onlineText: "<p>y</p>" }), (error: unknown) => error instanceof SubmissionError && /can't edit a submission/.test(error.message));
    const posts = state.posts.length;
    await assert.rejects(submitForGrading(context, SITE, 30, false), (error: unknown) => error instanceof SubmissionError && /has nothing to submit now/.test(error.message));
    assert.equal(state.posts.length, posts);
    await context.close();
  });

  // Moodle 5.2's rubric and marking guide on a student's page, reduced: a preview under "Grading
  // criteria" inside the status block before grading, the breakdown inside the feedback after.
  const STATUS = `<tr><th>Submission status</th><td class="submissionstatusnew">No submissions have been made yet</td></tr><tr><th>Grading status</th><td class="submissionnotgraded">Not graded</td></tr>`;
  const level = (prefix: string, criterion: number, id: number, definition: string, score: string, checked = false) =>
    `<td id="${prefix}-criteria-${criterion}-levels-${id}" class="text-break level${checked ? " checked" : ""}" aria-label="Level ${definition}, ${score} points."><div class="level-wrapper"><div class="definition">${definition}</div><div class="score d-inline"><span class="scorevalue">${score}</span> points</div></div></td>`;
  const rubricRow = (prefix: string, id: number, description: string, levels: string, remark?: string) =>
    `<tr class="criterion" id="${prefix}-criteria-${id}"><td class="description">${description}</td><td class="levels"><table role="none"><tbody><tr role="list">${levels}</tr></tbody></table></td>${remark !== undefined ? `<td class="remark">${remark}</td>` : ""}</tr>`;
  const rubricPreview = `<h4>Grading criteria</h4><div class="box py-3 gradingform_rubric-description"></div><div id="rubric-rubric" class="clearfix gradingform_rubric editor preview"><table class="criteria"><tbody>${
    rubricRow("rubric", 173, "Content", level("rubric", 173, 558, "Poor", "0") + level("rubric", 173, 559, "Good", "5") + level("rubric", 173, 560, "Great", "10")) + rubricRow("rubric", 174, "Style", level("rubric", 174, 561, "Plain", "0") + level("rubric", 174, 562, "Clear", "2.5"))
  }</tbody></table></div>`;
  const rubricBreakdown = `<h4>Grade breakdown</h4><div class="advancedgrade"><div class="box py-3 gradingform_rubric-description"></div><div id="rubric-rubric0" class="clearfix gradingform_rubric view"><table class="criteria"><tbody>${
    rubricRow("rubric0", 173, "Content", level("rubric0", 173, 558, "Poor", "0") + level("rubric0", 173, 559, "Good", "5", true) + level("rubric0", 173, 560, "Great", "10"), "Nice content") +
    rubricRow("rubric0", 174, "Style", level("rubric0", 174, 561, "Plain", "0", true) + level("rubric0", 174, 562, "Clear", "2.5"), "")
  }</tbody></table></div></div>`;
  const page = (status: string, feedback = "") =>
    `<div class="submissionstatustable"><h3>Submission status</h3><div class="box submissionsummarytable"><table class="generaltable"><tbody>${status}</tbody></table></div>${status === STATUS ? rubricPreview : ""}</div>${feedback}`;

  it("gives a rubric apart from the status, every level with its points; once graded, the chosen levels and remarks, and the feedback without the rubric's rows (#112)", async () => {
    const context = await browser!.newContext();
    const state: FakeMoodleState = { user: { id: 4, fullName: "Student" }, serviceCalls: [], bodies: { "/mod/assign/view.php": page(STATUS) } };
    await serveFakeMoodle(context, state);
    const before = await studentAssignment(context, SITE, 32);
    assert.deepEqual(before.status, [
      { label: "Submission status", value: "No submissions have been made yet" },
      { label: "Grading status", value: "Not graded" },
    ]);
    assert.deepEqual(before.grading, {
      method: "rubric",
      criteria: [
        { id: 173, description: "Content", levels: [{ id: 558, definition: "Poor", score: 0 }, { id: 559, definition: "Good", score: 5 }, { id: 560, definition: "Great", score: 10 }] },
        { id: 174, description: "Style", levels: [{ id: 561, definition: "Plain", score: 0 }, { id: 562, definition: "Clear", score: 2.5 }] },
      ],
    });
    const graded = `<tr><th>Submission status</th><td class="submissionstatusnew">No submissions have been made yet</td></tr><tr><th>Grading status</th><td class="submissiongraded">Graded</td></tr>`;
    state.bodies!["/mod/assign/view.php"] = page(graded, `<div class="feedback"><h3>Feedback</h3><div class="box feedbacktable"><table class="generaltable"><tbody><tr><th>Grade</th><td>40.00 / 100.00</td></tr><tr><th>Feedback comments</th><td><p>Overall fine</p></td></tr></tbody></table></div>${rubricBreakdown}</div>`);
    const after = await studentAssignment(context, SITE, 32);
    assert.deepEqual(after.feedback, [
      { label: "Grade", value: "40.00 / 100.00" },
      { label: "Feedback comments", value: "Overall fine" },
    ]);
    assert.deepEqual(
      after.grading?.criteria.map((c) => [c.id, c.levelId, c.score, c.remark]),
      [
        [173, 559, 5, "Nice content"],
        [174, 561, 0, undefined],
      ],
    );
    await context.close();
  });

  it("gives a marking guide's criteria with their maximum, and once graded the scores and remarks (#112)", async () => {
    const context = await browser!.newContext();
    const criterion = (prefix: string, id: number, name: string, details: string, max: number, graded?: [string, string]) =>
      `<tr class="criterion" id="${prefix}-criteria-${id}"><td class="description${graded ? "readonly" : ""}"><div class="criterionshortname">${name}</div><div class="criteriondescription">${details ? `<div class="text_to_html">${details}</div>` : ""}</div><label>Maximum score</label><div class="criteriondescriptionscore">${max}</div></td>${
        graded ? `<td class="remark"><div class="hidden">${name} criterion remark</div><div>${graded[0]}</div></td><td class="score"><div>${graded[1]} / ${max}</div></td>` : ""
      }</tr>`;
    const guide = (prefix: string, rows: string) => `<div id="guide-${prefix}" class="clearfix gradingform_guide ${prefix === "guide" ? "editor preview" : "view"}"><div class="hidden">Marking guide</div><table class="criteria"><tbody>${rows}</tbody></table></div>`;
    await serveFakeMoodle(context, {
      user: { id: 4, fullName: "Student" },
      bodies: {
        "/mod/assign/view.php": `<div class="submissionstatustable"><table><tbody><tr><th>Grading status</th><td class="submissiongraded">Graded</td></tr></tbody></table><h4>Grading criteria</h4>${guide("guide", criterion("guide", 10, "Clarity", "Is it clear", 4) + criterion("guide", 11, "Depth", "", 6))}</div>
<div class="feedback"><table><tbody><tr><th>Grade</th><td>80.00 / 100.00</td></tr></tbody></table><h4>Grade breakdown</h4><div class="advancedgrade">${guide("guide0", criterion("guide0", 10, "Clarity", "Is it clear", 4, ["Mostly clear", "3"]) + criterion("guide0", 11, "Depth", "", 6, ["", "5"]))}</div></div>`,
      },
    });
    const assignment = await studentAssignment(context, SITE, 32);
    assert.deepEqual(assignment.status, [{ label: "Grading status", value: "Graded" }]);
    assert.deepEqual(assignment.grading, {
      method: "guide",
      criteria: [
        { id: 10, description: "Clarity", details: "Is it clear", maxScore: 4, score: 3, remark: "Mostly clear" },
        { id: 11, description: "Depth", maxScore: 6, score: 5 },
      ],
    });
    await context.close();
  });

  it("gives the feedback's files, not the other links in it", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 4, fullName: "Student" },
      // Moodle 5.2's feedback table, reduced: a comment with an embedded file, and the feedback files plugin's block.
      bodies: {
        "/mod/assign/view.php": `<div class="feedback"><table class="generaltable"><tbody>
<tr><th>Feedback comments</th><td><a href="${SITE}pluginfile.php/89/assignfeedback_comments/feedback/13/note.png">note.png</a></td></tr>
<tr><th>Feedback files</th><td><div class="box plugincontentsummary summary_assignfeedback_file_13"><div class="fileuploadsubmission"><a target="_blank" href="${SITE}pluginfile.php/89/assignfeedback_file/feedback_files/13/corrected.pdf?forcedownload=1">corrected.pdf</a></div></div></td></tr>
</tbody></table></div>`,
      },
    });
    const assignment = await studentAssignment(context, SITE, 32);
    assert.deepEqual(assignment.feedbackFiles, [{ name: "corrected.pdf", url: `${SITE}pluginfile.php/89/assignfeedback_file/feedback_files/13/corrected.pdf?forcedownload=1` }]);
    await context.close();
  });

  /** A made-up assignment page with group submissions, as Moodle 5.2's: the group's row first, then the status with its class. */
  async function teamSite(groupCell: string) {
    const context = await browser!.newContext();
    const state: FakeMoodleState = {
      user: { id: 5, fullName: "Student" },
      serviceCalls: [],
      bodies: { "/mod/assign/view.php": `<div class="submissionstatustable"><table><tbody><tr><th>Group</th><td>${groupCell}</td></tr><tr><th>Submission status</th><td class="submissionstatussubmitted">Submitted</td></tr></tbody></table></div>` },
      bodyClasses: { "/mod/assign/view.php": "course-3" },
      services: {
        // Moodle's strings in the person's language: matched against the row's label.
        core_get_string: (args) => ({ submissionteam: "Group", defaultteam: "Default group" })[String(args.stringid)],
        core_table_get_dynamic_table_content: (args) => {
          const group = (args.filters as { name: string; values: number[] }[]).find((f) => f.name === "groups")?.values[0];
          const rows = group === 4 ? [[6, "Marcos López"], [5, "Lucía Martín"]] : [];
          return { html: `<table><tbody>${rows.map(([id, name]) => `<tr><th><a href="${SITE}user/view.php?id=${id}&amp;course=3"><span class="userinitials">XX</span>${name}</a></th></tr>`).join("")}</tbody></table>`, warnings: [] };
        },
      },
    };
    await serveFakeMoodle(context, state);
    const filters = `<select data-field-name="groups"><option value="-1">No group</option><option value="4">Driver group</option></select>`;
    await context.route(`${SITE}user/index.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 5, bodyId: "page-course-view-participants", body: filters }) }));
    return { context, state };
  }

  it("says the submission is the group's, by its id and name, without others' data", async () => {
    const { context, state } = await teamSite("Driver group");
    const assignment = await studentAssignment(context, SITE, 33);
    assert.deepEqual(assignment.group, { id: 4, name: "Driver group" });
    // Its members are others' data: the participants table isn't read.
    assert.equal(state.serviceCalls?.find((call) => call.methodname === "core_table_get_dynamic_table_content"), undefined);
    await context.close();
  });

  it("gives Moodle's default group by name only, and no group without group submissions", async () => {
    const { context } = await teamSite("Default group");
    assert.deepEqual((await studentAssignment(context, SITE, 34)).group, { name: "Default group" });
    await context.close();
    const solo = await site();
    const { group } = await studentAssignment(solo.context, SITE, 30);
    assert.equal(group, undefined);
    await solo.context.close();
  });

  it("refuses an activity that isn't an assignment", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    // Moodle names each page in the body id: another module's page has its own.
    await context.route(`${SITE}mod/assign/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-quiz-view" }) }));
    await assert.rejects(studentAssignment(context, SITE, 31), (error: unknown) => error instanceof SubmissionError && /isn't an assignment/.test(error.message));
    await context.close();
  });
});
