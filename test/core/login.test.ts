import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { LoginTimeoutError, LoginWindowClosedError, logIn, waitForLogin, type ContextOptions } from "../../src/index.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle } from "../../src/testing/index.js";
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

describe("logIn", { skip: !browser && "no system browser" }, () => {
  /** A browser manager over `context` that records what it's asked. */
  function manager(context: BrowserContext) {
    const requests: ContextOptions[] = [];
    const calls = { closed: 0, saved: 0 };
    const browser = fakeBrowserManager({
      context: async (options = {}) => (requests.push(options), context),
      close: async () => void calls.closed++,
      saveSession: async () => void calls.saved++,
    });
    return { browser, requests, calls };
  }

  it("returns the user at once when the session is alive, without a window", async () => {
    const context = await fakeSite({ user: { id: 9, fullName: "Alan Turing" } });
    const { browser, requests, calls } = manager(context);
    assert.deepEqual(await logIn(browser, SITE, { timeoutMs: 10_000 }), { status: "already-logged-in", userId: 9, fullName: "Alan Turing" });
    assert.deepEqual(requests, [{}]);
    assert.deepEqual(calls, { closed: 0, saved: 0 });
    await context.close();
  });

  it("opens a window, waits for the person, saves the session and goes back to headless", async () => {
    const state: State = {};
    const context = await fakeSite(state);
    const { browser, requests, calls } = manager(context);
    logInLater(context, state, 1500);
    assert.deepEqual(await logIn(browser, SITE, { timeoutMs: 20_000 }), { status: "logged-in", userId: 4, fullName: "Grace Hopper" });
    assert.deepEqual(requests, [{}, { headed: true }]);
    assert.deepEqual(calls, { closed: 1, saved: 1 });
    await context.close();
  });

  it("closes the window when nobody logs in in time", async () => {
    const context = await fakeSite({});
    const { browser, calls } = manager(context);
    await assert.rejects(logIn(browser, SITE, { timeoutMs: 200 }), LoginTimeoutError);
    assert.deepEqual(calls, { closed: 1, saved: 0 });
    await context.close();
  });
});
