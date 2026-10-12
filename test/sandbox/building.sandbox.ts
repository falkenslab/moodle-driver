// Building a course and its completion, against the sandbox: activities and sections made, changed,
// moved and deleted on a scratch course by the teacher, read back as the teacher and the student.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ActivitySettingsError, CompletionError, MoodleError, type CourseActivity, type CourseSection } from "../../src/index.js";
import { COURSE, as, scratchCourse, userId, type ScratchCourse } from "./harness.js";
import { scormPackage, textFile } from "./packages.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

const activities = (sections: CourseSection[]): CourseActivity[] => sections.flatMap((s) => s.activities);
const activityIn = (sections: CourseSection[], id: number) => activities(sections).find((a) => a.id === id);
const sectionOf = (sections: CourseSection[], id: number) => sections.find((s) => s.activities.some((a) => a.id === id));

describe("building a course", () => {
  let course: ScratchCourse;
  /** The scratch course's sections at the start: section 0 and the format's numbered ones. */
  let sections: CourseSection[];
  let pageId: number;
  let urlId: number;
  let labelId: number;
  let resourceId: number;
  let folderId: number;

  before(async () => {
    course = await scratchCourse("building");
    sections = await (await as("teacher")).courseStructure(course.id);
  }, SETUP);

  it("createActivity: a page, shown to students, with its content", SLOW, async () => {
    const teacher = await as("teacher");
    const made = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver page", content: "<p>Page body</p>", visibility: "shown" });
    assert.ok(made.activityId, made.changed);
    pageId = made.activityId;
    assert.equal(activityIn(made.sections, pageId)?.type, "page");
    // The student sees it, by the name given, where it was put.
    const seen = await (await as("student")).courseStructure(course.id);
    assert.equal(activityIn(seen, pageId)?.name, "Driver page");
    assert.equal(sectionOf(seen, pageId)?.id, course.sectionId);
    const content = await (await as("student")).activityContent(pageId, "page", { trail: "fast" });
    assert.match(JSON.stringify(content), /Page body/);
  });

  it("createActivity: a URL and a label, hidden from students unless asked", SLOW, async () => {
    const teacher = await as("teacher");
    const url = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "url", name: "Driver link", url: "https://moodle.org/" });
    const label = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "label", content: "<p>Driver label</p>", visibility: "shown" });
    urlId = url.activityId!;
    labelId = label.activityId!;
    assert.ok(urlId && labelId);
    assert.equal(activityIn(label.sections, urlId)?.visible, false);
    assert.equal(activityIn(label.sections, labelId)?.visible, true);
    const settings = await teacher.activitySettings(urlId);
    assert.equal(settings.fields.find((f) => f.name === "externalurl")?.value, "https://moodle.org/");
    // Hidden: the student's course has no such activity.
    assert.equal(activityIn(await (await as("student")).courseStructure(course.id), urlId), undefined);
  });

  it("createActivity: a file resource with its file", SLOW, async () => {
    const teacher = await as("teacher");
    const made = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "resource", name: "Driver file", files: [textFile("notes.txt", "Some notes\n")] });
    resourceId = made.activityId!;
    assert.ok(resourceId, made.changed);
    const settings = await teacher.activitySettings(resourceId);
    assert.equal(settings.module, "resource");
    assert.deepEqual(settings.files?.map((f) => f.name), ["notes.txt"]);
  });

  it("createActivity: a folder with files, one in a subfolder", SLOW, async () => {
    const teacher = await as("teacher");
    const made = await teacher.createActivity({
      courseId: course.id,
      sectionId: course.sectionId,
      type: "folder",
      name: "Driver folder",
      files: [textFile("a.txt"), { from: textFile("b.txt"), to: "week1/b.txt" }],
    });
    folderId = made.activityId!;
    assert.ok(folderId, made.changed);
    const settings = await teacher.activitySettings(folderId);
    assert.deepEqual(settings.files?.map((f) => f.name).sort(), ["a.txt", "week1/b.txt"]);
  });

  it("createActivity: a SCORM from a package", SLOW, async () => {
    const teacher = await as("teacher");
    const made = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "scorm", name: "Driver SCORM", files: [scormPackage()] });
    assert.ok(made.activityId, made.changed);
    assert.equal(activityIn(made.sections, made.activityId)?.type, "scorm");
    const settings = await teacher.activitySettings(made.activityId);
    assert.deepEqual(settings.files?.map((f) => f.name), ["driver-check-scorm.zip"]);
  });

  it("createActivity: refused for a section the course hasn't, and for a student", SLOW, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.createActivity({ courseId: course.id, sectionId: 999_999, type: "page", name: "Nowhere", content: "x" }), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
    const before = activities(await teacher.courseStructure(course.id)).length;
    await assert.rejects((await as("student")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "By a student", content: "x" }), MoodleError);
    assert.equal(activities(await teacher.courseStructure(course.id)).length, before);
  });

  it("updateActivity: name, description, visibility and a setting", SLOW, async () => {
    const teacher = await as("teacher");
    const done = await teacher.updateActivity(urlId, { name: "Driver link (renamed)", description: "<p>Where to read more</p>", visibility: "shown", settings: { externalurl: "https://docs.moodle.org/" } });
    assert.match(done.changed, /Driver link \(renamed\)/);
    const settings = await teacher.activitySettings(urlId);
    assert.equal(settings.name, "Driver link (renamed)");
    assert.match(settings.description, /Where to read more/);
    assert.equal(settings.fields.find((f) => f.name === "externalurl")?.value, "https://docs.moodle.org/");
    assert.equal(activityIn(await (await as("student")).courseStructure(course.id), urlId)?.name, "Driver link (renamed)");
  });

  it("updateActivity: a folder's files added, removed and replaced", SLOW, async () => {
    const teacher = await as("teacher");
    const added = await teacher.updateActivity(folderId, { files: { add: [textFile("c.txt")] } });
    assert.deepEqual(added.files?.map((f) => f.name).sort(), ["a.txt", "c.txt", "week1/b.txt"]);
    const removed = await teacher.updateActivity(folderId, { files: { remove: ["a.txt", "week1/b.txt"] } });
    assert.deepEqual(removed.files?.map((f) => f.name), ["c.txt"]);
    await assert.rejects(teacher.updateActivity(folderId, { files: { remove: ["missing.txt"] } }), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
    await teacher.updateActivity(folderId, { files: { replace: [textFile("d.txt"), { from: textFile("e.txt"), to: "sub/e.txt" }] } });
    // Saved: what the form holds afterwards.
    assert.deepEqual((await teacher.activitySettings(folderId)).files?.map((f) => f.name).sort(), ["d.txt", "sub/e.txt"]);
    // A file resource's file replaced.
    await teacher.updateActivity(resourceId, { files: { replace: [textFile("notes-v2.txt")] } });
    assert.deepEqual((await teacher.activitySettings(resourceId)).files?.map((f) => f.name), ["notes-v2.txt"]);
  });

  it("updateActivity: restrictions and completion, read back in the same terms", SLOW, async () => {
    const teacher = await as("teacher");
    const from = "2026-01-15T09:00:00.000Z";
    await teacher.updateActivity(pageId, { completion: "manual" });
    await teacher.updateActivity(labelId, {
      restrictions: { conditions: [{ type: "date", from }, { type: "completion", activityId: pageId, state: "complete" }], match: "all" },
    });
    await teacher.updateActivity(urlId, { completion: { view: true } });
    const label = await teacher.activitySettings(labelId);
    assert.deepEqual(label.restrictions, { conditions: [{ type: "date", from }, { type: "completion", activityId: pageId, state: "complete" }], match: "all", hidden: false });
    assert.equal((await teacher.activitySettings(pageId)).completion, "manual");
    assert.deepEqual((await teacher.activitySettings(urlId)).completion, { view: true });
    // The student finds the label restricted (the page isn't complete).
    assert.equal(activityIn(await (await as("student")).courseStructure(course.id), labelId)?.restricted, true);
    // A completion condition on an activity the course hasn't is refused before saving.
    await assert.rejects(teacher.updateActivity(labelId, { restrictions: { conditions: [{ type: "completion", activityId: 999_999, state: "complete" }] } }), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
    // No conditions: no restrictions.
    await teacher.updateActivity(labelId, { restrictions: { conditions: [] } });
    assert.equal((await teacher.activitySettings(labelId)).restrictions, undefined);
  });

  it("activitySettings: the form's fields, refused to a student and for an id that isn't there", SLOW, async () => {
    const teacher = await as("teacher");
    const settings = await teacher.activitySettings(pageId);
    assert.equal(settings.id, pageId);
    assert.equal(settings.courseId, course.id);
    assert.equal(settings.module, "page");
    assert.equal(settings.name, "Driver page");
    assert.match(String(settings.fields.find((f) => f.name === "page[text]")?.value), /Page body/);
    await assert.rejects((await as("student")).activitySettings(pageId), ActivitySettingsError);
    await assert.rejects(teacher.activitySettings(999_999), ActivitySettingsError);
  });

  it("editActivity: renamed, hidden and shown, moved to another section and before another activity", SLOW, async () => {
    const teacher = await as("teacher");
    const target = sections[1]!;
    const renamed = await teacher.editActivity(course.id, resourceId, { name: "Driver file (renamed)", visibility: "hidden" });
    assert.equal(activityIn(renamed.sections, resourceId)?.name, "Driver file (renamed)");
    assert.equal(activityIn(renamed.sections, resourceId)?.visible, false);
    const moved = await teacher.editActivity(course.id, resourceId, { sectionId: target.id, visibility: "shown" });
    assert.equal(sectionOf(moved.sections, resourceId)?.id, target.id);
    assert.equal(activityIn(moved.sections, resourceId)?.visible, true);
    const placed = await teacher.editActivity(course.id, folderId, { beforeActivityId: resourceId });
    const order = sectionOf(placed.sections, resourceId)!.activities.map((a) => a.id);
    assert.deepEqual(order, [folderId, resourceId]);
    // The student sees it where it went, by its new name.
    const seen = await (await as("student")).courseStructure(course.id);
    assert.equal(sectionOf(seen, resourceId)?.id, target.id);
    assert.equal(activityIn(seen, resourceId)?.name, "Driver file (renamed)");
  });

  it("duplicateActivity: a copy right after it", SLOW, async () => {
    const teacher = await as("teacher");
    const copy = await teacher.duplicateActivity(course.id, pageId);
    assert.ok(copy.activityId, copy.changed);
    const ids = sectionOf(copy.sections, pageId)!.activities.map((a) => a.id);
    assert.equal(ids[ids.indexOf(pageId) + 1], copy.activityId);
    assert.match(activityIn(copy.sections, copy.activityId)!.name, /Driver page/);
    assert.equal((await teacher.activitySettings(copy.activityId)).module, "page");
    const gone = await teacher.deleteActivity(course.id, copy.activityId);
    assert.equal(activityIn(gone.sections, copy.activityId), undefined);
  });

  it("deleteActivity: gone from the course, for the student too", SLOW, async () => {
    const teacher = await as("teacher");
    const done = await teacher.deleteActivity(course.id, labelId);
    assert.equal(activityIn(done.sections, labelId), undefined);
    assert.equal(activityIn(await (await as("student")).courseStructure(course.id), labelId), undefined);
    await assert.rejects((await as("student")).deleteActivity(course.id, pageId), MoodleError);
    assert.ok(activityIn(await teacher.courseStructure(course.id), pageId));
  });

  let sectionId: number;

  it("addSection: named, with a description, after another section", SLOW, async () => {
    const teacher = await as("teacher");
    const added = await teacher.addSection(course.id, { name: "Driver section", summary: "<p>What this week is about</p>", afterSectionId: sections[1]!.id });
    assert.ok(added.sectionId, added.changed);
    sectionId = added.sectionId;
    const at = added.sections.findIndex((s) => s.id === sectionId);
    assert.equal(added.sections[at - 1]?.id, sections[1]!.id);
    const detailed = await teacher.courseStructure(course.id, { details: true });
    const section = detailed.find((s) => s.id === sectionId)!;
    assert.equal(section.title, "Driver section");
    assert.match(section.summary ?? "", /What this week is about/);
    // At the end without afterSectionId, unnamed.
    const last = await teacher.addSection(course.id);
    assert.equal(last.sections.at(-1)?.id, last.sectionId);
    await teacher.deleteSection(course.id, last.sectionId!);
  });

  it("editSection: renamed, described, restricted, hidden and moved", SLOW, async () => {
    const teacher = await as("teacher");
    await teacher.editSection(course.id, sectionId, { name: "Driver section (renamed)", summary: "<p>New description</p>", restrictions: { conditions: [{ type: "date", from: "2030-01-01T00:00:00Z" }] } });
    const detailed = await teacher.courseStructure(course.id, { details: true });
    const section = detailed.find((s) => s.id === sectionId)!;
    assert.equal(section.title, "Driver section (renamed)");
    assert.match(section.summary ?? "", /New description/);
    assert.equal(section.restricted, true);
    const last = sections.at(-1)!;
    const moved = await teacher.editSection(course.id, sectionId, { afterSectionId: last.id, visible: false });
    assert.equal(moved.sections.at(-1)?.id, sectionId);
    assert.equal(moved.sections.at(-1)?.visible, false);
    // Hidden: the student sees the section as not visible, or not at all.
    const seen = (await (await as("student")).courseStructure(course.id)).find((s) => s.id === sectionId);
    assert.ok(!seen || !seen.visible);
    const cleared = await teacher.editSection(course.id, sectionId, { restrictions: { conditions: [] }, visible: true });
    assert.equal(cleared.sections.find((s) => s.id === sectionId)?.restricted, false);
    // A section of another course (the content course's, refused before anything is saved).
    const other = (await teacher.courseStructure(COURSE))[0]!.id;
    await assert.rejects(teacher.editSection(course.id, other, { summary: "x" }), (error: unknown) => error instanceof MoodleError && error.code === "not-found");
  });

  it("deleteSection: gone with its activities", SLOW, async () => {
    const teacher = await as("teacher");
    const inside = await teacher.createActivity({ courseId: course.id, sectionId, type: "page", name: "Goes with the section", content: "<p>x</p>" });
    const done = await teacher.deleteSection(course.id, sectionId);
    assert.equal(done.sections.find((s) => s.id === sectionId), undefined);
    assert.equal(activityIn(done.sections, inside.activityId!), undefined);
  });

  it("setCompletion: the student marks a manual activity done and not done", SLOW, async () => {
    const student = await as("student");
    const done = await student.setCompletion(pageId, true);
    assert.match(done.changed, /done/);
    assert.deepEqual(activityIn(await student.courseStructure(course.id), pageId)?.completion, { state: "complete", complete: true });
    await student.setCompletion(pageId, false);
    assert.equal(activityIn(await student.courseStructure(course.id), pageId)?.completion?.state, "incomplete");
    // One that completes on view can't be marked by hand.
    await assert.rejects(student.setCompletion(urlId, true), CompletionError);
  });

  it("overrideCompletion: the teacher sets the student's completion", SLOW, async () => {
    const teacher = await as("teacher");
    const student = await userId("student");
    const saved = await teacher.overrideCompletion(urlId, student, "complete");
    assert.equal(saved.state, "complete");
    assert.equal(saved.overridden, true);
    assert.equal(activityIn(await (await as("student")).courseStructure(course.id), urlId)?.completion?.state, "complete");
    // A student can't override anyone's.
    await assert.rejects((await as("student")).overrideCompletion(pageId, student, "complete"), CompletionError);
  });

  it("completionReport: every tracked activity and the student's completion, refused to the student", SLOW, async () => {
    const teacher = await as("teacher");
    const report = await teacher.completionReport(course.id);
    assert.ok(report.activities.some((a) => a.id === pageId && a.type === "page"));
    assert.ok(report.activities.some((a) => a.id === urlId && a.type === "url"));
    const studentId = await userId("student");
    const mine = report.participants.find((p) => p.userId === studentId);
    assert.ok(mine, "the student is in the report");
    assert.deepEqual(mine.completion.find((c) => c.activityId === urlId), { activityId: urlId, state: "complete", tracking: "auto", overridden: true });
    assert.deepEqual(mine.completion.find((c) => c.activityId === pageId), { activityId: pageId, state: "incomplete", tracking: "manual", overridden: false });
    await assert.rejects((await as("student")).completionReport(course.id), CompletionError);
  });
});
