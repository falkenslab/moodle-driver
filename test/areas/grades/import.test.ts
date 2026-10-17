import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { GradebookError, importGrades } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const dir = mkdtempSync(path.join(tmpdir(), "driver-grade-import-"));
const csv = path.join(dir, "grades.csv");
writeFileSync(csv, "Username,Lab 1,Comment\nana,7.5,Well done\n");

const fatal = (message: string) => `<div data-rel="fatalerror"><p class="errormessage">${message}</p></div>`;
const alert = (kind: string, text: string) => `<div class="alert alert-${kind} alert-block" role="alert"> ${text} <button type="button" class="btn-close"><span class="visually-hidden">Dismiss this notification</span></button></div>`;

/** A made-up course 9 whose gradebook has manual item 64 and activity item 65 (not offered: activities' items aren't imported into). */
interface FakeImport {
  allowed: boolean;
  /** The usernames Moodle finds. */
  users: string[];
  file?: string;
  mappings: Record<string, string>[];
}

/** The CSV upload form, its preview with the mapping form, and the import's outcome, as Moodle 5.2 renders them, reduced. */
async function serveImport(context: BrowserContext, fake: FakeImport): Promise<void> {
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  const page = (body: string) => moodlePage({ userId: 3, heading: "Import CSV", bodyId: "page-grade-import-csv-index", body: `<div role="main">${body}</div>` });
  await context.route(`${SITE}repository/repository_ajax.php**`, async (route: Route) => {
    // The file part's content, from the multipart body.
    fake.file = /filename="[^"]*"\r\n(?:[^\r]+\r\n)*\r\n([\s\S]*?)\r\n--/.exec(route.request().postData() ?? "")?.[1];
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/5/user/draft/77/grades.csv` }) });
  });
  await context.route(`${SITE}grade/import/csv/index.php**`, async (route: Route) => {
    const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body: page(body) });
    if (!fake.allowed) return html(fatal("Sorry, but you do not currently have permissions to do that (Import grades)."));
    const form = new URLSearchParams(route.request().postData() ?? "");
    if (form.get("_qf__grade_import_mapping_form")) {
      fake.mappings.push(Object.fromEntries([...form].filter(([key]) => /^map/.test(key))));
      const user = (fake.file ?? "").split("\n")[1]?.split(",")[Number(form.get("mapfrom"))];
      if (!fake.users.includes(user ?? "")) return html(alert("danger", `User mapping error: Could not find user with username of "${user}".`) + alert("danger", "Import failed. No data was imported."));
      return html(alert("success", "Grade import success") + alert("success", "This import included the following grades for users not currently enrolled in this course: Bea"));
    }
    if (form.get("_qf__grade_import_form")) {
      if (!fake.file) return html(alert("danger", "Required"));
      const [head, ...rows] = fake.file.trim().split("\n").map((line) => line.split(","));
      const options = `<optgroup label="Others"><option value="0">Ignore</option><option value="new">New grade item</option></optgroup><optgroup label="Grade items"><option value="64">Lab 1</option></optgroup><optgroup label="Feedbacks"><option value="feedback_64">Feedback for Lab 1</option></optgroup>`;
      return html(
        `<h2>Import preview</h2><table class="generaltable"><thead><tr>${head!.map((h) => `<th class="header">${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td class="cell">${c}</td>`).join("")}</tr>`).join("")}</tbody></table>
<form class="mform" action="${SITE}grade/import/csv/index.php" method="post"><input name="map" type="hidden" value="1"><input name="id" type="hidden" value="9"><input name="iid" type="hidden" value="555"><input name="sesskey" type="hidden" value="s1"><input name="_qf__grade_import_mapping_form" type="hidden" value="1">
<select name="mapfrom">${head!.map((h, i) => `<option value="${i}">${h}</option>`).join("")}</select>
<select name="mapto"><option value="userid">User ID</option><option value="username">Username</option><option value="useridnumber">ID number</option><option value="useremail">Email address</option><option value="0">Ignore</option></select>
${head!.map((_, i) => `<select name="mapping_${i}">${options}</select>`).join("")}<input type="submit" name="submitbutton" value="Upload grades"></form>`,
      );
    }
    return html(`<script>var fp = {"repositories":{"4":{"id":"4","name":"Upload a file","type":"upload"}}};</script>
<form class="mform" action="${SITE}grade/import/csv/index.php" method="post"><input name="id" type="hidden" value="9"><input name="sesskey" type="hidden" value="s1"><input name="_qf__grade_import_form" type="hidden" value="1">
<input type="hidden" name="userfile" value="77"><select name="encoding"><option value="UTF-8">UTF-8</option><option value="ISO-8859-1">ISO-8859-1</option></select>
<input type="radio" name="separator" value="tab"><input type="radio" name="separator" value="comma" checked><input type="radio" name="separator" value="colon"><input type="radio" name="separator" value="semicolon">
<select name="verbosescales"><option value="1">Yes</option><option value="0">No</option></select><select name="previewrows"><option value="10">10</option><option value="100000">100000</option></select>
<input type="submit" name="submitbutton" value="Upload grades"></form>`);
  });
}

