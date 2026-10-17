import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  FormError,
  GlossaryError,
  MoodleError,
  NotAGlossaryError,
  addGlossaryCategory,
  addGlossaryEntry,
  deleteGlossaryEntry,
  editGlossaryEntry,
  exportGlossaryEntries,
  glossaryCategories,
  glossaryEntries,
  importGlossaryEntries,
  setGlossaryEntryApproved,
} from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { newGlossary, serveGlossary, type FakeGlossary } from "./fakeGlossary.js";

const browser = await launchTestBrowser();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-glossary-"));
  await writeFile(path.join(dir, "dot.png"), "PNG");
  await writeFile(path.join(dir, "notes.txt"), "notes");
  await writeFile(path.join(dir, "export.xml"), "<GLOSSARY/>");
});
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

const STUDENT = { id: 5, name: "Student", teacher: false };

async function site(overrides: Partial<FakeGlossary> = {}, options: { linkless?: number[] } = {}) {
  const context = await browser!.newContext();
  const g = newGlossary(overrides);
  const state = await serveGlossary(context, g, options);
  return { context, g, state };
}

const ALPHA = {
  id: 11,
  concept: "Alpha",
  definition: "<p>First</p>",
  aliases: ["a", "uno"],
  categoryIds: [7],
  authorId: 3,
  authorName: "Teacher",
  approved: true,
  attachments: [{ name: "notes.txt", url: `${SITE}pluginfile.php/300/mod_glossary/attachment/11/notes.txt`, size: 4, mimeType: "text/plain" }],
  created: "2026-10-17T16:59:15.000Z",
  modified: "2026-10-17T16:59:15.000Z",
};

describe("glossaryEntries", { skip: !browser && "no system browser" }, () => {
  it("lists what the glossary shows the person, each entry read through get_entry_by_id, with aliases and categories", async () => {
    const { context, state } = await site();
    const entries = await glossaryEntries(context, SITE, 30);
    assert.deepEqual(entries[0], ALPHA);
    // The teacher sees the approved entries and their own: not the student's waiting one.
    assert.deepEqual(entries.map((e) => [e.id, e.categoryIds]), [[11, [7]], [13, []]]);
    assert.deepEqual(state.serviceCalls?.map((c) => c.args.id), [11, 13]);
    await context.close();
  });

  it("shows a student their own entry waiting for approval", async () => {
    const { context } = await site({ user: STUDENT });
    assert.deepEqual((await glossaryEntries(context, SITE, 30)).map((e) => [e.id, e.approved]), [[11, true], [12, false], [13, true]]);
    await context.close();
  });

  it("lists the entries waiting for approval for a teacher, and refuses them to a student", async () => {
    const { context } = await site();
    assert.deepEqual((await glossaryEntries(context, SITE, 30, { pending: true })).map((e) => e.id), [12]);
    await context.close();
    const student = await site({ user: STUDENT });
    await assert.rejects(glossaryEntries(student.context, SITE, 30, { pending: true }), (error: Error) => error instanceof GlossaryError && /mod\/glossary:approve/.test(error.message));
    await student.context.close();
  });

  it("filters by letter and search, and pages across Moodle's pages", async () => {
    const { context, state } = await site({ user: STUDENT });
    assert.deepEqual((await glossaryEntries(context, SITE, 30, { letter: "g" })).map((e) => e.id), [13]);
    assert.deepEqual((await glossaryEntries(context, SITE, 30, { search: "uno" })).map((e) => e.id), [11]);
    state.pagesServed!.length = 0;
    const window = await glossaryEntries(context, SITE, 30, { offset: 1, limit: 2 });
    assert.deepEqual([window.items.map((e) => e.id), window.more], [[12, 13], false]);
    // Two a page in Moodle: offset 1 then 3, and the category view (its menu and each category).
    assert.deepEqual(state.pagesServed, ["/mod/glossary/view.php", "/mod/glossary/view.php", "/mod/glossary/view.php", "/mod/glossary/view.php"]);
    const first = await glossaryEntries(context, SITE, 30, { limit: 1 });
    assert.deepEqual([first.items.map((e) => e.id), first.more], [[11], true]);
    await context.close();
  });

  it("leaves categories out where the display format has no category view", async () => {
    const { context } = await site({ format: "dictionary" });
    assert.deepEqual((await glossaryEntries(context, SITE, 30)).map((e) => e.categoryIds), [undefined, undefined]);
    await context.close();
  });

  it("leaves out an entry the page names no id for", async () => {
    const { context } = await site({ user: STUDENT }, { linkless: [12] });
    assert.deepEqual((await glossaryEntries(context, SITE, 30)).map((e) => e.id), [11, 13]);
    await context.close();
  });

  it("refuses another module and wrong options", async () => {
    const { context, state } = await site();
    await assert.rejects(glossaryEntries(context, SITE, 99), NotAGlossaryError);
    state.pagesServed!.length = 0;
    const invalid = (error: Error) => error instanceof MoodleError && error.code === "invalid-input";
    await assert.rejects(glossaryEntries(context, SITE, 30, { letter: "ab" }), invalid);
    await assert.rejects(glossaryEntries(context, SITE, 30, { search: "x", letter: "a" }), invalid);
    await assert.rejects(glossaryEntries(context, SITE, 30, { limit: 0 }), invalid);
    assert.deepEqual(state.pagesServed, []);
    await context.close();
  });
});

