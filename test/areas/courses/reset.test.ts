import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Route } from "playwright-core";
import { CourseError, resetCourse } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** Moodle 5.2's reset form, reduced: its own defaults ticked, as it opens. */
const box = (name: string, checked = true) => `<input type="hidden" name="${name}" value="0"><input type="checkbox" name="${name}" value="1"${checked ? " checked" : ""}>`;
const FORM = `<form class="mform" method="post" action="${SITE}course/reset.php"><input type="hidden" name="id" value="7"><input type="hidden" name="_qf__course_reset_form" value="1">
<input type="checkbox" name="reset_start_date[enabled]" value="1" checked><input type="checkbox" name="reset_events" value="1" checked><input type="checkbox" name="reset_gradebook_grades" value="1" checked>
<input type="hidden" name="unenrol_users" value="_qf__force_multiselect_submission"><select multiple name="unenrol_users[]"><option value="5" selected>Student</option><option value="3">Teacher</option></select>
${box("reset_assign_submissions")}${box("reset_quiz_attempts")}${box("reset_scorm")}<input type="checkbox" name="reset_forum_all" value="1" checked>
<input type="submit" name="submitbutton" data-action="resetcourse" value="Reset course"></form>`;
/** The report Moodle shows after resetting: done lines, and a failed one with its icon. */
const REPORT = `<div role="main"><table class="generaltable"><thead><tr><th>Component</th><th>Task</th><th>Status</th></tr></thead><tbody>
<tr><td>Roles</td><td>Unenrol (4)</td><td>Done</td></tr><tr><td>Assignments</td><td>All submissions</td><td>Done</td></tr>
<tr><td>Question banks</td><td></td><td><div><i class="icon fa fa-xmark"></i>Reset not supported</div></td></tr></tbody></table></div>`;

describe("resetCourse", { skip: !browser && "no system browser" }, () => {
  it("unticks the form's defaults, sends only what's asked and returns Moodle's report", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 2, fullName: "Admin" } });
    let posted: URLSearchParams | undefined;
    await context.route(`${SITE}course/reset.php**`, async (route: Route) => {
      if (route.request().method() === "POST") posted = new URLSearchParams(route.request().postData() ?? "");
      await route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 2, bodyId: "page-course-reset", body: posted ? REPORT : FORM }) });
    });
    const result = await resetCourse(context, SITE, 7, { delete: { submissions: true, attempts: true, posts: false }, unenrolRoles: [5] });
    assert.deepEqual(result.report, [
      { component: "Roles", item: "Unenrol (4)", done: true },
      { component: "Assignments", item: "All submissions", done: true },
      { component: "Question banks", item: "", done: false, error: "Reset not supported" },
    ]);
    assert.match(result.changed, /2 tasks done, 1 failed/);
    const sent = Object.fromEntries([...posted!.keys()].map((key) => [key, posted!.getAll(key)]));
    assert.deepEqual(
      [sent.reset_assign_submissions, sent.reset_quiz_attempts, sent.reset_scorm, sent.reset_events, sent.reset_gradebook_grades, sent.reset_forum_all, sent["reset_start_date[enabled]"], sent["unenrol_users[]"]],
      [["0", "1"], ["0", "1"], ["0", "1"], undefined, undefined, undefined, undefined, ["5"]],
    );
    await context.close();
  });

  it("refuses to reset nothing, a role nobody has, and a course the person can't reset", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 2, fullName: "Admin" }, bodies: { "/course/reset.php": FORM } });
    await assert.rejects(resetCourse(context, SITE, 7, {}), { code: "invalid-input" });
    await assert.rejects(resetCourse(context, SITE, 7, { unenrolRoles: [9] }), CourseError);
    await context.close();
    const student = await browser!.newContext();
    await serveFakeMoodle(student, { user: { id: 5, fullName: "Student" } });
    await assert.rejects(resetCourse(student, SITE, 7, { delete: { submissions: true } }), CourseError);
    await student.close();
  });
});
