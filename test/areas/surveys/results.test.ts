import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { NotLoggedInError, SurveyError, surveyResults } from "../../../src/index.js";
import { parseCsv } from "../../../src/areas/surveys/results.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const page = (body: string, bodyId: string) => moodlePage({ userId: 3, body: `<div id="region-main"><div role="main">${body}</div></div>`, bodyId });
const errorBox = (message: string) => `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">${message}</p></div>`;

// A made-up feedback (cmid 34) shaped like Moodle 5.2's print page: a single choice, a multiple
// choice, a page break, a rated choice, a text field and a number.
const FEEDBACK_PRINT = `<form class="feedback_form"><div data-region="questions-sortable-list">
<div id="fgroup_id_group_multichoice_1" class="mb-3 row fitem feedback_itemlist feedback-item-multichoice feedback_hasvalue multichoice-r multichoice-vertical">
  <div class="col-md-3 col-form-label"><p>Did you like it<i class="icon fa fa-circle-exclamation text-danger" title="Required field"></i><span class="visually-hidden">(Required field)</span></p></div>
  <div class="felement"><input name="multichoice_1" type="hidden" value="0">
  <label class="form-check-label"><input type="radio" name="multichoice_1" value="0"> Not selected</label>
  <label class="form-check-label"><input type="radio" name="multichoice_1" value="1"> A lot</label>
  <label class="form-check-label"><input type="radio" name="multichoice_1" value="2"> Not much</label></div>
</div>
<div id="fgroup_id_group_multichoice_2" class="mb-3 row fitem feedback_itemlist feedback-item-multichoice feedback_hasvalue multichoice-c multichoice-vertical">
  <div class="col-md-3 col-form-label"><p>What did you use</p></div>
  <div class="felement"><label><input type="hidden" name="multichoice_2[1]" value="0"><input type="checkbox" name="multichoice_2[1]" value="1"> Videos</label>
  <label><input type="hidden" name="multichoice_2[2]" value="0"><input type="checkbox" name="multichoice_2[2]" value="2"> Forums</label></div>
</div>
<div id="fitem_id_pagebreak_4" class="mb-3 row fitem feedback_itemlist feedback-item-pagebreak"><div class="col-form-label"><span>Page break</span></div></div>
<div id="fgroup_id_group_multichoicerated_5" class="mb-3 row fitem feedback_itemlist feedback-item-multichoicerated feedback_hasvalue multichoicerated-r">
  <div class="col-md-3 col-form-label"><p>Overall</p></div>
  <div class="felement"><label><input type="radio" name="multichoicerated_5" value="1"> <span class="weight">(1) </span>Bad</label>
  <label><input type="radio" name="multichoicerated_5" value="2"> <span class="weight">(3) </span>Good</label></div>
</div>
<div id="fitem_id_textfield_6" class="mb-3 row fitem feedback_itemlist feedback-item-textfield feedback_hasvalue">
  <div class="col-md-3 col-form-label"><label for="id_textfield_6">One word</label></div><div class="felement"><input type="text" name="textfield_6"></div>
</div>
<div id="fitem_id_numeric_8" class="mb-3 row fitem feedback_itemlist feedback-item-numeric feedback_hasvalue">
  <div class="col-md-3 col-form-label"><label for="id_numeric_8">Mark<span class="boundaries"> (0 - 10)</span></label></div><div class="felement"><input type="text" name="numeric_8"></div>
</div>
</div></form>`;

const named = (completed: number, userId: number, name: string) =>
  `<tr id="r${completed}"><td class="cell c0 userpic"></td><td class="cell c1 fullname"><a href="${SITE}user/view.php?id=${userId}&amp;course=2">${name}</a></td><td class="cell c2 groups"></td><td class="cell c3 completed_timemodified"><a href="${SITE}mod/feedback/show_entries.php?id=34&amp;userid=${userId}&amp;showcompleted=${completed}">Friday</a></td></tr>`;
const anonymous = (completed: number, number: number) =>
  `<tr><td class="cell c0 random_response"><a href="${SITE}mod/feedback/show_entries.php?id=34&amp;showcompleted=${completed}">Response number: ${number}</a></td></tr>`;
