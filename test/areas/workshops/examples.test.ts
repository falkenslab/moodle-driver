import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { WorkshopError, addWorkshopExample, assessWorkshopExample, deleteWorkshopExample, editWorkshopExample, workshopExamples } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";
import { button, errorPage, html, plan, serveDraftArea, submissionBox, submissionForm } from "./fakeWorkshop.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface Example {
  title: string;
  content: string;
  grade?: number;
}

/** The example summaries of the workshop's page in the setup phase, as `render_workshop_example_submission_summary` renders them. */
const examplesRegion = (examples: Map<number, Example>) =>
  `<div id="workshop-viewlet-allexamples" class="collapsibleregion"><div class="box generalbox examples">${[...examples]
    .map(
      ([id, e]) =>
        `<div class="box generalbox example-summary ${e.grade === undefined ? "notgraded" : "graded"}"><div class="example-title"><a class="title" href="${SITE}mod/workshop/exsubmission.php?cmid=58&amp;id=${id}">${e.title}</a></div>${
          e.grade === undefined ? '<div class="example-info nograde">No grade yet</div>' : `<div class="example-info grade">Grade: ${e.grade.toFixed(2)} of 80.00</div>`
        }<div class="example-actions">${button("mod/workshop/exsubmission.php", { cmid: "58", id: String(id), assess: "on", sesskey: "s1" })}</div></div>`,
    )
    .join("")}</div></div>`;

/** A one-criterion accumulative form for an example's assessment (`exassessment.php`), with the grade in its header once saved. */
const exampleAssessment = (asid: number, grade?: number) =>
  `<div class="assessment-full anonymous"><div class="header"><div class="title">Reference assessment</div>${grade === undefined ? '<div class="grade nograde">Not assessed yet</div>' : `<div class="grade">Grade: ${grade}.00 of 80.00</div>`}</div>
<form class="assessmentform accumulative mform" method="post" action="${SITE}mod/workshop/exassessment.php"><input type="hidden" name="asid" value="${asid}"><input name="dimensionid__idx_0" type="hidden" value="18">
<select name="grade__idx_0"><option value="-1">Choose...</option><option value="10">10 / 10</option><option value="9">9 / 10</option></select><textarea name="peercomment__idx_0"></textarea>
<input name="strategy" type="hidden" value="accumulative"><input type="submit" name="saveandcontinue" value="Save and continue"></form></div>`;

async function site({ phase = 10, teacher = true }: { phase?: number; teacher?: boolean } = {}) {
  const context = await browser!.newContext();
  const user = teacher ? { id: 3, fullName: "Profesor Demo" } : { id: 5, fullName: "Lucía Martín" };
  await serveFakeMoodle(context, { user });
  const examples = new Map<number, Example>([[14, { title: "Model answer", content: "<p>The model.</p>" }]]);
  const draft = new Set<string>();
  const posted: URLSearchParams[] = [];
  let next = 15;
  await serveDraftArea(context, draft);
  await context.route(`${SITE}mod/workshop/view.php**`, (route) => html(route, plan(phase) + (teacher && phase === 10 ? examplesRegion(examples) : ""), "page-mod-workshop-view", user.id));
  await context.route(`${SITE}mod/workshop/exsubmission.php**`, (route) => {
    const request = route.request();
    const params = new URL(request.url()).searchParams;
    const id = Number(params.get("id"));
    const page = (body: string) => html(route, body, "page-mod-workshop-exsubmission", user.id);
    if (!teacher && !(params.get("assess") || examples.has(id))) return page(errorPage("Sorry, but you do not currently have permissions to do that (Manage example submissions).", "required_capability"));
    if (request.method() === "POST") {
      const form = new URLSearchParams(request.postData() ?? "");
      posted.push(form);
      // Moodle redirects to the workshop, or to the example saved (served in place here: Playwright doesn't route a redirect's target).
      if (form.get("confirm") === "1") {
        examples.delete(Number(form.get("id")));
        return html(route, plan(phase), "page-mod-workshop-view", user.id);
      }
      const saved = id || next++;
      examples.set(saved, { ...examples.get(saved), title: form.get("title")!, content: form.get("content_editor[text]")! });
      return showExample(saved);
    }
    if (params.get("assess")) return html(route, exampleAssessment(teacher ? 21 : 22), "page-mod-workshop-exassessment", user.id);
    if (params.get("edit") === "on") return page(submissionForm(`mod/workshop/exsubmission.php?cmid=58&id=${id}&edit=1`, examples.get(id) ?? { title: "", content: "" }, 1));
    return showExample(id, params.get("delete") !== null);
    function showExample(id: number, deleting = false) {
      const example = examples.get(id);
      if (!example) return page(errorPage("Can't find data record in database table workshop_submissions.", "invalidrecord"));
      const confirm = deleting ? button("mod/workshop/exsubmission.php", { cmid: "58", id: String(id), delete: "1", confirm: "1", sesskey: "s1" }, "post") : "";
      return page(`${confirm}${submissionBox({ id, ...example, files: [...draft], example: true })}<div class="buttonsbar">${button("mod/workshop/exsubmission.php", { cmid: "58", id: String(id), assess: "on", sesskey: "s1" })}</div>`);
    }
  });
  let grade: number | undefined;
  await context.route(`${SITE}mod/workshop/exassessment.php**`, (route) => {
    const request = route.request();
    const asid = Number(new URL(request.url()).searchParams.get("asid")) || 21;
    if (request.method() === "POST") {
      const form = new URLSearchParams(request.postData() ?? "");
      posted.push(form);
      grade = Number(form.get("grade__idx_0")) * 8;
    }
    return html(route, exampleAssessment(asid, request.method() === "POST" ? grade : undefined), "page-mod-workshop-exassessment", user.id);
  });
  return { context, examples, posted, draft };
}

