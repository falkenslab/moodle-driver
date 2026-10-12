// Courses, their content and the session's browser, against the sandbox: reads on course 3, writes on
// a scratch course, the browser pieces on profiles of their own in a temporary folder.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import {
  CourseError,
  FormError,
  MoodleError,
  MoodleServiceError,
  NoDisplayError,
  NotLoggedInError,
  NotViewableError,
  SESSION_COOKIES_FILE,
  backgroundBrowser,
  canShowWindow,
  checkLocalFiles,
  connectBrowserManager,
  createBrowserManager,
  createMoodle,
  logIn,
  logOut,
  moduleCategories,
  siteProfileDir,
  type CourseSection,
} from "../../src/index.js";
import type { BrowserContext } from "playwright-core";
import { openForm, setFields } from "../../src/internals.js";
import { closeBackgroundBrowser } from "../../src/browser/background.js";
import { hostBackground } from "../../src/cli/background.js";
import { COURSE, SITE, as, cleanup, scratchCourse, userId, type ScratchCourse } from "./harness.js";

const SLOW = { timeout: 300_000 };

/** A browser of the file's own waits as long as the harness's do for a busy sandbox. */
function patient(context: BrowserContext): BrowserContext {
  context.setDefaultTimeout(120_000);
  context.setDefaultNavigationTimeout(300_000);
  return context;
}
const activitiesOf = (sections: CourseSection[]) => sections.flatMap((section) => section.activities);

let work: string;
before(async () => {
  work = await mkdtemp(path.join(tmpdir(), "courses-sandbox-"));
  cleanup(() => rm(work, { recursive: true, force: true }));
});

