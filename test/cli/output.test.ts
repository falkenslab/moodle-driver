import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { human, render } from "../../src/cli/output.js";

// Rows shaped as listCourses returns them (made up): ten columns, a URL, dates, empty fields.
const courses = [3, 142].map((id) => ({
  id,
  shortname: id === 3 ? "mcp-content" : "ake-tests",
  fullname: id === 3 ? "Contenido para moodle-mcp" : "agent-kit-extensions tests",
  category: "Category 1",
  url: `http://localhost:8080/course/view.php?id=${id}`,
  visible: true,
  startDate: "2026-10-08T23:00:00.000Z",
  endDate: undefined,
  progress: undefined,
  lastAccess: undefined,
}));

describe("the moodle command's tables", () => {
  it("fit a terminal 80 columns wide: one line per row, the ids and names kept, the rest said", () => {
    const text = human(courses, 80);
    const lines = text.split("\n");
    assert.ok(lines.every((line) => line.length <= 80), text);
    assert.match(lines[0]!, /^id +shortname +fullname/);
    assert.match(lines[2]!, /^3 +mcp-content +Contenido para moodle-mcp/);
    // Empty columns go first, then URLs, then from the last.
    assert.match(text, /\nLeft out: url, startDate, endDate, progress, lastAccess \(--json has every\ncolumn\)\.$/);
    assert.match(lines[0]!, /visible$/);
    // The dates went too: no time zone to state.
    assert.doesNotMatch(text, /UTC/);
  });

  it("keep a shortened date, saying its time zone once", () => {
    const text = human(courses, 90);
    assert.ok(text.split("\n").every((line) => line.length <= 90), text);
    assert.match(text, /\n3 +mcp-content .* true +2026-10-08 23:00\n/);
    assert.match(text, /\nLeft out: url, endDate, progress, lastAccess \(--json has every column\)\. Times in UTC\.$/);
  });

  it("leave out long texts before the columns after them", () => {
    // A row shaped as deadlines returns it (made up).
    const deadlines = [{ activityId: 35, activity: "Tarea MCP", type: "assign", event: "Tarea MCP is due to be graded", kind: "gradingdue", date: "2026-10-22T23:00:00.000Z", overdue: false, course: { id: 3, shortname: "mcp-content" }, action: { name: "Grade", url: "http://localhost:8080/mod/assign/view.php?id=35&action=grader" } }];
    const text = human(deadlines, 80);
    assert.ok(text.split("\n").every((line) => line.length <= 80), text);
    assert.match(text, /^activityId +activity +type +kind +date +overdue\n/);
    assert.match(text, /\n35 +Tarea MCP +assign +gradingdue +2026-10-22 23:00 +false\n/);
    assert.match(text, /\nLeft out: event, course, action \(--json has every column\)\. Times in UTC\.$/);
  });

  it("shorten dates, in UTC, before leaving out a column", () => {
    const rows = [{ id: 35, activity: "Tarea MCP", date: "2026-10-22T23:00:00.000Z", at: "2026-10-22T23:00:15.000Z" }];
    const text = human(rows, 56);
    assert.match(text, /\n35 +Tarea MCP +2026-10-22 23:00 +2026-10-22 23:00:15\n/);
    assert.match(text, /\nTimes in UTC\.$/);
    assert.doesNotMatch(text, /Left out/);
  });

  it("stay whole without a width, as when the output isn't a terminal", () => {
    const text = render(courses, false);
    assert.match(text.split("\n")[0]!, /^id +shortname +fullname +category +url +visible +startDate +endDate +progress +lastAccess$/);
    assert.match(text, /2026-10-08T23:00:00\.000Z/);
    assert.doesNotMatch(text, /Left out|UTC/);
    assert.equal(human(courses, 500), text);
  });

  it("name what lists of objects and objects hold", () => {
    const participants = [
      { userId: 4, fullName: "Alumno Demo", roles: [{ id: 5, shortname: "student", name: "" }], groups: [{ id: 1, name: "Group A" }, { id: 2, name: "Group B" }] },
      { userId: 3, fullName: "Profesor Demo", roles: [{ id: 3, shortname: "editingteacher" }], groups: [] },
    ];
    const text = human(participants);
    assert.match(text, /\n4 +Alumno Demo +student +Group A, Group B\n/);
    assert.match(text, /\n3 +Profesor Demo +editingteacher$/);
    const deadlines = [{ activityId: 35, course: { id: 3, shortname: "mcp-content" }, section: { number: 1, title: "New section" }, extra: { a: 1 }, ids: [{ id: 7 }], odd: [{ a: 1 }] }];
    assert.match(human(deadlines), /\n35 +mcp-content +New section +\{"a":1\} +7 +\[1\]$/);
  });

  it("leave key-value lines and JSON as they were", () => {
    assert.equal(human({ course: { id: 3, shortname: "mcp-content" } }, 80), 'course  {"id":3,"shortname":"mcp-content"}');
    assert.equal(render(courses, true, 80), JSON.stringify(courses, null, 2));
  });
});
