import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { CompletionError, courseCompletionCriteria, courseCompletionStatus, markCourseComplete, setCourseCompletionCriteria } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const page = (body: string, bodyId: string) => moodlePage({ userId: 3, body: `<div role="main">${body}</div>`, bodyId });
const errorBox = (message: string, code: string) => `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/moodle/${code}">More information about this error</a></p></div>`;

/** A made-up course 7's completion form, as Moodle 5.2 renders it reduced: activities 5 and 6, roles 3 and 4. */
interface FormState {
  locked: boolean;
  enabled: boolean;
  values: Record<string, string>;
  posts: Record<string, string>[];
}

const checkbox = (state: FormState, name: string, label = "") => {
  const id = `id_${name.replace(/\[(\d+)\]/, "_$1")}`;
  return `<input type="checkbox" name="${name}" value="1" id="${id}"${state.values[name] ? " checked" : ""}${state.locked ? " disabled" : ""}><label for="${id}"> ${label} </label>`;
};
const select = (state: FormState, name: string, options: [string, string][]) =>
  state.locked
    ? `<div id="fitem_id_${name}"><div class="felement" data-fieldtype="select"> ${options.find(([v]) => v === (state.values[name] ?? options[0]![0]))![1]} </div></div>`
    : `<div id="fitem_id_${name}"><div class="felement"><select name="${name}">${options.map(([v, t]) => `<option value="${v}"${state.values[name] === v ? " selected" : ""}>${t}</option>`).join("")}</select></div></div>`;
const dateField = (state: FormState) => {
  if (state.locked) return `<div id="fitem_id_criteria_date_value"><span data-fieldtype="select"> 18 </span><span data-fieldtype="select"> October </span><span data-fieldtype="select"> 2026 </span></div>`;
  const part = (p: string, max: number, from = 1) => `<select name="criteria_date_value[${p}]">${Array.from({ length: max }, (_, i) => `<option value="${i + from}"${state.values[`criteria_date_value[${p}]`] === String(i + from) ? " selected" : ""}>${i + from}</option>`).join("")}</select>`;
  return `<div id="fitem_id_criteria_date_value">${part("day", 31)}${part("month", 12)}${part("year", 10, 2024)}</div>`;
};
const form = (state: FormState) => `<form class="mform" method="post" action="${SITE}course/completion.php?id=7">
<input name="id" type="hidden" value="7"><input name="_qf__course_completion_form" type="hidden" value="1">
${state.locked ? '<input type="submit" name="settingsunlock" value="Unlock">' : ""}
${select(state, "overall_aggregation", [
  ["1", "Course is complete when ALL conditions are met"],
  ["2", "Course is complete when ANY of the conditions are met"],
])}
<input type="hidden" name="criteria_activity[5]" value="0">${checkbox(state, "criteria_activity[5]", "Page - Notes")}
<input type="hidden" name="criteria_activity[6]" value="0">${checkbox(state, "criteria_activity[6]", "Book - Guide")}
${select(state, "activity_aggregation", [
  ["1", "ALL selected activities to be completed"],
  ["2", "ANY selected activities to be completed"],
])}
${checkbox(state, "criteria_date")}${dateField(state)}
${checkbox(state, "criteria_duration")}${select(state, "criteria_duration_days", [
  ["86400", "1 day"],
  ["604800", "7 days"],
])}
${checkbox(state, "criteria_unenrol")}
${checkbox(state, "criteria_grade")}<input type="text" name="criteria_grade_value" value="${state.values.criteria_grade_value ?? "0.00000"}"${state.locked ? " readonly disabled" : ""}>
${checkbox(state, "criteria_self")}
${checkbox(state, "criteria_role[3]", "Teacher")}${checkbox(state, "criteria_role[4]", "Non-editing teacher")}
${select(state, "role_aggregation", [
  ["1", "ALL selected roles to mark when the condition is met"],
  ["2", "ANY selected roles to mark when the condition is met"],
])}
<input type="submit" name="submitbutton" value="Save changes"></form>`;