describe("the content course, read", () => {
  it("listCourses: the student and the teacher are enrolled in the content course", SLOW, async () => {
    for (const role of ["student", "teacher"] as const) {
      const courses = await (await as(role)).listCourses();
      const course = courses.find((c) => c.id === COURSE);
      assert.ok(course, `${role} lists course ${COURSE}`);
      assert.ok(course.fullname && course.shortname);
      assert.equal(course.url, `${SITE}course/view.php?id=${COURSE}`);
      // Every classification is a subset of "all".
      for (const classification of ["inprogress", "future", "past"] as const) {
        const some = await (await as(role)).listCourses(classification);
        for (const c of some) assert.ok(courses.some((all) => all.id === c.id), `${classification} course ${c.id} is in "all"`);
      }
    }
  });

  it("courseStructure: sections and activities of the content course, with details", SLOW, async () => {
    const student = await as("student");
    const sections = await student.courseStructure(COURSE);
    assert.ok(sections.length > 1);
    assert.equal(sections[0]!.number, 0);
    sections.forEach((section, i) => i > 0 && assert.ok(section.number > sections[i - 1]!.number, "sections in the course's order"));
    const activities = activitiesOf(sections);
    assert.ok(activities.length > 0);
    for (const activity of activities) {
      assert.ok(activity.id > 0 && activity.name && activity.type);
      if (activity.url) assert.ok(activity.url.startsWith(`${SITE}mod/${activity.type}/view.php?id=${activity.id}`), activity.url);
    }
    // The details add dates and summaries without changing what's there.
    const detailed = await student.courseStructure(COURSE, { details: true });
    assert.deepEqual(
      activitiesOf(detailed).map((a) => a.id),
      activities.map((a) => a.id),
    );
    assert.ok(activitiesOf(detailed).some((a) => (a.dates ?? []).length > 0), "some activity of the content course shows dates");
    // The teacher sees at least what the student sees.
    const teacherIds = new Set(activitiesOf(await (await as("teacher")).courseStructure(COURSE)).map((a) => a.id));
    for (const activity of activities) assert.ok(teacherIds.has(activity.id));
  });

  it("courseStructure: a course the person can't see is Moodle's refusal", SLOW, async () => {
    await assert.rejects((await as("student")).courseStructure(999_999), MoodleServiceError);
  });

  it("listAssignments: the content course's assignments, as its structure has them", SLOW, async () => {
    const student = await as("student");
    const sections = await student.courseStructure(COURSE);
    const assignments = await student.listAssignments(COURSE);
    const expected = sections.flatMap((s) => s.activities.filter((a) => a.type === "assign").map((a) => ({ id: a.id, section: s.number })));
    assert.ok(assignments.length > 0, "the content course has assignments");
    assert.deepEqual(
      assignments.map((a) => ({ id: a.id, section: a.section.number })),
      expected,
    );
  });

  it("pendingActivities: what the student still has to do is in the course, with a reason", SLOW, async () => {
    const student = await as("student");
    const activities = new Map(activitiesOf(await student.courseStructure(COURSE)).map((a) => [a.id, a]));
    const { completionTracked, pending } = await student.pendingActivities(COURSE);
    assert.equal(typeof completionTracked, "boolean");
    for (const item of pending) {
      const activity = activities.get(item.activityId);
      assert.ok(activity, `pending activity ${item.activityId} is in the course`);
      assert.equal(item.type, activity.type);
      if (item.reason === "incomplete") assert.equal(activity.completion?.complete, false);
      else assert.equal(item.reason, "not-graded");
    }
    // Completed activities are never pending.
    for (const activity of activities.values()) {
      if (activity.completion?.complete) assert.ok(!pending.some((p) => p.activityId === activity.id));
    }
  });

  it("activitiesOverview: the teacher's assignments overview of the content course", SLOW, async () => {
    const teacher = await as("teacher");
    const assignments = await teacher.listAssignments(COURSE);
    const overview = await teacher.activitiesOverview(COURSE, "assign");
    assert.deepEqual(overview.map((a) => a.id).sort(), assignments.map((a) => a.id).sort());
    for (const activity of overview) {
      assert.equal(activity.type, "assign");
      assert.ok(activity.fields.length > 0);
      for (const field of activity.fields) assert.ok(field.key && typeof field.text === "string");
    }
    // Without a type, every type the course has; a module Moodle doesn't know has no activities.
    const all = await teacher.activitiesOverview(COURSE);
    for (const id of assignments.map((a) => a.id)) assert.ok(all.some((a) => a.id === id));
    assert.deepEqual(await teacher.activitiesOverview(COURSE, "nosuchmodule"), []);
    // A course the person can't see is Moodle's refusal.
    await assert.rejects(teacher.activitiesOverview(999_999, "assign"), MoodleServiceError);
  });

  it("deadlines: the student's action events in the content course, in the window asked for", SLOW, async () => {
    const student = await as("student");
    const days = 365;
    const pastDays = 365;
    const events = await student.deadlines({ courseId: COURSE, days, pastDays });
    const activities = new Set(activitiesOf(await student.courseStructure(COURSE)).map((a) => a.id));
    const now = Date.now();
    for (const event of events) {
      assert.equal(event.course?.id, COURSE);
      const time = Date.parse(event.date);
      assert.ok(time >= now - (pastDays + 1) * 86_400_000 && time <= now + (days + 1) * 86_400_000, event.date);
      if (event.activityId) assert.ok(activities.has(event.activityId), `event's activity ${event.activityId} is in the course`);
    }
    // In every course, the course's own events are there too.
    const everywhere = await student.deadlines({ days, pastDays });
    for (const event of events) assert.ok(everywhere.some((e) => e.event === event.event && e.date === event.date));
  });

  it("courseRoles: the student's and the teacher's roles in the content course", SLOW, async () => {
    const admin = await as("admin");
    assert.ok((await admin.courseRoles(await userId("student"), COURSE)).some((role) => role.id === 5));
    assert.ok((await admin.courseRoles(await userId("teacher"), COURSE)).some((role) => role.id === 3));
    // The admin isn't enrolled: no role there.
    assert.deepEqual(await admin.courseRoles(await userId("admin"), COURSE), []);
  });

  it("courseAbilities: the teacher edits and grades the content course, the student neither", SLOW, async () => {
    const sectionId = (await (await as("student")).courseStructure(COURSE))[0]!.id;
    assert.deepEqual(await (await as("teacher")).courseAbilities(COURSE, sectionId), { canEdit: true, canGrade: true });
    assert.deepEqual(await (await as("student")).courseAbilities(COURSE, sectionId), { canEdit: false, canGrade: false });
  });

  it("courseActivityTypes: the teacher can add the usual types, the student none", SLOW, async () => {
    const types = await (await as("teacher")).courseActivityTypes(COURSE);
    for (const type of ["assign", "quiz", "forum", "page", "resource", "url", "folder", "label"]) assert.ok(types.some((t) => t.type === type), type);
    assert.equal(new Set(types.map((t) => t.type)).size, types.length, "each type once");
    assert.deepEqual(await (await as("student")).courseActivityTypes(COURSE), []);
  });

  it("userById: the teacher reads the student; nobody for an id that doesn't exist", SLOW, async () => {
    const teacher = await as("teacher");
    const me = await (await as("student")).whoAmI();
    const user = await teacher.userById(me.userId);
    assert.equal(user?.id, me.userId);
    assert.equal(user?.fullName, me.fullName);
    assert.equal(await teacher.userById(99_999_999), undefined);
  });

  it("moduleCategories: the categories of the content course's modules", SLOW, async () => {
    assert.deepEqual(moduleCategories("page"), ["course-content"]);
    assert.deepEqual(moduleCategories("forum"), ["course-content", "others-personal"]);
    assert.deepEqual(moduleCategories("assign"), ["course-content", "others-personal"]);
    assert.deepEqual(moduleCategories("someplugin"), ["any"]);
    for (const activity of activitiesOf(await (await as("teacher")).courseStructure(COURSE))) {
      assert.ok(moduleCategories(activity.type).length > 0, activity.type);
    }
  });
});

