import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { NotAnH5PActivityError, h5pActivity } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const PLAYER = `${SITE}h5p/embed.php?url=x&amp;component=mod_h5pactivity`;
const VIEW = `<div data-activityname="Quick check"></div><a href="${SITE}mod/h5pactivity/report.php?id=38">View my attempts</a><iframe class="h5p-player" src="${PLAYER}"></iframe>`;
const EMBED = `<script>var H5PIntegration = {"contents":{"cid-1":{"library":"H5P.MultiChoice 1.14","title":"Quick check"}}};</script>`;
/** The person's attempts report as Moodle 5.2 renders it, reduced: the scored attempt's table, then every attempt's. */
const attempt = (n: number, id: number, score: number, success: string) =>
  `<tr><th scope="row">${n}</th><td><span>10 Oct</span></td><td>${score}<span class="d-md-none"> / 1</span></td><td>1</td><td>1s</td>
<td><img alt="Completed" src="${SITE}theme/image.php/boost/core/1/i/completion-auto-y"></td><td><i class="icon fa ${success}"></i></td><td><a href="${SITE}mod/h5pactivity/report.php?a=1&amp;attemptid=${id}">View</a></td></tr>`;
const REPORT = `<div id="region-main"><table><tbody>${attempt(2, 7, 1, "fa-circle-check")}</tbody></table><table><tbody>${attempt(1, 6, 0, "fa-regular fa-circle")}${attempt(2, 7, 1, "fa-circle-check")}</tbody></table></div>`;

describe("h5pActivity", { skip: !browser && "no system browser" }, () => {
  it("reads the content type from the player and the person's attempts by position and icon", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/mod/h5pactivity/view.php": VIEW, "/mod/h5pactivity/report.php": REPORT, "/h5p/embed.php": EMBED } });
    assert.deepEqual(await h5pActivity(context, SITE, 38), {
      id: 38,
      name: "Quick check",
      tracked: true,
      contentType: { library: "H5P.MultiChoice", version: "1.14" },
      attempts: [
        { id: 6, number: 1, score: 0, maxScore: 1, completed: true, passed: false },
        { id: 7, number: 2, score: 1, maxScore: 1, completed: true, passed: true },
      ],
    });
    await context.close();
  });

  it("finds tracking from the report itself when the page doesn't link it, as for a student without attempts", async () => {
    // The sandbox showed it: Moodle 5.2 links a student's report only once they have an attempt.
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/mod/h5pactivity/view.php": `<div data-activityname="Fresh"></div>`, "/mod/h5pactivity/report.php": `<div id="region-main"><p>No attempts yet</p></div>` } });
    assert.deepEqual(await h5pActivity(context, SITE, 40), { id: 40, name: "Fresh", tracked: true, attempts: [] });
    await context.close();
  });

  it("gives no attempts where they aren't tracked, and refuses another module", async () => {
    const context = await browser!.newContext();
    // Untracked, the report is Moodle's error page, which keeps the report's body id.
    const denied = `<div class="box errorbox alert alert-danger" data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that.</p></div>`;
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/mod/h5pactivity/view.php": `<div data-activityname="Untracked"></div>`, "/mod/h5pactivity/report.php": denied } });
    assert.deepEqual(await h5pActivity(context, SITE, 39), { id: 39, name: "Untracked", tracked: false, attempts: [] });
    await context.close();
    const other = await browser!.newContext();
    await serveFakeMoodle(other, { user: { id: 4, fullName: "Student" }, bodies: {} });
    // Moodle answers another module's id with a page that isn't the H5P view.
    await other.route(`${SITE}mod/h5pactivity/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-site-index" }) }));
    await assert.rejects(h5pActivity(other, SITE, 5), NotAnH5PActivityError);
    await other.close();
  });
});
