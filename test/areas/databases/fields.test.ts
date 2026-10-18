import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { DatabaseError, MoodleError, NotADatabaseError, addDatabaseField, databaseFields, deleteDatabaseField, editDatabaseField, type DatabaseFieldInput, type DatabaseFieldOptions } from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { newDatabase, serveDatabase } from "./fakeDatabase.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** Each core type with options, what Moodle's form posts for them, and what reading the field gives back. */
const TYPES: { input: DatabaseFieldInput; posted: Record<string, string | string[]>; read: DatabaseFieldOptions }[] = [
  { input: { type: "text", name: "Title", required: true, options: { autolink: true } }, posted: { param1: "1", required: "on" }, read: { autolink: true } },
  { input: { type: "textarea", name: "Notes", options: { columns: 80, rows: 10 } }, posted: { param2: "80", param3: "10", param4: "1", param5: "0" }, read: { columns: 80, rows: 10, maxBytes: 0 } },
  { input: { type: "number", name: "Age" }, posted: {}, read: {} },
  { input: { type: "date", name: "Born", description: "When" }, posted: { description: "When" }, read: {} },
  { input: { type: "menu", name: "Colour", options: { choices: ["Red", " Blue ", ""] } }, posted: { param1: "Red\nBlue" }, read: { choices: ["Red", "Blue"] } },
  { input: { type: "radiobutton", name: "Size", options: { choices: ["S", "M"] } }, posted: { param1: "S\nM" }, read: { choices: ["S", "M"] } },
  { input: { type: "checkbox", name: "Tags", options: { choices: ["a", "b"] } }, posted: { param1: "a\nb" }, read: { choices: ["a", "b"] } },
  { input: { type: "multimenu", name: "Langs", options: { choices: ["es", "en"] } }, posted: { param1: "es\nen" }, read: { choices: ["es", "en"] } },
  { input: { type: "url", name: "Site", options: { autolink: true, linkName: "Visit", newWindow: true } }, posted: { param1: "on", param2: "Visit", param3: "on" }, read: { autolink: true, linkName: "Visit", newWindow: true } },
  { input: { type: "file", name: "Doc", options: { maxBytes: 1048576 } }, posted: { param3: "1048576" }, read: { maxBytes: 1048576 } },
  { input: { type: "picture", name: "Photo", options: { width: 400, listWidth: 100, maxBytes: 512000 } }, posted: { param1: "400", param2: "", param4: "100", param5: "", param3: "512000" }, read: { width: 400, listWidth: 100, maxBytes: 512000 } },
  { input: { type: "latlong", name: "Where", options: { services: ["Google Maps", "OpenStreetMap"], kmlLabel: "coordinates" } }, posted: { "param1[]": ["Google Maps", "OpenStreetMap"], param2: "-2" }, read: { services: ["Google Maps", "OpenStreetMap"], kmlLabel: "coordinates" } },
];

describe("addDatabaseField", { skip: !browser && "no system browser" }, () => {
  for (const { input, posted, read } of TYPES) {
    it(`adds a ${input.type} field with its options, read back from its edit form`, async () => {
      const context = await browser!.newContext();
      const db = newDatabase();
      await serveDatabase(context, db);
      const added = await addDatabaseField(context, SITE, 40, input);
      const [post] = db.posts;
      assert.equal(post?.form.get("mode"), "add");
      assert.equal(post?.form.get("type"), input.type);
      assert.equal(post?.form.get("name"), input.name);
      for (const [name, value] of Object.entries(posted)) assert.deepEqual(Array.isArray(value) ? post?.form.getAll(name) : post?.form.get(name), value, name);
      if (!input.required) assert.equal(post?.form.has("required"), false);
      assert.equal(post?.form.has("cancel"), false, "Cancel isn't sent: Moodle would cancel");
      assert.equal(added.fieldId, 11);
      assert.equal(added.changed, `Added the ${input.type} field "${input.name}" (11) to database 40.`);
      assert.deepEqual(added.fields, [{ id: 11, name: input.name, type: input.type, description: input.description ?? "", required: input.required ?? false, options: read }]);
      await context.close();
    });
  }

  it("refuses what Moodle's forms wouldn't take before opening anything", async () => {
    const context = await browser!.newContext();
    const db = newDatabase();
    const state = await serveDatabase(context, db);
    const invalid = (pattern: RegExp) => (error: Error) => error instanceof MoodleError && error.code === "invalid-input" && pattern.test(error.message);
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "rating" as "text", name: "X" }), invalid(/isn't a database field type/));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "number", name: "X", options: { choices: ["a"] } }), invalid(/doesn't take the option "choices": it takes none/));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "text", name: "X", options: { columns: 3 } }), invalid(/it takes autolink/));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "menu", name: "X" }), invalid(/needs its choices/));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "date", name: "X", required: true }), invalid(/can't be required/));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "picture", name: "X", options: { width: -1 } }), invalid(/whole number/));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "text", name: " " }), invalid(/a name/));
    assert.deepEqual(state.pagesServed, []);
    await context.close();
  });

  it("gives Moodle's reason when it refuses the field, and refuses a size its form doesn't offer", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ fields: [{ id: 11, type: "text", name: "Title", description: "", required: false, params: {} }] });
    await serveDatabase(context, db);
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "number", name: "Title" }), (error: Error) => error instanceof DatabaseError && /: Please choose another name for this field$/.test(error.message));
    await assert.rejects(addDatabaseField(context, SITE, 40, { type: "file", name: "Doc", options: { maxBytes: 123 } }), (error: Error) => error instanceof DatabaseError && /param3: 123 \(it offers 0, 209715200/.test(error.message));
    assert.equal(db.posts.length, 1, "nothing is posted for a size the form doesn't offer");
    await context.close();
  });

  it("tells a database it can't manage from an activity that isn't one", async () => {
    const context = await browser!.newContext();
    await serveDatabase(context, newDatabase({ refused: true }));
    await assert.rejects(databaseFields(context, SITE, 40), (error: Error) => error instanceof DatabaseError && /mod\/data:managetemplates/.test(error.message) && /Manage templates/.test(error.message));
    await assert.rejects(databaseFields(context, SITE, 41), (error: Error) => error instanceof NotADatabaseError && error.code === "not-a-database" && /Invalid course module ID/.test(error.message));
    await context.close();
  });
});

