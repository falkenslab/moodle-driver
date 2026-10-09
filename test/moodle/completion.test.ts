import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { CompletionError, completionReport, overrideCompletion, setCompletion } from "../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

async function open(state: FakeMoodleState): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  return context;
}

describe("setCompletion and overrideCompletion", { skip: !browser && "no system browser" }, () => {
  // Made-up activities: 5 has manual completion, 6 completes on view.
  const state = (): FakeMoodleState => ({
    user: { id: 4, fullName: "Student" },
    serviceCalls: [],
    services: {
      core_completion_update_activity_completion_status_manually: ({ cmid }) => {
        if (cmid === 6) throw new ServiceFailure("cannotmanualctrack");
        return { status: true, warnings: [] };
      },
      core_completion_override_activity_completion_status: ({ userid, cmid, newstate }) => {
        if (userid === 9) throw new ServiceFailure("nopermission");
        return { cmid, userid, state: newstate, timecompleted: 1_790_000_000, overrideby: 3, tracking: 2 };
      },
    },
  });

  it("marks manual completion, and explains an automatic one", async () => {
    const s = state();
    const context = await open(s);
    assert.deepEqual(await setCompletion(context, SITE, 5, true), { changed: "Activity 5 marked done." });
    assert.deepEqual(s.serviceCalls!.at(-1)?.args, { cmid: 5, completed: true });
    await assert.rejects(setCompletion(context, SITE, 6, true), (error: Error) => error instanceof CompletionError && /completes automatically/.test(error.message));
    await context.close();
  });

  it("overrides someone's completion by Moodle's state number, and refuses what Moodle refuses", async () => {
    const s = state();
    const context = await open(s);
    const result = await overrideCompletion(context, SITE, 6, 4, "complete");
    assert.deepEqual([result.state, result.overridden], ["complete", true]);
    assert.deepEqual(s.serviceCalls!.at(-1)?.args, { userid: 4, cmid: 6, newstate: 1 });
    await assert.rejects(overrideCompletion(context, SITE, 6, 9, "incomplete"), CompletionError);
    await context.close();
  });
});

/** The progress report as Moodle 5.2 renders it, reduced: header links, rows with icons by file name. */
const REPORT = `<form id="include-activity-select-report"></form>
<table id="completion-progress"><thead><tr><th>Name</th><th>Email</th>
<th class="completion-header"><a href="${SITE}mod/page/view.php?id=5" title="Notes"><span>Notes</span></a></th>
<th class="completion-header"><a href="${SITE}mod/book/view.php?id=6" title="Book"><span>Book</span></a></th></tr></thead><tbody>
<tr><th scope="row"><a href="${SITE}user/view.php?id=4&amp;course=3">Ana Student</a></th><td>a@example.org</td>
<td class="completion-progresscell"><a class="changecompl"><img src="${SITE}theme/image.php/boost/core/1/i/completion-manual-y" alt="Ana, Notes: Completed"></a></td>
<td class="completion-progresscell"><img src="${SITE}theme/image.php/boost/core/1/i/completion-auto-y-override" alt="Ana, Book: Completed (set by a teacher)"></td></tr>
<tr><th scope="row"><a href="${SITE}user/view.php?id=5&amp;course=3">Bruno Student</a></th><td>b@example.org</td>
<td class="completion-progresscell"><img src="${SITE}theme/image.php/boost/core/1/i/completion-manual-n"></td>
<td class="completion-progresscell"><img src="${SITE}theme/image.php/boost/core/1/i/completion-auto-fail"></td></tr></tbody></table>`;

describe("completionReport", { skip: !browser && "no system browser" }, () => {
  it("reads every participant's completion by the icons' names, through the pages until no new rows", async () => {
    const pagesServed: string[] = [];
    const context = await open({ user: { id: 3, fullName: "Teacher" }, pagesServed, bodies: { "/report/progress/index.php": REPORT } });
    const report = await completionReport(context, SITE, 3);
    assert.deepEqual(report.activities, [
      { id: 5, name: "Notes", type: "page" },
      { id: 6, name: "Book", type: "book" },
    ]);
    assert.deepEqual(report.participants, [
      {
        userId: 4,
        fullName: "Ana Student",
        completion: [
          { activityId: 5, state: "complete", tracking: "manual", overridden: false },
          { activityId: 6, state: "complete", tracking: "auto", overridden: true },
        ],
      },
      {
        userId: 5,
        fullName: "Bruno Student",
        completion: [
          { activityId: 5, state: "incomplete", tracking: "manual", overridden: false },
          { activityId: 6, state: "complete-fail", tracking: "auto", overridden: false },
        ],
      },
    ]);
    // The second page brought the same rows: nothing new, so it stopped there.
    assert.equal(pagesServed.filter((p) => p === "/report/progress/index.php").length, 2);
    await context.close();
  });

  it("gives an empty report when no activity tracks completion, and refuses an error page", async () => {
    const context = await open({ user: { id: 3, fullName: "Teacher" }, bodies: { "/report/progress/index.php": `<form id="include-activity-select-report"></form><div class="errorbox">None.</div>` } });
    assert.deepEqual(await completionReport(context, SITE, 3), { activities: [], participants: [] });
    await context.close();
    const denied = await open({ user: { id: 4, fullName: "Student" }, bodies: { "/report/progress/index.php": `<div class="errorbox">Not allowed.</div>` } });
    await assert.rejects(completionReport(denied, SITE, 3), CompletionError);
    await denied.close();
  });
});
