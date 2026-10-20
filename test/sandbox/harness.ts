// The sandbox suite's helpers: the accounts, logged in once per run in their own profiles, and a
// scratch course for the writes. Run through `npm run test:sandbox`, which mounts /sandbox.
//
// Rules for every file here:
// - Course 2 (the sandbox's "sandbox-course") is never touched; course 3 (COURSE) is only read.
// - Writes happen on a scratch course (scratchCourse), and each test removes what it creates there
//   and anywhere else; the scratch course is deleted after the file.
// - Test names start with the function they exercise, "<function>: <what>"; summary.ts checks every
//   function of src/index.ts appears in one (passed, failed, or skipped with the reason).
import { readFileSync } from "node:fs";
import { after, beforeEach } from "node:test";
import type { Page } from "playwright-core";
import { createMoodle, type Moodle } from "../../src/index.js";
import { openForm, setFields, submitForm } from "../../src/internals.js";


export type Role = "student" | "teacher" | "admin";
interface Accounts extends Record<Role, { username: string; password: string }> {
  sandboxCourseId: number;
  site?: string;
  series?: string;
  contentCourseId?: number;
  contentAssignmentId?: number;
  contentAssignmentItemId?: number;
  channel?: "chromium" | "firefox";
}
const accounts = JSON.parse(readFileSync("/sandbox/accounts.json", "utf8")) as Accounts;
/** The sandbox's own course: no test may use it. */
export const FORBIDDEN_COURSE = accounts.sandboxCourseId;
export const SITE = accounts.site ?? "http://localhost:8080/";
/** The Moodle series the sandbox runs ("5.2", "4.5"). */
export const SERIES = accounts.series ?? "5.2";
/** The content course every read uses (never written), found by its short name; an id no record has on a site without it. */
export const COURSE = accounts.contentCourseId ?? 3;
/** Its seeded assignment ("Tarea MCP") and that assignment's grade item. */
export const CONTENT_ASSIGNMENT = accounts.contentAssignmentId ?? 35;
export const CONTENT_ASSIGNMENT_ITEM = accounts.contentAssignmentItemId ?? 17;
/** The browser the suite runs in: Playwright's Chromium, or its Firefox (`--browser firefox`). */
export const CHANNEL = accounts.channel ?? "chromium";

const open = new Map<Role, Promise<Moodle>>();

// Each test says when it starts (the reporter speaks only when it ends), so a slow or hung run
// shows where it is while it runs.
beforeEach((t) => {
  console.error(`[${new Date().toISOString().slice(11, 19)}] ▶ ${t.name}`);
});

/** A Moodle object logged in as the account, its profile kept for the run; closed after the file. */
export function as(role: Role): Promise<Moodle> {
  let moodle = open.get(role);
  if (!moodle) {
    moodle = logIn(role);
    open.set(role, moodle);
  }
  return moodle;
}

async function logIn(role: Role): Promise<Moodle> {
  const moodle = createMoodle({ site: SITE, profileDir: `/sandbox/profiles/${role}`, channel: CHANNEL, headless: true, downloadBrowser: false, trail: "fast" });
  const context = await moodle.context();
  // A sandbox busy with other runs can take minutes to answer: Playwright's 30 s defaults would fail
  // checks that are only slow. The driver's own waits follow these defaults too.
  context.setDefaultTimeout(120_000);
  context.setDefaultNavigationTimeout(300_000);
  try {
    const page = await context.newPage();
    try {
      await page.goto(`${SITE}login/index.php`, { waitUntil: "domcontentloaded" });
      // Moodle sends a logged-in person on from the login page; the form is there only without a session.
      if ((await page.locator("#username").count()) > 0) {
        const { username, password } = accounts[role];
        await page.fill("#username", username);
        await page.fill("#password", password);
        await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("#loginbtn", { noWaitAfter: true })]);
        if ((await page.locator("#username").count()) > 0) throw new Error(`The sandbox's ${role} account couldn't log in.`);
      }
    } finally {
      await page.close().catch(() => undefined);
    }
    await moodle.saveSession();
    return moodle;
  } catch (error) {
    // A browser left open keeps the process, and its container, alive after the file; and the next
    // as(role) tries again instead of reusing the failure.
    await moodle.close().catch(() => undefined);
    open.delete(role);
    throw error;
  }
}