describe("the scratch course, written", () => {
  let scratch: ScratchCourse;
  let sourceFile: string;
  const ids = {} as Record<"page" | "label" | "url" | "resource" | "folder", number>;

  // The course and the resources the reads below need, shown to students.
  before(
    async () => {
      scratch = await scratchCourse("courses");
      sourceFile = path.join(work, "suite-notes.txt");
      await writeFile(sourceFile, "Notes for the suite: a file resource's content.\n");
      const teacher = await as("teacher");
      const add = async (fields: Parameters<typeof teacher.createActivity>[0]) => (await teacher.createActivity(fields)).activityId!;
      const where = { courseId: scratch.id, sectionId: scratch.sectionId, visibility: "shown" as const };
      ids.label = await add({ ...where, type: "label", content: "<p>The suite's label text.</p>" });
      ids.url = await add({ ...where, type: "url", name: "Suite link", url: "https://moodle.org/" });
      ids.resource = await add({ ...where, type: "resource", name: "Suite file", files: [sourceFile] });
      ids.folder = await add({ ...where, type: "folder", name: "Suite folder", files: [sourceFile, { from: sourceFile, to: "week1/more.txt" }] });
    },
    { timeout: 1_200_000 },
  );

  it("courseUpdates: a page created in the course is among its updates", SLOW, async () => {
    const teacher = await as("teacher");
    const since = new Date(Date.now() - 60_000);
    const created = await teacher.createActivity({ courseId: scratch.id, sectionId: scratch.sectionId, type: "page", name: "Suite page", content: "<p>The suite's page text.</p>", visibility: "shown" });
    ids.page = created.activityId!;
    const updates = await teacher.courseUpdates(scratch.id, since);
    const page = updates.find((u) => u.id === ids.page);
    assert.ok(page, "the page is updated since the minute before");
    assert.equal(page.name, "Suite page");
    assert.equal(page.type, "page");
    assert.ok(page.changes.length > 0);
    // Nothing changed since a moment in the future.
    assert.deepEqual(await teacher.courseUpdates(scratch.id, new Date(Date.now() + 3_600_000)), []);
  });

  it("courseStructure: a hidden activity is available to the teacher, not to the student", SLOW, async () => {
    const teacher = await as("teacher");
    // Hidden, as createActivity makes it by default.
    const { activityId } = await teacher.createActivity({ courseId: scratch.id, sectionId: scratch.sectionId, type: "page", name: "Driver check hidden page", content: "<p>Hidden.</p>" });
    const mine = activitiesOf(await teacher.courseStructure(scratch.id)).find((a) => a.id === activityId);
    assert.deepEqual(mine && { visible: mine.visible, availableToMe: mine.availableToMe }, { visible: false, availableToMe: true });
    const student = await as("student");
    const theirs = activitiesOf(await student.courseStructure(scratch.id)).find((a) => a.id === activityId);
    assert.ok(!theirs || !theirs.availableToMe, "the student can't open it");
    assert.ok(!(await student.pendingActivities(scratch.id)).pending.some((p) => p.activityId === activityId));
    await teacher.deleteActivity(scratch.id, activityId!);
  });

  it("activityContent: a page, a label, a URL, a file and a folder, as the student reads them", SLOW, async () => {
    const student = await as("student");
    const page = await student.activityContent(ids.page, "page");
    assert.match(page.text ?? "", /The suite's page text\./);
    assert.equal(page.trail, "fast");
    // As the course structure gives it.
    const structure = activitiesOf(await student.courseStructure(scratch.id));
    const label = await student.activityContent(structure.find((a) => a.id === ids.label)!);
    assert.match(label.text ?? "", /The suite's label text\./);
    assert.equal((await student.activityContent(ids.url, "url")).url, "https://moodle.org/");
    const file = await student.activityContent(ids.resource, "resource");
    assert.deepEqual(file.files?.map((f) => f.name), ["suite-notes.txt"]);
    assert.ok(file.files![0]!.url.startsWith(`${SITE}pluginfile.php/`));
    const folder = await student.activityContent(ids.folder, "folder");
    assert.deepEqual(folder.files?.map((f) => f.name).sort(), ["more.txt", "suite-notes.txt"]);
  });

  it("activityContent: an activity of another type, or a module it doesn't read, is NotViewableError", SLOW, async () => {
    const student = await as("student");
    await assert.rejects(student.activityContent(ids.page, "url"), NotViewableError);
    await assert.rejects(student.activityContent({ id: ids.page, type: "quiz" }), NotViewableError);
  });

  it("activitiesOverview: a type without an overview (labels) gives none; the scratch course's resources", SLOW, async () => {
    const teacher = await as("teacher");
    // The course has a label, but labels have no overview page: Moodle answers with no activities.
    assert.deepEqual(await teacher.activitiesOverview(scratch.id, "label"), []);
    // "resource" brings every resource type at once.
    const resources = await teacher.activitiesOverview(scratch.id, "resource");
    for (const id of [ids.page, ids.url, ids.resource, ids.folder]) assert.ok(resources.some((a) => a.id === id), `resource ${id}`);
    assert.ok(!resources.some((a) => a.id === ids.label));
  });

  it("downloadFile: the file resource's file, as the student, never overwriting", SLOW, async () => {
    const student = await as("student");
    const { files } = await student.activityContent(ids.resource, "resource");
    const dest = path.join(work, "downloads");
    const first = await student.downloadFile(files![0]!.url, dest);
    assert.equal(first.name, "suite-notes.txt");
    assert.equal(await readFile(first.path, "utf8"), await readFile(sourceFile, "utf8"));
    assert.equal(first.size, (await stat(sourceFile)).size);
    const second = await student.downloadFile(files![0]!.url, dest);
    assert.equal(second.name, "suite-notes (2).txt");
    // Without a folder or the object's downloadDir.
    await assert.rejects(student.downloadFile(files![0]!.url), { code: "invalid-input" });
  });

  it("downloadFile: another site, a relative folder and a file that isn't there are refused", SLOW, async () => {
    const student = await as("student");
    await assert.rejects(student.downloadFile("https://moodle.org/robots.txt", work), { code: "outside-site" });
    await assert.rejects(student.downloadFile(`${SITE}pluginfile.php/1/x/y/0/none.txt`, "relative"), { code: "invalid-input" });
    await assert.rejects(student.downloadFile(`${SITE}pluginfile.php/1/mod_resource/content/0/none.txt`, work), (error: unknown) => error instanceof MoodleError);
  });

  it("checkLocalFiles: the suite's file passes; a relative path and a missing file don't", async () => {
    await checkLocalFiles([sourceFile]);
    await assert.rejects(checkLocalFiles(["suite-notes.txt"]), { code: "invalid-input" });
    await assert.rejects(checkLocalFiles([path.join(work, "missing.txt")]), { code: "not-found" });
  });

  it("courseActivityTypes: the student can't add anything to the scratch course either", SLOW, async () => {
    assert.ok((await (await as("teacher")).courseActivityTypes(scratch.id)).some((t) => t.type === "page"));
    assert.deepEqual(await (await as("student")).courseActivityTypes(scratch.id), []);
  });

  it("updateCourse: the teacher renames the scratch course and changes its summary", SLOW, async () => {
    const teacher = await as("teacher");
    const before = (await teacher.listCourses()).find((c) => c.id === scratch.id)!;
    const fullName = `${before.fullname} (renamed)`;
    const result = await teacher.updateCourse(scratch.id, { fullName, summary: "<p>The suite's course.</p>" });
    assert.equal(result.course?.fullname, fullName);
    // As the student sees it.
    assert.equal((await (await as("student")).listCourses()).find((c) => c.id === scratch.id)?.fullname, fullName);
    const nothing = await teacher.updateCourse(scratch.id, {});
    assert.equal(nothing.changed, "Nothing to change.");
    assert.equal(nothing.course?.fullname, fullName);
  });

  it("updateCourse: a short name already taken is FormError; the student is refused", SLOW, async () => {
    const teacher = await as("teacher");
    const taken = (await teacher.listCourses()).find((c) => c.id === COURSE)!.shortname;
    await assert.rejects(teacher.updateCourse(scratch.id, { shortName: taken }), (error: unknown) => error instanceof FormError && error.fields.some((f) => f.field === "shortname"));
    await assert.rejects((await as("student")).updateCourse(scratch.id, { fullName: "Not allowed" }), CourseError);
  });
});

describe("the browser and the session", () => {
  it("siteProfileDir: the command's profile of an account, and the site's default", async () => {
    const home = path.join(work, "home");
    assert.equal(siteProfileDir(SITE, { as: "ada", home }), path.join(home, "sites", "localhost_8080", "profiles", "ada"));
    assert.throws(() => siteProfileDir(SITE, { home }), { code: "not-found" });
    await mkdir(path.join(home, "sites", "localhost_8080"), { recursive: true });
    await writeFile(path.join(home, "sites", "localhost_8080", "site.json"), JSON.stringify({ url: SITE, default: "lucia" }));
    assert.equal(siteProfileDir(SITE, { home }), path.join(home, "sites", "localhost_8080", "profiles", "lucia"));
    assert.throws(() => siteProfileDir(SITE, { as: "../x", home }), { code: "invalid-input" });
  });

  it("canShowWindow: no window in the suite's container, one with a display", () => {
    assert.equal(canShowWindow(), false);
    assert.equal(canShowWindow({ DISPLAY: ":0" }, "linux"), true);
    assert.equal(canShowWindow({}, "win32"), true);
  });

  it("createBrowserManager: a browser on a profile of its own, without a session or a window", SLOW, async () => {
    const browser = createBrowserManager({ profileDir: path.join(work, "manager"), channel: "chromium", headless: true, downloadBrowser: false });
    try {
      assert.equal(browser.openChannel(), undefined);
      const context = patient(await browser.context());
      assert.equal(browser.openChannel(), "chromium");
      assert.equal(browser.visible(), false);
      // A new profile has no session on the sandbox.
      const moodle = createMoodle({ site: SITE, browser });
      assert.equal(moodle.browser, browser);
      await assert.rejects(moodle.listCourses(), NotLoggedInError);
      // The context reaches the site: its login page.
      const page = await context.newPage();
      await page.goto(`${SITE}login/index.php`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator("#username").count(), 1);
      await page.close();
      await assert.rejects(browser.context({ headed: true }), NoDisplayError);
    } finally {
      await browser.close();
    }
  });

  it("createMoodle: an object on the student's browser is the student", SLOW, async () => {
    const student = await as("student");
    const moodle = createMoodle({ site: "http://localhost:8080", browser: student.browser });
    assert.equal(moodle.site, SITE);
    assert.equal((await moodle.whoAmI()).userId, await userId("student"));
    assert.ok((await moodle.listCourses()).some((c) => c.id === COURSE));
  });

  it("logIn: the session already there resolves at once", SLOW, async () => {
    const student = await as("student");
    const result = await student.logIn();
    assert.equal(result.status, "already-logged-in");
    assert.equal(result.userId, await userId("student"));
    const direct = await logIn(student.browser, SITE);
    assert.equal(direct.userId, result.userId);
  });

  it("logIn: without a session, it needs a window the container hasn't", SLOW, async () => {
    const moodle = createMoodle({ site: SITE, profileDir: path.join(work, "nologin"), channel: "chromium", headless: true, downloadBrowser: false });
    try {
      await assert.rejects(moodle.logIn({ timeoutMs: 5000 }), NoDisplayError);
    } finally {
      await moodle.close();
    }
  });

  it("logOut: a throwaway account logged in on a browser of its own ends its session", { timeout: 900_000 }, async () => {
    const admin = await as("admin");
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const username = `suitelogout${stamp}`;
    const password = `Suite-${stamp}-x!`;
    // Registered before the form is sent: a save that outlasts its wait still makes the account.
    cleanup(() => deleteUser(username));
    const form = await openForm(await admin.context(), SITE, "user/editadvanced.php?id=-1");
    try {
      // The page has another Moodle form before the user's: this one is named by its field.
      const userForm = 'form.mform:has([name="username"])';
      await setFields(form, { username, newpassword: password, firstname: "Suite", lastname: "Logout", email: `${username}@example.org` }, userForm);
      await Promise.all([form.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120_000 }), form.click(`${userForm} [name="submitbutton"]`, { noWaitAfter: true })]);
    } finally {
      await form.close();
    }
    const id = await accountId(username);
    assert.ok(id, "the throwaway account was created");

    const moodle = createMoodle({ site: SITE, profileDir: path.join(work, "throwaway"), channel: "chromium", headless: true, downloadBrowser: false });
    try {
      const page = await patient(await moodle.context()).newPage();
      await page.goto(`${SITE}login/index.php`, { waitUntil: "domcontentloaded" });
      await page.fill("#username", username);
      await page.fill("#password", password);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 120_000 }), page.click("#loginbtn", { noWaitAfter: true })]);
      await page.close();
      assert.equal((await moodle.whoAmI()).userId, id);

      assert.equal(await logOut(await moodle.context(), SITE), true);
      await assert.rejects(moodle.whoAmI(), NotLoggedInError);
      // Nobody logged in now.
      assert.equal(await moodle.logOut(), false);
    } finally {
      await moodle.close();
    }
    // The suite's own session is still there.
    assert.equal((await (await as("student")).whoAmI()).userId, await userId("student"));
  });

  it("backgroundBrowser: a browser kept open on a profile, found and closed", SLOW, async () => {
    const profileDir = path.join(work, "background");
    assert.equal(await backgroundBrowser(profileDir), undefined);
    // The student's session, as the command's profile would have it.
    await (await as("student")).saveSession();
    await mkdir(profileDir, { recursive: true });
    await copyFile(path.join("/sandbox/profiles/student", SESSION_COOKIES_FILE), path.join(profileDir, SESSION_COOKIES_FILE));
    const { closed } = await hostBackground(profileDir, false);
    try {
      const found = await backgroundBrowser(profileDir);
      assert.ok(found);
      assert.equal(found.pid, process.pid);
      assert.equal(found.headed, false);
      assert.match(found.endpoint, /^ws:\/\/127\.0\.0\.1:/);

      await connectAndCheck(profileDir);
    } finally {
      await closeBackgroundBrowser(profileDir);
      await closed;
    }
    assert.equal(await backgroundBrowser(profileDir), undefined);
  });

  it("connectBrowserManager: works the background browser's session and only disconnects", SLOW, async () => {
    const profileDir = path.join(work, "background2");
    await (await as("student")).saveSession();
    await mkdir(profileDir, { recursive: true });
    await copyFile(path.join("/sandbox/profiles/student", SESSION_COOKIES_FILE), path.join(profileDir, SESSION_COOKIES_FILE));
    const { closed } = await hostBackground(profileDir, false);
    try {
      await connectAndCheck(profileDir);
      // A second program connects after the first one left: the browser stayed open.
      await connectAndCheck(profileDir);
      const manager = connectBrowserManager({ ...(await backgroundBrowser(profileDir))!, profileDir });
      await assert.rejects(manager.context({ headed: true }), NoDisplayError);
      await manager.close();
    } finally {
      await closeBackgroundBrowser(profileDir);
      await closed;
    }
  });
});

