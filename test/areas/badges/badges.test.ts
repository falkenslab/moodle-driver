import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { BadgeError, BadgesDisabledError, awardBadge, courseBadges, createBadge, setBadgeCriteria, setBadgeEnabled } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const image = path.join(mkdtempSync(path.join(tmpdir(), "badges-test-")), "badge.png");
writeFileSync(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));

interface FakeBadge {
  id: number;
  name: string;
  description: string;
  /** 0 disabled, 1 enabled (Moodle's BADGE_STATUS_*). */
  status: number;
  criteria: string;
  /** Criteria by type (1 activity, 2 manual, 4 course): their id, checked ids or grade, aggregation. */
  crit: Record<number, { id: number; ids: number[]; agg: string; grade?: string }>;
  overall: string;
  /** Who has it; who was awarded it by hand. */
  holders: number[];
  manual: number[];
  /** Whether the person has it. */
  mine: boolean;
}

const COURSE = 3;

/** A row of the badges table as Moodle 5.2's report builder renders it; `teacher` adds the status and recipients columns. */
function row(b: FakeBadge, teacher: boolean): string {
  const cell = (html: string) => `<td class="cell">${html}</td>`;
  const cells = [
    cell(`<img src="${SITE}pluginfile.php/30/badges/badgeimage/${b.id}/f2" alt=""> <a href="${SITE}badges/overview.php?id=${b.id}">${b.name}</a>`),
    ...(teacher ? [cell(b.status ? "Available to users" : "Not available to users")] : []),
    cell(b.criteria ? b.criteria : '<span class="no-criteria-set d-none"></span>'),
    ...(teacher ? [cell(`<a href="${SITE}badges/recipients.php?id=${b.id}">${b.holders.length}</a>`)] : []),
    cell(b.mine ? `<a href="${SITE}badges/badge.php?hash=abc"><i class="icon"></i></a>` : ""),
    cell(teacher && b.status && b.crit[2] ? `<a href="${SITE}badges/award.php?id=${b.id}">Award</a>` : ""),
  ];
  return `<tr class="${b.status ? "" : "text-muted"}">${cells.join("")}</tr>`;
}

function table(badges: FakeBadge[], teacher: boolean, total = badges.length): string {
  const sortable = (key: string) => `<th class="header"><a data-sortable="1" data-sortby="${key}" href="#">${key}</a></th>`;
  const headers = [sortable("c0_name"), ...(teacher ? [sortable("c1_status")] : []), '<th class="header">Criteria</th>', ...(teacher ? [sortable("c3_visible")] : []), sortable(teacher ? "c4_dateissued" : "c2_dateissued"), '<th class="header"><span class="visually-hidden">Actions</span></th>'];
  const filters = JSON.stringify({ jointype: 2, filters: { reportid: { name: "reportid", jointype: 1, values: [2] } } }).replaceAll('"', "&quot;");
  return `<div data-region="core_table/dynamic" data-table-handler="system_report_table" data-table-component="core_reportbuilder" data-table-uniqueid="system-report-table-2" data-table-filters="${filters}" data-table-sort-data="[]" data-table-total-rows="${total}"><table data-region="reportbuilder-table"><thead><tr>${headers.join("")}</tr></thead><tbody>${badges.map((b) => row(b, teacher)).join("")}<tr class="emptyrow"><td></td></tr></tbody></table></div>`;
}

function overview(b: FakeBadge): string {
  const dd = ["", b.name, "1.0", "English", b.description, "Saturday", `<img src="${SITE}pluginfile.php/30/badges/badgeimage/${b.id}/f1?refresh=42">`, "", ""];
  return `<div class="box statusbox ${b.status ? "active" : "inactive"}"></div><div id="badge-overview"><h3>Badge details</h3><dl>${dd.slice(1).map((value) => `<dt>x</dt><dd>${value}</dd>`).join("")}</dl></div>`;
}

/** The criteria page: the "Add badge criteria" menu and each criterion's edit link while the badge can change, the overall select with more than one. */
function criteriaPage(b: FakeBadge): string {
  const open = b.status === 0;
  const add = open ? `<form method="get" action="${SITE}badges/criteria_settings.php"><select name="type"><option value="">Choose...</option>${[2, 4, 1].filter((t) => !b.crit[t]).map((t) => `<option value="${t}">${t}</option>`).join("")}</select></form>` : "";
  const types = Object.keys(b.crit).map(Number);
  const overall = open && types.length > 1 ? `<form method="get" action="criteria.php"><select name="update"><option value="1"${b.overall === "1" ? " selected" : ""}>All</option><option value="2"${b.overall === "2" ? " selected" : ""}>Any</option></select></form>` : "";
  const edits = open ? types.map((t) => `<a href="${SITE}badges/criteria_settings.php?badgeid=${b.id}&amp;edit=1&amp;type=${t}&amp;crit=${b.crit[t]!.id}">Edit</a>`).join("") : "";
  return `<div class="box statusbox ${b.status ? "active" : "inactive"}"></div>${add}${overall}${edits}`;
}