const cleanups: (() => Promise<unknown>)[] = [];

/** Runs `fn` after the file's tests, last registered first, before the browsers close: what a test made, it removes. */
export function cleanup(fn: () => Promise<unknown>): void {
  cleanups.push(fn);
}

// After the file: the cleanups (a failure is reported without stopping the others), then every
// account's browser closes (the profiles stay for the next file).
after(async () => {
  const failures: unknown[] = [];
  for (const fn of cleanups.reverse()) await fn().catch((error: unknown) => failures.push(error));
  cleanups.length = 0;
  // A login that failed is a rejected promise here: skipped, so the other browsers still close.
  for (const moodle of open.values()) await moodle.then((m) => m.close()).catch(() => undefined);
  open.clear();
  if (failures.length > 0) throw new AggregateError(failures, `${failures.length} cleanup(s) failed: the sandbox may keep something this file made.`);
});

/** The user ids of the accounts, as Moodle knows them. */
export async function userId(role: Role): Promise<number> {
  return (await (await as(role)).whoAmI()).userId;
}

/** Fails at once if a test is about to use the sandbox's own course. */
export function notForbidden(courseId: number): number {
  if (courseId === FORBIDDEN_COURSE) throw new Error(`Course ${courseId} is the sandbox's own course: the suite never touches it.`);
  return courseId;
}

export interface ScratchCourse {
  id: number;
  /** Its general section's id (section 0), where activities can be created. */
  sectionId: number;
}

/**
 * A new course for one file's writes ("Driver check suite <time>"), made by the admin with the
 * teacher (editing teacher) and the student enrolled; deleted after the file.
 */
export async function scratchCourse(name = "suite"): Promise<ScratchCourse> {
  const admin = await as("admin");
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  // A busy sandbox may not answer the first time: the form is opened up to three times.
  let page: Page | undefined;
  for (let attempt = 1; !page; attempt++) {
    try {
      page = await openForm(await admin.context(), SITE, "course/edit.php?category=1");
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
  let id: number;
  try {
    await setFields(page, { fullname: `Driver check ${name} ${stamp}`, shortname: `drivercheck-${name}-${stamp}` });
    await submitForm(page, "saveanddisplay");
    id = Number(new URL(page.url()).searchParams.get("id"));
  } finally {
    await page.close();
  }
  if (!id) throw new Error("The scratch course wasn't created.");
  cleanup(() => deleteCourse(id));
  await admin.enrolUsers(id, [await userId("teacher")], { roleId: 3 });
  await admin.enrolUsers(id, [await userId("student")], { roleId: 5 });
  const sections = await admin.courseStructure(id);
  return { id, sectionId: sections[0]!.id };
}

/** Deletes a course the suite made, as the admin, through Moodle's confirmation page. */
export async function deleteCourse(courseId: number): Promise<void> {
  notForbidden(courseId);
  if (courseId === COURSE) throw new Error("Course 3 is the suite's content course: it's only read.");
  const admin = await as("admin");
  const page: Page = await (await admin.context()).newPage();
  try {
    await page.goto(`${SITE}course/delete.php?id=${courseId}`, { waitUntil: "domcontentloaded" });
    // The confirmation's "Delete" button posts to delete.php with the course's hash and the sesskey.
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 300_000 }), page.click('form[action*="course/delete.php"] button[type="submit"], form[action*="course/delete.php"] input[type="submit"]')]);
  } finally {
    await page.close();
  }
}

/** Runs `fn` and gives its result, or undefined when it throws: for removing what may not be there. */
export async function quietly<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
