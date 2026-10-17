import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { FormError, WorkshopError, allocateRandomly, allocateReviewer, removeReviewer, scheduleAllocation, workshopAllocation } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const page = (route: Route, body: string, bodyId = "page-mod-workshop-allocation") =>
  route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: moodlePage({
      userId: 3,
      body: `<div id="region-main"><div role="main">${body}</div></div>`,
      bodyId,
    }),
  });

const NAMES: Record<number, string> = {
  5: "Lucía Martín",
  6: "Marcos López",
  7: "Sara Gil",
};
const picture = (id: number, size = 35) =>
  `<a href="${SITE}user/view.php?id=${id}&amp;course=167" class="d-inline-block aabtn"><span class="userinitials size-${size}" title="${NAMES[id]}">XX</span></a>`;

/** The fake workshop: Lucía (5) and Sara (7) submitted, Marcos (6) didn't; self-assessment off. */
interface Workshop {
  submissions: Record<number, { id: number; title: string }>;
  /** Assessments: id, submission's author, reviewer, graded. */
  assessments: {
    id: number;
    author: number;
    reviewer: number;
    graded: boolean;
  }[];
  next: number;
}

/** The manual allocator's table as workshopallocation_manual_renderer renders it (Moodle 5.2), reduced. */
function manualTable(w: Workshop, pageNumber: number): string {
  const participants = pageNumber === 0 ? [5, 6] : [7];
  const rows = participants.map((id) => {
    const submission = w.submissions[id];
    const by = w.assessments.filter((a) => a.author === id);
    const of = w.assessments.filter((a) => a.reviewer === id);
    const del = (asid: number) =>
      `<a href="${SITE}mod/workshop/allocation.php?cmid=58&amp;method=manual&amp;mode=del&amp;what=${asid}&amp;sesskey=s1" class="action-icon"><i class="icon fa fa-trash-can"></i></a>`;
    const offered = [5, 6, 7].filter((r) => r !== id);
    return `<tr><td class="reviewedby cell c0">${
      submission
        ? `<div class="singleselect"><form method="get" action="${SITE}mod/workshop/allocation.php" id="addreviewof${id}"><input type="hidden" name="of" value="${id}"><select name="by"><option value="" selected>Choose user...</option>${offered.map((r) => `<option value="${r}">${NAMES[r]}</option>`).join("")}</select></form></div>`
        : '<div class="info">Nothing to review</div>'
    }<ul>${by.map((a) => `<li>${picture(a.reviewer, 16)}${NAMES[a.reviewer]}${del(a.id)}</li>`).join("")}</ul></td>
<td class="peer cell c1">${picture(id)}${NAMES[id]}<div class="submission">${submission ? `<div class="title"><a href="${SITE}mod/workshop/submission.php?cmid=58&amp;id=${submission.id}">${submission.title}</a></div>` : '<div class="info">No submission found for this user</div>'}</div></td>
<td class="reviewerof cell c2 lastcol"><ul>${of.map((a) => `<li>${picture(a.author, 16)}${NAMES[a.author]}${del(a.id)}</li>`).join("")}</ul></td></tr>`;
  });
  return `<h3>Manual allocation</h3><div class="allocator-ui"><nav><ul class="pagination"><li><a class="page-link" href="${SITE}mod/workshop/allocation.php?cmid=58&amp;method=manual&amp;page=1">2</a></li></ul></nav>
<div class="manual-allocator"><table class="allocations table-reboot"><tbody>${rows.join("")}</tbody></table></div></div>`;
}

/** The random allocator's form (Moodle 5.2), reduced; `selfAssessment` adds its checkbox, where the workshop allows it. */
const randomForm = (method: string, extra = "") => `<form action="${SITE}mod/workshop/allocation.php" method="post" class="mform">
<input type="hidden" name="cmid" value="58"><input type="hidden" name="method" value="${method}"><input name="excludesamegroup" type="hidden" value="0"><input name="sesskey" type="hidden" value="s1">${extra}
<input type="text" name="numofreviews" id="id_numofreviews" value="5"><div class="invalid-feedback" id="id_error_numofreviews"></div><select name="numper" id="id_numper"><option value="1" selected>per submission</option><option value="2">per reviewer</option></select>
<input type="checkbox" name="removecurrent" value="1" id="id_removecurrent"><input type="checkbox" name="assesswosubmission" value="1" id="id_assesswosubmission">
<div class="form-control-static" data-name="addselfassessment">Self-assessment disabled</div>
<input type="submit" name="submitbutton" value="Save changes"></form>`;

