// Databases against the sandbox: a database made by the teacher on the scratch course, given its
// fields and a list template through the driver, then an entry added by the student through Moodle's
// own form; a second database given a preset. A third, needing approval, has its entries added by
// the teacher and the student through the driver, read, edited, approved, exported, imported and deleted.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { DatabaseError, MoodleError, NotADatabaseError, type DatabaseEntry, type DatabaseField, type Moodle } from "../../src/index.js";
import { SITE, as, scratchCourse, userId, type ScratchCourse } from "./harness.js";
import { pngFile, textFile } from "./packages.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

const LIST = '<div class="driver-check-entry"><span class="driver-title">[[Title]]</span> <span class="driver-colour">[[Colour]]</span> <span class="driver-born">[[Born]]</span></div>';

/** Adds an entry through the database's "Add entry" page, as the student would; the entry's id. */
async function addEntry(moodle: Moodle, activityId: number, fields: DatabaseField[]): Promise<number> {
  const id = (name: string) => fields.find((f) => f.name === name)!.id;
  const page = await (await moodle.context()).newPage();
  try {
    await page.goto(`${SITE}mod/data/edit.php?id=${activityId}`, { waitUntil: "domcontentloaded" });
    await page.fill(`[name="field_${id("Title")}"]`, "Driver check entry");
    await page.selectOption(`[name="field_${id("Colour")}"]`, "Blue");
    await page.selectOption(`[name="field_${id("Born")}_day"]`, "5");
    await page.selectOption(`[name="field_${id("Born")}_month"]`, "3");
    await page.selectOption(`[name="field_${id("Born")}_year"]`, "2001");
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('[name="saveandview"]')]);
    // Moodle lands on the entry: view.php?d=<database>&rid=<entry>.
    const rid = Number(new URL(page.url()).searchParams.get("rid"));
    assert.ok(rid > 0, `the entry wasn't added (landed on ${page.url()})`);
    return rid;
  } finally {
    await page.close();
  }
}