describe("databaseFields", { skip: !browser && "no system browser" }, () => {
  it("lists each field from its edit form, in order; one of a missing plugin by its row", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({
      fields: [
        { id: 12, type: "menu", name: "Colour", description: "Pick one", required: true, params: { param1: "Red\nBlue" } },
        { id: 11, type: "latlong", name: "Where", description: "", required: false, params: { param1: "Geabios", param2: "14" } },
        { id: 14, type: "text", name: "Place", description: "", required: false, params: {} },
        { id: 13, type: "unknown", name: "Old", description: "", required: false, params: {} },
      ],
    });
    await serveDatabase(context, db);
    assert.deepEqual(await databaseFields(context, SITE, 40), [
      { id: 12, name: "Colour", type: "menu", description: "Pick one", required: true, options: { choices: ["Red", "Blue"] } },
      { id: 11, name: "Where", type: "latlong", description: "", required: false, options: { services: ["Geabios"], kmlLabel: 14 } },
      { id: 14, name: "Place", type: "text", description: "", required: false, options: { autolink: false } },
      { id: 13, name: "Old", type: "unknown", description: "", required: false, options: {} },
    ]);
    await context.close();
  });

  it("is empty for a database without fields", async () => {
    const context = await browser!.newContext();
    await serveDatabase(context, newDatabase());
    assert.deepEqual(await databaseFields(context, SITE, 40), []);
    await context.close();
  });
});

describe("editDatabaseField", { skip: !browser && "no system browser" }, () => {
  it("changes what's given and posts the rest as the form has it", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ fields: [{ id: 11, type: "textarea", name: "Notes", description: "Long", required: true, params: { param2: "60", param3: "35", param4: "1", param5: "0" } }] });
    await serveDatabase(context, db);
    const edited = await editDatabaseField(context, SITE, 40, 11, { name: "Remarks", required: false, options: { rows: 5 } });
    const post = db.posts[0]!.form;
    assert.deepEqual([post.get("mode"), post.get("fid"), post.get("name"), post.get("description"), post.has("required"), post.get("param2"), post.get("param3")], ["update", "11", "Remarks", "Long", false, "60", "5"]);
    assert.equal(edited.changed, 'Changed the textarea field "Remarks" (11) of database 40.');
    assert.deepEqual(edited.fields[0]?.options, { columns: 60, rows: 5, maxBytes: 0 });
    await context.close();
  });

  it("knows a field's type from Moodle 4.5's fields page, its icon a font icon", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ moodle45: true, fields: [{ id: 11, type: "textarea", name: "Notes", description: "Long", required: true, params: { param2: "60", param3: "35", param4: "1", param5: "0" } }] });
    await serveDatabase(context, db);
    const edited = await editDatabaseField(context, SITE, 40, 11, { options: { rows: 5 } });
    assert.equal(edited.changed, 'Changed the textarea field "Notes" (11) of database 40.');
    assert.equal(db.posts[0]!.form.get("param3"), "5");
    await context.close();
  });

  it("refuses a field the database hasn't and an option its type doesn't take", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ fields: [{ id: 11, type: "number", name: "Age", description: "", required: false, params: {} }] });
    await serveDatabase(context, db);
    await assert.rejects(editDatabaseField(context, SITE, 40, 99, { name: "X" }), (error: Error) => error instanceof MoodleError && error.code === "not-found" && /its fields are 11 "Age"/.test(error.message));
    await assert.rejects(editDatabaseField(context, SITE, 40, 11, { options: { choices: ["a"] } }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    assert.equal(db.posts.length, 0);
    await context.close();
  });
});

describe("deleteDatabaseField", { skip: !browser && "no system browser" }, () => {
  it("deletes it as its confirmation does", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({
      fields: [
        { id: 11, type: "text", name: "Title", description: "", required: false, params: {} },
        { id: 12, type: "number", name: "Age", description: "", required: false, params: {} },
      ],
    });
    await serveDatabase(context, db);
    const deleted = await deleteDatabaseField(context, SITE, 40, 11);
    assert.deepEqual(Object.fromEntries(db.posts[0]!.form), { id: "40", mode: "delete", fid: "11", confirm: "1", sesskey: "s1" });
    assert.equal(deleted.changed, 'Deleted the text field "Title" (11) of database 40.');
    assert.deepEqual(deleted.fields.map((f) => f.id), [12]);
    await assert.rejects(deleteDatabaseField(context, SITE, 40, 11), (error: Error) => error instanceof MoodleError && error.code === "not-found");
    await context.close();
  });
});
