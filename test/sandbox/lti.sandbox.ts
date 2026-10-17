// External tools (LTI) against the sandbox: a site tool set up by the admin for the file, a course
// tool added by the teacher to a scratch course with a test URL Moodle never fetches (localhost is
// in its blocked hosts, so its cartridge check fails at once), both listed, the course tool toggled in
// the activity chooser, an activity made from it and its launch URL for the student; the tool is never
// launched. A deleted course keeps its tools (Moodle 5.2): the course tool is deleted by its test,
// and again after the file if a test failed before; the site tool after the file.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ExternalToolError, type ExternalTool } from "../../src/index.js";
import { openForm, openSitePage, setFields, submitForm } from "../../src/internals.js";
import { SITE, as, cleanup, quietly, scratchCourse, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
/** A URL Moodle doesn't reach (its curl blocks localhost), so nothing goes over the network. */
const TOOL_URL = "http://localhost/driver-check-tool/launch";
const SITE_TOOL = "Driver check site tool";

/** A site tool made by the admin through the site's tool form, offered as preconfigured (not in the activity chooser). */
async function addSiteTool(): Promise<void> {
  const context = await (await as("admin")).context();
  const home = await openSitePage(context, SITE, "user/preferences.php");
  const sesskey = await home.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
  await home.close();
  const page = await openForm(context, SITE, `mod/lti/typessettings.php?action=add&sesskey=${sesskey}`);
  try {
    // The admin page has the site search form first, another Moodle form: the tool's is told by its action.
    await setFields(page, { lti_typename: SITE_TOOL, lti_toolurl: "http://localhost/driver-check-site-tool/launch", lti_coursevisible: 1 }, 'form.mform[action*="typessettings.php"]');
    await submitForm(page, "submitbutton");
  } finally {
    await page.close();
  }
}

describe("lti", () => {
  let course: ScratchCourse;
  let tool: ExternalTool;
  let siteToolId: number;
  let activityId: number;

  before(async () => {
    course = await scratchCourse("lti");
    await addSiteTool();
    siteToolId = (await (await as("admin")).externalTools(course.id)).find((t) => t.name === SITE_TOOL)!.id;
    cleanup(() => (async () => (await as("admin")).callService("mod_lti_delete_tool_type", { id: siteToolId }))());
  }, { timeout: 1_800_000 });

  it("addExternalTool: a course tool with a test URL, its secret kept back", SLOW, async () => {
    const teacher = await as("teacher");
    const result = await teacher.addExternalTool(course.id, { name: "Driver check tool", url: TOOL_URL, description: "Made by the sandbox suite.", key: "driver-key", secret: "driver-secret" });
    tool = result.tool;
    cleanup(() => quietly(() => teacher.deleteExternalTool(course.id, tool.id)));
    assert.deepEqual(tool, { id: tool.id, name: "Driver check tool", description: "Made by the sandbox suite.", scope: "course", url: TOOL_URL, shownInActivityChooser: true });
    assert.match(result.changed, /Added external tool \d+ "Driver check tool"/);
    assert.doesNotMatch(JSON.stringify(result), /driver-secret/);
    await assert.rejects((await as("student")).addExternalTool(course.id, { name: "Driver check refused", url: TOOL_URL }), (e: Error) => e instanceof ExternalToolError && /mod\/lti:addcoursetool/.test(e.message));
  });

  it("externalTools: the site's tool and the course's, as the teacher sees them; refused to a student", SLOW, async () => {
    const tools = await (await as("teacher")).externalTools(course.id);
    assert.deepEqual(tools.find((t) => t.id === tool.id), tool);
    assert.deepEqual(tools.find((t) => t.id === siteToolId), { id: siteToolId, name: SITE_TOOL, description: "", scope: "site", shownInActivityChooser: false });
    await assert.rejects((await as("student")).externalTools(course.id), (e: Error) => e instanceof ExternalToolError && /mod\/lti:addpreconfiguredinstance/.test(e.message));
  });

  // Only the course tool: a site tool's setting for one course is a row Moodle keeps after the tool
  // and the course are deleted (lti_coursevisible, 5.2), which the suite would leave behind.
  it("setExternalToolInChooser: the course tool hidden from the activity chooser", SLOW, async () => {
    const teacher = await as("teacher");
    const hidden = await teacher.setExternalToolInChooser(course.id, tool.id, false);
    assert.equal(hidden.tool.shownInActivityChooser, false);
    assert.match(hidden.changed, /hidden from course \d+'s activity chooser/);
    assert.equal((await teacher.externalTools(course.id)).find((t) => t.id === tool.id)?.shownInActivityChooser, false);
  });

  it("createActivity: an external tool activity from the course tool, hidden from the chooser, which is shown again", SLOW, async () => {
    const teacher = await as("teacher");
    const made = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "lti", toolId: tool.id, name: "Driver check LTI", visibility: "shown" });
    activityId = made.activityId!;
    assert.match(made.changed, /Created lti \d+ "Driver check LTI"/);
    assert.equal(made.sections[0]!.activities.find((a) => a.id === activityId)?.type, "lti");
    await assert.rejects(teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "lti", name: "Driver check no tool" }), { code: "invalid-input" });
    assert.equal((await teacher.setExternalToolInChooser(course.id, tool.id, true)).tool.shownInActivityChooser, true);
  });

  it("externalToolLaunchUrl: the student's launch URL; another module's activity refused", SLOW, async () => {
    const student = await as("student");
    assert.equal(await student.externalToolLaunchUrl(activityId), `${SITE}mod/lti/launch.php?id=${activityId}`);
    const page = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check page", content: "<p>Not a tool.</p>", visibility: "shown" });
    await assert.rejects(student.externalToolLaunchUrl(page.activityId!), (e: Error) => e instanceof ExternalToolError && /mod\/lti:view/.test(e.message));
  });

  it("deleteExternalTool: the course tool deleted, the site tool refused", SLOW, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.deleteExternalTool(course.id, siteToolId), (e: Error) => e instanceof ExternalToolError && /site tool/.test(e.message));
    assert.match((await teacher.deleteExternalTool(course.id, tool.id)).changed, /Deleted external tool/);
    assert.equal((await teacher.externalTools(course.id)).some((t) => t.id === tool.id), false);
  });
});