describe("databases", () => {
  let course: ScratchCourse;
  let databaseId: number;
  let pageId: number;
  let fields: DatabaseField[];

  before(async () => {
    course = await scratchCourse("databases");
    const teacher = await as("teacher");
    databaseId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "data", name: "Driver check database", visibility: "shown" })).activityId!;
    pageId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check page", content: "<p>x</p>", visibility: "shown" })).activityId!;
  }, SETUP);

  it("databaseFields: none in a new database; refused to the student and for another module", SLOW, async () => {
    assert.deepEqual(await (await as("teacher")).databaseFields(databaseId), []);
    await assert.rejects((await as("student")).databaseFields(databaseId), DatabaseError);
    await assert.rejects((await as("teacher")).databaseFields(pageId), NotADatabaseError);
  });

  it("databaseTemplates: refused while the database has no fields", SLOW, async () => {
    await assert.rejects((await as("teacher")).databaseTemplates(databaseId), (error: Error) => error instanceof DatabaseError && /no fields yet/.test(error.message));
  });

  it("addDatabaseField: text, menu, date and picture fields, read back as set", SLOW, async () => {
    const teacher = await as("teacher");
    await teacher.addDatabaseField(databaseId, { type: "text", name: "Title", description: "The entry's title", required: true });
    await teacher.addDatabaseField(databaseId, { type: "menu", name: "Colour", options: { choices: ["Red", "Blue"] } });
    await teacher.addDatabaseField(databaseId, { type: "date", name: "Born" });
    const added = await teacher.addDatabaseField(databaseId, { type: "picture", name: "Photo", options: { width: 320, listWidth: 80, maxBytes: 1048576 } });
    fields = added.fields;
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    assert.equal(added.fieldId, byName.Photo?.id);
    assert.deepEqual(
      fields.map(({ name, type, description, required, options }) => ({ name, type, description, required, options })),
      [
        { name: "Title", type: "text", description: "The entry's title", required: true, options: { autolink: false } },
        { name: "Colour", type: "menu", description: "", required: false, options: { choices: ["Red", "Blue"] } },
        { name: "Born", type: "date", description: "", required: false, options: {} },
        { name: "Photo", type: "picture", description: "", required: false, options: { width: 320, listWidth: 80, maxBytes: 1048576 } },
      ],
    );
    assert.deepEqual(await teacher.databaseFields(databaseId), fields);
    // Moodle's own refusals: a name already used, an image size that isn't a number (sent as Moodle's form would).
    await assert.rejects(teacher.addDatabaseField(databaseId, { type: "number", name: "Title" }), DatabaseError);
    await assert.rejects(teacher.addDatabaseField(databaseId, { type: "file", name: "Doc", options: { maxBytes: 123 } }), DatabaseError);
    await assert.rejects(teacher.addDatabaseField(databaseId, { type: "number", name: "Age", options: { choices: ["x"] } }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
  });

  it("editDatabaseField: a description and a choice added, the rest as it was", SLOW, async () => {
    const colour = fields.find((f) => f.name === "Colour")!;
    const edited = await (await as("teacher")).editDatabaseField(databaseId, colour.id, { description: "Pick one", options: { choices: ["Red", "Blue", "Green"] } });
    assert.deepEqual(edited.fields.find((f) => f.id === colour.id), { ...colour, description: "Pick one", options: { choices: ["Red", "Blue", "Green"] } });
    fields = edited.fields;
  });

  it("deleteDatabaseField: a field added for it, gone", SLOW, async () => {
    const teacher = await as("teacher");
    const { fieldId } = await teacher.addDatabaseField(databaseId, { type: "url", name: "Driver check link", options: { autolink: true, linkName: "Open", newWindow: true } });
    assert.deepEqual(fields.length + 1, (await teacher.databaseFields(databaseId)).length);
    const deleted = await teacher.deleteDatabaseField(databaseId, fieldId);
    assert.deepEqual(deleted.fields, fields);
  });

  it("setDatabaseTemplate: a list template read back as set; the single template reset to Moodle's default", SLOW, async () => {
    const teacher = await as("teacher");
    const saved = await teacher.setDatabaseTemplate(databaseId, "list", LIST);
    assert.equal(saved.templates.list, LIST);
    const defaults = await teacher.databaseTemplates(databaseId);
    assert.equal(defaults.list, LIST);
    assert.match(defaults.single, /\[\[Colour\]\]/);
    await teacher.setDatabaseTemplate(databaseId, "single", "<p>[[Title]]</p>");
    const reset = await teacher.setDatabaseTemplate(databaseId, "single", null);
    assert.equal(reset.templates.single, defaults.single);
  });

  it("databaseTemplates: an entry added by the student through Moodle's form shows the fields in the list template", SLOW, async () => {
    const student = await as("student");
    await addEntry(student, databaseId, fields);
    const page = await (await student.context()).newPage();
    try {
      await page.goto(`${SITE}mod/data/view.php?id=${databaseId}`, { waitUntil: "domcontentloaded" });
      const entry = page.locator(".driver-check-entry");
      assert.equal(await entry.count(), 1);
      assert.equal((await entry.locator(".driver-title").textContent())?.trim(), "Driver check entry");
      assert.equal((await entry.locator(".driver-colour").textContent())?.trim(), "Blue");
      assert.match((await entry.locator(".driver-born").textContent()) ?? "", /2001/);
    } finally {
      await page.close();
    }
  });

  it("databasePresets: Moodle's own, by the id applyDatabasePreset takes", SLOW, async () => {
    const presets = await (await as("teacher")).databasePresets(databaseId);
    assert.ok(presets.some((p) => p.id === "0/imagegallery" && p.name && p.userId === undefined), JSON.stringify(presets));
  });

  it("applyDatabasePreset: the image gallery's fields and templates on a second database; an unknown preset refused", SLOW, async () => {
    const teacher = await as("teacher");
    const galleryId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "data", name: "Driver check gallery", visibility: "shown" })).activityId!;
    await assert.rejects(teacher.applyDatabasePreset(galleryId, "0/nonsense"), (error: Error) => error instanceof MoodleError && error.code === "not-found");
    const applied = await teacher.applyDatabasePreset(galleryId, "0/imagegallery");
    assert.ok(applied.fields.some((f) => f.type === "picture"), JSON.stringify(applied.fields));
    assert.deepEqual(await teacher.databaseFields(galleryId), applied.fields);
    assert.ok((await teacher.databaseTemplates(galleryId)).list.includes("[["));
  });
});