/** The fake course 7: its completion form (posted, it keeps what's sent), its settings form's "Enable completion tracking". */
async function fakeCourse(state: FormState, { canEdit = true } = {}): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, {
    user: { id: 3, fullName: "Teacher" },
    services: {
      core_get_strings: ({ strings }) =>
        (strings as { stringid: string }[]).map(({ stringid }) => ({ stringid, string: stringid === "overallaggregation_any" ? "Course is complete when ANY of the conditions are met" : stringid === "locale" ? "en_AU.UTF-8" : `(${stringid})` })),
    },
  });
  await context.route(`${SITE}course/completion.php**`, async (route: Route) => {
    if (!canEdit) return route.fulfill({ status: 200, contentType: "text/html", body: page(errorBox("Sorry, but you do not currently have permissions to do that (Edit course settings).", "nopermissions"), "page-course-completion") });
    if (route.request().method() === "POST") {
      const sent = Object.fromEntries(new URLSearchParams(route.request().postData() ?? ""));
      state.posts.push(sent);
      if (sent.settingsunlock) state.locked = false;
      else state.values = Object.fromEntries(Object.entries(sent).filter(([, v]) => v !== "0"));
      // Saved: Moodle goes on to the course; unlocked, back to the form.
      if (!sent.settingsunlock) return route.fulfill({ status: 200, contentType: "text/html", body: page("<p>Course</p>", "page-course-view-topics") });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: page(form(state), "page-course-completion") });
  });
  await context.route(`${SITE}course/edit.php**`, (route: Route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: page(`<form class="mform"><select name="enablecompletion" id="id_enablecompletion"><option value="0"${state.enabled ? "" : " selected"}>No</option><option value="1"${state.enabled ? " selected" : ""}>Yes</option></select></form>`, "page-course-edit") }),
  );
  return context;
}

const OFFERED = {
  activities: [
    { id: 5, name: "Page - Notes" },
    { id: 6, name: "Book - Guide" },
  ],
  roles: [
    { id: 3, name: "Teacher" },
    { id: 4, name: "Non-editing teacher" },
  ],
};

const fresh = (): FormState => ({ locked: false, enabled: true, values: { overall_aggregation: "1", activity_aggregation: "1", role_aggregation: "1" }, posts: [] });

