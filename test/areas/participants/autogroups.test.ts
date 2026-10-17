import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { FormError, MoodleError, autoCreateGroups, importGroups } from "../../../src/index.js";
import { groupName, previewMembers } from "../../../src/areas/participants/autogroups.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** The auto-create form (group/autogroup.php), reduced to its fields; course 3 has a grouping 7 and a cohort 9. */
const autogroupForm = `<form class="mform" method="post" action="${SITE}group/autogroup.php?courseid=3">
<input type="hidden" name="sesskey" value="s1"><input type="hidden" name="courseid" value="3"><input type="hidden" name="seed" value="1234">
<input type="text" name="namingscheme" value="Group @"><select name="groupby"><option value="groups">Number of groups</option><option value="members">Members per group</option></select>
<input type="text" name="number" value=""><select name="roleid"><option value="0">All</option><option value="5" selected>Student</option></select>
<select name="cohortid"><option value="0">Any cohort</option><option value="9">Class</option></select>
<select name="groupingid"><option value="0">None</option><option value="7">Old grouping</option></select><input type="hidden" name="groupid" value="0">
<select name="allocateby"><option value="no">No allocation</option><option value="random" selected>Random</option><option value="firstname">First name</option><option value="lastname">Last name</option><option value="idnumber">ID number</option></select>
<input type="checkbox" name="nosmallgroups" value="1"><input type="checkbox" name="notingroup" value="1">
<select name="grouping"><option value="0">No grouping</option><option value="-1" selected>New grouping</option><option value="7">Old grouping</option></select><input type="text" name="groupingname" value="">
<input type="submit" name="preview" value="Preview"><input type="submit" name="submitbutton" value="Submit"></form>`;

/** The import form (group/import.php), reduced: its file picker's draft area, the delimiter. */
const importForm = `<form class="mform" method="post" action="${SITE}group/import.php?id=3"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="userfile" value="555">
<select name="delimiter_name"><option value="comma">,</option><option value="semicolon">;</option></select><input type="submit" name="submitbutton" value="Import groups"></form>
<script>var filepicker = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`;

const PEOPLE: Record<number, string> = { 4: "Ana Uno", 5: "Bruno Dos", 6: "Carla Tres" };

