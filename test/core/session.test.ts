import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { NotLoggedInError, fetchSitePage, htmlSessionFacts, isLoggedIn, logOut, openSitePage, readMoodleConfig, readSessionFacts } from "../../src/core/session.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/fakeMoodle.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

describe("isLoggedIn", () => {
  const user = { notLoggedIn: false, userId: 5, hasLogoutLink: true, hasLoginLink: false };

  it("accepts a site page with a real user", () => {
    assert.equal(isLoggedIn(`${SITE}my/`, SITE, user), true);
  });

  it("accepts a page without the navigation bar, like the assignment grader", () => {
    assert.equal(isLoggedIn(`${SITE}mod/assign/view.php?id=3&action=grader`, SITE, { ...user, hasLogoutLink: false }), true);
  });

  it("rejects the login page, other sites, logged-out pages and guests", () => {
    assert.equal(isLoggedIn(`${SITE}login/index.php`, SITE, user), false);
    assert.equal(isLoggedIn("https://sso.example.org/", SITE, user), false);
    assert.equal(isLoggedIn(`${SITE}my/`, SITE, { notLoggedIn: true, userId: 0, hasLogoutLink: false, hasLoginLink: true }), false);
    assert.equal(isLoggedIn(`${SITE}my/`, SITE, { notLoggedIn: false, userId: 1, hasLogoutLink: false, hasLoginLink: true }), false);
    assert.equal(isLoggedIn(`${SITE}my/`, SITE, { ...user, userId: null }), false);
  });
});

describe("readSessionFacts", { skip: !browser && "no system browser" }, () => {
  // A new page each time: `setContent` keeps the window, and with it the previous page's `M`.
  async function factsOf(html: string) {
    const page = await browser!.newPage();
    await page.setContent(html);
    const facts = await readSessionFacts(page);
    await page.close();
    return facts;
  }

  it("reads a logged-in page, a login page and a page that isn't Moodle's", async () => {
    assert.deepEqual(await factsOf(moodlePage({ userId: 7 })), { notLoggedIn: false, userId: 7, hasLogoutLink: true, hasLoginLink: false });
    assert.deepEqual(await factsOf(moodlePage({ userId: 0 })), { notLoggedIn: true, userId: 0, hasLogoutLink: false, hasLoginLink: true });
    assert.equal((await factsOf("<html><body>An identity provider</body></html>")).userId, null);
  });
});

describe("openSitePage", { skip: !browser && "no system browser" }, () => {
  it("opens a page with a session and refuses one without", async () => {
    const context = await browser!.newContext();
    const state: { user?: { id: number; fullName: string } } = {};
    await serveFakeMoodle(context, state);
    await assert.rejects(openSitePage(context, SITE, "my/"), NotLoggedInError);
    assert.equal(context.pages().length, 0);
    state.user = { id: 3, fullName: "Ada Lovelace" };
    const page = await openSitePage(context, SITE, "my/");
    assert.equal(page.url(), `${SITE}my/`);
    await context.close();
  });
});

describe("logOut", { skip: !browser && "no system browser" }, () => {
  /** A fake site whose logout link ends the session, unless `ends` is false. */
  async function site(state: FakeMoodleState, ends = true) {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    await context.route(`${SITE}login/logout.php**`, (route) => {
      if (ends) delete state.user;
      return route.fulfill({ status: 200, contentType: "text/html", body: `<body class="notloggedin"><script>var M={cfg:{userId:0}}</script>Logged out</body>` });
    });
    return context;
  }

  it("logs out, and says when nobody was logged in", async () => {
    const state: FakeMoodleState = { user: { id: 3, fullName: "T" } };
    const context = await site(state);
    assert.equal(await logOut(context, SITE), true);
    assert.equal(state.user, undefined);
    assert.equal(await logOut(context, SITE), false);
    assert.equal(context.pages().length, 0);
    await context.close();
  });

  it("throws when Moodle keeps the session", async () => {
    const context = await site({ user: { id: 3, fullName: "T" } }, false);
    await assert.rejects(logOut(context, SITE), /still logged in/);
    await context.close();
  });
});

describe("reading a page's HTML", () => {
  it("parses M.cfg as Moodle writes it, escaped slashes and nested objects included", () => {
    const html = moodlePage({ userId: 4, sesskey: "abc" }).replace("M.cfg = {", 'M.cfg = {"homeurl":{"a":"}"},');
    assert.deepEqual(readMoodleConfig(html), { homeurl: { a: "}" }, wwwroot: "http://moodle.test", sesskey: "abc", userId: 4, language: "en", usertimezone: "Europe/Madrid" });
    assert.equal(readMoodleConfig("<html><body>No Moodle here</body></html>"), undefined);
  });

  it("tells a person's page from a guest's and from the login page", () => {
    assert.deepEqual(htmlSessionFacts(moodlePage({ userId: 4 })), { notLoggedIn: false, userId: 4, hasLogoutLink: true, hasLoginLink: false });
    assert.equal(isLoggedIn(SITE, SITE, htmlSessionFacts(moodlePage({ userId: 4, guest: true }))), false);
    assert.equal(isLoggedIn(SITE, SITE, htmlSessionFacts(moodlePage({ userId: 0 }))), false);
  });
});

describe("fetchSitePage", { skip: !browser && "no system browser" }, () => {
  it("gives a page's HTML with the session, and NotLoggedInError without one", async () => {
    const context = await browser!.newContext();
    const state: FakeMoodleState = { user: { id: 4, fullName: "Ada Lovelace" }, bodies: { "/my/courses.php": "<p id='mine'>My courses</p>" } };
    await serveFakeMoodle(context, state);
    const { url, html } = await fetchSitePage(context, SITE, "my/courses.php");
    assert.equal(url, `${SITE}my/courses.php`);
    assert.ok(html.includes("<p id='mine'>My courses</p>"));
    delete state.user;
    await assert.rejects(fetchSitePage(context, SITE, "my/courses.php"), NotLoggedInError);
    await context.close();
  });
});
