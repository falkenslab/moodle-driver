import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { MoodleServiceError, NotLoggedInError, activitiesOverview, courseUpdates, deadlines, overviewField } from "../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

// Columns shaped like Moodle 5.2's overview items (made-up values).
const item = (key: string, contenttype: string, content: unknown, alert?: [string, number]) => ({
  key,
  name: key[0]!.toUpperCase() + key.slice(1),
  contenttype,
  alertlabel: alert?.[0] ?? "",
  alertcount: String(alert?.[1] ?? 0),
  contentjson: content === null ? null : JSON.stringify(content),
});
const DUE = item("duedate", "core_calendar\\output\\humandate", { timestamp: 1_797_810_900, date: "Sunday, 20 December", time: "11:55 PM" });
const SUBMISSIONS = item("submissions", "basic", { value: 2, content: "<strong>2</strong> of 4" });
const ACTIONS = item("actions", "core_courseformat\\output\\local\\overview\\overviewaction", { content: "View", linkurl: `${SITE}mod/assign/view.php?id=18&action=grading` }, ["Needs grading", 2]);
const ATTEMPTS = item("totalattempts", "core_courseformat\\output\\local\\overview\\overviewdialog", { buttoncontent: "2", items: [{ label: "Allowed attempts per student", value: "3" }] });
const ANSWERED = item("responded", "core\\output\\pix_icon", { pix: "i/checkedcircle", extras: [{ name: "class", value: "text-success" }, { name: "alt", value: "Answered" }] });

describe("overviewField", () => {
  it("reads each kind of column", () => {
    assert.deepEqual(overviewField(DUE), { key: "duedate", label: "Duedate", text: "Sunday, 20 December 11:55 PM", date: "2026-12-20T23:55:00.000Z" });
    assert.equal(overviewField(SUBMISSIONS).text, "2 of 4");
    assert.deepEqual(overviewField(ACTIONS), { key: "actions", label: "Actions", text: "View", url: `${SITE}mod/assign/view.php?id=18&action=grading`, alert: { label: "Needs grading", count: 2 } });
    assert.deepEqual(overviewField(ATTEMPTS).details, [{ label: "Allowed attempts per student", value: "3" }]);
    assert.equal(overviewField(ANSWERED).text, "Answered");
    assert.equal(overviewField(item("odd", "something\\new", null)).text, "");
  });
});


