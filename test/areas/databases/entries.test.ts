import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { DatabaseError, MoodleError, NotADatabaseError, addDatabaseEntry, databaseEntries, deleteDatabaseEntry, editDatabaseEntry, exportDatabaseEntries, importDatabaseEntries, setDatabaseEntryApproved } from "../../../src/index.js";
import { csvRecords } from "../../../src/areas/databases/entries.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { FIELD, newEntries, serveEntries, type FakeEntries } from "./fakeEntries.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const dir = mkdtempSync(path.join(tmpdir(), "driver-entries-"));
const photo = path.join(dir, "dog.png");
writeFileSync(photo, "png");

async function site(overrides: Partial<FakeEntries> = {}) {
  const context = await browser!.newContext();
  const db = newEntries(overrides);
  const state = await serveEntries(context, db);
  return { context, db, state };
}

const posted = (db: FakeEntries, at = 0) => db.posts[at]!.form;
const valuesOf = (form: [string, string][], name: string) => form.filter(([n]) => n === name).map(([, v]) => v);

describe("databaseEntries", { skip: !browser && "no system browser" }, () => {
  it("reads each entry's author, dates, approval and, where the person can edit it, its values", async () => {
    const { context } = await site();
    const [first, second] = await databaseEntries(context, SITE, 40);
    assert.deepEqual(first, {
      id: 21,
      author: { userId: 5, name: "Ana Ruiz" },
      // Madrid is UTC+2 in October.
      created: "2026-10-16T07:15:00.000Z",
      modified: "2026-10-17T08:05:00.000Z",
      approved: false,
      values: [
        { fieldId: FIELD.TITLE, name: "Title", value: "First" },
        { fieldId: FIELD.COLOUR, name: "Colour", value: "Blue" },
        { fieldId: FIELD.BORN, name: "Born", value: "2001-03-05" },
        { fieldId: FIELD.TAGS, name: "Tags", value: ["b"] },
        { fieldId: FIELD.PHOTO, name: "Photo", value: [{ name: "cat.png", url: `${SITE}pluginfile.php/77/mod_data/content/210/cat.png` }] },
      ],
    });
    assert.deepEqual(second, { id: 22, author: { userId: 3, name: "Teacher" }, created: "2026-10-17T09:00:00.000Z", modified: "2026-10-17T09:00:00.000Z", approved: true });
    await context.close();
  });

  it("pages through the list's own pages, and searches with Moodle's simple search", async () => {
    const { context, db } = await site({ perPage: 2 });
    db.entries.push({ ...db.entries[1]!, id: 23, values: { [FIELD.TITLE]: "Third" } });
    assert.deepEqual((await databaseEntries(context, SITE, 40)).map((e) => e.id), [21, 22, 23]);
    const page = await databaseEntries(context, SITE, 40, { limit: 1, offset: 2 });
    assert.deepEqual([page.items.map((e) => e.id), page.more], [[23], false]);
    db.lists.length = 0;
    assert.deepEqual((await databaseEntries(context, SITE, 40, { search: "Third" })).map((e) => e.id), [23]);
    assert.deepEqual([db.lists[0]?.get("filter"), db.lists[0]?.get("search")], ["1", "Third"]);
    await assert.rejects(databaseEntries(context, SITE, 40, { limit: 0 }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    await context.close();
  });

  it("is empty without entries, and tells another module from a database", async () => {
    const { context } = await site({ entries: [] });
    assert.deepEqual(await databaseEntries(context, SITE, 40), []);
    await assert.rejects(databaseEntries(context, SITE, 41), NotADatabaseError);
    await context.close();
  });
});

describe("addDatabaseEntry", { skip: !browser && "no system browser" }, () => {
  it("fills the form by field name or id, uploads the picture to its draft area, and gives the new entry's id", async () => {
    const { context, db } = await site();
    const added = await addDatabaseEntry(context, SITE, 40, { Title: "New", [String(FIELD.COLOUR)]: "Red", Born: new Date(2001, 2, 5), Tags: ["a", "b"], Photo: photo });
    assert.deepEqual(added, { changed: "Added entry 23 to database 40.", entryId: 23 });
    const form = posted(db);
    assert.deepEqual(valuesOf(form, `field_${FIELD.TITLE}`), ["New"]);
    assert.deepEqual(valuesOf(form, `field_${FIELD.COLOUR}`), ["Red"]);
    assert.deepEqual([valuesOf(form, `field_${FIELD.BORN}_day`), valuesOf(form, `field_${FIELD.BORN}_month`), valuesOf(form, `field_${FIELD.BORN}_year`)], [["5"], ["3"], ["2001"]]);
    assert.deepEqual(valuesOf(form, `field_${FIELD.TAGS}[]`), ["", "", "a", "b"]);
    assert.deepEqual([valuesOf(form, "d"), valuesOf(form, "rid"), valuesOf(form, "sesskey"), valuesOf(form, "saveandview"), valuesOf(form, "saveandadd")], [["400"], ["0"], ["s1"], ["1"], []]);
    assert.deepEqual(db.uploads, ["900:dog.png"]);
    assert.equal(db.entries.at(-1)?.values[FIELD.PHOTO], "dog.png");
    await context.close();
  });

  it("refuses a field the form hasn't and a value it doesn't take, before posting anything", async () => {
    const { context, db } = await site();
    const invalid = (pattern: RegExp) => (error: Error) => error instanceof MoodleError && error.code === "invalid-input" && pattern.test(error.message);
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Nope: "x" }), invalid(/no field "Nope": its fields are 11 "Title", 12 "Colour", 13 "Born", 14 "Tags", 15 "Photo"/));
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Colour: "Green" }), invalid(/Field 12 "Colour" doesn't take "Green": it offers "Red", "Blue"/));
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Tags: ["c"] }), invalid(/offers "a", "b"/));
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Born: "5/3/2001" }), invalid(/is a date/));
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Photo: "dog.png" }), invalid(/absolute path/));
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Title: ["a"] }), invalid(/takes one value/));
    assert.deepEqual(db.posts, []);
    await context.close();
  });

  it("gives Moodle's reasons when it refuses the entry or the person", async () => {
    const { context } = await site();
    await assert.rejects(addDatabaseEntry(context, SITE, 40, { Colour: "Red" }), (error: Error) => error instanceof DatabaseError && /: You must supply a value here\.$/.test(error.message));
    await context.close();
    const refused = await site({ can: { add: false, approve: false, manage: false, export: false } });
    await assert.rejects(addDatabaseEntry(refused.context, SITE, 40, { Title: "x" }), (error: Error) => error instanceof DatabaseError && /mod\/data:writeentry/.test(error.message));
    await refused.context.close();
  });
});