/** A criterion's form: checkboxes by id (activities with completion, roles that may award), the aggregation, or the course's grade and date. */
function criterionForm(b: FakeBadge, type: number): string {
  const crit = b.crit[type];
  // It posts where Moodle's redirect leads (the fake serves no redirects): the criteria page, saying which criterion.
  const action = `${SITE}badges/criteria.php?id=${b.id}&amp;posted=${type}`;
  let fields: string;
  if (type === 4) {
    fields = `<input type="hidden" name="course_${COURSE}" value="${COURSE}"><input type="hidden" name="agg" value="1"><input type="text" name="grade_${COURSE}" value="${crit?.grade ?? ""}"><input type="checkbox" name="bydate_${COURSE}[enabled]" value="1">${["day", "month", "year"].map((p) => `<input type="text" name="bydate_${COURSE}[${p}]" value="">`).join("")}`;
  } else {
    const [prefix, offered] = type === 1 ? ["module", [41, 42]] : ["role", [3, 4]];
    const boxes = offered.map((id) => `<input type="hidden" name="${prefix}_${id}" value="0"><input type="checkbox" name="${prefix}_${id}" value="${id}"${crit?.ids.includes(id) ? " checked" : ""}>`).join("");
    const agg = crit?.agg ?? "2";
    fields = `${boxes}<input type="radio" name="agg" value="1"${agg === "1" ? " checked" : ""}><input type="radio" name="agg" value="2"${agg === "2" ? " checked" : ""}>`;
  }
  return `<form class="mform" method="post" action="${action}">${fields}<input type="submit" name="submitbutton" value="Save"></form>`;
}

