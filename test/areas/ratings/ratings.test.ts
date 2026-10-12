import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { GradingError, rate } from "../../../src/index.js";
import { SITE, launchTestBrowser, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A post's rating form as Moodle 5.2 renders it under a forum post, reduced; made-up post 11, a 0-5 point scale. */
const RATING_FORM = `<article id="p11"><form id="postrating11" class="postratingform" method="post" action="${SITE}rating/rate.php"><div class="ratingform">
<input type="hidden" class="ratinginput" name="contextid" value="88"><input type="hidden" class="ratinginput" name="component" value="mod_forum">
<input type="hidden" class="ratinginput" name="ratingarea" value="post"><input type="hidden" class="ratinginput" name="itemid" value="11">
<input type="hidden" class="ratinginput" name="scaleid" value="5"><input type="hidden" class="ratinginput" name="returnurl" value="${SITE}mod/forum/discuss.php?d=6">
<input type="hidden" class="ratinginput" name="rateduserid" value="5"><input type="hidden" class="ratinginput" name="aggregation" value="1"><input type="hidden" class="ratinginput" name="sesskey" value="s1">
<select class="postratingmenu ratinginput" id="menurating11" name="rating"><option value="-999">Rate...</option>${[0, 1, 2, 3, 4, 5].map((v) => `<option value="${v}">${v}</option>`).join("")}</select>
<input type="submit" class="postratingmenusubmit" value="Rate"></div></form></article>
<article id="p12"><p>Your own post: no rating menu.</p></article>`;

/** A rating form as Moodle 5.2 renders it for an item of another module, reduced; a 0-5 point scale. */
const ratingForm = (itemId: number, component: string, area: string) =>
  `<div class="ratings"><form id="postrating${itemId}" class="postratingform" method="post" action="${SITE}rating/rate.php"><div class="ratingform hstack gap-2">
<input type="hidden" class="ratinginput" name="contextid" value="310"><input type="hidden" class="ratinginput" name="component" value="${component}">
<input type="hidden" class="ratinginput" name="ratingarea" value="${area}"><input type="hidden" class="ratinginput" name="itemid" value="${itemId}">
<input type="hidden" class="ratinginput" name="scaleid" value="5"><input type="hidden" class="ratinginput" name="rateduserid" value="5">
<input type="hidden" class="ratinginput" name="aggregation" value="1"><input type="hidden" class="ratinginput" name="sesskey" value="s1">
<select class="postratingmenu ratinginput" name="rating"><option value="-999">Rate...</option>${[0, 1, 2, 3, 4, 5].map((v) => `<option value="${v}">${v}</option>`).join("")}</select></div></form></div>`;

/** rate_ajax.php, answering a rating as Moodle does for the only rating of an item. */
async function answerRatings(context: BrowserContext, sent: Record<string, string>[]): Promise<void> {
  await context.route(`${SITE}rating/rate_ajax.php`, async (route) => {
    const data = Object.fromEntries(new URLSearchParams(route.request().postData() ?? ""));
    sent.push(data);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, aggregate: data.rating, count: 1, itemid: Number(data.itemid) }) });
  });
}

async function open(sent: Record<string, string>[], answer?: object): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/mod/forum/discuss.php": RATING_FORM } });
  await context.route(`${SITE}rating/rate_ajax.php`, async (route) => {
    const data = Object.fromEntries(new URLSearchParams(route.request().postData() ?? ""));
    sent.push(data);
    const body = answer ?? (data.rating === "-999" ? { success: true, aggregate: " - ", count: 0, itemid: 11 } : { success: true, aggregate: data.rating, count: 1, itemid: 11 });
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  return context;
}

describe("rate", { skip: !browser && "no system browser" }, () => {
  it("rates a post with its form's fields, and takes the rating away", async () => {
    const sent: Record<string, string>[] = [];
    const context = await open(sent);
    const post = { type: "forum-post", id: 11, discussionId: 6 } as const;
    assert.deepEqual(await rate(context, SITE, post, 4), { changed: 'Rated forum-post 11 "4".', aggregate: "4", count: 1 });
    assert.deepEqual(sent[0], { contextid: "88", component: "mod_forum", ratingarea: "post", itemid: "11", scaleid: "5", rateduserid: "5", aggregation: "1", sesskey: "s1", rating: "4" });
    assert.deepEqual(await rate(context, SITE, post, null), { changed: "Rating on forum-post 11 taken away.", count: 0 });
    assert.equal(sent[1]?.rating, "-999");
    await context.close();
  });

  it("rates a glossary entry on its glossary's page, which its own page names", async () => {
    const sent: Record<string, string>[] = [];
    const context = await browser!.newContext();
    const state = {
      user: { id: 3, fullName: "Teacher" },
      pagesServed: [] as string[],
      // The entry's own page has no ratings (Moodle 5.2); its body class names its glossary.
      bodies: { "/mod/glossary/showentry.php": "<p>Term: its definition.</p>", "/mod/glossary/view.php": ratingForm(21, "mod_glossary", "entry") },
      bodyClasses: { "/mod/glossary/showentry.php": "path-mod-glossary cmid-230 cm-type-glossary" },
    };
    await serveFakeMoodle(context, state);
    await answerRatings(context, sent);
    assert.deepEqual(await rate(context, SITE, { type: "glossary-entry", id: 21 }, 5), { changed: 'Rated glossary-entry 21 "5".', aggregate: "5", count: 1 });
    assert.deepEqual(state.pagesServed, ["/mod/glossary/showentry.php", "/mod/glossary/view.php"]);
    assert.equal(sent[0]?.component, "mod_glossary");
    await context.close();
  });

  it("rates a database record whose rating form is nested in the single view's form", async () => {
    const sent: Record<string, string>[] = [];
    const context = await browser!.newContext();
    // The browser drops the nested form element and keeps its fields (Moodle 5.2's single view).
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/mod/data/view.php": `<form id="singleview" method="post">${ratingForm(31, "mod_data", "entry")}</form>` } });
    await answerRatings(context, sent);
    assert.deepEqual(await rate(context, SITE, { type: "database-record", id: 31 }, 3), { changed: 'Rated database-record 31 "3".', aggregate: "3", count: 1 });
    assert.equal(sent[0]?.component, "mod_data");
    assert.equal(sent[0]?.itemid, "31");
    await context.close();
  });

  it("refuses an item without a rating menu, a rating off the scale, and passes Moodle's refusal", async () => {
    const context = await open([], { success: false, error: "Rating is outside the allowed range" });
    await assert.rejects(rate(context, SITE, { type: "forum-post", id: 12, discussionId: 6 }, 3), (error: Error) => error instanceof GradingError && /no rating menu for you/.test(error.message));
    await assert.rejects(rate(context, SITE, { type: "forum-post", id: 11, discussionId: 6 }, 9), /rated on "0", "1", "2", "3", "4", "5"; not "9"/);
    await assert.rejects(rate(context, SITE, { type: "forum-post", id: 11, discussionId: 6 }, 2), /Rating is outside the allowed range/);
    await context.close();
  });
});