async function site(overrides: Partial<FakeImport> = {}) {
  const context = await browser!.newContext();
  const fake: FakeImport = { allowed: true, users: ["ana"], mappings: [], ...overrides };
  await serveImport(context, fake);
  return { context, fake };
}

describe("importGrades", { skip: !browser && "no system browser" }, () => {
  it("previews the file as Moodle reads it, without importing", async () => {
    const { context, fake } = await site();
    const result = await importGrades(context, SITE, 9, csv, { mapFrom: "Username", mapTo: "username", columns: { "Lab 1": 64 }, preview: true });
    assert.deepEqual(result, {
      changed: "Nothing imported: Moodle's preview of grades.csv, 1 row.",
      imported: false,
      preview: { columns: ["Username", "Lab 1", "Comment"], rows: [["ana", "7.5", "Well done"]] },
      notices: [],
    });
    assert.equal(fake.mappings.length, 0);
    await context.close();
  });

  it("maps the person's column and each imported one, ignoring the others, and imports", async () => {
    const { context, fake } = await site();
    const result = await importGrades(context, SITE, 9, csv, { mapFrom: "Username", mapTo: "username", columns: { "Lab 1": 64, Comment: { feedback: 64 } } });
    assert.equal(result.imported, true);
    assert.equal(result.changed, "Imported grades.csv into course 9: 1 row, into grade item 64.");
    assert.deepEqual(result.notices, ["This import included the following grades for users not currently enrolled in this course: Bea"]);
    assert.deepEqual(fake.mappings[0], { map: "1", mapfrom: "0", mapto: "username", mapping_0: "0", mapping_1: "64", mapping_2: "feedback_64" });
    await context.close();
  });

  it("gives Moodle's reason when it imports nothing, and refuses unknown columns and items", async () => {
    const { context } = await site({ users: [] });
    await assert.rejects(importGrades(context, SITE, 9, csv, { mapFrom: "Username", mapTo: "username", columns: { "Lab 1": 64 } }), (error: Error) => error instanceof GradebookError && /Could not find user with username of "ana"\. Import failed/.test(error.message));
    await assert.rejects(importGrades(context, SITE, 9, csv, { mapFrom: "User", mapTo: "username", columns: { "Lab 1": 64 } }), /grades\.csv has no column "User"; its columns are: "Username", "Lab 1", "Comment"/);
    await assert.rejects(importGrades(context, SITE, 9, csv, { mapFrom: "Username", mapTo: "username", columns: { "Lab 1": 65 } }), /Grade item 65 can't take imported grades in course 9.*items 64/);
    await assert.rejects(importGrades(context, SITE, 9, csv, { mapFrom: "Username", mapTo: "username", columns: {} }), /Give columns/);
    await assert.rejects(importGrades(context, SITE, 9, "relative.csv", { mapFrom: "Username", mapTo: "username", columns: { "Lab 1": 64 } }), /absolute/);
    await context.close();
  });

  it("names the capabilities when the person can't import", async () => {
    const { context } = await site({ allowed: false });
    await assert.rejects(importGrades(context, SITE, 9, csv, { mapFrom: "Username", mapTo: "username", columns: { "Lab 1": 64 } }), (error: Error) => error instanceof GradebookError && /moodle\/grade:import and gradeimport\/csv:view/.test(error.message) && /Import grades/.test(error.message));
    await context.close();
  });
});