async function site({ disabled = false, teacher = true }: { disabled?: boolean; teacher?: boolean } = {}) {
  const badges: FakeBadge[] = [
    { id: 7, name: "Explorer", description: "Visited everything.", status: 1, criteria: "Complete Page - Intro", crit: { 1: { id: 70, ids: [41], agg: "1" }, 2: { id: 71, ids: [3], agg: "2" } }, overall: "2", holders: [5], manual: [], mine: false },
    { id: 8, name: "Draft", description: "Not yet.", status: 0, criteria: "", crit: {}, overall: "1", holders: [], manual: [], mine: false },
  ];
  const posts: { path: string; form: URLSearchParams }[] = [];
  const visits: string[] = [];
  const state: FakeMoodleState = { user: { id: 3, fullName: "Teacher" }, serviceCalls: [], services: {} };
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, state);
  const page = (route: Route, body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body, bodyId, bodyClass: `course-${COURSE}`, contextId: 30 }) });
  const fatal = (route: Route, code: string, bodyId: string) => page(route, `<div data-rel="fatalerror"><p class="errormessage">Refused</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/${code}">More information</a></p></div>`, bodyId);
  const find = (url: URL, key = "id") => badges.find((b) => b.id === Number(url.searchParams.get(key)));
  const visible = () => (teacher ? badges : badges.filter((b) => b.status === 1));

  await context.route(`${SITE}badges/**`, async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.replace("/badges/", "");
    visits.push(`${name}${url.search}`);
    if (route.request().method() === "POST") posts.push({ path: name, form: new URLSearchParams(route.request().postData() ?? "") });
    if (disabled) return fatal(route, "badges/badgesdisabled", `page-badges-${name.replace(".php", "")}`);
    if (name === "index.php") return page(route, table(visible(), teacher), "page-badges-index");
    if (name === "overview.php") {
      const b = find(url);
      return b ? page(route, overview(b), "page-badges-overview") : fatal(route, "moodle/invalidrecord", "page-badges-overview");
    }
    if (name === "edit.php") {
      if (!teacher) return fatal(route, "moodle/nopermissions", "page-badges-edit");
      // The form posts where Moodle's redirect leads (the fake serves no redirects): the new badge's criteria page.
      return page(route, `<form class="mform" method="post" action="${SITE}badges/criteria.php?id=9"><input type="hidden" name="image" value="555"><input type="text" name="name"><textarea name="description"></textarea><input type="text" name="imagecaption"><input type="submit" name="submitbutton" value="Create"></form><script>var repos = {"id":"4","name":"Upload a file","type":"upload"};</script>`, "page-badges-edit");
    }
    if (name === "criteria.php") {
      if (route.request().method() === "POST" && url.searchParams.get("id") === "9") {
        const form = posts.at(-1)!.form;
        badges.push({ id: 9, name: form.get("name") ?? "", description: form.get("description") ?? "", status: 0, criteria: "", crit: {}, overall: "1", holders: [], manual: [], mine: false });
      }
      const b = find(url)!;
      const posted = Number(url.searchParams.get("posted"));
      if (route.request().method() === "POST" && posted) {
        const form = posts.at(-1)!.form;
        const ids = form.getAll(posted === 1 ? "module_41" : "role_3").concat(form.getAll(posted === 1 ? "module_42" : "role_4")).map(Number).filter((id) => id > 0);
        const grade = form.get(`grade_${COURSE}`) ?? undefined;
        b.crit[posted] = { id: b.crit[posted]?.id ?? 90 + posted, ids, agg: form.get("agg") ?? "1", ...(posted === 4 ? { grade } : {}) };
        b.criteria = "Set";
      }
      const update = url.searchParams.get("update");
      if (update && url.searchParams.get("sesskey") === "s1") b.overall = update;
      return page(route, criteriaPage(b), "page-badges-criteria");
    }
    if (name === "criteria_settings.php") {
      const b = find(url, "badgeid")!;
      const type = Number(url.searchParams.get("type"));
      return page(route, criterionForm(b, type), "page-badges-criteria_settings");
    }
    if (name === "criteria_action.php") {
      const b = find(url, "badgeid")!;
      if (url.searchParams.get("sesskey") === "s1" && url.searchParams.get("confirm")) delete b.crit[Number(url.searchParams.get("type"))];
      return page(route, criteriaPage(b), "page-badges-criteria");
    }
    if (name === "award.php") {
      if (!teacher) return fatal(route, "moodle/nopermissions", "page-badges-award");
      const b = find(url)!;
      if (!b.status) return page(route, '<div class="alert">This badge is not active</div>', "page-badges-award");
      if (route.request().method() === "POST") {
        const form = posts.at(-1)!.form;
        // Moodle awards only participants it may award it to.
        for (const id of form.getAll("potentialrecipients[]").map(Number).filter((id) => [5, 6].includes(id))) {
          b.manual.push(id);
          // Either criterion earns it (the overall aggregation "any"): the manual award issues it.
          if (b.overall === "2") b.holders.push(id);
        }
      }
      // Two roles may award it: Moodle asks which one the person awards as.
      const role = url.searchParams.get("role");
      if (role && role !== "3") return page(route, '<div class="alert">You do not have the required role</div>', "page-badges-award");
      if (!role) return page(route, `<form method="get" action="${SITE}badges/award.php"><select name="role"><option value="">Choose...</option><option value="3">Teacher</option></select></form>`, "page-badges-award");
      const options = (ids: number[]) => ids.map((id) => `<option value="${id}">User ${id}</option>`).join("");
      return page(route, `<form id="recipientform" method="post" action="${SITE}badges/award.php?id=${b.id}&amp;role=3"><select name="existingrecipients[]" multiple>${options(b.manual)}</select><input type="submit" name="award" value="Award"><select name="potentialrecipients[]" multiple><optgroup>${options([5, 6].filter((id) => !b.manual.includes(id)))}</optgroup></select></form>`, "page-badges-award");
    }
    return page(route, "", "page-badges-other");
  });
  // The file picker's upload, as repository_ajax.php answers it.
  await context.route(`${SITE}repository/repository_ajax.php**`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/5/user/draft/555/badge.png` }) }));
  return { context, badges, posts, visits, state };
}

describe("courseBadges", { skip: !browser && "no system browser" }, () => {
  it("reads each badge from its row and its overview, as a teacher sees them", async () => {
    const { context } = await site();
    assert.deepEqual(await courseBadges(context, SITE, COURSE), [
      { id: 7, courseId: COURSE, name: "Explorer", description: "Visited everything.", imageUrl: `${SITE}pluginfile.php/30/badges/badgeimage/7/f1`, enabled: true, criteria: "Complete Page - Intro", recipients: 1, awarded: false },
      { id: 8, courseId: COURSE, name: "Draft", description: "Not yet.", imageUrl: `${SITE}pluginfile.php/30/badges/badgeimage/8/f1`, enabled: false, criteria: "", recipients: 0, awarded: false },
    ]);
    await context.close();
  });

  it("gives a student the enabled badges, without recipients, and whether they have each", async () => {
    const { context, badges } = await site({ teacher: false });
    badges[0]!.mine = true;
    assert.deepEqual(
      (await courseBadges(context, SITE, COURSE)).map((b) => [b.id, b.enabled, b.recipients, b.awarded]),
      [[7, true, undefined, true]],
    );
    await context.close();
  });

  it("asks the table's service for the rows beyond the page's", async () => {
    const { context, state, badges } = await site();
    await context.unroute(`${SITE}badges/**`);
    await context.route(`${SITE}badges/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/index.php")) return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-badges-index", body: table(badges.slice(0, 1), true, 2) }) });
      const b = badges.find((x) => x.id === Number(url.searchParams.get("id")))!;
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-badges-overview", bodyClass: `course-${COURSE}`, body: overview(b) }) });
    });
    state.services!.core_table_get_dynamic_table_content = () => ({ html: table(badges, true) });
    assert.deepEqual((await courseBadges(context, SITE, COURSE)).map((b) => b.id), [7, 8]);
    const call = state.serviceCalls!.find((c) => c.methodname === "core_table_get_dynamic_table_content")!;
    assert.deepEqual([call.args.handler, call.args.uniqueid, call.args.pagesize, call.args.filters], ["system_report_table", "system-report-table-2", 2, [{ name: "reportid", jointype: 1, values: [2] }]]);
    await context.close();
  });

  it("throws BadgesDisabledError on a site with badges off, BadgeError without access", async () => {
    const off = await site({ disabled: true });
    await assert.rejects(courseBadges(off.context, SITE, COURSE), BadgesDisabledError);
    await off.context.close();
    // Without a badge capability, Moodle sends the person to the front page.
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
    await context.route(`${SITE}badges/index.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-site-index" }) }));
    await assert.rejects(courseBadges(context, SITE, COURSE), (e: Error) => e instanceof BadgeError && /moodle\/badges:viewbadges/.test(e.message));
    await context.close();
  });
});

describe("createBadge", { skip: !browser && "no system browser" }, () => {
  it("uploads the image to the form's file picker, fills it and reads the new badge back", async () => {
    const { context, posts } = await site();
    const { badge, changed } = await createBadge(context, SITE, COURSE, { name: "Reader", description: "Read the page.", image });
    const form = posts.find((p) => p.path === "criteria.php")!.form;
    assert.deepEqual([form.get("name"), form.get("description"), form.get("image")], ["Reader", "Read the page.", "555"]);
    assert.deepEqual([badge.id, badge.name, badge.enabled, badge.criteria], [9, "Reader", false, ""]);
    assert.match(changed, /Badge 9 "Reader" created in course 3/);
    await context.close();
  });

  it("names the capability when Moodle refuses, and checks the image first", async () => {
    const { context } = await site({ teacher: false });
    await assert.rejects(createBadge(context, SITE, COURSE, { name: "X", description: "Y", image }), (e: Error) => e instanceof BadgeError && /moodle\/badges:createbadge/.test(e.message));
    await assert.rejects(createBadge(context, SITE, COURSE, { name: "X", description: "Y", image: path.join(tmpdir(), "no-such-badge.png") }), /no file/);
    await context.close();
  });
});

describe("setBadgeCriteria", { skip: !browser && "no system browser" }, () => {
  it("adds activity, manual and course criteria, sets any of them, and reads them back", async () => {
    const { context, posts, badges } = await site();
    const { criteria, changed } = await setBadgeCriteria(context, SITE, 8, { activities: { activityIds: [42] }, manual: { roleIds: [3, 4], all: true }, courseCompletion: { minGrade: 50 }, all: false });
    const activity = posts.find((p) => p.path === "criteria.php" && p.form.has("module_41"))!.form;
    assert.deepEqual([activity.getAll("module_41"), activity.getAll("module_42"), activity.get("agg")], [["0"], ["0", "42"], "1"]);
    assert.equal(badges[1]!.overall, "2");
    assert.deepEqual(criteria, { activities: { activityIds: [42], all: true }, courseCompletion: { minGrade: 50 }, manual: { roleIds: [3, 4], all: true }, all: false });
    assert.match(changed, /activities added, courseCompletion added, manual added, all criteria not required/);
    await context.close();
  });

  it("removes a criterion with its confirmed delete link, and edits the existing one in place", async () => {
    const { context, badges, visits } = await site();
    badges[1]!.crit = { 1: { id: 80, ids: [41], agg: "2" }, 2: { id: 81, ids: [3], agg: "2" } };
    const { criteria } = await setBadgeCriteria(context, SITE, 8, { manual: null, activities: { activityIds: [41, 42], all: false } });
    assert.ok(visits.includes("criteria_action.php?badgeid=8&delete=1&type=2&confirm=1&sesskey=s1"));
    assert.ok(visits.includes("criteria_settings.php?badgeid=8&type=1&edit=1&crit=80"));
    assert.deepEqual(criteria, { activities: { activityIds: [41, 42], all: false } });
    await context.close();
  });

  it("refuses an enabled badge, and activities the criterion doesn't offer, before saving", async () => {
    const { context, posts } = await site();
    await assert.rejects(setBadgeCriteria(context, SITE, 7, { manual: null }), (e: Error) => e instanceof BadgeError && /enabled/.test(e.message));
    await assert.rejects(setBadgeCriteria(context, SITE, 8, { activities: { activityIds: [41, 99] } }), (e: Error) => e instanceof BadgeError && /activities 99/.test(e.message));
    assert.equal(posts.length, 0);
    await context.close();
  });
});

describe("setBadgeEnabled", { skip: !browser && "no system browser" }, () => {
  it("enables a badge through Moodle's service, and leaves one already in that state", async () => {
    const { context, state, badges } = await site();
    state.services!.core_badges_enable_badges = (args) => {
      badges.find((b) => b.id === Number((args.badgeids as string[])[0]))!.status = 1;
      return { result: [{ badgeid: 8, awards: "0" }], warnings: [] };
    };
    const { badge } = await setBadgeEnabled(context, SITE, 8, true);
    assert.equal(badge.enabled, true);
    assert.match((await setBadgeEnabled(context, SITE, 8, true)).changed, /already enabled/);
    assert.equal(state.serviceCalls!.filter((c) => c.methodname === "core_badges_enable_badges").length, 1);
    await context.close();
  });

  it("explains Moodle's warnings and a site with badges off", async () => {
    const { context, state } = await site();
    state.services!.core_badges_enable_badges = () => ({ result: [], warnings: [{ item: "8", warningcode: "nocriteria", message: "No criteria" }] });
    await assert.rejects(setBadgeEnabled(context, SITE, 8, true), (e: Error) => e instanceof BadgeError && /no criteria/.test(e.message));
    state.services!.core_badges_disable_badges = () => {
      throw new ServiceFailure("badgesdisabled");
    };
    await assert.rejects(setBadgeEnabled(context, SITE, 7, false), BadgesDisabledError);
    await context.close();
  });
});

describe("awardBadge", { skip: !browser && "no system browser" }, () => {
  it("chooses the role Moodle asks for, awards the participant and reads the badge back", async () => {
    const { context, posts } = await site();
    const { badge, changed } = await awardBadge(context, SITE, 7, 6);
    const form = posts.find((p) => p.path === "award.php")!.form;
    assert.deepEqual([form.getAll("potentialrecipients[]"), form.has("award")], [["6"], true]);
    assert.equal(badge.recipients, 2);
    assert.match(changed, /awarded by hand to user 6 \(2 people have it\)/);
    assert.match((await awardBadge(context, SITE, 7, 6)).changed, /already awarded/);
    await context.close();
  });

  it("refuses a disabled badge, a role the person doesn't award as, and a user Moodle doesn't award", async () => {
    const { context } = await site();
    await assert.rejects(awardBadge(context, SITE, 8, 6), (e: Error) => e instanceof BadgeError && /isn't enabled/.test(e.message));
    await assert.rejects(awardBadge(context, SITE, 7, 6, { roleId: 4 }), (e: Error) => e instanceof BadgeError && /not role 4/.test(e.message));
    await assert.rejects(awardBadge(context, SITE, 7, 99), (e: Error) => e instanceof BadgeError && /didn't award badge 7 to user 99/.test(e.message));
    await context.close();
    const student = await site({ teacher: false });
    await assert.rejects(awardBadge(student.context, SITE, 7, 6), (e: Error) => e instanceof BadgeError && /moodle\/badges:awardbadge/.test(e.message));
    await student.context.close();
  });
});