const FEEDBACK_ENTRIES = `<table id="showentrytable" class="flexible"><tbody>${named(11, 5, "Ana López")}${named(12, 6, "Luis Pérez")}<tr class="emptyrow"><td></td></tr></tbody></table>
<table id="showentryanontable" class="flexible"><tbody>${anonymous(13, 1)}<tr class="emptyrow"><td></td></tr></tbody></table>`;
// The downloads: the named rows in another order than the table's, every question as the last columns.
const BOM = String.fromCharCode(0xfeff);
const NAMED_CSV = `${BOM}"Full name",Groups,"Email address",Date,"Did you like it","What did you use","Overall","One word","Mark"
"Luis Pérez",,luis@example.com,"Friday, 9 October 2026","Not much",Forums,Bad,,7.5
"Ana López",,ana@example.com,"Friday, 9 October 2026","A lot","Videos
Forums",Good,"Clear, short",9
`;
const ANON_CSV = `${BOM}"Response number","Did you like it","What did you use","Overall","One word","Mark"
1,"A lot",,Good,"Two
lines",
`;

async function fakeFeedback({ canRead = true } = {}): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await context.route(`${SITE}mod/feedback/**`, (route: Route) => {
    const url = new URL(route.request().url());
    const html = (body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page(body, bodyId) });
    const csv = (body: string) => route.fulfill({ status: 200, contentType: "text/csv; charset=UTF-8", body });
    if (!canRead) return html(errorBox("Sorry, but you do not currently have permissions to do that (View reports)."), `page-mod-feedback-${url.pathname.endsWith("print.php") ? "print" : "show_entries"}`);
    if (url.pathname.endsWith("print.php")) return html(FEEDBACK_PRINT, "page-mod-feedback-print");
    if (url.searchParams.get("download") === "csv") return csv(NAMED_CSV);
    if (url.searchParams.get("adownload") === "csv") return csv(ANON_CSV);
    return html(FEEDBACK_ENTRIES, "page-mod-feedback-show_entries");
  });
  return context;
}

// A made-up questionnaire (cmid 33, instance 7): two responses, one named, one anonymous-looking (no title).
function questionnaireResponse(level: string, checked: string[], rank: number, essay: string, hours: string): string {
  const span = (label: string, on: boolean, kind: string) => `<span class="${on ? "selected" : "unselected"}"><input type="${kind}" disabled${on ? " checked" : ""}> ${label}</span><br>`;
  const rateRow = (row: string) =>
    `<tr><td style="text-align:left">${row}&nbsp; </td>${[1, 2, 3].map((r) => `<td class="${r === rank ? "selected" : "c0"}"><span class="${r === rank ? "selected" : "unselected"}"><input type="radio" disabled></span></td>`).join("")}</tr>`;
  return `<span class="respondentinfo">Respondent: <strong>Ana López</strong></span>
<fieldset id="qn-1" class="qn-container"><div class="qn-legend"><h2 class="qn-number">1</h2></div><div class="qn-content"><div class="qn-question"><div class="no-overflow">The level was</div></div>
<div class="qn-answer"><div class="questionnaire_response questionnaire_radio">${["Low", "Right", "High"].map((l) => span(l, l === level, "radio")).join("")}</div></div></div></fieldset>
<fieldset id="qn-2" class="qn-container"><div class="qn-legend"><h2 class="qn-number">2</h2></div><div class="qn-content"><div class="qn-question"><div class="no-overflow">What you used</div></div>
<div class="qn-answer"><div class="questionnaire_response questionnaire_check">${["Videos", "PDF"].map((l) => span(l, checked.includes(l), "checkbox")).join("")}</div></div></div></fieldset>
<fieldset id="qn-3" class="qn-container"><div class="qn-legend"><h2 class="qn-number">3</h2></div><div class="qn-content"><div class="qn-question"><div class="no-overflow">Your age</div></div>
<div class="qn-answer"><div class="questionnaire_response questionnaire_drop"><select disabled><option value="">Choose...</option><option value="1"${hours === "5" ? ' selected="selected"' : ""}>Under 30</option><option value="2"${hours === "5" ? "" : ' selected="selected"'}>30 or more</option></select></div></div></div></fieldset>
<fieldset id="qn-4" class="qn-container"><div class="qn-legend"><h2 class="qn-number">4</h2></div><div class="qn-content"><div class="qn-question"><div class="no-overflow">Rate 1 to 3</div></div>
<div class="qn-answer"><div class="questionnaire_response questionnaire_radio"><table class="individual"><tbody><tr><td></td><td class="c0 smalltext">1</td><td class="c1 smalltext">2</td><td class="c0 smalltext">3</td></tr>${rateRow("Contents")}</tbody></table></div></div></div></fieldset>
<fieldset id="qn-9" class="qn-container"><div class="qn-content"><div class="qn-question"><div class="no-overflow">A section's text</div></div></div></fieldset>
<fieldset id="qn-5" class="qn-container"><div class="qn-legend"><h2 class="qn-number">5</h2></div><div class="qn-content"><div class="qn-question"><label><div class="no-overflow">Suggestions</div></label></div>
<div class="qn-answer">${essay ? `<div class="response text">${essay}</div>` : ""}</div></div></fieldset>
<fieldset id="qn-6" class="qn-container"><div class="qn-legend"><h2 class="qn-number">6</h2></div><div class="qn-content"><div class="qn-question"><div class="no-overflow">Hours a week</div></div>
<div class="qn-answer"><div class="questionnaire_response questionnaire_numeric"><span class="selected">${hours}</span></div></div></div></fieldset>`;
}

