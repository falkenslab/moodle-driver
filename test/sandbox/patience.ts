// Patience with a loaded sandbox (shared by several runs at once), for harness.ts's steps that time out:
// - `as()` clicks "Log in" with Playwright's 30 s wait for the navigation it starts, which a busy
//   sandbox exceeds (the admin's login, seen on the shared sandbox), and then keeps the failed login
//   for the file. Logged in here first, in the same profile, `as()` finds the session and skips the form.
// - `scratchCourse()` opens the new course's form with the driver's 60 s navigation timeout.
import { readFileSync } from "node:fs";
import { errors } from "playwright-core";
import { createMoodle } from "../../src/index.js";
import { SITE, scratchCourse, type Role, type ScratchCourse } from "./harness.js";

/** `scratchCourse()`, tried again when opening its form timed out (nothing was created then). */
export async function patientScratchCourse(name: string, tries = 3): Promise<ScratchCourse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await scratchCourse(name);
    } catch (error) {
      const opening = error instanceof errors.TimeoutError && error.message.includes("course/edit.php?category=1");
      if (!opening || attempt >= tries) throw error;
    }
  }
}

/** Logs `role` in, in its profile, waiting as long as the sandbox needs; nothing when it already is. */
export async function logInPatiently(role: Role): Promise<void> {
  const accounts = JSON.parse(readFileSync("/sandbox/accounts.json", "utf8")) as Record<Role, { username: string; password: string }>;
  const moodle = createMoodle({ site: SITE, profileDir: `/sandbox/profiles/${role}`, channel: "chromium", headless: true, downloadBrowser: false, trail: "fast" });
  try {
    const page = await (await moodle.context()).newPage();
    page.setDefaultTimeout(300_000);
    await page.goto(`${SITE}login/index.php`, { waitUntil: "domcontentloaded" });
    if ((await page.locator("#username").count()) > 0) {
      const { username, password } = accounts[role];
      await page.fill("#username", username);
      await page.fill("#password", password);
      await Promise.all([page.waitForURL((url) => !url.pathname.endsWith("/login/index.php"), { waitUntil: "domcontentloaded" }), page.click("#loginbtn", { noWaitAfter: true })]);
    }
    await page.close();
    await moodle.saveSession();
  } finally {
    await moodle.close();
  }
}