describe("courseCompletionCriteria and setCourseCompletionCriteria", { skip: !browser && "no system browser" }, () => {
  it("reads the criteria the form holds, and what it offers", async () => {
    const state = fresh();
    Object.assign(state.values, { "criteria_activity[6]": "1", activity_aggregation: "2", criteria_grade: "1", criteria_grade_value: "50.00000", criteria_self: "1", "criteria_role[3]": "1", criteria_duration: "1", criteria_duration_days: "604800" });
    const context = await fakeCourse(state);
    assert.deepEqual(await courseCompletionCriteria(context, SITE, 7), {
      enabled: true,
      locked: false,
      overall: "all",
      activities: { activityIds: [6], all: false },
      enrolmentDays: 7,
      grade: 50,
      self: true,
      roles: { roleIds: [3], all: true },
      offered: OFFERED,
    });
    await context.close();
  });

  it("reads a locked form, whose selects show only their text, by Moodle's strings", async () => {
    const state = fresh();
    Object.assign(state.values, { overall_aggregation: "2", "criteria_activity[5]": "1", criteria_date: "1", criteria_duration: "1", criteria_duration_days: "604800" });
    state.locked = true;
    const context = await fakeCourse(state);
    // 18 October 2026, at the start of the day in Madrid.
    assert.deepEqual(await courseCompletionCriteria(context, SITE, 7), { enabled: true, locked: true, overall: "any", activities: { activityIds: [5], all: true }, date: "2026-10-17T22:00:00.000Z", enrolmentDays: 7, offered: OFFERED });
    await context.close();
  });

  it("sets what's given, leaves the rest, and removes what's null", async () => {
    const state = fresh();
    Object.assign(state.values, { criteria_self: "1", "criteria_role[4]": "1" });
    const context = await fakeCourse(state);
    const result = await setCourseCompletionCriteria(context, SITE, 7, { overall: "any", activities: { activityIds: [5, 6] }, grade: 6.5, roles: null, date: new Date("2026-11-02T10:00:00Z") });
    assert.match(result.changed, /overall, activities, grade, roles, date/);
    assert.deepEqual(result.criteria, { enabled: true, locked: false, overall: "any", activities: { activityIds: [5, 6], all: true }, date: "2026-11-01T23:00:00.000Z", grade: 6.5, self: true, offered: OFFERED });
    const sent = state.posts.at(-1)!;
    assert.deepEqual([sent["criteria_role[4]"], sent.criteria_grade_value, sent["criteria_date_value[day]"]], [undefined, "6.5", "2"]);
    await context.close();
  });

  it("refuses activities the form doesn't offer, a locked course unless unlocked, and completion off", async () => {
    const state = fresh();
    const context = await fakeCourse(state);
    await assert.rejects(setCourseCompletionCriteria(context, SITE, 7, { activities: { activityIds: [9] } }), (error: Error) => error instanceof CompletionError && /activities 9.*\(5, 6\)/.test(error.message));
    await assert.rejects(setCourseCompletionCriteria(context, SITE, 7, {}), /Nothing to change/);
    state.locked = true;
    await assert.rejects(setCourseCompletionCriteria(context, SITE, 7, { self: true }), (error: Error) => error instanceof CompletionError && /locked/.test(error.message));
    const unlocked = await setCourseCompletionCriteria(context, SITE, 7, { self: true }, { unlock: true });
    assert.match(unlocked.changed, /unlocked/);
    assert.deepEqual([unlocked.criteria.locked, unlocked.criteria.self], [false, true]);
    state.enabled = false;
    await assert.rejects(setCourseCompletionCriteria(context, SITE, 7, { self: false }), (error: Error) => error instanceof CompletionError && /isn't enabled/.test(error.message));
    await context.close();
  });

  it("names the capability when the person can't edit the course", async () => {
    const context = await fakeCourse(fresh(), { canEdit: false });
    await assert.rejects(courseCompletionCriteria(context, SITE, 7), (error: Error) => error instanceof CompletionError && /moodle\/course:update/.test(error.message));
    await context.close();
  });
});

/** The course completion report as Moodle 5.2 renders it, reduced: activity 5, the grade, the teacher's mark, the course. */
const REPORT = (toggle: boolean) => `<table id="completion-progress"><thead><tr><th class="completion-sortchoice">Name</th><th class="completion-identifyfield">Email address</th>
<th class="criteriaicon"><a href="${SITE}mod/page/view.php?id=5" title="Notes"><img class="icon" alt="Page" src="${SITE}theme/image.php/boost/mod_page/1/monologo"></a></th>
<th class="criteriaicon"><i class="icon fa fa-clipboard-check fa-fw icon" title="Course grade"></i></th>
<th class="criteriaicon"><i class="icon fa fa-user-tie fa-fw icon" title="Teacher"></i></th>
<th class="criteriaicon"><i class="icon fa fa-graduation-cap fa-fw" title="Course complete"></i></th></tr></thead><tbody>
<tr id="user-4"><th scope="row"><a href="${SITE}blocks/completionstatus/details.php?course=7&amp;user=4">Ana Student</a></th><td>ana@example.org</td>
<td class="completion-progresscell"><img src="${SITE}theme/image.php/boost/core/1/i/completion-manual-y"></td>
<td class="completion-progresscell"><img src="${SITE}theme/image.php/boost/core/1/i/completion-auto-n"></td>
<td class="completion-progresscell">${toggle ? `<a href="${SITE}course/togglecompletion.php?user=4&amp;course=7&amp;rolec=12&amp;sesskey=s1">` : ""}<img src="${SITE}theme/image.php/boost/core/1/i/completion-manual-n">${toggle ? "</a>" : ""}</td>
<td class="completion-progresscell"><img src="${SITE}theme/image.php/boost/core/1/i/completion-auto-n"></td></tr></tbody></table>`;

async function fakeReport({ toggle = true, criteria = true, allowed = true } = {}): Promise<{ context: BrowserContext; marked: string[] }> {
  const context = await browser!.newContext();
  const marked: string[] = [];
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: { core_get_strings: () => { throw new ServiceFailure("unused"); } } });
  await context.route(`${SITE}report/completion/index.php**`, (route: Route) => {
    const url = new URL(route.request().url());
    if (!allowed) return route.fulfill({ status: 200, contentType: "text/html", body: page(errorBox("Sorry, but you do not currently have permissions to do that (View course completion report).", "nopermissions"), "page-report-completion-index") });
    if (!criteria) return route.fulfill({ status: 200, contentType: "text/html", body: page(errorBox("No completion criteria set for this course", "nocriteriaset"), "page-report-completion-index") });
    if (url.searchParams.get("format") === "csv") {
      const mark = marked.length > 0 ? '"2026-10-17 20:15:00"' : "";
      return route.fulfill({
        status: 200,
        contentType: "text/csv",
        body: `ID,Name,"Email address",Notes,"Notes - Completion date","50.00 required",Teacher,"Course complete"\n4,"Ana Student",ana@example.org,Completed,"2026-10-17 20:12:17",${marked.length > 0 ? '"2026-10-17 20:14:00"' : ""},${mark},${mark}\n6,"Bruno Student",bruno@example.org,"Not completed",,,,\n`,
      });
    }
    return route.fulfill({ status: 200, contentType: "text/html", body: page(REPORT(toggle), "page-report-completion-index") });
  });
  await context.route(`${SITE}course/togglecompletion.php**`, (route: Route) => {
    marked.push(route.request().url());
    return route.fulfill({ status: 200, contentType: "text/html", body: page("<p>Report</p>", "page-report-completion-index") });
  });
  return { context, marked };
}

