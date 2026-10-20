import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { chromium } from "playwright-core";
import { BACKGROUND_FILE, backgroundBrowser, connectBrowserManager } from "../../src/browser/background.js";
import { hostBrowser, type BrowserHost } from "../../src/browser/host.js";
import { SESSION_COOKIES_FILE } from "../../src/browser/cookies.js";
import { launchTestBrowser } from "../../src/testing/index.js";

// Only where a browser can be launched (Docker, CI).
const available = await launchTestBrowser().then(async (b) => (await b?.close(), b !== undefined));

let profileDir: string;
let host: BrowserHost;
before(async () => {
  if (!available) return;
  profileDir = await mkdtemp(path.join(tmpdir(), "moodle-driver-host-"));
  // A session saved last time comes back in the hosted browser (ADR-003).
  await writeFile(path.join(profileDir, SESSION_COOKIES_FILE), JSON.stringify([{ name: "MoodleSession", value: "s3cret", domain: "moodle.test", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Lax" }]));
  host = await hostBrowser({ profileDir });
});
after(async () => {
  await host?.close();
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
});

/** An HTTP request to the host's port, with these headers: its status. */
function httpStatus(pathname: string, headers: Record<string, string>, method = "GET"): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(new URL(pathname, host.endpoint.replace(/^ws/, "http")), { method, headers }, (response) => {
      response.resume();
      resolve(response.statusCode!);
    });
    req.on("error", reject);
    req.end();
  });
}

const refused = (headers: Record<string, string>) =>
  chromium.connectOverCDP(host.endpoint, { headers, timeout: 5000 }).then(
    async (browser) => {
      await browser.close();
      return "connected";
    },
    (error: Error) => error.message,
  );

describe("a browser hosted for other processes", { skip: !available && "no browser to launch" }, () => {
  it("listens on 127.0.0.1 only, and refuses anything without the token", async () => {
    assert.match(host.endpoint, /^ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser$/);
    assert.match(await refused({}), /401 Unauthorized/);
    assert.match(await refused({ authorization: "Bearer not-the-token" }), /401 Unauthorized/);
    // A web page always sends Origin: refused even with the token.
    assert.match(await refused({ authorization: `Bearer ${host.token}`, origin: "http://evil.test" }), /401 Unauthorized/);
    assert.equal(await httpStatus("/status", {}), 401);
    assert.equal(await httpStatus("/close", {}, "POST"), 401);
    // Chromium's own endpoints aren't there: the browser's debugging connection is a pipe.
    assert.equal(await httpStatus("/json/version", { authorization: `Bearer ${host.token}` }), 404);
  });

  it("serves one client at a time, each starting clean, and keeps the browser when they disconnect", async () => {
    for (const round of [1, 2]) {
      const manager = connectBrowserManager({ endpoint: host.endpoint, token: host.token, profileDir });
      const context = await manager.context();
      if (round === 1) assert.deepEqual((await context.cookies("http://moodle.test/")).map((c) => [c.name, c.value]), [["MoodleSession", "s3cret"]]);
      const page = await context.newPage();
      await page.goto(`data:text/html,<title>round ${round}</title>`);
      assert.equal(await page.title(), `round ${round}`);
      // A second client waits its turn.
      assert.match(await refused({ authorization: `Bearer ${host.token}` }), /409 Conflict/);
      await page.close();
      await manager.close();
    }
    assert.equal(await httpStatus("/status", { authorization: `Bearer ${host.token}` }), 200);
  });

  it("is found from the file in its profile, a stale file removed", async () => {
    const file = path.join(profileDir, BACKGROUND_FILE);
    await writeFile(file, JSON.stringify({ endpoint: host.endpoint, token: host.token, pid: process.pid, channel: host.channel, headed: false }));
    assert.equal((await backgroundBrowser(profileDir))?.endpoint, host.endpoint);
    // A process that's gone.
    await writeFile(file, JSON.stringify({ endpoint: host.endpoint, token: host.token, pid: 2 ** 22 + 7, channel: host.channel, headed: false }));
    assert.equal(await backgroundBrowser(profileDir), undefined);
    await assert.rejects(readFile(file));
  });

  it("can't be shown from a client when it has no window", async () => {
    const manager = connectBrowserManager({ endpoint: host.endpoint, token: host.token });
    assert.equal(manager.visible(), false);
    await assert.rejects(manager.setVisible(true), { code: "no-display" });
    await assert.rejects(manager.context({ headed: true }), { code: "no-display" });
  });

  it("closes when asked with the token, saving the session", async () => {
    await host.close();
    await host.closed;
    assert.throws(() => process.kill(host.pid, 0));
    const saved = JSON.parse(await readFile(path.join(profileDir, SESSION_COOKIES_FILE), "utf8")) as { name: string }[];
    assert.deepEqual(saved.map((c) => c.name), ["MoodleSession"]);
  });
});

describe("hostBrowser", () => {
  it("refuses Firefox, which doesn't speak Chromium's debugging protocol", async () => {
    await assert.rejects(hostBrowser({ profileDir: tmpdir(), channel: "firefox" }), { code: "invalid-input" });
  });
});
