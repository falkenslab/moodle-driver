import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { overviewField } from "../../src/index.js";
import { SITE, launchTestBrowser } from "../../src/testing/index.js";
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

