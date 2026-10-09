import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { LoginTimeoutError, LoginWindowClosedError, waitForLogin } from "../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

type State = { user?: { id: number; fullName: string } };

async function fakeSite(state: State): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  return context;
}

/**
 * The person logs in `delayMs` after the login page shows: the site gets a user and that page moves
 * on to the dashboard.
 */
function logInLater(context: BrowserContext, state: State, delayMs: number) {
  const timer = setInterval(() => {
    const page = context.pages().find((p) => p.url() === `${SITE}login/index.php`);
    if (!page) return;
    clearInterval(timer);
    setTimeout(() => {
      state.user = { id: 4, fullName: "Grace Hopper" };
      void page.goto(`${SITE}my/`).catch(() => undefined);
    }, delayMs);
  }, 20);
}

describe("waitForLogin", { skip: !browser && "no system browser" }, () => {
  it("returns once the page shows the site logged in", async () => {
    const state: State = {};
    const context = await fakeSite(state);
    const page = await context.newPage();
    await page.goto(`${SITE}login/index.php`);
    logInLater(context, state, 300);
    await waitForLogin(page, SITE, { timeoutMs: 10_000, pollMs: 50 });
    assert.equal(page.url(), `${SITE}my/`);
    await context.close();
  });

  it("gives up after the timeout", async () => {
    const context = await fakeSite({});
    const page = await context.newPage();
    await page.goto(`${SITE}login/index.php`);
    await assert.rejects(waitForLogin(page, SITE, { timeoutMs: 200, pollMs: 50 }), LoginTimeoutError);
    await context.close();
  });

  it("notices the window being closed", async () => {
    const context = await fakeSite({});
    const page = await context.newPage();
    await page.goto(`${SITE}login/index.php`);
    setTimeout(() => void context.close(), 200);
    await assert.rejects(waitForLogin(page, SITE, { timeoutMs: 10_000, pollMs: 50 }), LoginWindowClosedError);
  });
});

