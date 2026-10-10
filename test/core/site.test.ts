import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { MoodleUrlError } from "../../src/options.js";
import { findMoodleSite, readWwwroot } from "../../src/core/site.js";
import { moodlePage } from "../../src/testing/fakeMoodle.js";

describe("readWwwroot", () => {
  it("reads Moodle's escaped wwwroot", () => {
    assert.equal(readWwwroot(String.raw`M.cfg = {"wwwroot":"https:\/\/campus.example.org\/moodle","sesskey":"x"};`), "https://campus.example.org/moodle");
    assert.equal(readWwwroot("<html>Not Moodle</html>"), undefined);
  });
});

describe("findMoodleSite", () => {
  let server: Server;
  let origin: string;
  before(async () => {
    server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      if (request.url?.startsWith("/moodle")) {
        // Moodle pages carry the site's wwwroot, whatever the page.
        response.end(moodlePage({ userId: 0, wwwroot: `${origin}/moodle` }));
      } else response.end("<html>Not Moodle</html>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  it("turns any page of a site into its base URL", async () => {
    assert.equal(await findMoodleSite(`${origin}/moodle/course/view.php?id=4`), `${origin}/moodle/`);
  });

  it("refuses a site that isn't Moodle, or can't be reached", async () => {
    await assert.rejects(findMoodleSite(`${origin}/other`), /doesn't look like a Moodle/);
    await assert.rejects(findMoodleSite("http://127.0.0.1:1/"), MoodleUrlError);
    await assert.rejects(findMoodleSite("ftp://example.org/"), MoodleUrlError);
  });
});
