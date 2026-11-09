// A browser killed during a call, for real: a local server stands in for Moodle, so the requests it
// receives can be counted. Firefox, the browser the test container can launch by channel.
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { firefox } from "playwright-core";
import { BrowserLostError, createBrowserManager, createMoodle, type Moodle } from "../../src/index.js";
import { moodlePage } from "../../src/testing/index.js";

const available = await firefox.launch({ headless: true }).then(
  async (browser) => (await browser.close(), true),
  () => false,
);

const COURSES = { courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: "http://x/course/view.php?id=3", visible: true }] };

describe("A browser killed during a call", { skip: !available && "no Firefox to launch" }, () => {
  let server: http.Server;
  let profileDir: string;
  let moodle: Moodle;
  let posts: string[];

  beforeEach(async () => {
    posts = [];
    profileDir = await mkdtemp(path.join(tmpdir(), "lostbrowser-"));
    server = http.createServer((request, response) => {
      if (request.method !== "POST") {
        response.setHeader("content-type", "text/html");
        return void response.end(moodlePage({ userId: 3, wwwroot: site().replace(/\/$/, "") }));
      }
      const method = new URL(request.url!, site()).searchParams.get("info")!;
      posts.push(method);
      // The first request of each call never gets its answer: the browser dies with it in flight.
      if (posts.length === 1) return void execSync(`pkill -9 -f "[l]ostbrowser-${profileDir.split("lostbrowser-")[1]}" || true`);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify([{ error: false, data: COURSES }]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    moodle = createMoodle({ site: site(), browser: createBrowserManager({ profileDir, channel: "firefox", headless: true, downloadBrowser: false }) });
  });

  const site = () => `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  afterEach(async () => {
    await moodle.close();
    server.closeAllConnections();
    server.close();
    await rm(profileDir, { recursive: true, force: true });
  });

  it("runs a read again on a new browser, once", async () => {
    assert.deepEqual((await moodle.listCourses()).map((c) => c.fullname), ["Loops"]);
    assert.equal(posts.length, 2);
  });

  it("never repeats a write", async () => {
    await assert.rejects(moodle.setCompletion(20, true), (error: unknown) => error instanceof BrowserLostError && error.code === "browser-lost");
    assert.deepEqual(posts, ["core_completion_update_activity_completion_status_manually"]);
  });
});
