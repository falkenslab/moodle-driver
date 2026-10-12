// Logs the accounts in before the harness does, patiently: on a busy sandbox the login form's answer
// takes longer than the 30 seconds harness.ts's click waits, and a failed login there stops the file.
// Same profiles as harness.ts: once logged in here, its own login finds the session and skips the form.
// (What the harness itself should gain: a longer wait on the login, and closing the browser when it fails.)
import { readFileSync } from "node:fs";
import { createMoodle } from "../../src/index.js";
import { SITE, type Role } from "./harness.js";

const accounts = JSON.parse(readFileSync("/sandbox/accounts.json", "utf8")) as Record<Role, { username: string; password: string }>;

async function logIn(role: Role): Promise<void> {
  const moodle = createMoodle({ site: SITE, profileDir: `/sandbox/profiles/${role}`, channel: "chromium", headless: true, downloadBrowser: false, trail: "fast" });
  try {
    const page = await (await moodle.context()).newPage();
    page.setDefaultTimeout(300_000);
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

/** Logs the accounts in (each tried three times), before any `as()` of the file. */
export async function logInPatiently(roles: Role[] = ["admin", "teacher", "student"]): Promise<void> {
  for (const role of roles) {
    for (let tries = 1; ; tries++) {
      try {
        await logIn(role);
        break;
      } catch (error) {
        if (tries === 3) throw error;
      }
    }
  }
}