/** A fake course 3 with one group (1) and the auto-create and import pages; records what they receive. */
async function site({ student = false } = {}) {
  const posts: { path: string; form: URLSearchParams }[] = [];
  const groups = new Map<number, { name: string; members: number[] }>([[1, { name: "Existing", members: [] }]]);
  const groupings = new Map<number, { name: string; groupIds: number[] }>([[7, { name: "Old grouping", groupIds: [] }]]);
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  const page = (body: string, bodyId = "") => `${moodlePage({ userId: 3, body: `<div id="region-main">${body}</div>`, bodyId })}<script>M.cfg.courseId = 3;</script>`;
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  const refusal = page('<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Manage groups).</p></div>');
  const record = (route: Route) => {
    const url = new URL(route.request().url());
    const form = new URLSearchParams(route.request().postData() ?? "");
    posts.push({ path: url.pathname + url.search, form });
    return form;
  };
  // The participants page's group filter: the course's groups by id.
  await context.route(`${SITE}user/index.php**`, (route) =>
    html(route, page(`<select data-field-name="roles"><option value="5">Student</option></select><select data-field-name="groups">${[...groups].map(([id, g]) => `<option value="${id}">${g.name}</option>`).join("")}</select>`, "page-course-view-participants")),
  );
  await context.route(`${SITE}group/members.php**`, (route) => {
    const group = groups.get(Number(new URL(route.request().url()).searchParams.get("group")));
    const options = (group?.members ?? []).map((id) => `<option value="${id}">${PEOPLE[id]}</option>`).join("");
    return html(route, page(`<form id="assignform"><select id="removeselect">${options}</select><select id="addselect"></select></form>`, "page-group-members"));
  });
  await context.route(`${SITE}group/groupings.php**`, (route) => {
    const rows = [...groupings].map(([id, g]) => `<tr><td>${g.name}</td><td><a href="${SITE}group/assign.php?id=${id}">g</a></td></tr>`).join("");
    return html(route, page(`<table class="generaltable"><tbody>${rows}</tbody></table>`, "page-group-groupings"));
  });
  await context.route(`${SITE}group/assign.php**`, (route) => {
    const grouping = groupings.get(Number(new URL(route.request().url()).searchParams.get("id")));
    return html(route, page(`<form id="assignform"><select id="removeselect">${(grouping?.groupIds ?? []).map((id) => `<option value="${id}.">G</option>`).join("")}</select><select id="addselect"></select></form>`, "page-group-assign"));
  });
  await context.route(`${SITE}group/index.php**`, (route) => html(route, page("", "page-group-index")));
  await context.route(`${SITE}group/autogroup.php**`, (route) => {
    if (student) return html(route, refusal);
    if (route.request().method() !== "POST") return html(route, page(autogroupForm, "page-group-autogroup"));
    const form = record(route);
    const scheme = form.get("namingscheme") ?? "";
    if (!/[#@]/.test(scheme)) {
      return html(route, page(autogroupForm.replace('name="namingscheme" value="Group @">', `name="namingscheme" value="${scheme}"><div id="id_error_namingscheme">Naming scheme must contain exactly one '@' or one '#' character</div>`), "page-group-autogroup"));
    }
    // Two groups of the three students, as Moodle would split them; the second name is taken when the scheme says so.
    const planned = [
      { name: groupName(scheme, 0), members: [4, 6] },
      { name: groupName(scheme, 1), members: [5] },
    ];
    if (form.get("preview")) {
      const rows = planned.map((g, i) => `<tr><td class="cell c0">${i === 1 && scheme.startsWith("Taken") ? `<span class="notifyproblem">The group name '${g.name}' already exists</span>` : g.name}</td><td class="cell c1">${g.members.map((id) => `${PEOPLE[id]} (u${id}@example.com)`).join(", ")}</td><td class="cell c2">${g.members.length}</td></tr>`);
      return html(route, page(`${autogroupForm}<h2>Preview</h2><table class="generaltable"><thead><tr><th>Groups (2)</th><th>Members</th><th>User count (3)</th></tr></thead><tbody>${rows.join("")}</tbody></table>`, "page-group-autogroup"));
    }
    if (scheme.startsWith("Taken")) return html(route, page(`<div class="alert alert-danger" role="alert">The group name '${planned[1]!.name}' already exists<button class="btn-close"><span class="visually-hidden">Dismiss this notification</span></button></div>${autogroupForm}`, "page-group-autogroup"));
    let next = Math.max(...groups.keys()) + 1;
    const ids = planned.map((g) => {
      groups.set(next, g);
      return next++;
    });
    if (form.get("grouping") === "-1") groupings.set(8, { name: form.get("groupingname") ?? "", groupIds: ids });
    // Moodle redirects to the groups page (the fake answers with it: it can't follow a redirect).
    return html(route, page("", "page-group-index"));
  });
  await context.route(`${SITE}group/import.php**`, (route) => {
    if (student) return html(route, refusal);
    if (route.request().method() !== "POST") return html(route, page(importForm, "page-group-import"));
    const form = record(route);
    if (form.get("delimiter_name") === "semicolon") return html(route, page('<div data-rel="fatalerror"><p class="errormessage">"name" is not a valid field name</p></div>'));
    groups.set(20, { name: "CSV 1", members: [] });
    return html(route, page('<div class="alert alert-success">Group CSV 1 added<button><span>Dismiss this notification</span></button></div><div class="alert alert-danger">Existing :Group "Existing" already exists for this course<button><span>Dismiss this notification</span></button></div>', "page-group-import"));
  });
  await context.route(`${SITE}repository/repository_ajax.php**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/555/groups.csv` }) }));
  return { context, posts, groups };
}

describe("groupName and previewMembers", () => {
  it("names groups as Moodle does", () => {
    assert.deepEqual([0, 1, 25, 26, 27].map((i) => groupName("G @", i)), ["G A", "G B", "G Z", "G AA", "G AB"]);
    assert.deepEqual([0, 9].map((i) => groupName("Team #", i)), ["Team 1", "Team 10"]);
  });

  it("splits a preview's members, without their identity fields", () => {
    assert.deepEqual(previewMembers("Ana Uno (a@x.com, 12), Bruno Dos (b@x.com, 13)", 2), ["Ana Uno", "Bruno Dos"]);
    assert.deepEqual(previewMembers("Uno, Ana, Dos, Bruno", 2), ["Uno, Ana", "Dos, Bruno"]);
    assert.deepEqual(previewMembers("", 0), []);
  });
});

