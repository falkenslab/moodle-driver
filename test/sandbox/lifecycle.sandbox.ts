// A course's reports (logs, activity, participation) and its life cycle (copy, backup, restore,
// import, reset), against the sandbox. The reports read the content course; copies and imports take
// it only as a source; backups, restores and resets work on the scratch course or on courses the
// tests make, each deleted afterwards. Moodle makes copies, backups and restores in its ad hoc
// tasks, which the runner runs every 10 s: those tests have long timeouts.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { BackupError, CourseError, ReportError, type CourseSection } from "../../src/index.js";
import { deleteDraftFile, formValue, openForm, openSitePage, submitForm } from "../../src/internals.js";
import { readBackupInfo } from "../../src/areas/backup/mbz.js";
import { readTgz, writeTgz } from "../areas/backup/tgz.js";
import { COURSE, SITE, as, cleanup, deleteCourse, notForbidden, scratchCourse, userId, type ScratchCourse } from "./harness.js";

const STUDENT_ROLE = 5;
/** The sandbox's default category, where new courses go. */
const CATEGORY = 1;
const SLOW = { timeout: 900_000 };
const stamp = Date.now().toString(36);

/** A course this file made, deleted after the file. */
function made(courseId: number): number {
  notForbidden(courseId);
  assert.notEqual(courseId, COURSE);
  cleanup(() => deleteCourse(courseId));
  return courseId;
}

/**
 * Deletes a backup file from the person's private backup area, where Moodle keeps the backups made
 * without users' data, through the area's "Manage backup files" form (reached from a course's
 * restore page).
 */
async function removeBackupFile(role: "teacher" | "admin", courseId: number, name: string): Promise<void> {
  const context = await (await as(role)).context();
  const course = await openSitePage(context, SITE, `course/view.php?id=${courseId}`);
  const contextId = await course.evaluate(() => (globalThis as unknown as { M: { cfg: { contextid: number } } }).M.cfg.contextid);
  await course.close();
  const list = await openSitePage(context, SITE, `backup/restorefile.php?contextid=${contextId}`);
  const query = await list
    .locator('form[action*="backupfilesedit.php"]:has(input[name="component"][value="user"])')
    .evaluate((form) => Array.from((form as unknown as { querySelectorAll(s: string): ArrayLike<{ name: string; value: string }> }).querySelectorAll("input")).map((input) => `${encodeURIComponent(input.name)}=${encodeURIComponent(input.value)}`).join("&"));
  await list.close();
  const form = await openForm(context, SITE, `backup/backupfilesedit.php?${query}`);
  try {
    await deleteDraftFile(form, (await formValue(form, "files_filemanager"))!, name);
    await submitForm(form, "submitbutton");
  } finally {
    await form.close();
  }
}

/** The ids of a course's activities, as the person sees them. */
async function activityIds(role: "teacher" | "admin", courseId: number): Promise<number[]> {
  return (await (await as(role)).courseStructure(courseId)).flatMap((s) => s.activities.map((a) => a.id));
}

