import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { Route } from "playwright-core";
import { ScormError, openScorm, scorm } from "../../../src/index.js";
import { SITE, fakeBrowserManager, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A SCORM's page as Moodle 5.2 renders it, reduced: the "Enter" form and the attempt status. */
const view = (status: string) => `<div data-activityname="Check what you know"></div><div role="main"><div id="intro" class="box"><p>Ten questions.</p></div>
<div class="scorm-center"><form id="scormviewform" method="post" action="${SITE}mod/scorm/player.php"><button name="mode" id="n" value="normal">Enter</button>
<input type="hidden" name="scoid" value="2" /><input type="hidden" name="cm" value="43" /><input type="hidden" name="currentorg" value="org1" /></form></div>
<div class="box py-3 generalbox"><p>${status}</p></div></div>`;
const TWO_ATTEMPTS = "Number of attempts allowed: 3<br />Number of attempts you have made: 2<br />Grade for attempt 1: 40%<br />Grade for attempt 2: 100%<br />Grading method: Highest attempt<br />Grade reported: 100%<br />";
const NONE = "Number of attempts allowed: Unlimited<br />Number of attempts you have made: 0<br />Grading method: Highest attempt<br />Grade reported: None<br />";
/** `prereqs.php`'s table of contents: a SCO's status by its icon, its score after the title. */
const TOC = `<ul><li><a data-scoid="2" title="a=1&amp;scoid=2"><i class="icon fa-check fa-fw" title="Passed"></i>&nbsp;Questions&nbsp;(Score:&nbsp;100)</a></li>
<li><a data-scoid="3" title="a=1&amp;scoid=3"><i class="icon fa-regular fa-pen-to-square fa-fw" title="Incomplete"></i>&nbsp;Summary&nbsp;</a></li>
<li><a data-scoid="4" title="a=1&amp;scoid=4"><i class="icon fa-regular fa-square fa-fw" title="Not attempted"></i>&nbsp;Extra&nbsp;</a></li></ul>`;

describe("scorm", { skip: !browser && "no system browser" }, () => {
  it("reads the attempt status by position and the SCOs from the table of contents, for the last attempt", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, bodies: { "/mod/scorm/view.php": view(TWO_ATTEMPTS), "/mod/scorm/prereqs.php": TOC } });
    const asked: string[] = [];
    context.on("request", (request) => void (request.url().includes("prereqs.php") && asked.push(request.url())));
    assert.deepEqual(await scorm(context, SITE, 43), {
      id: 43,
      name: "Check what you know",
      description: "<p>Ten questions.</p>",
      attemptsAllowed: 3,
      attemptsMade: 2,
      gradingMethod: "Highest attempt",
      grade: "100%",
      attemptGrades: [
        { attempt: 1, grade: "40%" },
        { attempt: 2, grade: "100%" },
      ],
      scos: [
        { id: 2, title: "Questions", status: "passed", score: 100 },
        { id: 3, title: "Summary", status: "incomplete" },
        { id: 4, title: "Extra", status: "not-attempted" },
      ],
    });
    const query = new URL(asked[0]!).searchParams;
    assert.deepEqual([query.get("id"), query.get("scoid"), query.get("attempt"), query.get("currentorg"), query.get("sesskey")], ["43", "2", "2", "org1", "s1"]);
    await context.close();
  });

  it("gives no grade before the first attempt, and refuses another module", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, bodies: { "/mod/scorm/view.php": view(NONE), "/mod/scorm/prereqs.php": "" } });
    const activity = await scorm(context, SITE, 43);
    assert.deepEqual([activity.attemptsAllowed, activity.attemptsMade, activity.grade, activity.attemptGrades, activity.scos], [undefined, 0, undefined, [], []]);
    await context.route(`${SITE}mod/scorm/view.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 5, bodyId: "page-site-index" }) }));
    await assert.rejects(scorm(context, SITE, 5), ScormError);
    await context.close();
  });
});

describe("openScorm", { skip: !browser && "no system browser" }, () => {
  it("opens the player on the working tab, at the SCO and attempt Moodle chose, once the SCO's frame loads", async () => {
    const context = await browser!.newContext();
    // The player as Moodle renders it, reduced: its data model script and its init call (kept inert), and the SCO's frame.
    const player = `<script type="text/plain" src="${SITE}mod/scorm/datamodels/scorm_12.js"></script>
<script type="text/plain">M.scorm_api.init({"2":{}}, {}, {}, "^.*$", "^.*$", false, 0, "1", "http:\\/\\/moodle.test", "s1", "3", 2, "normal", "43", "org1", false, false, "0");</script>
<iframe id="scorm_object" src="${SITE}pluginfile.php/1/mod_scorm/content/1/index.html"></iframe>`;
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, bodies: { "/mod/scorm/view.php": view(TWO_ATTEMPTS), "/mod/scorm/player.php": player } });
    const tab = await context.newPage();
    const opened = await openScorm(fakeBrowserManager({ context: async () => context, tab: async () => tab }), SITE, 43, { scoId: 3, newAttempt: true });
    const query = new URL(opened.url).searchParams;
    assert.deepEqual([new URL(opened.url).pathname, query.get("cm"), query.get("scoid"), query.get("currentorg"), query.get("mode"), query.get("newattempt")], ["/mod/scorm/player.php", "43", "3", "org1", "normal", "on"]);
    assert.deepEqual([opened.attempt, opened.scoId, opened.version], [2, 3, "SCORM 1.2"]);
    assert.equal(tab.url(), opened.url);
    await context.close();
  });

  it("says so when Moodle doesn't open the player", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, bodies: { "/mod/scorm/view.php": view(TWO_ATTEMPTS), "/mod/scorm/player.php": "<p>You have reached the maximum number of attempts.</p>" } });
    const tab = await context.newPage();
    await assert.rejects(openScorm(fakeBrowserManager({ context: async () => context, tab: async () => tab }), SITE, 43), ScormError);
    await context.close();
  });
});