describe("courseCompletionStatus and markCourseComplete", { skip: !browser && "no system browser" }, () => {
  it("reads each participant's criteria by the columns' icons and the export's dates", async () => {
    const { context } = await fakeReport();
    const all = await courseCompletionStatus(context, SITE, 7);
    assert.deepEqual(all[0], {
      userId: 4,
      fullName: "Ana Student",
      complete: false,
      criteria: [
        { type: "activity", activityId: 5, name: "Notes", met: true, metAt: "2026-10-17T18:12:17.000Z" },
        { type: "grade", name: "Course grade", met: false },
        { type: "role", name: "Teacher", met: false },
      ],
      markable: true,
    });
    assert.deepEqual(
      all.map((s) => s.userId),
      [4, 6],
    );
    assert.deepEqual((await courseCompletionStatus(context, SITE, 7, { userId: 6 })).map((s) => s.fullName), ["Bruno Student"]);
    const second = await courseCompletionStatus(context, SITE, 7, { limit: 1, offset: 1 });
    assert.deepEqual([second.items.map((s) => s.userId), second.more], [[6], false]);
    await context.close();
  });

  it("marks someone complete through the report's link, once", async () => {
    const { context, marked } = await fakeReport();
    const result = await markCourseComplete(context, SITE, 7, 4);
    assert.match(marked[0] ?? "", /togglecompletion\.php\?user=4&course=7&rolec=12&sesskey=s1/);
    assert.deepEqual([result.status.complete, result.status.completedAt, result.status.criteria.map((c) => c.met)], [true, "2026-10-17T18:15:00.000Z", [true, true, true]]);
    assert.match((await markCourseComplete(context, SITE, 7, 4)).changed, /already/);
    assert.equal(marked.length, 1);
    await assert.rejects(markCourseComplete(context, SITE, 7, 99), CompletionError);
    await context.close();
  });

  it("explains what Moodle refuses: no role to mark with, no criteria, no capability", async () => {
    let fake = await fakeReport({ toggle: false });
    await assert.rejects(markCourseComplete(fake.context, SITE, 7, 4), (error: Error) => error instanceof CompletionError && /moodle\/course:markcomplete/.test(error.message));
    assert.equal((await courseCompletionStatus(fake.context, SITE, 7))[0]?.markable, false);
    await fake.context.close();
    fake = await fakeReport({ criteria: false });
    await assert.rejects(courseCompletionStatus(fake.context, SITE, 7), (error: Error) => error instanceof CompletionError && /no course completion criteria/.test(error.message));
    await fake.context.close();
    fake = await fakeReport({ allowed: false });
    await assert.rejects(courseCompletionStatus(fake.context, SITE, 7), (error: Error) => error instanceof CompletionError && /report\/completion:view/.test(error.message));
    await fake.context.close();
  });
});
