import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { createGroup, createGrouping, deleteGroup, deleteGrouping, groupings, setGroupMembers, setGroupingGroups, updateGroup } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A members page (group/members.php) or a grouping's groups page (group/assign.php), reduced: the two lists by id. */
function assignPage(current: number[], potential: number[], groupingPage = false): string {
  // A grouping page writes its values "5." and puts a blank option in an empty list (Moodle 5.2).
  const option = (id: number) => `<option value="${id}${groupingPage ? "." : ""}">Item ${id}</option>`;
  const blank = groupingPage ? "<option>&nbsp;</option>" : "";
  return `<div id="addmembersform"><form id="assignform" method="post" action=""><input type="hidden" name="sesskey" value="s1">
<select name="removeselect[]" id="removeselect" multiple>${current.map(option).join("") || blank}</select>
<input name="add" id="add" type="submit" value="Add"><input name="remove" id="remove" type="submit" value="Remove">
<select name="addselect[]" id="addselect" multiple><optgroup label="Student (2)">${potential.map(option).join("") || blank}</optgroup></select></form></div>`;
}

/** The group form (group/group.php), reduced; it posts where Moodle redirects after saving (the fake can't follow a redirect). */
const groupForm = (action: string) => `<form class="mform" method="post" action="${action}"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="name" value="Old"><input type="text" name="idnumber" value=""><textarea name="description_editor[text]"></textarea>
<input type="text" name="enrolmentkey" value=""><input type="submit" name="submitbutton" value="Save changes"></form>`;

/** A fake course 3 with group 12 (members 4) and its groupings; records what the pages receive. */
async function site() {
  const posts: { path: string; form: URLSearchParams }[] = [];
  const members = new Set([4]);
  const enrolled = [4, 5, 6];
  const groupingGroups = new Map<number, Set<number>>([[1, new Set([12])]]);
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  const page = (body: string, bodyId = "") => `${moodlePage({ userId: 3, body, bodyId })}<script>M.cfg.courseId = 3;</script>`;
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  const record = (route: Route) => {
    const url = new URL(route.request().url());
    const form = new URLSearchParams(route.request().postData() ?? "");
    posts.push({ path: url.pathname + url.search, form });
    return form;
  };
  await context.route(`${SITE}group/members.php**`, (route) => {
    if (new URL(route.request().url()).searchParams.get("group") !== "12") return html(route, page('<div data-rel="fatalerror"><p class="errormessage">Can\'t find data record in database.</p></div>'));
    if (route.request().method() === "POST") {
      const form = record(route);
      if (form.get("add")) for (const id of form.getAll("addselect[]")) members.add(Number(id));
      if (form.get("remove")) for (const id of form.getAll("removeselect[]")) members.delete(Number(id));
    }
    return html(route, page(assignPage([...members], enrolled.filter((id) => !members.has(id))), "page-group-members"));
  });
  await context.route(`${SITE}group/assign.php**`, (route) => {
    const id = Number(new URL(route.request().url()).searchParams.get("id"));
    const groups = groupingGroups.get(id) ?? new Set<number>();
    if (route.request().method() === "POST") {
      const form = record(route);
      if (form.get("add")) for (const g of form.getAll("addselect[]")) groups.add(Number.parseInt(g, 10));
      if (form.get("remove")) for (const g of form.getAll("removeselect[]")) groups.delete(Number.parseInt(g, 10));
    }
    return html(route, page(assignPage([...groups], [12, 13].filter((g) => !groups.has(g)), true), "page-group-assign"));
  });
  await context.route(`${SITE}group/groupings.php**`, (route) => {
    // Course 4: a student's refusal, which keeps the page's body id (Moodle 5.2, seen on the sandbox).
    if (new URL(route.request().url()).searchParams.get("id") === "4") {
      return html(route, page('<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Manage groups).</p></div>', "page-group-groupings"));
    }
    const rows = [...groupingGroups.keys()].map((id) => `<tr><td class="cell c0">Grouping ${id}</td><td>Groups</td><td>0</td><td><a href="${SITE}group/grouping.php?id=${id}">e</a><a href="${SITE}group/assign.php?id=${id}">g</a></td></tr>`);
    return html(route, page(`<table class="generaltable"><thead><tr><th>Grouping</th></tr></thead><tbody>${rows.join("")}</tbody></table>`, "page-group-groupings"));
  });
  await context.route(`${SITE}group/group.php**`, (route) => html(route, page(groupForm(`${SITE}group/index.php?id=3&group=${new URL(route.request().url()).searchParams.get("id") ?? 15}`), "page-group-group")));
  await context.route(`${SITE}group/grouping.php**`, (route) => {
    if (route.request().method() === "POST") {
      const form = record(route);
      if (form.get("delete")) groupingGroups.delete(Number(form.get("id")));
      else groupingGroups.set(2, new Set());
      return html(route, page("", "page-group-groupings"));
    }
    return html(route, page(groupForm(`${SITE}group/grouping.php?courseid=3`), "page-group-grouping"));
  });
  await context.route(`${SITE}group/index.php**`, (route) => {
    if (route.request().method() === "POST") record(route);
    return html(route, page("", "page-group-index"));
  });
  await context.route(`${SITE}group/delete.php**`, (route) => {
    record(route);
    return html(route, page("", "page-group-index"));
  });
  return { context, posts, members, groupingGroups };
}

