import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium } from "playwright-core";
import { createBrowserManager } from "../../src/browser/manager.js";
import type { BrowserOptions } from "../../src/options.js";

// Only where Playwright's Chromium is there to launch (the test container has it).
const available = await chromium.launch({ headless: true }).then(
  async (browser) => (await browser.close(), true),
  () => false,
);

// The user agent of every request the server gets, by path.
const seen = new Map<string, string | undefined>();
const server = http.createServer((request, response) => {
  seen.set(request.url!, request.headers["user-agent"]);
  response.setHeader("content-type", "text/html");
  response.end("<html><body>ok</body></html>");
});
let base: string;
let profileDir: string;
before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  profileDir = await mkdtemp(path.join(tmpdir(), "moodle-driver-ua-"));
});
after(async () => {
  server.close();
  await rm(profileDir, { recursive: true, force: true });
});

/** The user agents a page load, an AJAX call and a `context.request` fetch sent, launched with `userAgent`. */
async function sent(userAgent: BrowserOptions["userAgent"]): Promise<string[]> {
  seen.clear();
  const browser = createBrowserManager({ profileDir, channel: "chromium", headless: true, downloadBrowser: false, userAgent });
  try {
    const context = await browser.context();
    const page = await browser.tab();
    await page.goto(`${base}page`);
    await page.evaluate((url) => fetch(url).then(() => undefined), `${base}ajax`);
    await context.request.get(`${base}request`);
    return ["/page", "/ajax", "/request"].map((p) => seen.get(p) ?? "");
  } finally {
    await browser.close();
  }
}

describe("the user agent requests carry", { skip: !available && "no Chromium to launch" }, () => {
  it("is the browser's headless one without the option", async () => {
    for (const agent of await sent(undefined)) assert.match(agent, /HeadlessChrome\/\d/);
  });

  it("is the headed one with \"browser\", for pages, AJAX and context.request alike", async () => {
    const agents = await sent("browser");
    for (const agent of agents) {
      assert.doesNotMatch(agent, /Headless/);
      assert.match(agent, / Chrome\/\d/);
    }
  });

  it("is a text as it is", async () => {
    assert.deepEqual(await sent("Mozilla/5.0 Example/1.0"), ["Mozilla/5.0 Example/1.0", "Mozilla/5.0 Example/1.0", "Mozilla/5.0 Example/1.0"]);
  });
});
