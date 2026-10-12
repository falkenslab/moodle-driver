import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { ReportError, activityReport, courseLogs, participationReport } from "../../../src/index.js";
import { parseMoodleDate } from "../../../src/areas/reports/dates.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// The language's formats as core_get_strings returns them (Moodle 5.2's English).
const STRINGS = {
  core_get_strings: (args: Record<string, unknown>) =>
    (args.strings as { stringid: string }[]).map(({ stringid }) => ({
      stringid,
      component: "langconfig",
      lang: "en",
      string: ({ strftimedatetimeaccurate: "%d %B %Y, %I:%M:%S %p", strftimedaydatetime: "%A, %d %B %Y, %I:%M %p", locale: "en_AU.UTF-8" } as Record<string, string>)[stringid] ?? "",
    })),
};

describe("parseMoodleDate", () => {
  it("reads a date back with the format, the language's month names and the person's time zone", () => {
    const english = { format: "%d %B %Y, %I:%M:%S %p", locale: "en_AU.UTF-8", timeZone: "Europe/Madrid" };
    assert.equal(parseMoodleDate("11 October 2026, 8:03:37 PM", english)?.toISOString(), "2026-10-11T18:03:37.000Z");
    assert.equal(parseMoodleDate("1 January 2026, 12:05:00 AM", english)?.toISOString(), "2025-12-31T23:05:00.000Z");
    const day = { format: "%A, %d %B %Y, %I:%M %p", locale: "en_AU.UTF-8", timeZone: "UTC" };
    assert.equal(parseMoodleDate("Friday, 9 October 2026, 11:52 PM (1 day 20 hours)", day)?.toISOString(), "2026-10-09T23:52:00.000Z");
    const spanish = { format: "%d de %B de %Y, %H:%M:%S", locale: "es_ES.UTF-8", timeZone: "Europe/Madrid" };
    assert.equal(parseMoodleDate("11 de octubre de 2026, 20:03:37", spanish)?.toISOString(), "2026-10-11T18:03:37.000Z");
    assert.equal(parseMoodleDate("yesterday", english), undefined);
  });
});

/** The logs report as Moodle 5.2 renders it, reduced: its filter form and the table's nine cells per row. */
const logRow = (time: string, user: string, context: string, event: string, related = "-") => `<tr><td class="cell c0">${time}</td><td class="cell c1">${user}</td><td class="cell c2">${related}</td>
<td class="cell c3">${context}</td><td class="cell c4">Page</td><td class="cell c5"><a href="#">${event}</a></td><td class="cell c6">The user with id &#039;5&#039; viewed the &#039;page&#039; activity.</td>
<td class="cell c7">web</td><td class="cell c8"><a href="#">172.18.0.6</a></td></tr>`;
const LUCIA = `<a href="${SITE}user/view.php?id=5&amp;course=3">Lucia Martin</a>`;
const PAGE5 = `<a href="${SITE}mod/page/view.php?id=5">Page: Apuntes</a>`;
const LOGS = `<form class="logselecform" action="${SITE}report/log/index.php"><select name="modid"></select></form>
<table class="reportlog generaltable"><tbody>
${logRow("11 October 2026, 8:04:12 PM", LUCIA, PAGE5, "Course module viewed")}
${logRow("11 October 2026, 8:03:37 PM", `<a href="${SITE}user/view.php?id=2&amp;course=3">Admin</a> as <a href="${SITE}user/view.php?id=5&amp;course=3">Lucia Martin</a>`, `<a href="${SITE}course/view.php?id=3">Course: Programming</a>`, "Course viewed", LUCIA)}
${logRow("10 October 2026, 9:00:00 AM", "-", "Other", "Something")}
<tr class="emptyrow"><td class="cell c0"></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
</tbody></table>`;