describe("groups: create, update and delete", { skip: !browser && "no system browser" }, () => {
  it("creates a group with its form and returns the id Moodle lands on", async () => {
    const { context, posts } = await site();
    assert.deepEqual(await createGroup(context, SITE, 3, { name: "Driver group", idNumber: "g1", description: "<p>Hi</p>", enrolmentKey: "k" }), { changed: 'Group 15 "Driver group" created in course 3.', groupId: 15 });
    const form = posts[0]!.form;
    assert.deepEqual([form.get("name"), form.get("idnumber"), form.get("description_editor[text]"), form.get("enrolmentkey")], ["Driver group", "g1", "<p>Hi</p>", "k"]);
    await context.close();
  });

  it("updates only what's given", async () => {
    const { context, posts } = await site();
    await updateGroup(context, SITE, 12, { name: "Renamed" });
    assert.equal(posts[0]!.path, "/group/index.php?id=3&group=12");
    assert.deepEqual([posts[0]!.form.get("name"), posts[0]!.form.get("idnumber")], ["Renamed", ""]);
    await assert.rejects(updateGroup(context, SITE, 12, {}), /Nothing to change/);
    await context.close();
  });

  it("deletes a group with its course and the confirmation", async () => {
    const { context, posts } = await site();
    await deleteGroup(context, SITE, 12);
    assert.equal(posts[0]!.path, "/group/delete.php");
    assert.deepEqual(Object.fromEntries(posts[0]!.form), { courseid: "3", groups: "12", confirm: "1", sesskey: "s1" });
    await assert.rejects(deleteGroup(context, SITE, 99), /Can't find data record/);
    await context.close();
  });
});

describe("setGroupMembers", { skip: !browser && "no system browser" }, () => {
  it("adds and removes through the members page, skipping who it doesn't offer", async () => {
    const { context } = await site();
    const result = await setGroupMembers(context, SITE, 12, { add: [5, 6, 99], remove: [4] });
    assert.deepEqual(result.members.sort(), [5, 6]);
    assert.equal(result.changed, "Group 12: added 5, 6; removed 4; couldn't change 99 (not participants the page offers).");
    await context.close();
  });
});

describe("groupings", { skip: !browser && "no system browser" }, () => {
  it("lists groupings with their groups, creates, fills and deletes one", async () => {
    const { context, posts } = await site();
    assert.deepEqual(await groupings(context, SITE, 3), [{ id: 1, name: "Grouping 1", groupIds: [12] }]);
    const { groupingId } = await createGrouping(context, SITE, 3, { name: "New" });
    assert.equal(groupingId, 2);
    assert.deepEqual(await setGroupingGroups(context, SITE, 2, [12, 13, 77]), { changed: "Grouping 2: added groups 12, 13; left out 77 (not groups of its course).", groupIds: [12, 13] });
    assert.deepEqual((await setGroupingGroups(context, SITE, 2, [13])).groupIds, [13]);
    await deleteGrouping(context, SITE, 2);
    assert.deepEqual(Object.fromEntries(posts.at(-1)!.form), { id: "2", delete: "1", courseid: "3", confirm: "1", sesskey: "s1" });
    assert.deepEqual((await groupings(context, SITE, 3)).map((g) => g.id), [1]);
    await assert.rejects(groupings(context, SITE, 4), /You can't see the groupings of course 4: Sorry, but you do not currently have permissions/);
    await context.close();
  });
});
