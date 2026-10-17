import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { DatabaseError, MoodleError, applyDatabasePreset, databasePresets, databaseTemplates, setDatabaseTemplate, type DatabaseTemplate } from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { newDatabase, serveDatabase, type FakeField } from "./fakeDatabase.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const TITLE: FakeField = { id: 11, type: "text", name: "Title", description: "", required: false, params: {} };

describe("databaseTemplates", { skip: !browser && "no system browser" }, () => {
  it("reads every template from its page's editors, Moodle's default where none was saved", async () => {
    const context = await browser!.newContext();
    await serveDatabase(context, newDatabase({ fields: [TITLE], templates: { listtemplate: '<div class="x">[[Title]] & ##more##</div>', csstemplate: ".x { color: red; }" } }));
    assert.deepEqual(await databaseTemplates(context, SITE, 40), {
      list: '<div class="x">[[Title]] & ##more##</div>',
      listHeader: "",
      listFooter: "",
      single: '<div class="default-singletemplate">[[Title]]</div>',
      add: '<div class="default-addtemplate">[[Title]]</div>',
      search: '<div class="default-asearchtemplate">[[Title]]</div>',
      rss: '<div class="default-rsstemplate">[[Title]]</div>',
      rssTitle: "",
      css: ".x { color: red; }",
      js: "",
    });
    await context.close();
  });

  it("refuses a database without fields: Moodle has no templates for it", async () => {
    const context = await browser!.newContext();
    await serveDatabase(context, newDatabase());
    await assert.rejects(databaseTemplates(context, SITE, 40), (error: Error) => error instanceof DatabaseError && /has no fields yet/.test(error.message));
    await context.close();
  });
});

describe("setDatabaseTemplate", { skip: !browser && "no system browser" }, () => {
  it("posts the template as it is, and resets one by saving it empty", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ fields: [TITLE], templates: { singletemplate: "<p>old</p>" } });
    await serveDatabase(context, db);
    const html = '<table><tr><td>[[Title]]</td><td>##edit##</td></tr></table>\n<script>x < 1</script>';
    const saved = await setDatabaseTemplate(context, SITE, 40, "list", html);
    assert.equal(db.posts[0]?.path, "/mod/data/templates.php");
    assert.deepEqual(Object.fromEntries(db.posts[0]!.form), { sesskey: "s1", listtemplate: html });
    assert.equal(saved.changed, "Saved database 40's list template.");
    assert.equal(saved.templates.list, html);
    const reset = await setDatabaseTemplate(context, SITE, 40, "single", null);
    assert.deepEqual(Object.fromEntries(db.posts[1]!.form), { sesskey: "s1", singletemplate: "" });
    assert.equal(reset.changed, "Reset database 40's single template to Moodle's default.");
    assert.equal(reset.templates.single, '<div class="default-singletemplate">[[Title]]</div>');
    await context.close();
  });

  it("refuses an unknown template, and one Moodle didn't keep", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ fields: [TITLE] });
    const state = await serveDatabase(context, db);
    await assert.rejects(setDatabaseTemplate(context, SITE, 40, "header" as DatabaseTemplate, "x"), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    assert.deepEqual(state.pagesServed, []);
    // Moodle answers "saved" but keeps the old one, as with an add entry template with a tag twice.
    await context.route(`${SITE}mod/data/templates.php**`, (route) => (route.request().method() === "POST" ? route.fulfill({ status: 200, contentType: "text/html", body: "<html><body><div class='alert alert-success'>Template saved</div></body></html>" }) : route.fallback()));
    await assert.rejects(setDatabaseTemplate(context, SITE, 40, "add", "[[Title]][[Title]]"), (error: Error) => error instanceof DatabaseError && /didn't keep database 40's add template: an add entry template can't have a field's tag twice/.test(error.message));
    await context.close();
  });
});

describe("databasePresets", { skip: !browser && "no system browser" }, () => {
  it("lists Moodle's own presets and those saved by people, by the id Moodle takes", async () => {
    const context = await browser!.newContext();
    await serveDatabase(context, newDatabase());
    assert.deepEqual(await databasePresets(context, SITE, 40), [
      { id: "0/imagegallery", name: "Image gallery", description: "Use this preset to collect images." },
      { id: "0/journal", name: "Journal", description: "Use this preset for a journal." },
      { id: "7/Shared by Ana", name: "Shared by Ana", description: "", userId: 7 },
    ]);
    await context.close();
  });
});

describe("applyDatabasePreset", { skip: !browser && "no system browser" }, () => {
  it("applies it without mapping the fields, as Apply preset does", async () => {
    const context = await browser!.newContext();
    const db = newDatabase({ fields: [{ ...TITLE, name: "title" }, { id: 12, type: "number", name: "Age", description: "", required: false, params: {} }] });
    await serveDatabase(context, db);
    const applied = await applyDatabasePreset(context, SITE, 40, "0/imagegallery");
    assert.deepEqual(db.applied, ["0/imagegallery"]);
    assert.equal(applied.changed, 'Applied the preset "Image gallery" to database 40: 2 fields now.');
    assert.deepEqual(applied.fields.map((f) => [f.id, f.name, f.type]), [[11, "title", "text"], [91, "image", "picture"]]);
    await context.close();
  });

  it("refuses a preset the presets page doesn't list", async () => {
    const context = await browser!.newContext();
    const db = newDatabase();
    await serveDatabase(context, db);
    await assert.rejects(applyDatabasePreset(context, SITE, 40, "imagegallery"), (error: Error) => error instanceof MoodleError && error.code === "not-found" && /0\/imagegallery \(Image gallery\)/.test(error.message));
    assert.deepEqual(db.applied, []);
    await context.close();
  });
});