describe("database entries", () => {
  let databaseId: number;
  let fields: DatabaseField[];
  let studentEntry: number;
  let teacherEntry: number;
  const id = (name: string) => String(fields.find((f) => f.name === name)!.id);
  const valuesOf = (entry: DatabaseEntry | undefined) => Object.fromEntries((entry?.values ?? []).map((v) => [v.name ?? v.fieldId, v.value]));

  before(async () => {
    const course = await scratchCourse("entries");
    const teacher = await as("teacher");
    databaseId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "data", name: "Driver check entries", visibility: "shown", settings: { approval: 1 } })).activityId!;
    await teacher.addDatabaseField(databaseId, { type: "text", name: "Title", required: true });
    await teacher.addDatabaseField(databaseId, { type: "menu", name: "Colour", options: { choices: ["Red", "Blue"] } });
    await teacher.addDatabaseField(databaseId, { type: "date", name: "Born" });
    fields = (await teacher.addDatabaseField(databaseId, { type: "picture", name: "Photo" })).fields;
  }, SETUP);

  it("databaseEntries: none in a new database", SLOW, async () => {
    assert.deepEqual(await (await as("teacher")).databaseEntries(databaseId), []);
  });

  it("addDatabaseEntry: the student's with a picture, by field name; the teacher's by field id; what the form doesn't take refused", SLOW, async () => {
    const student = await as("student");
    await assert.rejects(student.addDatabaseEntry(databaseId, { Title: "x", Colour: "Green" }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input" && /offers "Red", "Blue"/.test(error.message));
    await assert.rejects(student.addDatabaseEntry(databaseId, { Nope: "x" }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    // Moodle's own refusal: the required title missing.
    await assert.rejects(student.addDatabaseEntry(databaseId, { Colour: "Red" }), DatabaseError);
    studentEntry = (await student.addDatabaseEntry(databaseId, { Title: "Driver check student", Colour: "Blue", [id("Born")]: "2001-03-05", Photo: pngFile("photo.png") })).entryId;
    teacherEntry = (await (await as("teacher")).addDatabaseEntry(databaseId, { [id("Title")]: "Driver check teacher", [id("Colour")]: "Red" })).entryId;
    assert.ok(studentEntry > 0 && teacherEntry > studentEntry);
  });

  it("databaseEntries: the teacher reads both with their values; the student, the values of their own; search and paging", SLOW, async () => {
    const teacher = await as("teacher");
    const entries = await teacher.databaseEntries(databaseId);
    const mine = entries.find((e) => e.id === studentEntry);
    assert.equal(mine?.author?.userId, await userId("student"));
    assert.equal(mine?.approved, false);
    assert.ok(mine?.created && mine.modified && Math.abs(Date.parse(mine.created) - Date.now()) < 3_600_000, JSON.stringify(mine));
    const values = valuesOf(mine);
    assert.deepEqual([values.Title, values.Colour, values.Born], ["Driver check student", "Blue", "2001-03-05"]);
    assert.match(JSON.stringify(values.Photo), /"name":"photo\.png","url":"http:\/\/localhost:8080\/pluginfile\.php\/\d+\/mod_data\/content\/\d+\/photo\.png"/);
    assert.equal(entries.find((e) => e.id === teacherEntry)?.approved, true, "the teacher's own entries need no approval");
    const seen = await (await as("student")).databaseEntries(databaseId);
    assert.deepEqual(seen.map((e) => e.id).sort(), [studentEntry, teacherEntry].sort());
    assert.equal(seen.find((e) => e.id === teacherEntry)?.values, undefined);
    assert.equal(valuesOf(seen.find((e) => e.id === studentEntry)).Title, "Driver check student");
    assert.deepEqual((await teacher.databaseEntries(databaseId, { search: "Driver check teacher" })).map((e) => e.id), [teacherEntry]);
    const page = await teacher.databaseEntries(databaseId, { limit: 1 });
    assert.deepEqual([page.items.length, page.more], [1, true]);
  });

  it("editDatabaseEntry: the student's colour, the rest as it was; the teacher's refused to the student", SLOW, async () => {
    await (await as("student")).editDatabaseEntry(databaseId, studentEntry, { Colour: "Red" });
    await assert.rejects((await as("student")).editDatabaseEntry(databaseId, teacherEntry, { Colour: "Blue" }), DatabaseError);
    const values = valuesOf((await (await as("teacher")).databaseEntries(databaseId)).find((e) => e.id === studentEntry));
    assert.deepEqual([values.Title, values.Colour], ["Driver check student", "Red"]);
    assert.match(JSON.stringify(values.Photo), /photo\.png/);
  });

  it("setDatabaseEntryApproved: refused to the student; approved by the teacher, taken back", SLOW, async () => {
    await assert.rejects((await as("student")).setDatabaseEntryApproved(databaseId, studentEntry, true), DatabaseError);
    const teacher = await as("teacher");
    await teacher.setDatabaseEntryApproved(databaseId, studentEntry, true);
    assert.equal((await teacher.databaseEntries(databaseId)).find((e) => e.id === studentEntry)?.approved, true);
    await teacher.setDatabaseEntryApproved(databaseId, studentEntry, false);
    assert.equal((await teacher.databaseEntries(databaseId)).find((e) => e.id === studentEntry)?.approved, false);
  });

  it("exportDatabaseEntries: a CSV of both entries with their times and approval; refused to the student", SLOW, async () => {
    const file = textFile("driver-check-export.csv", "");
    assert.equal((await (await as("teacher")).exportDatabaseEntries(databaseId, file, { times: true, approval: true })).entries, 2);
    const [header, ...rows] = readFileSync(file, "utf8").trim().split("\n");
    assert.match(header!, /^Title,Colour,Born,Photo,/);
    assert.ok(rows.some((row) => row.startsWith('"Driver check student",Red,')), rows.join("\n"));
    await assert.rejects((await as("student")).exportDatabaseEntries(databaseId, file), DatabaseError);
  });

  it("importDatabaseEntries: an entry from a CSV, then deleted; refused to the student", SLOW, async () => {
    const file = textFile("driver-check-import.csv", "Title,Colour\nDriver check imported,Blue\n");
    await assert.rejects((await as("student")).importDatabaseEntries(databaseId, file), DatabaseError);
    const teacher = await as("teacher");
    assert.equal((await teacher.importDatabaseEntries(databaseId, file)).added, 1);
    const [imported] = await teacher.databaseEntries(databaseId, { search: "Driver check imported" });
    assert.equal(valuesOf(imported).Colour, "Blue");
    await teacher.deleteDatabaseEntry(databaseId, imported!.id);
  });

  it("deleteDatabaseEntry: the teacher's refused to the student; both deleted by the teacher", SLOW, async () => {
    await assert.rejects((await as("student")).deleteDatabaseEntry(databaseId, teacherEntry), DatabaseError);
    const teacher = await as("teacher");
    await teacher.deleteDatabaseEntry(databaseId, studentEntry);
    await teacher.deleteDatabaseEntry(databaseId, teacherEntry);
    assert.deepEqual(await teacher.databaseEntries(databaseId), []);
  });
});