describe("addGlossaryEntry", { skip: !browser && "no system browser" }, () => {
  it("fills the entry form with aliases, categories, attachments and embedded files, and reads the entry back", async () => {
    const { context, g } = await site();
    const added = await addGlossaryEntry(context, SITE, 30, {
      concept: "Delta",
      definition: '<p>Fourth <img src="dot.png"></p>',
      aliases: ["d", " four "],
      categoryIds: [7],
      attachments: [path.join(dir, "notes.txt")],
      embed: [path.join(dir, "dot.png")],
    });
    const form = g.posts.find((p) => p.path === "/mod/glossary/view.php")!.form;
    assert.equal(form.get("concept"), "Delta");
    assert.match(form.get("definition_editor[text]")!, /draftfile\.php\/9\/user\/draft\/1800\/dot\.png/);
    assert.equal(form.get("aliases"), "d\r\nfour");
    assert.deepEqual(form.getAll("categories[]"), ["7"]);
    assert.equal(form.has("cancel"), false);
    assert.deepEqual(g.drafts["800"], ["notes.txt"]);
    assert.equal(added.entryId, 100);
    assert.equal(added.changed, 'Added entry 100 "Delta" to glossary 30.');
    assert.deepEqual([added.entry?.aliases, added.entry?.categoryIds, added.entry?.attachments.map((a) => a.name)], [["d", "four"], [7], ["notes.txt"]]);
    await context.close();
  });

  it("says a student's entry waits for approval", async () => {
    const { context } = await site({ user: STUDENT });
    const added = await addGlossaryEntry(context, SITE, 30, { concept: "Epsilon", definition: "<p>Fifth</p>" });
    assert.equal(added.changed, 'Added entry 100 "Epsilon" to glossary 30, waiting for approval.');
    await context.close();
  });

  it("refuses an unknown category, a duplicate concept, and empty fields", async () => {
    const { context } = await site();
    await assert.rejects(addGlossaryEntry(context, SITE, 30, { concept: "Zeta", definition: "<p>z</p>", categoryIds: [8] }), (error: Error) => error instanceof GlossaryError && /no categories 8; it has 7/.test(error.message));
    await assert.rejects(addGlossaryEntry(context, SITE, 30, { concept: "alpha", definition: "<p>again</p>" }), FormError);
    await assert.rejects(addGlossaryEntry(context, SITE, 30, { concept: " ", definition: "<p>x</p>" }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    await assert.rejects(addGlossaryEntry(context, SITE, 99, { concept: "Zeta", definition: "<p>z</p>" }), NotAGlossaryError);
    await context.close();
  });
});

describe("editGlossaryEntry", { skip: !browser && "no system browser" }, () => {
  it("changes only what's given, replacing the attachments", async () => {
    const { context, g } = await site();
    const edited = await editGlossaryEntry(context, SITE, 30, 11, { aliases: [], attachments: [path.join(dir, "dot.png")] });
    const alpha = g.entries.find((e) => e.id === 11)!;
    assert.deepEqual([alpha.concept, alpha.aliases, alpha.categories, alpha.attachments], ["Alpha", [], [7], ["dot.png"]]);
    assert.equal(edited.changed, "Entry 11 of glossary 30: aliases set to none, 1 attachment(s) set.");
    assert.equal(edited.entry?.definition, "<p>First</p>");
    assert.equal((await editGlossaryEntry(context, SITE, 30, 11, {})).changed, "Nothing to change.");
    await context.close();
  });

  it("names the capability when a student changes someone else's entry", async () => {
    const { context } = await site({ user: STUDENT });
    await assert.rejects(editGlossaryEntry(context, SITE, 30, 11, { concept: "Mine" }), (error: Error) => error instanceof GlossaryError && /mod\/glossary:manageentries/.test(error.message) && /You cannot edit other people's entries/.test(error.message));
    await assert.rejects(editGlossaryEntry(context, SITE, 30, 77, { concept: "Mine" }), (error: Error) => error instanceof GlossaryError && /isn't in glossary 30/.test(error.message));
    await context.close();
  });
});

describe("deleteGlossaryEntry and setGlossaryEntryApproved", { skip: !browser && "no system browser" }, () => {
  it("deletes after Moodle's confirmation", async () => {
    const { context, g } = await site();
    assert.deepEqual(await deleteGlossaryEntry(context, SITE, 30, 13), { changed: "Deleted entry 13 from glossary 30.", entryId: 13 });
    assert.deepEqual(g.entries.map((e) => e.id), [11, 12]);
    assert.equal(g.posts.find((p) => p.path === "/mod/glossary/deleteentry.php")?.form.get("confirm"), "1");
    await context.close();
  });

  it("refuses a student someone else's entry", async () => {
    const { context } = await site({ user: STUDENT });
    await assert.rejects(deleteGlossaryEntry(context, SITE, 30, 11), (error: Error) => error instanceof GlossaryError && /manageentries/.test(error.message));
    await context.close();
  });

  it("approves and takes back an approval through approve.php with the sesskey", async () => {
    const { context, g } = await site();
    const approved = await setGlossaryEntryApproved(context, SITE, 30, 12, true);
    assert.deepEqual([approved.changed, approved.entry?.approved, g.entries[1]!.approved], ["Entry 12 of glossary 30 approved.", true, true]);
    assert.equal((await setGlossaryEntryApproved(context, SITE, 30, 12, true)).changed, "Entry 12 is already approved.");
    assert.equal((await setGlossaryEntryApproved(context, SITE, 30, 11, false)).entry?.approved, false);
    await context.close();
  });

  it("refuses a student, and an entry the glossary doesn't show", async () => {
    const { context } = await site({ user: STUDENT });
    await assert.rejects(setGlossaryEntryApproved(context, SITE, 30, 12, true), (error: Error) => error instanceof GlossaryError && /mod\/glossary:approve/.test(error.message));
    await assert.rejects(setGlossaryEntryApproved(context, SITE, 30, 77, true), (error: Error) => error instanceof GlossaryError && /shows you no entry 77/.test(error.message));
    await context.close();
  });
});

describe("glossary categories", { skip: !browser && "no system browser" }, () => {
  it("lists them from the category view, or from the entry form without one", async () => {
    const { context } = await site({ user: STUDENT });
    assert.deepEqual(await glossaryCategories(context, SITE, 30), [{ id: 7, name: "Animals" }]);
    await context.close();
    const dictionary = await site({ format: "dictionary" });
    assert.deepEqual(await glossaryCategories(dictionary.context, SITE, 30), [{ id: 7, name: "Animals" }]);
    assert.ok(dictionary.state.pagesServed?.includes("/mod/glossary/edit.php"));
    await dictionary.context.close();
  });

  it("adds one through the categories page; refuses a name already there", async () => {
    const { context, g } = await site();
    const added = await addGlossaryCategory(context, SITE, 30, { name: "Plants", autoLink: true });
    assert.deepEqual(added, { changed: 'Added category 51 "Plants" to glossary 30, linked automatically.', categoryId: 51, categories: [{ id: 7, name: "Animals" }, { id: 51, name: "Plants" }] });
    const form = g.posts.find((p) => p.path === "/mod/glossary/editcategories.php")!.form;
    assert.deepEqual([form.get("action"), form.get("confirm"), form.get("usedynalink"), form.get("sesskey")], ["add", "1", "1", "s1"]);
    await assert.rejects(addGlossaryCategory(context, SITE, 30, { name: "animals" }), GlossaryError);
    await context.close();
  });

  it("names the capability to a student", async () => {
    const { context } = await site({ user: STUDENT });
    await assert.rejects(addGlossaryCategory(context, SITE, 30, { name: "Plants" }), (error: Error) => error instanceof GlossaryError && /mod\/glossary:managecategories/.test(error.message));
    await context.close();
  });
});

describe("exportGlossaryEntries and importGlossaryEntries", { skip: !browser && "no system browser" }, () => {
  it("saves the export page's file", async () => {
    const { context } = await site();
    // The folder has an export.xml already: never overwritten.
    const file = await exportGlossaryEntries(context, SITE, 30, { destDir: dir });
    assert.deepEqual([file.name, file.size], ["export (2).xml", "<GLOSSARY></GLOSSARY>".length]);
    await context.close();
  });

  it("imports through the import form and reads the report", async () => {
    const { context, g } = await site();
    const result = await importGlossaryEntries(context, SITE, 30, path.join(dir, "export.xml"), { categories: true });
    assert.deepEqual(result, { changed: "Imported 2 of 3 entries into glossary 30 (1 rejected), 1 new categories.", total: 3, imported: 2, rejected: 1, categoriesAdded: 1 });
    const form = g.posts.find((p) => p.path === "/mod/glossary/import.php")!.form;
    assert.deepEqual([form.get("dest"), form.get("catsincl"), form.get("file")], ["current", "1", "555"]);
    await context.close();
  });

  it("names the capabilities to a student", async () => {
    const { context } = await site({ user: STUDENT });
    await assert.rejects(exportGlossaryEntries(context, SITE, 30, { destDir: dir }), (error: Error) => error instanceof GlossaryError && /mod\/glossary:export/.test(error.message));
    await assert.rejects(importGlossaryEntries(context, SITE, 30, path.join(dir, "export.xml")), (error: Error) => error instanceof GlossaryError && /mod\/glossary:import/.test(error.message));
    await context.close();
  });
});