/** Connects to the background browser on `profileDir` as a program would, checks it's the student, and disconnects. */
async function connectAndCheck(profileDir: string): Promise<void> {
  const found = await backgroundBrowser(profileDir);
  assert.ok(found, "the background browser is open");
  const moodle = createMoodle({ site: SITE, browser: connectBrowserManager({ ...found, profileDir }) });
  patient(await moodle.context());
  assert.equal((await moodle.whoAmI()).userId, await userId("student"));
  await moodle.close();
  assert.ok(await backgroundBrowser(profileDir), "closing only disconnected");
}

/** An account's id by its username, as the admin sees it; undefined when there's none. */
async function accountId(username: string): Promise<number | undefined> {
  const admin = await as("admin");
  return (await admin.callService<{ id: number }[]>("core_user_get_users_by_field", { field: "username", values: [username] }))[0]?.id;
}

/**
 * Deletes an account the suite made, by its username, as the admin through Moodle's user list
 * (`admin/user.php`); nothing when there's no such account (its form was never saved).
 */
async function deleteUser(username: string): Promise<void> {
  const id = await accountId(username);
  if (!id) return;
  const admin = await as("admin");
  const page = await (await admin.context()).newPage();
  try {
    await page.goto(`${SITE}my/`, { waitUntil: "domcontentloaded" });
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    // Moodle's confirmation is md5 of the id, as its "Delete" button sends it.
    const confirm = createHash("md5").update(String(id)).digest("hex");
    await page.goto(`${SITE}admin/user.php?delete=${id}&confirm=${confirm}&sesskey=${sesskey}`, { waitUntil: "domcontentloaded" });
  } finally {
    await page.close();
  }
  // Moodle keeps a deleted account's record and still gives it to the admin, renamed; userById
  // treats it as gone.
  const left = await admin.userById(id);
  if (left) throw new Error(`The throwaway account ${id} wasn't deleted (userById still gives ${left.username}).`);
}
