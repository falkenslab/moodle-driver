// Glossaries against the sandbox: a glossary needing approval made by the teacher on the scratch
// course (encyclopedia format, which has a category view, two entries a page), given a category,
// entries added by the teacher and by the student (the student's waiting), read back, edited,
// approved, exported, imported into a second glossary, and deleted.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { GlossaryError, MoodleError, NotAGlossaryError, type GlossaryEntry } from "../../src/index.js";
import { as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

// A 1×1 PNG, embedded in a definition.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("glossaries", () => {
  let course: ScratchCourse;
  let glossaryId: number;
  let pageId: number;
  let dir: string;
  let categoryId: number;
  let teacherEntry: GlossaryEntry;
  let studentEntry: GlossaryEntry;
  let exported: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "driver-check-glossary-"));
    await writeFile(path.join(dir, "dot.png"), PNG);
    await writeFile(path.join(dir, "notes.txt"), "Driver check notes");
    course = await scratchCourse("glossaries");
    const teacher = await as("teacher");
    const settings = { defaultapproval: 0, displayformat: "encyclopedia", entbypage: 2 };
    glossaryId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "glossary", name: "Driver check glossary", visibility: "shown", settings })).activityId!;
    pageId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check page", content: "<p>x</p>", visibility: "shown" })).activityId!;
  }, SETUP);
  after(() => rm(dir, { recursive: true, force: true }));

  it("addGlossaryCategory: added by the teacher; a second of the same name and the student refused", SLOW, async () => {
    const teacher = await as("teacher");
    const added = await teacher.addGlossaryCategory(glossaryId, { name: "Driver check category" });
    categoryId = added.categoryId;
    assert.deepEqual(added.categories, [{ id: categoryId, name: "Driver check category" }]);
    await assert.rejects(teacher.addGlossaryCategory(glossaryId, { name: "driver check CATEGORY" }), GlossaryError);
    await assert.rejects((await as("student")).addGlossaryCategory(glossaryId, { name: "Driver check other" }), (error: Error) => error instanceof GlossaryError && /managecategories/.test(error.message));
  });

  it("glossaryCategories: the category, for the teacher and the student; another module refused", SLOW, async () => {
    assert.deepEqual(await (await as("student")).glossaryCategories(glossaryId), [{ id: categoryId, name: "Driver check category" }]);
    assert.deepEqual(await (await as("teacher")).glossaryCategories(glossaryId), [{ id: categoryId, name: "Driver check category" }]);
    await assert.rejects((await as("teacher")).glossaryCategories(pageId), NotAGlossaryError);
  });

  it("addGlossaryEntry: the teacher's, approved, with aliases, its category, an attachment and an embedded image; the student's waiting", SLOW, async () => {
    const teacher = await as("teacher");
    const added = await teacher.addGlossaryEntry(glossaryId, {
      concept: "Driver check alpha",
      definition: '<p>Alpha, defined. <img src="dot.png" alt="Dot"></p>',
      aliases: ["first", "primero"],
      categoryIds: [categoryId],
      attachments: [path.join(dir, "notes.txt")],
      embed: [path.join(dir, "dot.png")],
    });
    teacherEntry = added.entry!;
    assert.equal(added.entryId, teacherEntry.id);
    assert.equal(teacherEntry.concept, "Driver check alpha");
    assert.match(teacherEntry.definition, /pluginfile\.php\/\d+\/mod_glossary\/entry\/\d+\/dot\.png/);
    assert.deepEqual(teacherEntry.aliases, ["first", "primero"]);
    assert.deepEqual(teacherEntry.categoryIds, [categoryId]);
    assert.equal(teacherEntry.authorId, await userId("teacher"));
    assert.equal(teacherEntry.approved, true);
    assert.deepEqual(teacherEntry.attachments.map((a) => a.name), ["notes.txt"]);
    await assert.rejects(teacher.addGlossaryEntry(glossaryId, { concept: "Driver check alpha", definition: "<p>Again</p>" }), (error: Error) => error instanceof MoodleError && error.code === "form");
    await assert.rejects(teacher.addGlossaryEntry(glossaryId, { concept: "Driver check x", definition: "<p>x</p>", categoryIds: [999999] }), GlossaryError);

    const student = await as("student");
    const pending = await student.addGlossaryEntry(glossaryId, { concept: "Driver check beta", definition: "<p>Beta, by the student.</p>" });
    studentEntry = pending.entry!;
    assert.equal(studentEntry.approved, false);
    assert.equal(studentEntry.authorId, await userId("student"));
    assert.deepEqual(studentEntry.categoryIds, []);
    assert.match(pending.changed, /waiting for approval/);
  });

  it("glossaryEntries: each sees what Moodle shows them; the pending ones, a letter, a search, pages; another module refused", SLOW, async () => {
    const teacher = await as("teacher");
    const student = await as("student");
    // The student's waiting entry: shown to its author, not to the teacher outside the approval page.
    assert.deepEqual((await teacher.glossaryEntries(glossaryId)).map((e) => e.id), [teacherEntry.id]);
    assert.deepEqual(await student.glossaryEntries(glossaryId), [teacherEntry, studentEntry]);
    assert.deepEqual(await teacher.glossaryEntries(glossaryId, { pending: true }), [studentEntry]);
    await assert.rejects(student.glossaryEntries(glossaryId, { pending: true }), (error: Error) => error instanceof GlossaryError && /mod\/glossary:approve/.test(error.message));
    assert.deepEqual((await student.glossaryEntries(glossaryId, { letter: "d" })).map((e) => e.id), [teacherEntry.id, studentEntry.id]);
    assert.deepEqual(await student.glossaryEntries(glossaryId, { letter: "z" }), []);
    // A search finds aliases and definitions too.
    assert.deepEqual((await student.glossaryEntries(glossaryId, { search: "primero" })).map((e) => e.id), [teacherEntry.id]);
    assert.deepEqual((await student.glossaryEntries(glossaryId, { search: "student" })).map((e) => e.id), [studentEntry.id]);
    // Two a page in Moodle: a window across them.
    assert.deepEqual(await student.glossaryEntries(glossaryId, { limit: 1 }), { items: [teacherEntry], more: true });
    assert.deepEqual(await student.glossaryEntries(glossaryId, { limit: 5, offset: 1 }), { items: [studentEntry], more: false });
    await assert.rejects(teacher.glossaryEntries(pageId), NotAGlossaryError);
  });

  it("editGlossaryEntry: the teacher changes the student's entry; the student can't change the teacher's", SLOW, async () => {
    const teacher = await as("teacher");
    const edited = await teacher.editGlossaryEntry(glossaryId, studentEntry.id, { definition: "<p>Beta, corrected by the teacher.</p>", aliases: ["segundo"], categoryIds: [categoryId], attachments: [path.join(dir, "notes.txt")] });
    assert.equal(edited.entry!.definition, "<p>Beta, corrected by the teacher.</p>");
    assert.deepEqual(edited.entry!.aliases, ["segundo"]);
    assert.deepEqual(edited.entry!.categoryIds, [categoryId]);
    assert.deepEqual(edited.entry!.attachments.map((a) => a.name), ["notes.txt"]);
    assert.equal(edited.entry!.concept, "Driver check beta");
    // Saved by someone who can approve it, Moodle approves the entry.
    assert.equal(edited.entry!.approved, true);
    const cleared = await teacher.editGlossaryEntry(glossaryId, studentEntry.id, { attachments: [], categoryIds: [] });
    assert.deepEqual(cleared.entry!.attachments, []);
    assert.deepEqual(cleared.entry!.categoryIds, []);
    studentEntry = cleared.entry!;
    await assert.rejects((await as("student")).editGlossaryEntry(glossaryId, teacherEntry.id, { concept: "Driver check hijacked" }), (error: Error) => error instanceof GlossaryError && /manageentries/.test(error.message));
  });

  it("setGlossaryEntryApproved: the teacher takes the approval back; the student refused; the teacher approves the student's entry, which everyone sees then", SLOW, async () => {
    const teacher = await as("teacher");
    const withdrawn = await teacher.setGlossaryEntryApproved(glossaryId, studentEntry.id, false);
    assert.equal(withdrawn.entry!.approved, false);
    assert.deepEqual((await teacher.glossaryEntries(glossaryId, { pending: true })).map((e) => e.id), [studentEntry.id]);
    await assert.rejects((await as("student")).setGlossaryEntryApproved(glossaryId, studentEntry.id, true), (error: Error) => error instanceof GlossaryError && /mod\/glossary:approve/.test(error.message));
    const approved = await teacher.setGlossaryEntryApproved(glossaryId, studentEntry.id, true);
    assert.equal(approved.entry!.approved, true);
    assert.match((await teacher.setGlossaryEntryApproved(glossaryId, studentEntry.id, true)).changed, /already approved/);
    assert.deepEqual((await teacher.glossaryEntries(glossaryId)).map((e) => e.id), [teacherEntry.id, studentEntry.id]);
    assert.deepEqual(await teacher.glossaryEntries(glossaryId, { pending: true }), []);
  });

  it("exportGlossaryEntries: Moodle's XML of the approved entries; refused to the student", SLOW, async () => {
    const file = await (await as("teacher")).exportGlossaryEntries(glossaryId, { destDir: dir });
    assert.ok(file.size > 0);
    exported = file.path;
    await assert.rejects((await as("student")).exportGlossaryEntries(glossaryId, { destDir: dir }), (error: Error) => error instanceof GlossaryError && /mod\/glossary:export/.test(error.message));
  });

  it("importGlossaryEntries: the export into a second glossary, with categories; again, all rejected; refused to the student", SLOW, async () => {
    const teacher = await as("teacher");
    const file = { path: exported };
    const secondId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "glossary", name: "Driver check imported", visibility: "shown" })).activityId!;
    const imported = await teacher.importGlossaryEntries(secondId, file.path, { categories: true });
    assert.deepEqual({ total: imported.total, imported: imported.imported, rejected: imported.rejected, categoriesAdded: imported.categoriesAdded }, { total: 2, imported: 2, rejected: 0, categoriesAdded: 1 });
    // The second glossary's display format is the dictionary, without a category view: no categories read.
    const entries = await teacher.glossaryEntries(secondId);
    assert.deepEqual(entries.map((e) => [e.concept, e.categoryIds, e.approved]), [["Driver check alpha", undefined, true], ["Driver check beta", undefined, true]]);
    assert.deepEqual(entries[0]!.aliases, ["first", "primero"]);
    assert.deepEqual((await teacher.glossaryCategories(secondId)).map((c) => c.name), ["Driver check category"]);
    const again = await teacher.importGlossaryEntries(secondId, file.path);
    assert.deepEqual([again.imported, again.rejected], [0, 2]);
    await assert.rejects((await as("student")).importGlossaryEntries(secondId, file.path), (error: Error) => error instanceof GlossaryError && /mod\/glossary:import/.test(error.message));
  });

  it("deleteGlossaryEntry: the student can't delete the teacher's entry; the teacher deletes both", SLOW, async () => {
    await assert.rejects((await as("student")).deleteGlossaryEntry(glossaryId, teacherEntry.id), GlossaryError);
    const teacher = await as("teacher");
    assert.equal((await teacher.deleteGlossaryEntry(glossaryId, studentEntry.id)).entryId, studentEntry.id);
    await teacher.deleteGlossaryEntry(glossaryId, teacherEntry.id);
    assert.deepEqual(await teacher.glossaryEntries(glossaryId), []);
    await assert.rejects(teacher.deleteGlossaryEntry(glossaryId, teacherEntry.id), GlossaryError);
  });
});
