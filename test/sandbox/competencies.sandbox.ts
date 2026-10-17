// Competencies against the sandbox, which has them enabled but no framework: the admin makes a
// framework ("Driver check …", on Moodle's default competence scale) with two competencies through
// Moodle's own services; the teacher adds them to a scratch course, links one to a page, and rates a
// throwaway student in it with a note. A rating makes a user competency, which keeps Moodle from
// deleting the framework while the account lives (competency::can_all_be_deleted): so the rated
// student is a throwaway account, deleted with its ratings (hook_user_deleted) before the framework.
// The suite's student only reads. Nothing is left: the account, the course, then the framework go.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { before, describe, it } from "node:test";
import { CompetencyError, MoodleError } from "../../src/index.js";
import { callService, openForm, setFields } from "../../src/internals.js";
import { SITE, as, cleanup, scratchCourse, userId, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
/** Moodle's "Default competence scale" (Not yet competent, Competent), there on every site. */
const COMPETENCE_SCALE = 2;
const STUDENT_ROLE = 5;

async function accountId(username: string): Promise<number | undefined> {
  return (await (await as("admin")).callService<{ id: number }[]>("core_user_get_users_by_field", { field: "username", values: [username] }))[0]?.id;
}

/** Deletes an account the file made, as the admin through Moodle's user list, as its "Delete" button does. */
async function deleteUser(username: string): Promise<void> {
  const id = await accountId(username);
  if (!id) return;
  const page = await (await (await as("admin")).context()).newPage();
  try {
    await page.goto(`${SITE}my/`, { waitUntil: "domcontentloaded" });
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    const confirm = createHash("md5").update(String(id)).digest("hex");
    await page.goto(`${SITE}admin/user.php?delete=${id}&confirm=${confirm}&sesskey=${sesskey}`, { waitUntil: "domcontentloaded" });
  } finally {
    await page.close();
  }
  if (await (await as("admin")).userById(id)) throw new Error(`The throwaway account ${id} wasn't deleted.`);
}

describe("competencies", () => {
  let course: ScratchCourse;
  let frameworkId: number;
  let first: number;
  let second: number;
  let pageId: number;
  let rated: number;

  before(async () => {
    const admin = await as("admin");
    const context = await admin.context();
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const framework = await callService<{ id: number }>(context, SITE, "core_competency_create_competency_framework", {
      competencyframework: {
        shortname: `Driver check framework ${stamp}`,
        idnumber: `drivercheck-${stamp}`,
        scaleid: COMPETENCE_SCALE,
        // The scale's default rating and the proficient one: "Competent" (2) is proficient.
        scaleconfiguration: JSON.stringify([{ scaleid: String(COMPETENCE_SCALE) }, { id: 1, scaledefault: 1, proficient: 0 }, { id: 2, scaledefault: 0, proficient: 1 }]),
        contextid: 1,
        visible: true,
      },
    });
    frameworkId = framework.id;
    // Registered first, so it runs last: after the account and the course that use its competencies.
    cleanup(async () => {
      const deleted = await callService<boolean>(context, SITE, "core_competency_delete_competency_framework", { id: frameworkId });
      if (!deleted) throw new Error(`Moodle didn't delete framework ${frameworkId}: something still uses its competencies.`);
    });
    const make = (n: number) => callService<{ id: number }>(context, SITE, "core_competency_create_competency", { competency: { shortname: `Driver check competency ${n} ${stamp}`, idnumber: `drivercheck-${n}-${stamp}`, description: `<p>Competency ${n}.</p>`, competencyframeworkid: frameworkId } });
    first = (await make(1)).id;
    second = (await make(2)).id;
    course = await scratchCourse("competencies");
    const made = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check competency page", content: "<p>Read me.</p>", visibility: "shown" });
    pageId = made.activityId!;
    // The throwaway student, enrolled in the course; its password is random and never shown.
    const username = `drivercheckcomp${stamp}`;
    cleanup(() => deleteUser(username));
    const form = await openForm(context, SITE, "user/editadvanced.php?id=-1");
    try {
      const userForm = 'form.mform:has([name="username"])';
      await setFields(form, { username, newpassword: `Dc-${randomBytes(12).toString("hex")}-X!`, firstname: "Driver", lastname: "Check", email: `${username}@example.org` }, userForm);
      await Promise.all([form.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 300_000 }), form.click(`${userForm} [name="submitbutton"]`, { noWaitAfter: true })]);
    } finally {
      await form.close();
    }
    rated = (await accountId(username))!;
    assert.ok(rated, "the throwaway student was created");
    await admin.enrolUsers(course.id, [rated], { roleId: STUDENT_ROLE });
  }, { timeout: 1_800_000 });

  it("competencyFrameworks: the teacher sees the new framework and its competencies", SLOW, async () => {
    const frameworks = await (await as("teacher")).competencyFrameworks(course.id);
    const framework = frameworks.find((f) => f.id === frameworkId);
    assert.ok(framework, "the framework is listed");
    assert.match(framework.shortName, /^Driver check framework/);
    assert.deepEqual(framework.competencies.map((c) => [c.id, c.parentId]), [[first, 0], [second, 0]]);
    assert.equal(framework.competencies[0]!.description, "<p>Competency 1.</p>");
  });

  it("addCourseCompetency: the teacher adds both, once; the student can't", SLOW, async () => {
    const teacher = await as("teacher");
    const added = await teacher.addCourseCompetency(course.id, first);
    assert.match(added.changed, /^Added/);
    await teacher.addCourseCompetency(course.id, second);
    const again = await teacher.addCourseCompetency(course.id, first);
    assert.match(again.changed, /already/);
    assert.deepEqual(again.competencies.map((c) => c.id), [first, second]);
    await assert.rejects((await as("student")).addCourseCompetency(course.id, first), (error: unknown) => error instanceof CompetencyError && error.message.includes("coursecompetencymanage"));
  });

  it("courseCompetencies: both, with their framework, for the teacher and the student", SLOW, async () => {
    const teacher = await (await as("teacher")).courseCompetencies(course.id);
    assert.deepEqual(teacher.map((c) => [c.id, c.framework.id, c.activities]), [[first, frameworkId, []], [second, frameworkId, []]]);
    assert.match(teacher[0]!.framework.name, /^Driver check framework/);
    assert.match(teacher[0]!.shortName, /^Driver check competency 1/);
    assert.deepEqual(await (await as("student")).courseCompetencies(course.id), teacher);
  });

  it("setActivityCompetencies: the page linked to the first, read back; a competency not in the course refused", SLOW, async () => {
    const teacher = await as("teacher");
    const result = await teacher.setActivityCompetencies(pageId, [first]);
    assert.deepEqual(result.competencyIds, [first]);
    const linked = await teacher.courseCompetencies(course.id);
    assert.deepEqual(linked.map((c) => c.activities.map((a) => a.id)), [[pageId], []]);
    assert.equal(linked[0]!.activities[0]!.name, "Driver check competency page");
    await assert.rejects(teacher.setActivityCompetencies(pageId, [999_999]), CompetencyError);
    await assert.rejects((await as("student")).setActivityCompetencies(pageId, []), CompetencyError);
  });

  it("competencyRating: unrated at first, on the competence scale; the student reads their own", SLOW, async () => {
    const rating = await (await as("teacher")).competencyRating(course.id, rated, first);
    assert.deepEqual([rating.rating, rating.proficient, rating.evidence, rating.canRate], [null, null, [], true]);
    assert.deepEqual(rating.scale.map((s) => [s.value, s.proficient]), [[1, false], [2, true]]);
    const own = await (await as("student")).competencyRating(course.id, await userId("student"), first);
    assert.deepEqual([own.rating, own.canRate], [null, false]);
  });

  it("rateCompetency: the throwaway student rated Competent with a note, kept as evidence", SLOW, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.rateCompetency(course.id, rated, first, { rating: 7 }), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
    await assert.rejects((await as("student")).rateCompetency(course.id, rated, first, { rating: 2 }), CompetencyError);
    const result = await teacher.rateCompetency(course.id, rated, first, { rating: "Competent", note: "Driver check: shown in the page's task." });
    assert.match(result.changed, /"Competent"/);
    const { rating } = result;
    assert.deepEqual([rating.rating?.value, rating.proficient], [2, true]);
    const evidence = rating.evidence[0]!;
    assert.deepEqual([evidence.action, evidence.note, evidence.rating?.value, evidence.by?.id], ["override", "Driver check: shown in the page's task.", 2, await userId("teacher")]);
    assert.ok(Date.now() - Date.parse(evidence.created) < 3_600_000, "the evidence is recent");
    assert.deepEqual(await teacher.competencyRating(course.id, rated, first), rating);
  });

  it("removeCourseCompetency: the second removed, once; the page unlinked from the first", SLOW, async () => {
    const teacher = await as("teacher");
    const removed = await teacher.removeCourseCompetency(course.id, second);
    assert.match(removed.changed, /^Removed/);
    assert.deepEqual(removed.competencies.map((c) => c.id), [first]);
    assert.match((await teacher.removeCourseCompetency(course.id, second)).changed, /wasn't/);
    assert.deepEqual((await teacher.setActivityCompetencies(pageId, [])).competencyIds, []);
    assert.deepEqual((await teacher.courseCompetencies(course.id))[0]!.activities, []);
  });
});