describe("editDatabaseEntry", { skip: !browser && "no system browser" }, () => {
  it("changes what's given; the rest is posted as the form has it, the picture kept", async () => {
    const { context, db } = await site();
    const edited = await editDatabaseEntry(context, SITE, 40, 21, { Colour: "Red" });
    assert.deepEqual(edited, { changed: "Changed entry 21 of database 40.", entryId: 21 });
    const form = posted(db);
    assert.deepEqual([valuesOf(form, "rid"), valuesOf(form, `field_${FIELD.TITLE}`), valuesOf(form, `field_${FIELD.COLOUR}`), valuesOf(form, `field_${FIELD.TAGS}[]`)], [["21"], ["First"], ["Red"], ["", "", "b"]]);
    assert.equal(db.entries[0]?.values[FIELD.PHOTO], "cat.png");
    assert.deepEqual(db.uploads, []);
    await context.close();
  });

  it("replaces or removes a file, and names the capability when Moodle refuses the entry", async () => {
    const { context, db } = await site();
    await editDatabaseEntry(context, SITE, 40, 21, { Photo: photo });
    assert.equal(db.entries[0]?.values[FIELD.PHOTO], "dog.png");
    await editDatabaseEntry(context, SITE, 40, 21, { Photo: null });
    assert.equal(db.entries[0]?.values[FIELD.PHOTO], undefined);
    await assert.rejects(editDatabaseEntry(context, SITE, 40, 22, { Title: "x" }), (error: Error) => error instanceof DatabaseError && /mod\/data:manageentries/.test(error.message));
    await context.close();
  });
});