async function fakeQuestionnaire({ installed = true, canRead = true } = {}): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await context.route(`${SITE}mod/questionnaire/**`, (route: Route) => {
    const url = new URL(route.request().url());
    if (!installed) return route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>404 Not Found</title><h1>404 Not Found</h1>" });
    const html = (body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page(body, bodyId) });
    if (url.pathname.endsWith("view.php")) {
      return html(canRead ? `<a href="${SITE}mod/questionnaire/report.php?instance=7&amp;group=0">View all responses</a>` : "<p>You have completed it.</p>", "page-mod-questionnaire-view");
    }
    assert.equal(url.searchParams.get("instance"), "7");
    if (url.searchParams.get("byresponse") === "1") {
      return html(
        `<div id="respondentscolumn0" class="respondentscolumn"><a title = "Friday, 9 October 2026, 2:38 PM" href="${SITE}mod/questionnaire/report.php?action=vresp&group=0&individualresponse=1&amp;rid=21&amp;individualresponse=1" >Ana López</a> <br>
<a title = "Friday, 9 October 2026, 2:41 PM" href="${SITE}mod/questionnaire/report.php?action=vresp&group=0&individualresponse=1&amp;rid=22&amp;individualresponse=1" >Luis Pérez</a> <br></div>`,
        "page-mod-questionnaire-report",
      );
    }
    const rid = url.searchParams.get("rid");
    return html(rid === "21" ? questionnaireResponse("Right", ["Videos", "PDF"], 3, "More examples", "5") : questionnaireResponse("Low", ["Videos"], 2, "", "2,5"), "page-mod-questionnaire-report");
  });
  return context;
}

