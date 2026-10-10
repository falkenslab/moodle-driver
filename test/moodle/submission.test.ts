import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { SubmissionError, saveSubmission, studentAssignment, submitForGrading } from "../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../src/testing/index.js";

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

/** A made-up assignment (cmid 30) whose pages follow Moodle 5.2's; `statement` asks to accept one. */
function fakeAssignment(statement = false, files = true) {
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
    const actions = state.stage === "submitted" ? "" : action("editsubmission") + (state.stage === "draft" ? action("submit") : "");
    return page(
      `<div class="activity-description" id="intro"><p>Write a program.</p><a href="${SITE}pluginfile.php/9/mod_assign/introattachment/0/template.docx">template.docx</a></div>
<div data-region="activity-dates"><div class="date-item"><span class="date-item-label">Due:</span> Friday</div></div>
<table class="submissionstatustable">${rows}</table>${actions}`,
      "page-mod-assign-view",
    );
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/assign/view.php**`, (route: Route) => {
      const request = route.request();
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      const actionParam = new URL(request.url()).searchParams.get("action");
      if (request.method() === "POST") {
        const form = new URLSearchParams(request.postData() ?? "");
        state.posts.push(form);
        if (form.get("action") === "savesubmission") {
          state.stage = "draft";
          if (form.has("onlinetext_editor[text]")) state.text = form.get("onlinetext_editor[text]")!.replace(/<[^>]+>/g, "");
        } else if (form.get("action") === "confirmsubmit") state.stage = "submitted";
        return html(view());
      }
      if (actionParam === "editsubmission") {
        if (state.stage === "submitted") return html(page("<p>Not allowed</p>", "page-mod-assign-view"));
        const fileField = files ? `<input type="hidden" name="files_filemanager" value="321">` : "";
        return html(
          page(
            `<form class="mform" method="post" action="${SITE}mod/assign/view.php"><input type="hidden" name="action" value="savesubmission"><textarea name="onlinetext_editor[text]"></textarea><input type="hidden" name="onlinetext_editor[format]" value="1">${fileField}<input type="submit" name="submitbutton" value="Save changes"></form>
<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`,
            "page-mod-assign-editsubmission",
          ),
        );
      }
      if (actionParam === "submit") {
        if (state.stage !== "draft") return html(page("<p>Not allowed</p>", "page-mod-assign-view"));
        const box = statement ? `<div class="form-check"><input type="hidden" name="submissionstatement" value="0"><input type="checkbox" name="submissionstatement" value="1"> This is my own work.</div>` : "";
        return html(page(`<form class="mform" method="post" action="${SITE}mod/assign/view.php"><input type="hidden" name="action" value="confirmsubmit">${box}<input type="submit" name="submitbutton" value="Continue"></form>`, "page-mod-assign-submit"));
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
  async function site(statement = false, files = true) {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const assignment = fakeAssignment(statement, files);
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
    const draft = await saveSubmission(context, SITE, 30, { onlineText: "<p>My answer</p>", files: [path.join(dir, "work.txt")] });
    assert.deepEqual([draft.submissionState, draft.canSubmit], ["draft", true]);
    assert.deepEqual(draft.submittedFiles.map((f) => f.name), ["work.txt"]);
    assert.equal(state.posts[0]?.get("onlinetext_editor[text]"), "<p>My answer</p>");
    const submitted = await submitForGrading(context, SITE, 30);
    assert.deepEqual([submitted.submissionState, submitted.canEdit], ["submitted", false]);
    await context.close();
  });

  it("asks to accept the site's statement before submitting", async () => {
    const { context, state } = await site(true);
    await saveSubmission(context, SITE, 30, { onlineText: "<p>x</p>" });
    await assert.rejects(submitForGrading(context, SITE, 30, false), (error: unknown) => error instanceof SubmissionError && /This is my own work/.test(error.message));
    assert.equal(state.stage, "draft");
    assert.equal((await submitForGrading(context, SITE, 30, { acceptStatement: true })).submissionState, "submitted");
    assert.deepEqual(state.posts.at(-1)?.getAll("submissionstatement"), ["0", "1"]);
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
    await assert.rejects(submitForGrading(context, SITE, 30, false), /has nothing to submit now/);
    await context.close();
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