describe("deleteDatabaseEntry", { skip: !browser && "no system browser" }, () => {
  it("deletes it as its confirmation does, and says when Moodle didn't", async () => {
    const { context, db } = await site({ can: { add: true, approve: false, manage: false, export: false } });
    assert.deepEqual(await deleteDatabaseEntry(context, SITE, 40, 21), { changed: "Deleted entry 21 of database 40." });
    assert.deepEqual(Object.fromEntries(posted(db)), { id: "40", delete: "21", confirm: "1", sesskey: "s1" });
    assert.deepEqual(db.entries.map((e) => e.id), [22]);
    await assert.rejects(deleteDatabaseEntry(context, SITE, 40, 22), (error: Error) => error instanceof DatabaseError && /mod\/data:manageentries/.test(error.message));
    await context.close();
  });
});

describe("setDatabaseEntryApproved", { skip: !browser && "no system browser" }, () => {
  it("approves an entry and takes it back; refused without mod/data:approve", async () => {
    const { context, db } = await site();
    assert.deepEqual(await setDatabaseEntryApproved(context, SITE, 40, 21, true), { changed: "Approved entry 21 of database 40.", approved: true });
    assert.equal(db.entries[0]?.approved, true);
    await setDatabaseEntryApproved(context, SITE, 40, 21, false);
    assert.equal(db.entries[0]?.approved, false);
    db.can.approve = false;
    await assert.rejects(setDatabaseEntryApproved(context, SITE, 40, 21, true), (error: Error) => error instanceof DatabaseError && /mod\/data:approve/.test(error.message));
    await context.close();
  });
});

describe("exportDatabaseEntries", { skip: !browser && "no system browser" }, () => {
  it("writes the CSV Moodle exports with a comma, without files, with the columns asked for", async () => {
    const { context, db } = await site();
    const file = path.join(dir, "export.csv");
    assert.deepEqual(await exportDatabaseEntries(context, SITE, 40, file, { times: true }), { file, entries: 2 });
    assert.equal(readFileSync(file, "utf8"), 'Title,Colour,"Time added"\nFirst,Blue,"Friday, 16 October 2026, 9:15 AM"\nSecond,Red,"Saturday, 17 October 2026, 11:00 AM"\n');
    const form = Object.fromEntries(posted(db));
    assert.deepEqual([form.exporttype, form.delimiter_name, form.exporttime, form.includefiles, form.cancel, form.exportapproval], ["csv", "comma", "1", undefined, undefined, undefined]);
    db.can.export = false;
    await assert.rejects(exportDatabaseEntries(context, SITE, 40, file), (error: Error) => error instanceof DatabaseError && /mod\/data:viewalluserpresets/.test(error.message));
    await assert.rejects(exportDatabaseEntries(context, SITE, 40, "export.csv"), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    await context.close();
  });

  it("counts a CSV's records, line breaks in quotes and all", () => {
    assert.equal(csvRecords('a,b\n"x\ny",2\r\n3,4'), 2);
    assert.equal(csvRecords("a,b\n"), 0);
  });
});

describe("importDatabaseEntries", { skip: !browser && "no system browser" }, () => {
  it("uploads the CSV to the import form and gives how many entries Moodle added", async () => {
    const { context, db } = await site();
    const file = path.join(dir, "import.csv");
    writeFileSync(file, "Title,Colour\nImported,Red\n");
    assert.deepEqual(await importDatabaseEntries(context, SITE, 40, file), { changed: "Imported 1 entry into database 40 from import.csv.", added: 1 });
    assert.deepEqual(db.uploads, ["555:import.csv"]);
    db.can.manage = false;
    await assert.rejects(importDatabaseEntries(context, SITE, 40, file), (error: Error) => error instanceof DatabaseError && /mod\/data:manageentries/.test(error.message));
    await context.close();
  });
});