describe("autoCreateGroups", { skip: !browser && "no system browser" }, () => {
  it("previews the groups Moodle would make, writing nothing", async () => {
    const { context, posts, groups } = await site();
    const preview = await autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "Team #", preview: true, seed: 99 });
    assert.deepEqual(preview, {
      changed: "Nothing created (a preview): 2 groups of 3 participants in course 3.",
      groups: [
        { name: "Team 1", members: ["Ana Uno", "Carla Tres"], nameTaken: false },
        { name: "Team 2", members: ["Bruno Dos"], nameTaken: false },
      ],
      seed: 99,
    });
    const form = posts[0]!.form;
    assert.deepEqual([form.get("namingscheme"), form.get("groupby"), form.get("number"), form.get("allocateby"), form.get("grouping"), form.get("seed"), form.get("preview")], ["Team #", "groups", "2", "random", "0", "99", "Preview"]);
    assert.equal(groups.size, 1);
    const taken = await autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "Taken @", preview: true });
    assert.deepEqual(taken.groups.map((g) => [g.name, g.nameTaken]), [["Taken A", false], ["Taken B", true]]);
    assert.equal(taken.seed, 1234);
    await context.close();
  });

  it("creates them in a new grouping and reads them back", async () => {
    const { context, posts } = await site();
    const created = await autoCreateGroups(context, SITE, 3, { by: "members", count: 2, naming: "Team @", allocation: "none", roleId: 0, cohortId: 9, fromGroupingId: 7, noSmallGroups: true, newGrouping: "Teams" });
    assert.deepEqual(created, {
      changed: '2 groups created in course 3 (2 "Team A", 3 "Team B") with 3 members, in grouping 8.',
      groups: [
        { id: 2, name: "Team A", members: [4, 6] },
        { id: 3, name: "Team B", members: [5] },
      ],
      groupingId: 8,
      seed: 1234,
    });
    const form = posts[0]!.form;
    assert.deepEqual([form.get("groupby"), form.get("allocateby"), form.get("roleid"), form.get("cohortid"), form.get("groupingid"), form.get("nosmallgroups"), form.get("grouping"), form.get("groupingname"), form.get("submitbutton")], ["members", "no", "0", "9", "7", "1", "-1", "Teams", "Submit"]);
    await context.close();
  });

  it("passes on what Moodle refuses, and checks what it can first", async () => {
    const { context } = await site();
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "Plain" }), (e: Error) => e instanceof FormError && /namingscheme: Naming scheme must contain/.test(e.message));
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "Taken #" }), (e: Error) => e instanceof FormError && /Moodle created no groups: namingscheme: The group name 'Taken 2' already exists$/.test(e.message));
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "T #", cohortId: 4 }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input" && /cohortId 4/.test(e.message));
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "T #", fromGroupId: 1 }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 0, naming: "T #" }), /count is a whole number/);
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "T #", groupingId: 7, newGrouping: "X" }), /either groupingId or newGrouping/);
    await context.close();
  });

  it("names the capability to someone who can't manage groups", async () => {
    const { context } = await site({ student: true });
    await assert.rejects(autoCreateGroups(context, SITE, 3, { by: "groups", count: 2, naming: "T #" }), (e: Error) => e instanceof MoodleError && e.code === "not-available" && /Manage groups.*moodle\/course:managegroups/.test(e.message));
    await context.close();
  });
});

describe("importGroups", { skip: !browser && "no system browser" }, () => {
  it("uploads the CSV, returns the new groups and the rows with a problem", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "groups-"));
    const file = path.join(dir, "groups.csv");
    await writeFile(file, "groupname\nCSV 1\nExisting\n");
    const { context, posts } = await site();
    assert.deepEqual(await importGroups(context, SITE, 3, file), {
      changed: '1 groups imported into course 3 (20 "CSV 1"); 1 rows with a problem.',
      groups: [{ id: 20, name: "CSV 1" }],
      problems: ['Existing :Group "Existing" already exists for this course'],
    });
    assert.deepEqual([posts[0]!.form.get("userfile"), posts[0]!.form.get("delimiter_name")], ["555", "comma"]);
    await assert.rejects(importGroups(context, SITE, 3, file, { delimiter: "semicolon" }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input" && /not a valid field name/.test(e.message));
    await context.close();
    const refused = await site({ student: true });
    await assert.rejects(importGroups(refused.context, SITE, 3, file), (e: Error) => e instanceof MoodleError && e.code === "not-available");
    await refused.context.close();
  });
});
