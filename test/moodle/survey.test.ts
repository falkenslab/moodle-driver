import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { SurveyError, getSurvey, submitSurvey } from "../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// Made-up surveys shaped like Moodle 5.2's: a one-page questionnaire (cmid 33), a two-page feedback (cmid 34).
const QUESTIONNAIRE_FORM = `<form id="phpesp_response" method="post" action="${SITE}mod/questionnaire/complete.php?id=33">
<fieldset class="qn-container"><div class="qn-legend"><h2 class="qn-number">1</h2><img class="req" alt="Required"></div><div class="qn-question">Recommend?</div>
<input id="r1" type="radio" name="q2" value="y"><label for="r1">Yes</label><input id="r2" type="radio" name="q2" value="n"><label for="r2">No</label></fieldset>
<fieldset class="qn-container"><div class="qn-legend"><h2 class="qn-number">2</h2></div><div class="qn-question">Rate 1 to 3</div>
<table><tr class="raterow"><td>Content</td><td><input type="radio" name="q4_7" value="-999" checked><label class="accesshide">Row 1, Content: Unanswered.</label></td><td><input type="radio" name="q4_7" value="1"></td><td><input type="radio" name="q4_7" value="3"></td></tr></table></fieldset>
<input type="submit" name="submit" value="Submit questionnaire"></form>`;

const FEEDBACK_PAGES = [
  `<div class="feedback_itemlist"><div class="col-form-label"><p>Did you like it <i class="text-danger"></i><span class="visually-hidden">(Required field)</span></p></div>
<input type="hidden" name="multichoice_1" value="0"><label><input type="radio" name="multichoice_1" value="1"> A lot </label><label><input type="radio" name="multichoice_1" value="2"> Not much </label></div>
<input type="submit" name="gonextpage" value="Next page">`,
  `<div class="feedback_itemlist"><div class="col-form-label"><p>One word</p></div><input type="text" name="textfield_6"></div>
<input type="submit" name="gopreviouspage" value="Previous page"><input type="submit" name="savevalues" value="Submit your answers">`,
];

function fakeSurveys() {
  const posts: { path: string; form: URLSearchParams }[] = [];
  let submitted = false;
  const page = (body: string, bodyId: string) => moodlePage({ userId: 4, body, bodyId });
  const routes = async (context: BrowserContext) => {
    await context.route(/\/mod\/(questionnaire|feedback)\//, (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const [, , type, file] = url.pathname.split("/") as [string, string, "questionnaire" | "feedback", string];
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      if (file === "view.php") {
        const body = submitted ? `<div class="alert">You have already submitted.</div>` : `<a href="${SITE}mod/${type}/complete.php?id=${url.searchParams.get("id")}">Answer the questions</a>`;
        return html(page(`<div id="region-main"><div class="activity-description">Tell us.</div>${body}</div>`, `page-mod-${type}-view`));
      }
      if (request.method() === "POST") {
        const form = new URLSearchParams(request.postData() ?? "");
        posts.push({ path: url.pathname, form });
        if (type === "questionnaire") {
          if (!form.get("q2")) return html(page(`<div id="region-main"><div class="alert alert-danger">Please answer required question #1.<button class="close">Dismiss this notification</button></div>${QUESTIONNAIRE_FORM}</div>`, "page-mod-questionnaire-complete"));
          submitted = true;
          return html(page(`<div id="region-main">Thank you</div>`, "page-mod-questionnaire-complete"));
        }
        if (form.has("gonextpage")) return html(page(`<form class="feedback_form mform" method="post" action="${SITE}mod/feedback/complete.php">${FEEDBACK_PAGES[1]}</form>`, "page-mod-feedback-complete"));
        submitted = true;
        return html(page(`<div id="region-main">Thank you</div>`, "page-mod-feedback-complete"));
      }
      if (type === "questionnaire") return html(page(`<div id="region-main">${QUESTIONNAIRE_FORM}</div>`, "page-mod-questionnaire-complete"));
      const p = Number(url.searchParams.get("gopage") ?? 0);
      return html(page(`<form class="feedback_form mform" method="post" action="${SITE}mod/feedback/complete.php">${FEEDBACK_PAGES[p] ?? ""}</form>`, "page-mod-feedback-complete"));
    });
  };
  return { posts, routes };
}

