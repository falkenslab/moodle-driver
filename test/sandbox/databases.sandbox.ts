// Databases against the sandbox: a database made by the teacher on the scratch course, given its
// fields and a list template through the driver, then an entry added by the student through Moodle's
// own form; a second database given a preset.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { DatabaseError, MoodleError, NotADatabaseError, type DatabaseField, type Moodle } from "../../src/index.js";
import { SITE, as, scratchCourse, type ScratchCourse } from "./harness.js";

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
