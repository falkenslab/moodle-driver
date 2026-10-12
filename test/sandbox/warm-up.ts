// Logging the accounts in patiently before the harness opens them: on a loaded sandbox (a page in
// 20 s) the harness's login click times out after 30 s, and its `as()` then keeps the failure for
// the whole file. Logged in here first, with minutes to spare, the harness finds the session and
// skips its form. Each account's profile is opened, saved and closed before `as()` opens it; then
// the accounts' browsers wait minutes, not seconds, for Moodle's pages.
import { readFileSync } from "node:fs";
import { createMoodle } from "../../src/index.js";
import { SITE, as, type Role } from "./harness.js";

const PATIENCE = 300_000;

/** Logs the accounts in, one at a time, unless their profile already has a session. Call before any `as()`. */
export async function warmUp(...roles: Role[]): Promise<void> {
  const accounts = JSON.parse(readFileSync("/sandbox/accounts.json", "utf8")) as Record<Role, { username: string; password: string }>;
  for (const role of roles) {
    const moodle = createMoodle({ site: SITE, profileDir: `/sandbox/profiles/${role}`, channel: "chromium", headless: true, downloadBrowser: false, trail: "fast" });
    try {
      const page = await (await moodle.context()).newPage();
      page.setDefaultTimeout(PATIENCE);
      page.setDefaultNavigationTimeout(PATIENCE);
      await page.goto(`${SITE}login/index.php`, { waitUntil: "domcontentloaded" });
      if ((await page.locator("#username").count()) > 0) {
        await page.fill("#username", accounts[role].username);
        await page.fill("#password", accounts[role].password);
        await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("#loginbtn", { noWaitAfter: true })]);
        if ((await page.locator("#username").count()) > 0) throw new Error(`The sandbox's ${role} account couldn't log in.`);
      }
      await page.close();
      await moodle.saveSession();
    } finally {
      await moodle.close();
    }
  }
  // The driver's pages wait 60 s for a navigation; a loaded sandbox can take longer.
  for (const role of roles) {
    const context = await (await as(role)).context();
    context.setDefaultNavigationTimeout(PATIENCE);
    context.setDefaultTimeout(PATIENCE);
  }
}