describe("workshopExamples", { skip: !browser && "no system browser" }, () => {
  it("lists the examples with their reference assessment's grade, in the setup phase only", async () => {
    const { context, examples } = await site();
    examples.set(15, { title: "Weak answer", content: "<p>Weak.</p>", grade: 24 });
    assert.deepEqual(await workshopExamples(context, SITE, 58), [
      { id: 14, title: "Model answer", assessed: false },
      { id: 15, title: "Weak answer", assessed: true, grade: 24, maxGrade: 80 },
    ]);
    await context.close();
    const later = await site({ phase: 20 });
    await assert.rejects(workshopExamples(later.context, SITE, 58), /submission phase: Moodle lists its example submissions in the setup phase only/);
    await later.context.close();
    const student = await site({ teacher: false });
    await assert.rejects(workshopExamples(student.context, SITE, 58), (error: Error) => error instanceof WorkshopError && /mod\/workshop:manageexamples/.test(error.message));
    await student.context.close();
  });
});

describe("addWorkshopExample, editWorkshopExample and deleteWorkshopExample", { skip: !browser && "no system browser" }, () => {
  it("adds an example through the submission form, edits it and deletes it", async () => {
    const { context, examples, posted } = await site();
    const added = await addWorkshopExample(context, SITE, 58, { title: "Good answer", content: "<p>Good.</p>" });
    assert.deepEqual(added, { changed: 'Example submission 15 "Good answer" added to workshop 58.', exampleId: 15, example: { id: 15, title: "Good answer", content: "<p>Good.</p>", attachments: [] } });
    assert.equal(posted[0]?.get("example"), "1");
    const edited = await editWorkshopExample(context, SITE, 58, 15, { title: "Good answer, revised" });
    assert.equal(edited.example.title, "Good answer, revised");
    assert.equal(edited.example.content, "<p>Good.</p>");
    assert.deepEqual(await deleteWorkshopExample(context, SITE, 58, 15), { changed: "Example submission 15 deleted from workshop 58." });
    assert.deepEqual([...examples.keys()], [14]);
    await assert.rejects(deleteWorkshopExample(context, SITE, 58, 15), (error: Error) => error instanceof WorkshopError && /Can't find data record/.test(error.message));
    await assert.rejects(editWorkshopExample(context, SITE, 58, 14, {}), /title, content or attachments/);
    await context.close();
  });

  it("names the capability a student lacks", async () => {
    const { context } = await site({ teacher: false });
    await assert.rejects(addWorkshopExample(context, SITE, 58, { title: "Mine" }), (error: Error) => error instanceof WorkshopError && /mod\/workshop:manageexamples/.test(error.message));
    await context.close();
  });
});

describe("assessWorkshopExample", { skip: !browser && "no system browser" }, () => {
  it("fills the reference assessment through the strategy's form and reads its grade", async () => {
    const { context, posted } = await site();
    const result = await assessWorkshopExample(context, SITE, 58, 14, { criteria: [{ grade: 9, comment: "The model." }] });
    assert.deepEqual(result, { changed: "Example 14 of workshop 58 assessed: 72 of 80.", assessmentId: 21, grade: 72, maxGrade: 80 });
    assert.equal(posted[0]?.get("grade__idx_0"), "9");
    assert.equal(posted[0]?.get("peercomment__idx_0"), "The model.");
    await assert.rejects(assessWorkshopExample(context, SITE, 58, 14, { criteria: [{ grade: 7 }] }), /takes "10"/);
    await context.close();
  });
});