describe("surveyResults", { skip: !browser && "no system browser" }, () => {
  it("reads a feedback's questions, its named and anonymous responses and every answer, with counts and averages", async () => {
    const context = await fakeFeedback();
    const results = await surveyResults(context, SITE, 34, { type: "feedback" });
    assert.deepEqual(results.responses, [
      { id: 12, anonymous: false, userId: 6, fullName: "Luis Pérez" },
      { id: 11, anonymous: false, userId: 5, fullName: "Ana López" },
      { id: 13, anonymous: true, number: 1 },
    ]);
    assert.deepEqual(
      results.questions.map((q) => [q.id, q.type, q.text]),
      [
        [1, "multichoice", "Did you like it"],
        [2, "multichoice", "What did you use"],
        [5, "multichoicerated", "Overall"],
        [6, "textfield", "One word"],
        [8, "numeric", "Mark"],
      ],
    );
    const [liked, used, overall, word, mark] = results.questions;
    assert.deepEqual(liked!.counts, [
      { option: "A lot", count: 2 },
      { option: "Not much", count: 1 },
    ]);
    // Several options in one answer come one per line in the download; a text's line breaks stay.
    assert.deepEqual(used!.answers, [
      { responseId: 12, values: ["Forums"] },
      { responseId: 11, values: ["Videos", "Forums"] },
    ]);
    assert.deepEqual(used!.counts, [
      { option: "Videos", count: 1 },
      { option: "Forums", count: 2 },
    ]);
    // Rated by the options' weights: (1 + 3 + 3) / 3.
    assert.equal(overall!.average, 2.33);
    assert.deepEqual(word!.answers, [
      { responseId: 11, values: ["Clear, short"] },
      { responseId: 13, values: ["Two\nlines"] },
    ]);
    assert.equal(word!.counts, undefined);
    assert.equal(mark!.average, 8.25);
    await context.close();
  });

  it("names the capability when Moodle refuses a feedback's reports", async () => {
    const context = await fakeFeedback({ canRead: false });
    await assert.rejects(surveyResults(context, SITE, 34, { type: "feedback" }), (e: Error) => e instanceof SurveyError && /mod\/feedback:viewreports/.test(e.message) && /Moodle says: Sorry/.test(e.message));
    await context.close();
  });

  it("reads a questionnaire's responses one by one: choices, check boxes, a dropdown, a rate question, an essay and a number", async () => {
    const context = await fakeQuestionnaire();
    const results = await surveyResults(context, SITE, 33, { type: "questionnaire" });
    assert.deepEqual(results.responses, [
      { id: 21, anonymous: false, fullName: "Ana López" },
      { id: 22, anonymous: false, fullName: "Luis Pérez" },
    ]);
    assert.deepEqual(
      results.questions.map((q) => [q.id, q.number, q.type, q.text]),
      [
        [1, "1", "radio", "The level was"],
        [2, "2", "check", "What you used"],
        [3, "3", "drop", "Your age"],
        [4, "4", "rate", "Rate 1 to 3"],
        [5, "5", "essay", "Suggestions"],
        [6, "6", "numeric", "Hours a week"],
      ],
    );
    const [level, used, age, rate, essay, hours] = results.questions;
    assert.deepEqual(level!.counts, [
      { option: "Low", count: 1 },
      { option: "Right", count: 1 },
      { option: "High", count: 0 },
    ]);
    assert.deepEqual(used!.answers, [
      { responseId: 21, values: ["Videos", "PDF"] },
      { responseId: 22, values: ["Videos"] },
    ]);
    assert.deepEqual(used!.counts, [
      { option: "Videos", count: 2 },
      { option: "PDF", count: 1 },
    ]);
    assert.deepEqual(age!.counts, [
      { option: "Under 30", count: 1 },
      { option: "30 or more", count: 1 },
    ]);
    assert.deepEqual(rate!.answers, [
      { responseId: 21, values: ["Contents: 3"] },
      { responseId: 22, values: ["Contents: 2"] },
    ]);
    assert.deepEqual(rate!.rows, [
      {
        row: "Contents",
        counts: [
          { option: "1", count: 0 },
          { option: "2", count: 1 },
          { option: "3", count: 1 },
        ],
        average: 2.5,
      },
    ]);
    // The second response left the essay blank.
    assert.deepEqual(essay!.answers, [{ responseId: 21, values: ["More examples"] }]);
    // "2,5" as a comma-decimal language writes it.
    assert.equal(hours!.average, 3.75);
    await context.close();
  });

  it("refuses a questionnaire whose responses the person can't read, and says when the plugin isn't installed", async () => {
    const refused = await fakeQuestionnaire({ canRead: false });
    await assert.rejects(surveyResults(refused, SITE, 33, { type: "questionnaire" }), (e: Error) => e instanceof SurveyError && /mod\/questionnaire:readallresponses/.test(e.message));
    await refused.close();
    const missing = await fakeQuestionnaire({ installed: false });
    await assert.rejects(surveyResults(missing, SITE, 33, { type: "questionnaire" }), (e: Error) => e instanceof SurveyError && /plugin \(mod_questionnaire\) isn't installed/.test(e.message));
    await missing.close();
  });

  it("tells a feedback apart on a site without the questionnaire plugin, and still reports a lost session", async () => {
    const context = await fakeFeedback();
    await context.route(`${SITE}mod/questionnaire/**`, (route) => route.fulfill({ status: 404, contentType: "text/html", body: "<h1>404 Not Found</h1>" }));
    await context.route(`${SITE}mod/feedback/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: page("", "page-mod-feedback-view") }));
    assert.equal((await surveyResults(context, SITE, 34)).type, "feedback");
    await context.close();
    const loggedOut = await browser!.newContext();
    await serveFakeMoodle(loggedOut, {});
    await assert.rejects(surveyResults(loggedOut, SITE, 35), NotLoggedInError);
    await loggedOut.close();
  });
});

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes and line breaks, without the byte order mark", () => {
    assert.deepEqual(parseCsv(BOM + 'a,"b, c","say ""hi"""\r\n1,"two\nlines",\n'), [
      ["a", "b, c", 'say "hi"'],
      ["1", "two\nlines", ""],
    ]);
  });
});