describe("activitiesOverview, deadlines and courseUpdates", { skip: !browser && "no system browser" }, () => {
  const NAME = (hidden = false) => item("name", "core_courseformat\\output\\local\\overview\\activityname", { activityname: "x", hidden, available: true });
  const state = { cm: [{ id: "5", name: "Notes", module: "page", visible: true, sectionid: "1" }, { id: "18", name: "Essay", module: "assign", visible: false, sectionid: "1" }, { id: "6", name: "Book", module: "book", visible: true, sectionid: "1" }], section: [] };
  const overviews: Record<string, unknown[]> = {
    resource: [{ name: "Notes", modname: "page", cmid: 5, items: [NAME()] }, { name: "Book", modname: "book", cmid: 6, items: [NAME()] }],
    page: [{ name: "Notes", modname: "page", cmid: 5, items: [NAME()] }],
    assign: [{ name: "Essay &amp; more", modname: "assign", cmid: 18, url: `${SITE}mod/assign/view.php?id=18`, items: [NAME(true), DUE, SUBMISSIONS, ACTIONS] }],
  };
  const EVENT = { name: "Essay is due", activityname: "Essay", modulename: "assign", eventtype: "due", timesort: 1_797_810_900, overdue: false, url: `${SITE}mod/assign/view.php?id=18`, course: { id: 3, shortname: "PRG" }, action: { name: "Add submission", url: `${SITE}mod/assign/view.php?id=18&action=editsubmission`, itemcount: 1, actionable: true } };
  const services: FakeMoodleState["services"] = {
    core_courseformat_get_state: () => JSON.stringify(state),
    core_courseformat_get_overview_information: (args) => {
      if (!overviews[String(args.modname)]) throw new ServiceFailure("invalidparameter");
      return { courseid: 3, activities: overviews[String(args.modname)] };
    },
    core_calendar_get_action_events_by_timesort: () => ({ events: [EVENT] }),
    core_calendar_get_action_events_by_course: () => ({ events: [{ ...EVENT, overdue: true, course: undefined, action: undefined }] }),
    core_course_get_updates_since: ({ courseid }) => {
      if (courseid !== 3) throw new ServiceFailure("invalidrecord");
      return { instances: [{ contextlevel: "module", id: 18, updates: [{ name: "configuration", timeupdated: 1_791_545_479 }, { name: "submissions", itemids: [1, 2] }] }, { contextlevel: "course", id: 3, updates: [] }] };
    },
  };
  async function site(): Promise<{ context: BrowserContext; calls: { methodname: string; args: Record<string, unknown> }[] }> {
    const context = await browser!.newContext();
    const calls: { methodname: string; args: Record<string, unknown> }[] = [];
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, services, serviceCalls: calls });
    return { context, calls };
  }

  it("overviews every type once, resources first, and skips types they already brought", async () => {
    const { context, calls } = await site();
    const activities = await activitiesOverview(context, SITE, 3);
    assert.deepEqual(calls.filter((c) => c.methodname === "core_courseformat_get_overview_information").map((c) => c.args.modname), ["resource", "assign"]);
    assert.deepEqual(activities.map((a) => [a.id, a.name, a.visible]), [[5, "Notes", true], [6, "Book", true], [18, "Essay & more", false]]);
    assert.deepEqual(activities[2]?.fields.map((f) => f.key), ["duedate", "submissions", "actions"]);
    await context.close();
  });

  it("overviews one type, passing Moodle's error for a type without an overview", async () => {
    const { context } = await site();
    assert.deepEqual((await activitiesOverview(context, SITE, 3, "page")).map((a) => a.id), [5]);
    await assert.rejects(activitiesOverview(context, SITE, 3, "label"), (error: unknown) => error instanceof MoodleServiceError && error.errorcode === "invalidparameter");
    await context.close();
  });

  it("lists deadlines with their activity and action, in all courses or one", async () => {
    const { context } = await site();
    assert.deepEqual(await deadlines(context, SITE, {}), [
      {
        activityId: 18,
        activity: "Essay",
        type: "assign",
        event: "Essay is due",
        kind: "due",
        date: "2026-12-20T23:55:00.000Z",
        overdue: false,
        course: { id: 3, shortname: "PRG" },
        action: { name: "Add submission", actionable: true, count: 1, url: `${SITE}mod/assign/view.php?id=18&action=editsubmission` },
      },
    ]);
    const [inCourse] = await deadlines(context, SITE, { courseId: 3, days: 10, pastDays: 0 });
    assert.deepEqual([inCourse?.overdue, inCourse?.course, inCourse?.action], [true, undefined, undefined]);
    await context.close();
  });

  it("throws NotLoggedInError for deadlines without a session", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { services });
    await assert.rejects(deadlines(context, SITE, {}), NotLoggedInError);
    await context.close();
  });

  it("lists course updates with the activities' names, and passes Moodle's error", async () => {
    const { context, calls } = await site();
    assert.deepEqual(await courseUpdates(context, SITE, 3, new Date("2026-10-01T00:00:00Z")), [
      { id: 18, name: "Essay", type: "assign", changes: [{ what: "configuration", time: "2026-10-09T11:31:19.000Z" }, { what: "submissions", items: 2 }] },
    ]);
    assert.equal(calls.find((c) => c.methodname === "core_course_get_updates_since")?.args.since, 1_790_812_800);
    await assert.rejects(courseUpdates(context, SITE, 4, new Date()), MoodleServiceError);
    await context.close();
  });
});