describe("getSurvey and submitSurvey", { skip: !browser && "no system browser" }, () => {
  async function site() {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const surveys = fakeSurveys();
    await surveys.routes(context);
    return { context, posts: surveys.posts };
  }

  it("reads a questionnaire: required marks, choices, rating rows", async () => {
    const { context } = await site();
    const survey = await getSurvey(context, SITE, 33, "questionnaire");
    assert.deepEqual([survey.canAnswer, survey.intro], [true, "Tell us."]);
    const [first, second] = survey.questions;
    assert.deepEqual([first?.number, first?.text, first?.required, first?.fields[0]?.options], ["1", "Recommend?", true, [{ value: "y", label: "Yes" }, { value: "n", label: "No" }]]);
    assert.deepEqual([second?.required, second?.fields[0]?.label, second?.fields[0]?.value, second?.fields[0]?.options?.map((o) => o.label)], [false, "Content", "-999", ["(no answer)", "1", "3"]]);
    await context.close();
  });

  it("reads every page of a feedback, and submits it page by page", async () => {
    const { context, posts } = await site();
    const { questions } = await getSurvey(context, SITE, 34, "feedback");
    assert.deepEqual(questions.map((q) => [q.page, q.text, q.required, q.fields[0]?.name]), [[0, "Did you like it", true, "multichoice_1"], [1, "One word", false, "textfield_6"]]);
    assert.deepEqual(questions[0]?.fields[0]?.options?.map((o) => o.label), ["A lot", "Not much"]);
    const done = await submitSurvey(context, SITE, 34, "feedback", { multichoice_1: "1", textfield_6: "Great" });
    // PHP keeps a name's last value: the hidden "0" goes first, the chosen radio after it.
    const last = (form: URLSearchParams, name: string) => form.getAll(name).at(-1) ?? null;
    assert.deepEqual(posts.map((p) => [last(p.form, "multichoice_1"), last(p.form, "textfield_6"), p.form.has("gonextpage"), p.form.has("savevalues")]), [["1", null, true, false], [null, "Great", false, true]]);
    assert.deepEqual(done.messages, ["You have already submitted."]);
    // Once answered, there's nothing to read nor to send.
    assert.deepEqual(await getSurvey(context, SITE, 34, "feedback"), { canAnswer: false, intro: "Tell us.", messages: ["You have already submitted."], questions: [] });
    await assert.rejects(submitSurvey(context, SITE, 34, "feedback", { textfield_6: "Again" }), (error: unknown) => error instanceof SurveyError && /can't answer feedback 34 now: You have already submitted\./.test(error.message));
    await context.close();
  });

  it("checks names before sending and returns Moodle's complaints", async () => {
    const { context, posts } = await site();
    await assert.rejects(submitSurvey(context, SITE, 33, "questionnaire", { q9: "1" }), (error: unknown) => error instanceof SurveyError && /no field q9/.test(error.message));
    assert.equal(posts.length, 0);
    await assert.rejects(submitSurvey(context, SITE, 33, "questionnaire", { q4_7: "3" }), (error: unknown) => {
      assert.ok(error instanceof SurveyError);
      assert.match(error.message, /Please answer required question #1\./);
      assert.doesNotMatch(error.message, /Dismiss/);
      return true;
    });
    await context.close();
  });

  it("refuses an activity of another type", async () => {
    const { context } = await site();
    // The fake names a page after its path: a questionnaire's isn't a feedback's.
    await context.route(`${SITE}mod/feedback/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-questionnaire-view" }) }));
    await assert.rejects(getSurvey(context, SITE, 33, "feedback"), (error: unknown) => error instanceof SurveyError && /isn't a feedback you can open/.test(error.message));
    await context.close();
  });
});

describe("survey modules found by their page", { skip: !browser && "no system browser" }, () => {
  it("finds a feedback activity's module, and submits with responses first", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const surveys = fakeSurveys();
    await surveys.routes(context);
    // Activity 35 is a feedback: the questionnaire's page answers with Moodle's error page.
    await context.route(`${SITE}mod/questionnaire/view.php?id=35`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-questionnaire-view-error" }) }));
    const survey = await getSurvey(context, SITE, 35);
    assert.deepEqual(survey.questions.map((q) => q.fields[0]?.name), ["multichoice_1", "textfield_6"]);
    await submitSurvey(context, SITE, 35, { multichoice_1: "1", textfield_6: "Fine" });
    assert.ok(surveys.posts.every((p) => p.path === "/mod/feedback/complete.php"));
    await context.close();
  });
});
