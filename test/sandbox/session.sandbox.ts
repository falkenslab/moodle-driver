// The session and the site, against the sandbox: the model for the other files.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMoodleSite, parseSiteUrl, publicSiteInfo, siteName } from "../../src/index.js";
import { readWwwroot } from "../../src/internals.js";
import { COURSE, SITE, as, userId } from "./harness.js";

describe("session and site", () => {
  it("publicSiteInfo: the site's name and login page, without the browser", async () => {
    const info = await publicSiteInfo(SITE);
    assert.ok(info.name);
    // Moodle's own wwwroot, without the trailing slash the driver's site URLs have.
    assert.equal(info.url, "http://localhost:8080");
  });

  it("whoAmI: each account is who the sandbox says", async () => {
    const student = await as("student");
    const me = await student.whoAmI(COURSE);
    assert.equal(me.userId, await userId("student"));
    assert.ok(me.course?.roles.some((role) => role.id === 5));
  });

  it("siteName: the site's name from a logged-in page", async () => {
    const teacher = await as("teacher");
    assert.ok(await siteName(await teacher.context(), SITE));
  });

  it("parseSiteUrl: the sandbox's URL normalized", () => {
    assert.equal(parseSiteUrl("http://localhost:8080"), SITE);
  });

  it("readWwwroot: the sandbox's wwwroot from a page's HTML", async () => {
    const html = await (await fetch(SITE)).text();
    assert.equal(readWwwroot(html), "http://localhost:8080");
  });

  it("findMoodleSite: finds the sandbox from one of its course URLs", async () => {
    const found = await findMoodleSite(`${SITE}course/view.php?id=${COURSE}`);
    assert.equal(found, SITE);
  });
});
