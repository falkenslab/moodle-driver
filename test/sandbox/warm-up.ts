// Logs the suite's accounts in ahead of the harness, patiently: on a loaded sandbox the login form's
// redirect takes longer than the 30 s a click waits for its navigation, and the harness then fails
// the whole file. Each account is logged in its own profile (the one `as()` uses) and closed, so
// `as()` finds the session and doesn't post the form again.
import { readFileSync } from "node:fs";
import { createMoodle } from "../../src/index.js";
import { SITE, type Role } from "./harness.js";

const accounts = JSON.parse(readFileSync("/sandbox/accounts.json", "utf8")) as Record<Role, { username: string; password: string }>;

/** Logs `roles` in (once each, retried), before the first `as()` of the file. */
export async function warmUp(...roles: Role[]): Promise<void> {
  for (const role of roles) {
    for (let attempt = 1; ; attempt++) {
      try {
        await logIn(role);
        break;
      } catch (error) {
        if (attempt >= 3) throw error;
      }
    }
  }
}

async function logIn(role: Role): Promise<void> {
  const moodle = createMoodle({ site: SITE, profileDir: `/sandbox/profiles/${role}`, channel: "chromium", headless: true, downloadBrowser: false, trail: "fast" });
  try {
    const page = await (await moodle.context()).newPage();
    page.setDefaultTimeout(300_000);
    page.setDefaultNavigationTimeout(300_000);
    await page.goto(`${SITE}login/index.php`, { waitUntil: "domcontentloaded" });
    if ((await page.locator("#username").count()) > 0) {
      const { username, password } = accounts[role];
      await page.fill("#username", username);
      await page.fill("#password", password);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("#loginbtn", { noWaitAfter: true })]);
      if ((await page.locator("#username").count()) > 0) throw new Error(`The sandbox's ${role} account couldn't log in.`);
    }
    await page.close();
    await moodle.saveSession();
  } finally {
    await moodle.close();
  }
}
