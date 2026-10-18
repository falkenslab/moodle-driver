import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { GradebookError, exportGrades } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
const dir = await mkdtemp(path.join(os.tmpdir(), "export-grades-"));
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

/** The gradebook's navigation menu as Moodle 5.2 renders it, reduced to its export options. */
const menu = (plugins: string[]) =>
  `<ul role="listbox">${plugins.map((p) => `<li class="dropdown-item" role="option" data-value="${SITE}grade/export/${p}/index.php?id=3">${p}</li>`).join("")}</ul>`;

/** An export form, reduced: items 12 and 4 (the second frozen, as XML freezes an item without ID number), options. */
const form = (plugin: string, { frozen = false } = {}) => `<form class="mform" method="post" action="${SITE}grade/export/${plugin}/export.php">
<input type="hidden" name="id" value="3"><input type="hidden" name="sesskey" value="s1">
<input type="hidden" name="itemids[12]" value="0"><input type="checkbox" name="itemids[12]" value="1" checked>
${frozen ? `<input type="checkbox" name="itemids[4]" value="1" disabled>` : `<input type="hidden" name="itemids[4]" value="0"><input type="checkbox" name="itemids[4]" value="1" checked>`}
<input type="hidden" name="export_feedback" value="0"><input type="checkbox" name="export_feedback" value="1">
${plugin === "xml" ? `<select name="display"><option value="1" selected>Real</option><option value="2">Percentage</option></select>` : `<input type="hidden" name="display[real]" value="0"><input type="checkbox" name="display[real]" value="1" checked><input type="hidden" name="display[percentage]" value="0"><input type="checkbox" name="display[percentage]" value="2"><input type="hidden" name="display[letter]" value="0"><input type="checkbox" name="display[letter]" value="3">`}
${plugin === "txt" ? `<input type="radio" name="separator" value="tab"><input type="radio" name="separator" value="comma" checked>` : ""}
<input type="submit" name="submitbutton" value="Download"></form>`;

async function open(plugins: string[], { frozen = false } = {}): Promise<{ context: BrowserContext; posts: Record<string, string[]>[] }> {
  const context = await browser!.newContext();
  const posts: Record<string, string[]>[] = [];
  // A disabled plugin's page still opens (its form or not): the menu lists only the enabled ones.
  const bodies = Object.fromEntries(["ods", "txt", "xls", "xml"].map((p) => [`/grade/export/${p}/index.php`, menu(plugins) + (plugins.includes(p) ? form(p, { frozen }) : "")]));
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies });
  await context.route(`${SITE}grade/export/*/export.php`, async (route) => {
    const data = new URLSearchParams(route.request().postData() ?? "");
    const fields: Record<string, string[]> = {};
    for (const [key, value] of data) (fields[key] ??= []).push(value);
    posts.push(fields);
    return route.fulfill({
      status: 200,
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="Course 3 Grades.csv"' },
      body: "First name,Last name,Quiz one (Real)\nAna,Student,10.00\n",
    });
  });
  return { context, posts };
}

/**
 * Moodle 4.5's txt export form (Classic theme), reduced: the button in the sticky footer at the
 * form's end, here covered by a fixed banner as a site's own footer or a cookie bar can.
 */
const form45 = `<div style="position:fixed;inset:0;z-index:9999;background:#fff">Banner</div>
<form autocomplete="off" action="${SITE}grade/export/txt/export.php" method="post" class="mform">
<input name="id" type="hidden" value="3"><input name="sesskey" type="hidden" value="s1"><input name="_qf__grade_export_form" type="hidden" value="1">
<input type="hidden" name="itemids[12]" value="0"><input type="checkbox" name="itemids[12]" class="form-check-input checkboxgroup1" value="1" id="id_itemids_12" checked>
<input type="hidden" name="export_feedback" value="0"><input type="checkbox" name="export_feedback" class="form-check-input" value="1" id="id_export_feedback">
<input type="hidden" name="display[real]" value="0"><input type="checkbox" name="display[real]" class="form-check-input" id="id_display_real" value="1" checked>
<input type="radio" name="separator" id="id_separator_tab" value="tab"><input type="radio" name="separator" id="id_separator_comma" value="comma" checked>
<div id="sticky-footer" class="stickyfooter bg-white border-top"><div class="sticky-footer-content"><div id="fitem_id_submitbutton" class="mb-3 row fitem femptylabel">
<input type="submit" class="btn btn-primary" name="submitbutton" id="id_submitbutton" value="Download"></div></div></div></form>`;

describe("exportGrades", { skip: !browser && "no system browser" }, () => {
  it("sends Moodle 4.5's form though its sticky footer's button is covered, and reports a page answered instead of a file", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/grade/export/txt/index.php": menu(["txt"]) + form45 } });
    let refuse = false;
    await context.route(`${SITE}grade/export/txt/export.php`, (route) =>
      refuse
        ? route.fulfill({ status: 200, contentType: "text/html", body: `<html><body><div class="errorbox"><p class="errormessage">Sorry, but you do not currently have permissions to do that</p></div></body></html>` })
        : route.fulfill({ status: 200, headers: { "content-type": "text/csv", "content-disposition": 'attachment; filename="Grades.csv"' }, body: "a,b\n" }),
    );
    const file = await exportGrades(context, SITE, 3, { format: "csv", destDir: dir });
    assert.equal(file.name, "Grades.csv");
    refuse = true;
    await assert.rejects(exportGrades(context, SITE, 3, { format: "csv", destDir: dir }), (error: Error) => error instanceof GradebookError && /with a page, not a file/.test(error.message));
    await context.close();
  });

  it("fills the export form and saves the file Moodle sends, never overwriting", async () => {
    const { context, posts } = await open(["ods", "txt", "xls", "xml"]);
    const file = await exportGrades(context, SITE, 3, { format: "csv", itemIds: [12], display: ["real", "percentage"], feedback: true, destDir: dir });
    assert.equal(file.name, "Course 3 Grades.csv");
    assert.equal(await readFile(file.path, "utf8"), "First name,Last name,Quiz one (Real)\nAna,Student,10.00\n");
    assert.equal(file.size, 55);
    const sent = posts[0]!;
    assert.deepEqual(sent["itemids[12]"], ["0", "1"]);
    assert.deepEqual(sent["itemids[4]"], ["0"]);
    assert.deepEqual(sent["display[percentage]"], ["0", "2"]);
    assert.deepEqual(sent["export_feedback"], ["0", "1"]);
    assert.deepEqual(sent.separator, ["comma"]);
    const again = await exportGrades(context, SITE, 3, { format: "csv", destDir: dir });
    assert.equal(again.name, "Course 3 Grades (2).csv");
    await context.close();
  });

  it("refuses a format the site doesn't export, an unknown item, and an XML item without ID number", async () => {
    const { context } = await open(["txt", "xml"], { frozen: true });
    await assert.rejects(exportGrades(context, SITE, 3, { format: "xlsx", destDir: dir }), (error: Error) => error instanceof GradebookError && /doesn't export grades as xlsx; it exports as: csv, xml/.test(error.message));
    await assert.rejects(exportGrades(context, SITE, 3, { format: "csv", itemIds: [99], destDir: dir }), /no grade item 99: it offers 12, 4/);
    await assert.rejects(exportGrades(context, SITE, 3, { format: "xml", itemIds: [4], destDir: dir }), /Grade item 4 has no ID number/);
    await assert.rejects(exportGrades(context, SITE, 3, { format: "csv", destDir: "relative" }), /absolute path/);
    await context.close();
  });
});