const results = (message: string, lines: string) =>
  `<div class="allocator-init-results"><div class="message ok"><span>${message}</span></div><ul class="allocation-init-results">${lines}</ul><div class="continuebutton"><form method="get" action="${SITE}mod/workshop/allocation.php"><button type="submit">Continue</button></form></div></div>`;

async function workshopSite(
  w: Workshop = {
    submissions: {
      5: { id: 1, title: "Loops essay" },
      7: { id: 4, title: "Sara's essay" },
    },
    assessments: [{ id: 10, author: 5, reviewer: 7, graded: false }],
    next: 11,
  },
) {
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, {
    user: { id: 3, fullName: "Profesor Demo" },
  });
  const posted: URLSearchParams[] = [];
  const actions: string[] = [];
  let scheduled = { enabled: false, numofreviews: "5", numper: "1" };
  await context.route(`${SITE}mod/workshop/allocation.php**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const q = url.searchParams;
    if (request.method() === "POST") {
      const form = new URLSearchParams(request.postData() ?? "");
      posted.push(form);
      if (form.get("method") === "scheduled") {
        scheduled = {
          enabled: form.get("enablescheduled") === "1",
          numofreviews: form.get("numofreviews") ?? "",
          numper: form.get("numper") ?? "",
        };
        return page(route, `<h3>Scheduled allocation</h3>${results(scheduled.enabled ? "Scheduled allocation enabled" : "Scheduled allocation disabled", "")}`);
      }
      // Marcos (6) reviews Lucía's submission; Sara's gets no one: Moodle reports it.
      w.assessments.push({
        id: w.next++,
        author: 5,
        reviewer: 6,
        graded: false,
      });
      return page(
        route,
        `<h3>Random allocation</h3>${results("Allocation done", '<li class="info">Trying to allocate 1 review(s) per author</li><li class="ok indent">New assessment to be done: <strong>Marcos López</strong> is reviewer of <strong>Lucía Martín</strong></li><li class="error indent">Not enough peers available</li><li class="debug">iteration 1</li>')}`,
      );
    }
    const method = q.get("method") ?? "manual";
    if (method === "random") return page(route, `<h3>Random allocation</h3><div class="allocator-ui"><div class="random-allocator">${randomForm("random")}</div></div>`);
    if (method === "scheduled") {
      const form = randomForm("scheduled", `<input type="checkbox" name="enablescheduled" value="1" id="id_enablescheduled"${scheduled.enabled ? " checked" : ""}>`)
        .replace('value="5"', `value="${scheduled.numofreviews}"`)
        .replace('<option value="2">', `<option value="2"${scheduled.numper === "2" ? " selected" : ""}>`)
        .replace('<input type="submit"', '<div class="form-control-static" data-name="infostatus">Workshop does not have the submissions deadline defined</div><input type="submit"');
      return page(route, `<h3>Scheduled allocation</h3><div class="allocator-ui"><div class="scheduled-allocator">${form}</div></div>`);
    }
    // Moodle redirects each action to the allocation page with its message; served in place here
    // (Playwright doesn't route the request after a redirect it fulfilled).
    const message = (type: string, text: string, confirm = "") =>
      page(route, manualTable(w, 0).replace('<div class="allocator-ui">', `<div class="allocator-ui"><div class="message ${type}"><span>${text}</span>${confirm}</div>`));
    if (q.get("mode") === "new") {
      const author = Number(q.get("of"));
      const reviewer = Number(q.get("by"));
      actions.push(`new ${author} ${reviewer}`);
      if (!w.submissions[author]) return message("error", "No submission found for this user");
      if (w.assessments.some((a) => a.author === author && a.reviewer === reviewer)) return message("info", "The allocation already exists");
      w.assessments.push({ id: w.next++, author, reviewer, graded: false });
      return message("ok", "Submission has been allocated");
    }
    if (q.get("mode") === "del") {
      const a = w.assessments.find((x) => x.id === Number(q.get("what")))!;
      actions.push(`del ${a.id}${q.get("confirm") === "1" ? " confirmed" : ""}`);
      if (q.get("confirm") !== "1") {
        const sure = `<form method="get" action="${SITE}mod/workshop/allocation.php"><input type="hidden" name="mode" value="del"><input type="hidden" name="what" value="${a.id}"><input type="hidden" name="confirm" value="1"><button type="submit">Yes, I am sure</button></form>`;
        return a.graded ? message("error", "Assessment has already been graded. Are you sure?", sure) : message("info", "Are you sure?", sure);
      }
      w.assessments = w.assessments.filter((x) => x !== a);
      return message("ok", "Assessment deleted");
    }
    return page(route, manualTable(w, Number(q.get("page") ?? "0")));
  });
  return { context, w, posted, actions };
}

describe("workshopAllocation", { skip: !browser && "no system browser" }, () => {
  it("reads every page of the manual allocator: submissions, their reviewers and who may review", async () => {
    const site = await workshopSite();
    assert.deepEqual(await workshopAllocation(site.context, SITE, 58), {
      activityId: 58,
      submissions: [
        {
          id: 1,
          title: "Loops essay",
          authorId: 5,
          author: "Lucía Martín",
          reviewers: [{ assessmentId: 10, reviewerId: 7, reviewer: "Sara Gil" }],
        },
        {
          id: 4,
          title: "Sara's essay",
          authorId: 7,
          author: "Sara Gil",
          reviewers: [],
        },
      ],
      potentialReviewers: [
        { userId: 6, fullName: "Marcos López" },
        { userId: 7, fullName: "Sara Gil" },
        { userId: 5, fullName: "Lucía Martín" },
      ],
    });
    await site.context.close();
  });

  it("names the capability when Moodle refuses, and refuses another activity", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 5, fullName: "Lucía Martín" },
    });
    await context.route(`${SITE}mod/workshop/allocation.php**`, (route) =>
      page(route, '<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Allocate submissions for review).</p></div>'),
    );
    await assert.rejects(workshopAllocation(context, SITE, 58), (error: Error) => error instanceof WorkshopError && /mod\/workshop:allocate/.test(error.message));
    await assert.rejects(allocateRandomly(context, SITE, 58, { perSubmission: 2 }), (error: Error) => error instanceof WorkshopError && /mod\/workshop:allocate/.test(error.message));
    await context.route(`${SITE}mod/workshop/allocation.php**`, (route) => page(route, '<div data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>', "page-site-index"));
    await assert.rejects(workshopAllocation(context, SITE, 46), /isn't a workshop/);
    await context.close();
  });
});

describe("allocateReviewer", { skip: !browser && "no system browser" }, () => {
  it("adds a reviewer by the submission's id or its author's, and says when they were already allocated", async () => {
    const site = await workshopSite();
    const result = await allocateReviewer(site.context, SITE, 58, {
      submissionId: 1,
      reviewerId: 6,
    });
    assert.equal(result.changed, "User 6 allocated to review submission 1 of workshop 58.");
    assert.equal(result.added, true);
    assert.equal(result.assessmentId, 11);
    assert.deepEqual(
      result.submission.reviewers.map((r) => r.reviewerId),
      [7, 6],
    );
    const again = await allocateReviewer(site.context, SITE, 58, {
      authorId: 5,
      reviewerId: 6,
    });
    assert.equal(again.added, false);
    assert.equal(again.assessmentId, 11);
    // Already allocated: nothing asked of Moodle the second time.
    assert.deepEqual(site.actions, ["new 5 6"]);
    assert.equal(site.w.assessments.length, 2);
    await site.context.close();
  });

  it("refuses a reviewer Moodle doesn't offer, self-assessment, a missing submission and an ambiguous one", async () => {
    const site = await workshopSite();
    await assert.rejects(
      allocateReviewer(site.context, SITE, 58, {
        submissionId: 1,
        reviewerId: 2,
      }),
      (error: Error) => error instanceof WorkshopError && /can't review submission 1.*it offers 6, 7/.test(error.message),
    );
    await assert.rejects(
      allocateReviewer(site.context, SITE, 58, {
        submissionId: 1,
        reviewerId: 5,
      }),
      /doesn't allow self-assessment/,
    );
    await assert.rejects(allocateReviewer(site.context, SITE, 58, { authorId: 6, reviewerId: 5 }), /User 6 has no submission/);
    await assert.rejects(
      allocateReviewer(site.context, SITE, 58, {
        submissionId: 9,
        reviewerId: 5,
      }),
      /has no submission 9/,
    );
    await assert.rejects(
      allocateReviewer(site.context, SITE, 58, {
        submissionId: 1,
        authorId: 5,
        reviewerId: 6,
      }),
      /one of the two/,
    );
    assert.equal(site.w.assessments.length, 1);
    await site.context.close();
  });
});

describe("removeReviewer", { skip: !browser && "no system browser" }, () => {
  it("deletes the allocation through Moodle's question, and keeps a graded one unless asked", async () => {
    const site = await workshopSite();
    site.w.assessments.push({ id: 11, author: 7, reviewer: 5, graded: true });
    const result = await removeReviewer(site.context, SITE, 58, {
      submissionId: 1,
      reviewerId: 7,
    });
    assert.equal(result.assessmentId, 10);
    assert.deepEqual(result.submission.reviewers, []);
    assert.match(result.changed, /no longer reviews submission 1/);
    await assert.rejects(removeReviewer(site.context, SITE, 58, { authorId: 7, reviewerId: 5 }), /already assessed.*evenIfAssessed/);
    assert.deepEqual(site.actions, ["del 10", "del 10 confirmed", "del 11"]);
    assert.equal(site.w.assessments.length, 1);
    assert.equal(
      (
        await removeReviewer(site.context, SITE, 58, {
          authorId: 7,
          reviewerId: 5,
          evenIfAssessed: true,
        })
      ).assessmentId,
      11,
    );
    await assert.rejects(removeReviewer(site.context, SITE, 58, { authorId: 7, reviewerId: 5 }), /isn't allocated to review submission 4.*none/);
    await site.context.close();
  });
});

describe("allocateRandomly", { skip: !browser && "no system browser" }, () => {
  it("fills Moodle's form, and gives its report, its problems and the allocation afterwards", async () => {
    const site = await workshopSite();
    const result = await allocateRandomly(site.context, SITE, 58, {
      perSubmission: 1,
      withoutSubmission: true,
    });
    const form = site.posted[0]!;
    assert.equal(form.get("numofreviews"), "1");
    assert.equal(form.get("numper"), "1");
    assert.equal(form.get("assesswosubmission"), "1");
    assert.equal(form.get("removecurrent"), null);
    assert.equal(result.added, 1);
    assert.equal(result.removed, 0);
    assert.equal(result.changed, "Workshop 58 allocated at random: 1 allocation(s) added, 0 removed.");
    assert.deepEqual(result.problems, ["Not enough peers available"]);
    assert.deepEqual(result.report, [
      "Allocation done",
      "Trying to allocate 1 review(s) per author",
      "New assessment to be done: Marcos López is reviewer of Lucía Martín",
      "Not enough peers available",
    ]);
    assert.deepEqual(
      result.allocation.submissions[0]!.reviewers.map((r) => r.reviewerId),
      [7, 6],
    );
    await site.context.close();
  });

  it("refuses settings the workshop doesn't have, and wants one number of reviews", async () => {
    const site = await workshopSite();
    await assert.rejects(
      allocateRandomly(site.context, SITE, 58, {
        perSubmission: 1,
        selfAssessment: true,
      }),
      /doesn't allow self-assessment/,
    );
    await assert.rejects(
      allocateRandomly(site.context, SITE, 58, {
        perSubmission: 1,
        excludeSameGroup: true,
      }),
      /visible groups mode/,
    );
    await assert.rejects(allocateRandomly(site.context, SITE, 58, {}), /perSubmission.*perReviewer/);
    await assert.rejects(
      allocateRandomly(site.context, SITE, 58, {
        perSubmission: 1,
        perReviewer: 2,
      }),
      /not both/,
    );
    assert.equal(site.posted.length, 0);
    await site.context.close();
  });

  it("passes on Moodle's refusal of the form", async () => {
    const site = await workshopSite();
    await site.context.route(`${SITE}mod/workshop/allocation.php**`, (route) =>
      page(route, randomForm("random").replace('id="id_error_numofreviews"></div>', 'id="id_error_numofreviews">Invalid number</div>')),
    );
    await assert.rejects(allocateRandomly(site.context, SITE, 58, { perReviewer: 3 }), FormError);
    await site.context.close();
  });
});

describe("scheduleAllocation", { skip: !browser && "no system browser" }, () => {
  it("turns it on with its settings, and reads it back with Moodle's status", async () => {
    const site = await workshopSite();
    assert.deepEqual(
      await scheduleAllocation(site.context, SITE, 58, {
        enabled: true,
        perReviewer: 2,
      }),
      {
        changed: "Workshop 58's scheduled allocation turned on.",
        enabled: true,
        perReviewer: 2,
        keepCurrent: true,
        withoutSubmission: false,
        selfAssessment: false,
        status: "Workshop does not have the submissions deadline defined",
      },
    );
    assert.equal(site.posted[0]?.get("enablescheduled"), "1");
    const off = await scheduleAllocation(site.context, SITE, 58, {
      enabled: false,
    });
    assert.equal(off.enabled, false);
    // The settings left out keep what the form had.
    assert.equal(off.perReviewer, 2);
    await site.context.close();
  });
});