describe("reports and course life cycle", () => {
  let scratch: ScratchCourse;
  let studentId: number;
  /** A page made in the scratch course, which backups and restores carry. */
  let pageName: string;

  before(async () => {
    scratch = await scratchCourse("lifecycle");
    studentId = await userId("student");
    pageName = `Suite page ${stamp}`;
    await (await as("teacher")).createActivity({ courseId: scratch.id, sectionId: scratch.sectionId, type: "page", name: pageName, content: "<p>Carried by backups</p>" });
  });

  it("courseLogs: the content course's logs, newest first, by user and action", async () => {
    const teacher = await as("teacher");
    const logs = (await teacher.courseLogs(COURSE, { limit: 30 })).items;
    assert.ok(logs.length > 0);
    assert.ok(logs.length <= 30);
    const times = logs.map((entry) => entry.time).filter((time): time is string => time !== undefined);
    assert.equal(times.length, logs.length, "every entry's time read back with the site's format");
    assert.deepEqual(times, [...times].sort().reverse());
    const mine = (await teacher.courseLogs(COURSE, { userId: studentId, limit: 10 })).items;
    assert.ok(mine.length > 0, "the student did things in the content course");
    assert.ok(mine.every((entry) => entry.userId === studentId));
    const views = (await teacher.courseLogs(COURSE, { action: "view", limit: 10 })).items;
    // Moodle files some reads under other words ("Tour started"): views hold the modules viewed, changes none of them.
    assert.ok(views.some((entry) => entry.activityId !== undefined && / viewed the '/.test(entry.description)));
    const changes = (await teacher.courseLogs(COURSE, { action: "change", limit: 30 })).items;
    assert.ok(!changes.some((entry) => / viewed the '/.test(entry.description)), "a module view isn't a change");
    // The span: nothing before `from`.
    const from = new Date(Date.parse(times[times.length - 1]!) - 1000);
    assert.ok((await teacher.courseLogs(COURSE, { from, limit: 30 })).items.every((entry) => Date.parse(entry.time!) >= from.getTime()));
    await assert.rejects((await as("student")).courseLogs(COURSE), ReportError);
  });

  it("courseLogs: a page with limit and offset, and without limit the first 100 as a list", async () => {
    const teacher = await as("teacher");
    // Up to a minute ago: other runs may make the student act in the content course meanwhile.
    const until = new Date(Date.now() - 60_000);
    const first = await teacher.courseLogs(COURSE, { userId: studentId, until, limit: 3 });
    assert.equal(first.items.length, 3);
    assert.equal(first.more, true, "the student did more than three things in the content course");
    const next = await teacher.courseLogs(COURSE, { userId: studentId, until, limit: 3, offset: 3 });
    assert.equal(next.items.length, 3);
    const both = await teacher.courseLogs(COURSE, { userId: studentId, until, limit: 6 });
    assert.deepEqual([...first.items, ...next.items], both.items);
    const all = await teacher.courseLogs(COURSE, { userId: studentId, until });
    assert.ok(Array.isArray(all) && all.length <= 100);
    assert.deepEqual(all.slice(0, 6), both.items);
  });

  it("activityReport: the content course's activities with their views", async () => {
    const teacher = await as("teacher");
    const report = await teacher.activityReport(COURSE);
    const ids = await activityIds("teacher", COURSE);
    assert.ok(report.length > 0);
    // The course's question bank (a qbank module, Moodle 5) is in the report but not on the course page.
    assert.ok(report.filter((row) => row.type !== "qbank").every((row) => ids.includes(row.activityId)), JSON.stringify(report));
    // Every activity with a page of its own (a label has none) is in the report.
    const withPages = (await (await as("teacher")).courseStructure(COURSE)).flatMap((s) => s.activities).filter((a) => a.type !== "label");
    assert.ok(withPages.every((a) => report.some((row) => row.activityId === a.id)), JSON.stringify(report.map((row) => row.activityId)));
    const viewed = report.filter((row) => row.views > 0);
    assert.ok(viewed.length > 0, "someone viewed an activity of the content course");
    assert.ok(viewed.every((row) => row.users > 0));
    assert.ok(viewed.some((row) => row.lastAccess !== undefined && !Number.isNaN(Date.parse(row.lastAccess))));
    await assert.rejects((await as("student")).activityReport(COURSE), ReportError);
  });

  it("participationReport: who took part in the content course's most viewed activity", async () => {
    const teacher = await as("teacher");
    const report = await teacher.activityReport(COURSE);
    const busiest = [...report].sort((a, b) => b.views - a.views)[0];
    assert.ok(busiest && busiest.views > 0);
    const people = await teacher.participationReport(COURSE, busiest.activityId, { roleId: STUDENT_ROLE });
    assert.ok(people.some((p) => p.userId === studentId), "the student is listed with the student role");
    assert.ok(people.every((p) => p.roleId === STUDENT_ROLE));
    assert.ok(people.some((p) => p.actions > 0), "a student took part in the most viewed activity");
    const views = await teacher.participationReport(COURSE, busiest.activityId, { roleId: STUDENT_ROLE, action: "view" });
    assert.equal(views.length, people.length);
    await assert.rejects(teacher.participationReport(COURSE, 999_999), ReportError);
  });

  it("copyCourse: the content course copied into a new course with the same activities", SLOW, async () => {
    const admin = await as("admin");
    const { course } = await admin.copyCourse(COURSE, { fullName: `Driver check copy ${stamp}`, shortName: `drivercheck-copy-${stamp}`, visible: false, timeoutMs: 180_000 });
    made(course.id);
    assert.notEqual(course.id, COURSE);
    assert.equal(course.shortName, `drivercheck-copy-${stamp}`);
    const original = await (await as("admin")).courseStructure(COURSE);
    const copy = await admin.courseStructure(course.id);
    assert.deepEqual(
      copy.flatMap((s) => s.activities.map((a) => `${a.type}:${a.name}`)),
      original.flatMap((s) => s.activities.map((a) => `${a.type}:${a.name}`)),
    );
    // The student has no rights to copy.
    await assert.rejects((await as("student")).copyCourse(COURSE, { fullName: "No", shortName: `drivercheck-no-${stamp}` }), BackupError);
  });

  let backupFile: string | undefined;

  it("backupCourse: the scratch course backed up to an .mbz file", SLOW, async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "suite-backup-"));
    cleanup(async () => rmSync(dir, { recursive: true, force: true }));
    const { file } = await (await as("teacher")).backupCourse(scratch.id, dir, { timeoutMs: 180_000 });
    cleanup(() => removeBackupFile("teacher", scratch.id, file.name));
    assert.ok(file.name.endsWith(".mbz"));
    assert.ok(file.size > 0);
    assert.equal(path.dirname(file.path), dir);
    backupFile = file.path;
    await assert.rejects((await as("student")).backupCourse(scratch.id, dir), BackupError);
  });

  it("restoreCourse: the backup restored into a new course, and merged into the scratch course", SLOW, async () => {
    assert.ok(backupFile, "backupCourse made the file");
    const admin = await as("admin");
    const { course } = await admin.restoreCourse(backupFile, { into: "new", categoryId: CATEGORY, fullName: `Driver check restore ${stamp}`, shortName: `drivercheck-restore-${stamp}`, timeoutMs: 180_000 });
    made(course.id);
    assert.equal(course.shortName, `drivercheck-restore-${stamp}`);
    const restored = (await admin.courseStructure(course.id)).flatMap((s) => s.activities);
    assert.ok(restored.some((a) => a.type === "page" && a.name === pageName));
    // Merged into the scratch course: the page twice.
    await (await as("teacher")).restoreCourse(backupFile, { into: scratch.id, timeoutMs: 180_000 });
    const merged = (await admin.courseStructure(scratch.id)).flatMap((s) => s.activities).filter((a) => a.name === pageName);
    assert.equal(merged.length, 2);
    // The teacher can't create courses.
    await assert.rejects((await as("teacher")).restoreCourse(backupFile, { into: "new", categoryId: CATEGORY }), BackupError);
  });

  /** Part of the content course backed up: its file, and its activities' names by section, in order. */
  let part: { file: string; sections: string[][] } | undefined;

  it("backupCourse: part of the content course (a whole section, a page and a file from others), without people's data", SLOW, async () => {
    const teacher = await as("teacher");
    const original = await teacher.courseStructure(COURSE);
    const whole = original.find((s) => s.activities.length > 0)!;
    const others = original.filter((s) => s !== whole);
    const page = others.flatMap((s) => s.activities).find((a) => a.type === "page");
    const pageSection = others.find((s) => s.activities.includes(page!));
    const resource = others.filter((s) => s !== pageSection).flatMap((s) => s.activities).find((a) => a.type === "resource");
    assert.ok(page && resource, "the content course has a page and a file outside its first section with content");
    const dir = mkdtempSync(path.join(tmpdir(), "suite-part-"));
    cleanup(async () => rmSync(dir, { recursive: true, force: true }));
    const { file, changed } = await teacher.backupCourse(COURSE, dir, { sections: [whole.id], activities: [page.id, resource.id], timeoutMs: 600_000 });
    cleanup(() => removeBackupFile("teacher", scratch.id, file.name));
    assert.match(changed, /without people's data/);
    // The file: what was asked, no one's data (no users, no grades, submissions, posts or logs).
    const info = await readBackupInfo(file.path);
    const held = info.activities.filter((a) => a.included).map((a) => a.id);
    assert.deepEqual(held.sort(), [...whole.activities.map((a) => a.id), page.id, resource.id].sort());
    assert.ok(["users", "logs", "comments", "userscompletion", "grade_histories", "role_assignments"].every((name) => info.settings[name] !== "1"), JSON.stringify(info.settings));
    const entries = readTgz(readFileSync(file.path));
    assert.ok(!entries.some(([name]) => /(^|\/)(users|logs|logstores|comments|completion)\.xml$/.test(name)), entries.map(([name]) => name).join(", "));
    const xml = entries.filter(([name]) => name.endsWith(".xml")).map(([, content]) => content.toString("utf8")).join("\n");
    assert.ok(!/<(grade_grade|submission|post|user|attempt|log) /.test(xml), "no one's grades, submissions, posts, attempts or logs");
    // The content course is only read.
    assert.deepEqual(await activityIds("teacher", COURSE), original.flatMap((s) => s.activities.map((a) => a.id)));
    await assert.rejects(teacher.backupCourse(COURSE, dir, { activities: [999_999] }), { code: "not-found" });
    await assert.rejects((await as("student")).backupCourse(COURSE, dir, { sections: [whole.id] }), BackupError);
    part = { file: file.path, sections: [whole.activities.map((a) => a.name), [page.name], [resource.name]] };
  });

  it("restoreCourse: part of a course into one section of the scratch course, and as new sections after it, with its files", SLOW, async () => {
    assert.ok(part, "backupCourse made the part's file");
    const teacher = await as("teacher");
    const { sectionId: target } = await teacher.addSection(scratch.id, { name: `Driver check target ${stamp}` });
    assert.ok(target);
    const before = await teacher.courseStructure(scratch.id);
    const names = (structure: CourseSection[], ids: number[]) => ids.map((id) => structure.flatMap((s) => s.activities).find((a) => a.id === id)?.name);

    const into = await teacher.restoreCourse(part.file, { into: scratch.id, sectionId: target, timeoutMs: 600_000 });
    let now = await teacher.courseStructure(scratch.id);
    assert.deepEqual(into.sectionIds, []);
    assert.deepEqual(now.map((s) => [s.id, s.title]), before.map((s) => [s.id, s.title]), "no section added, none renamed");
    assert.deepEqual(now.find((s) => s.id === target)!.activities.map((a) => a.id), into.activityIds);
    assert.deepEqual(names(now, into.activityIds!), part.sections.flat());
    for (const section of before.filter((s) => s.id !== target)) assert.deepEqual(now.find((s) => s.id === section.id)!.activities.map((a) => a.id), section.activities.map((a) => a.id));
    // The file resource came with its file.
    const restoredFile = now.find((s) => s.id === target)!.activities.find((a) => a.type === "resource")!;
    assert.ok(((await teacher.activitySettings(restoredFile.id)).files ?? []).length > 0, "the restored resource has its file");

    const after = await teacher.restoreCourse(part.file, { into: scratch.id, afterSectionId: target, timeoutMs: 600_000 });
    now = await teacher.courseStructure(scratch.id);
    const at = now.findIndex((s) => s.id === target);
    assert.equal(after.sectionIds!.length, part.sections.length);
    assert.deepEqual(now.slice(at + 1, at + 1 + part.sections.length).map((s) => s.id), after.sectionIds);
    assert.deepEqual(after.sectionIds!.map((id) => now.find((s) => s.id === id)!.activities.map((a) => a.name)), part.sections);
    assert.deepEqual(after.activityIds, after.sectionIds!.flatMap((id) => now.find((s) => s.id === id)!.activities.map((a) => a.id)));
    // The course's own sections keep their names and activities.
    for (const section of before) {
      const kept = now.find((s) => s.id === section.id)!;
      assert.equal(kept.title, section.title);
      assert.deepEqual(kept.activities.map((a) => a.id).filter((id) => !into.activityIds!.includes(id)), section.activities.map((a) => a.id));
    }
  });

  it("restoreCourse: a backup from a newer Moodle, or with a module the site lacks, refused before the wizard", SLOW, async () => {
    assert.ok(part, "backupCourse made the part's file");
    const teacher = await as("teacher");
    const dir = mkdtempSync(path.join(tmpdir(), "suite-edited-"));
    cleanup(async () => rmSync(dir, { recursive: true, force: true }));
    const entries = readTgz(readFileSync(part.file));
    const edited = (name: string, change: (xml: string) => string) => {
      const file = path.join(dir, name);
      writeFileSync(file, writeTgz(entries.map(([entry, content]) => [entry, entry === "moodle_backup.xml" ? change(content.toString("utf8")) : content])));
      return file;
    };
    const newer = edited("newer.mbz", (xml) => xml.replace(/<moodle_release>[^<]*<\/moodle_release>/, "<moodle_release>9.9 (Build: 20991231)</moodle_release>"));
    const lacking = edited("lacking.mbz", (xml) => xml.replace("<modulename>page</modulename>", "<modulename>nosuchmodule</modulename>"));
    const before = await activityIds("teacher", scratch.id);
    await assert.rejects(teacher.restoreCourse(newer, { into: scratch.id }), (error: Error) => error instanceof BackupError && /Moodle 9\.9 \(Build: 20991231\), newer than this site's/.test(error.message));
    await assert.rejects(teacher.restoreCourse(lacking, { into: scratch.id }), (error: Error) => error instanceof BackupError && /nosuchmodule/.test(error.message));
    assert.deepEqual(await activityIds("teacher", scratch.id), before);
  });

  it("importActivities: one activity of the content course imported into the scratch course", SLOW, async () => {
    const teacher = await as("teacher");
    const source = (await teacher.courseStructure(COURSE)).flatMap((s) => s.activities);
    const chosen = source.find((a) => a.type === "page") ?? source.find((a) => a.type === "forum") ?? source[0];
    assert.ok(chosen, "the content course has an activity");
    const before = await activityIds("teacher", scratch.id);
    const { activityIds: added } = await teacher.importActivities(COURSE, scratch.id, { activityIds: [chosen.id] });
    assert.equal(added.length, 1);
    const now = (await teacher.courseStructure(scratch.id)).flatMap((s) => s.activities);
    const imported = now.find((a) => a.id === added[0]);
    assert.equal(imported?.name, chosen.name);
    assert.equal(imported?.type, chosen.type);
    assert.ok(!before.includes(added[0]!));
    await assert.rejects(teacher.importActivities(COURSE, scratch.id, { activityIds: [999_999] }), BackupError);
    await assert.rejects(teacher.importActivities(scratch.id, scratch.id), /itself/);
  });

  it("resetCourse: the scratch course's groups deleted and its students unenrolled", SLOW, async () => {
    const teacher = await as("teacher");
    const admin = await as("admin");
    const { groupId } = await teacher.createGroup(scratch.id, { name: `Reset me ${stamp}` });
    await assert.rejects((await as("student")).resetCourse(scratch.id, { delete: { groups: true } }), CourseError);
    const { report } = await admin.resetCourse(scratch.id, { delete: { groups: true }, unenrolRoles: [STUDENT_ROLE] });
    assert.ok(report.length > 0);
    assert.ok(report.every((line) => line.done), JSON.stringify(report));
    assert.ok(!(await teacher.groups(scratch.id)).some((g) => g.id === groupId));
    const people = await teacher.participants(scratch.id);
    assert.ok(!people.some((p) => p.userId === studentId), "the student was unenrolled");
    assert.ok(people.length > 0, "the teacher stays");
    // Activities aren't deleted by a reset.
    assert.ok((await activityIds("teacher", scratch.id)).length > 0);
  });
});
