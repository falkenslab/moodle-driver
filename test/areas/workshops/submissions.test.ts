import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { WorkshopError, saveWorkshopSubmission, workshopSubmission } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";
import { button, errorPage, html, plan, serveDraftArea, submissionBox, submissionForm } from "./fakeWorkshop.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const dir = mkdtempSync(path.join(tmpdir(), "workshop-submissions-"));
const essay = path.join(dir, "essay.txt");
const notes = path.join(dir, "notes.txt");
writeFileSync(essay, "An essay.\n");
writeFileSync(notes, "Notes.\n");

/** Lucía's (5) workshop in the submission phase: her submission (12) once she saves one, Marcos's (6) in the teacher's report. */
async function site({ phase = 20, user = { id: 5, fullName: "Lucía Martín" } }: { phase?: number; user?: { id: number; fullName: string } } = {}) {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user });
  const state: { submission?: { title: string; content: string }; posted: URLSearchParams[]; draft: Set<string> } = { posted: [], draft: new Set() };
  await serveDraftArea(context, state.draft);
  const shown = (linked: boolean) =>
    submissionBox({ id: 12, title: state.submission!.title, content: state.submission!.content, author: [5, "Lucía Martín"], files: [...state.draft], linked }) +
    (phase === 20 && user.id === 5 ? button("mod/workshop/submission.php", { cmid: "58", id: "12", edit: "on" }) : "");
  await context.route(`${SITE}mod/workshop/submission.php**`, (route) => {
    const request = route.request();
    const params = new URL(request.url()).searchParams;
    if (request.method() === "POST") {
      const form = new URLSearchParams(request.postData() ?? "");
      state.posted.push(form);
      state.submission = { title: form.get("title")!, content: form.get("content_editor[text]")! };
      return html(route, shown(false), "page-mod-workshop-submission");
    }
    if (params.get("id") === "13") return html(route, submissionBox({ id: 13, title: "Marcos's essay", content: "<p>Loops</p>", author: [6, "Marcos López"] }), "page-mod-workshop-submission", user.id);
    if (user.id !== 5) return html(route, errorPage("Sorry, but you do not currently have permissions to do that (view or create submission)."), "page-mod-workshop-submission", user.id);
    if (params.get("edit") === "on" && phase === 20) return html(route, submissionForm("mod/workshop/submission.php", state.submission ?? { title: "", content: "" }), "page-mod-workshop-submission");
    if (!state.submission) return html(route, `<div class="box generalbox">You have not submitted your work yet</div>${phase === 20 ? button("mod/workshop/submission.php", { cmid: "58", id: "0", edit: "on" }) : ""}`, "page-mod-workshop-submission");
    return html(route, shown(!params.get("id")), "page-mod-workshop-submission");
  });
  await context.route(`${SITE}mod/workshop/view.php**`, (route) =>
    html(
      route,
      `${plan(phase)}<table class="grading-report"><tbody><tr><td class="participant"><a href="${SITE}user/view.php?id=6&amp;course=3"></a><span>Marcos López</span></td><td class="submission"><a class="title" href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=13">Marcos's essay</a></td></tr></tbody></table>`,
      "page-mod-workshop-view",
      user.id,
    ),
  );
  return { context, state };
}

describe("saveWorkshopSubmission", { skip: !browser && "no system browser" }, () => {
  it("adds the submission with its attachments, then edits it, replacing them", async () => {
    const { context, state } = await site();
    const added = await saveWorkshopSubmission(context, SITE, 58, { title: "Loops essay", content: "<p>On loops.</p>", attachments: [essay, notes] });
    assert.equal(added.changed, 'Submission 12 "Loops essay" added to workshop 58.');
    assert.equal(added.submissionId, 12);
    assert.deepEqual(added.submission, {
      id: 12,
      title: "Loops essay",
      content: "<p>On loops.</p>",
      authorId: 5,
      author: "Lucía Martín",
      attachments: [
        { name: "essay.txt", url: `${SITE}pluginfile.php/99/mod_workshop/submission_attachment/12/essay.txt?forcedownload=1` },
        { name: "notes.txt", url: `${SITE}pluginfile.php/99/mod_workshop/submission_attachment/12/notes.txt?forcedownload=1` },
      ],
      editable: true,
    });
    assert.equal(state.posted[0]?.get("attachment_filemanager"), "777");
    // Editing: only the title changes, and the attachments are replaced.
    const edited = await saveWorkshopSubmission(context, SITE, 58, { title: "Loops essay, revised", attachments: [notes] });
    assert.equal(edited.changed, "Submission 12 to workshop 58 changed.");
    assert.equal(edited.submission.content, "<p>On loops.</p>");
    assert.deepEqual(
      edited.submission.attachments.map((a) => a.name),
      ["notes.txt"],
    );
    await context.close();
  });

  it("refuses a new submission without a title, outside the submission phase, and to someone who can't submit", async () => {
    const early = await site({ phase: 10 });
    await assert.rejects(saveWorkshopSubmission(early.context, SITE, 58, { content: "<p>Hi</p>" }), /needs a title/);
    await assert.rejects(saveWorkshopSubmission(early.context, SITE, 58, { title: "Too early" }), (error: Error) => error instanceof WorkshopError && /submission phase/.test(error.message));
    await assert.rejects(saveWorkshopSubmission(early.context, SITE, 58, {}), /title, content or attachments/);
    await assert.rejects(saveWorkshopSubmission(early.context, SITE, 58, { title: "Mine", attachments: ["relative.txt"] }), /absolute paths/);
    await early.context.close();
    const teacher = await site({ user: { id: 3, fullName: "Profesor Demo" } });
    await assert.rejects(saveWorkshopSubmission(teacher.context, SITE, 58, { title: "Mine" }), (error: Error) => error instanceof WorkshopError && /mod\/workshop:submit/.test(error.message));
    await teacher.context.close();
  });
});

describe("workshopSubmission", { skip: !browser && "no system browser" }, () => {
  it("reads the person's own, none before submitting", async () => {
    const { context } = await site();
    assert.equal(await workshopSubmission(context, SITE, 58), undefined);
    await saveWorkshopSubmission(context, SITE, 58, { title: "Loops essay", content: "<p>On loops.</p>" });
    const own = await workshopSubmission(context, SITE, 58);
    assert.deepEqual([own?.id, own?.title, own?.editable], [12, "Loops essay", true]);
    await context.close();
  });

  it("reads someone's by its id or its author's, as a teacher", async () => {
    const { context } = await site({ user: { id: 3, fullName: "Profesor Demo" } });
    const expected = { id: 13, title: "Marcos's essay", content: "<p>Loops</p>", authorId: 6, author: "Marcos López", attachments: [], editable: false };
    assert.deepEqual(await workshopSubmission(context, SITE, 58, { submissionId: 13 }), expected);
    assert.deepEqual(await workshopSubmission(context, SITE, 58, { authorId: 6 }), expected);
    assert.equal(await workshopSubmission(context, SITE, 58, { authorId: 7 }), undefined);
    await assert.rejects(workshopSubmission(context, SITE, 58), /mod\/workshop:submit/);
    await assert.rejects(workshopSubmission(context, SITE, 58, { submissionId: 13, authorId: 6 }), /not both/);
    await context.close();
  });
});