describe("courseLogs", { skip: !browser && "no system browser" }, () => {
  it("reads the rows in the driver's terms, filtering by user, activity and action in Moodle's query", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: STRINGS, bodies: { "/report/log/index.php": LOGS } });
    const asked: string[] = [];
    context.on("request", (request) => void (request.url().includes("report/log") && asked.push(request.url())));
    const entries = await courseLogs(context, SITE, 3, { userId: 5, activityId: 5, action: "view" });
    assert.deepEqual(entries[0], {
      time: "2026-10-11T18:04:12.000Z",
      timeText: "11 October 2026, 8:04:12 PM",
      userId: 5,
      userName: "Lucia Martin",
      context: "Page: Apuntes",
      activityId: 5,
      component: "Page",
      event: "Course module viewed",
      description: "The user with id '5' viewed the 'page' activity.",
      origin: "web",
      ip: "172.18.0.6",
    });
    assert.deepEqual([entries[1]!.userId, entries[1]!.realUserId, entries[1]!.relatedUserId, entries[1]!.activityId], [5, 2, 5, undefined]);
    assert.deepEqual([entries[2]!.userId, entries[2]!.userName, entries.length], [undefined, "-", 3]);
    const query = new URL(asked[0]!).searchParams;
    assert.deepEqual([query.get("id"), query.get("user"), query.get("modid"), query.get("modaction"), query.get("chooselog")], ["3", "5", "5", "r", "1"]);
    await context.close();
  });

  it("keeps to the time span and the limit", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: STRINGS, bodies: { "/report/log/index.php": LOGS } });
    const span = await courseLogs(context, SITE, 3, { from: new Date("2026-10-11T00:00:00Z"), until: new Date("2026-10-11T18:04:00Z") });
    assert.deepEqual(span.map((e) => e.time), ["2026-10-11T18:03:37.000Z"]);
    await context.close();
  });

  it("gives a page of entries with limit and offset, and whether there are more", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: STRINGS, bodies: { "/report/log/index.php": LOGS } });
    const asked: string[] = [];
    context.on("request", (request) => void (request.url().includes("report/log") && asked.push(request.url())));
    const first = await courseLogs(context, SITE, 3, { limit: 2 });
    assert.deepEqual([first.items.map((e) => e.timeText), first.more], [["11 October 2026, 8:04:12 PM", "11 October 2026, 8:03:37 PM"], true]);
    const last = await courseLogs(context, SITE, 3, { limit: 2, offset: 2 });
    assert.deepEqual([last.items.map((e) => e.timeText), last.more], [["10 October 2026, 9:00:00 AM"], false]);
    // Without limit, the list as before (its first 100).
    assert.equal((await courseLogs(context, SITE, 3, { offset: 1 })).length, 2);
    assert.deepEqual(asked.map((url) => new URL(url).searchParams.get("perpage")), ["20", "20", "101"]);
    await context.close();
  });

  it("says so when the person can't see the logs", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, services: STRINGS, bodies: { "/report/log/index.php": '<div data-rel="fatalerror"><p class="errormessage">Sorry</p></div>' } });
    await assert.rejects(courseLogs(context, SITE, 3), ReportError);
    await context.close();
  });
});

/** The activity report's table (`#outlinereport`), reduced: the activity link, the views cell, the last access. */
const OUTLINE = `<form><input name="filterstartdate[day]"></form><table id="outlinereport"><tbody>
<tr><td class="cell activityname"><a href="${SITE}mod/page/view.php?id=5">Apuntes</a></td><td class="cell numviews">11 views by 3 users</td><td class="cell blog">-</td><td class="cell lastaccess">Sunday, 11 October 2026, 8:03 PM (3 mins)</td></tr>
<tr><td class="cell activityname"><a href="${SITE}mod/feedback/view.php?id=34">Feedback</a></td><td class="cell numviews">-</td><td class="cell blog">-</td><td class="cell lastaccess"></td></tr>
</tbody></table>`;

describe("activityReport", { skip: !browser && "no system browser" }, () => {
  it("gives each activity's views, viewers and last access", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: STRINGS, bodies: { "/report/outline/index.php": OUTLINE } });
    assert.deepEqual(await activityReport(context, SITE, 3), [
      { activityId: 5, type: "page", name: "Apuntes", views: 11, users: 3, lastAccess: "2026-10-11T18:03:00.000Z" },
      { activityId: 34, type: "feedback", name: "Feedback", views: 0, users: 0 },
    ]);
    await context.close();
  });

  it("says so when the person can't see it", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, services: STRINGS });
    await assert.rejects(activityReport(context, SITE, 3), ReportError);
    await context.close();
  });
});

/** The participation report, reduced: its form's activities and roles, and a row per person (count in the checkbox). */
const participationRow = (id: number, name: string, count: number) =>
  `<tr><td class="cell c0"><a href="${SITE}user/view.php?id=${id}&amp;course=3">${name}</a></td><td class="cell c1">${count ? `Yes (${count})` : "No"}</td><td class="cell c2"><input class="usercheckbox" name="user${id}" value="${count}"></td></tr>`;
const PARTICIPATION = `<form class="participationselectform"><select name="instanceid"><option value="">Choose...</option><optgroup label="Pages"><option value="5">Apuntes</option></optgroup></select>
<select name="roleid"><option value="3">Teacher</option><option value="5">Student</option></select></form>
<div id="participationreport"><table><tbody>${participationRow(5, "Lucia Martin", 11)}${participationRow(6, "Marcos Lopez", 0)}<tr class="emptyrow"><td></td><td></td><td></td></tr></tbody></table></div>`;

describe("participationReport", { skip: !browser && "no system browser" }, () => {
  it("lists everyone with the role, with how many actions they made in the activity", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/report/participation/index.php": PARTICIPATION } });
    const asked: string[] = [];
    context.on("request", (request) => void (request.url().includes("report/participation") && asked.push(request.url())));
    assert.deepEqual(await participationReport(context, SITE, 3, 5, { roleId: 5, since: new Date("2026-10-01T00:00:00Z"), action: "post" }), [
      { userId: 5, fullName: "Lucia Martin", roleId: 5, actions: 11 },
      { userId: 6, fullName: "Marcos Lopez", roleId: 5, actions: 0 },
    ]);
    const query = new URL(asked[0]!).searchParams;
    assert.deepEqual([query.get("instanceid"), query.get("roleid"), query.get("timefrom"), query.get("action")], ["5", "5", "1790812800", "post"]);
    await context.close();
  });

  it("asks for every role the report offers unless given one, and refuses an activity it doesn't list", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/report/participation/index.php": PARTICIPATION } });
    assert.deepEqual((await participationReport(context, SITE, 3, 5)).map((p) => p.roleId), [3, 3, 5, 5]);
    await assert.rejects(participationReport(context, SITE, 3, 99), ReportError);
    await context.close();
  });
});
