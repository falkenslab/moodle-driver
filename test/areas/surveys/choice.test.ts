import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { ChoiceError, answerChoice, choiceResults, getChoice } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A made-up choice (cmid 40) shaped like Moodle 5.2's page: three options, one full; answers can change. */
function fakeChoice({ open = true } = {}) {
  let chosen: string | undefined;
  const option = (id: number, label: string, full = false) =>
    `<li><input value="${id}" name="answer" type="radio" id="choice_${id}"${chosen === String(id) ? ' checked="1"' : ""}${full ? " disabled" : ""}><label for="choice_${id}">${label}</label></li>`;
  const view = () => {
    const selection = chosen ? `<div id="yourselection" class="generalbox">Your selection: ${{ "1": "for", "2": "while" }[chosen]}</div>` : "";
    const form = open
      ? `<form method="POST" action="${SITE}mod/choice/view.php"><ul>${option(1, "for")}${option(2, "while")}${option(3, "do-while", true)}</ul><input type="hidden" name="action" value="makechoice"><input type="submit" value="Save my choice">${chosen ? `<a href="view.php?id=40&amp;action=delchoice">Remove my choice</a>` : ""}</form>`
      : `<div class="generalbox">Sorry, this activity closed on 1 October.</div>`;
    return moodlePage({ userId: 4, bodyId: "page-mod-choice-view", body: `<div data-activityname="Favourite loop"></div><div id="region-main"><div class="activity-description" id="intro">Which loop?</div><div role="main">${selection}${form}</div></div>` });
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/choice/view.php**`, (route) => {
      if (route.request().method() === "POST") chosen = new URLSearchParams(route.request().postData() ?? "").get("answer") ?? chosen;
      return route.fulfill({ status: 200, contentType: "text/html", body: view() });
    });
  };
  return { routes };
}

async function open(fake: ReturnType<typeof fakeChoice>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 4, fullName: "Ana Student" } });
  await fake.routes(context);
  return context;
}

describe("choices", { skip: !browser && "no system browser" }, () => {
  it("reads the options by id and answers one, then reads the answer back", async () => {
    const context = await open(fakeChoice());
    const before = await getChoice(context, SITE, 40);
    assert.deepEqual(before.options, [
      { id: 1, text: "for", selected: false, full: false },
      { id: 2, text: "while", selected: false, full: false },
      { id: 3, text: "do-while", selected: false, full: true },
    ]);
    assert.deepEqual([before.name, before.intro, before.multiple, before.canAnswer, before.canChange, before.answer], ["Favourite loop", "Which loop?", false, true, false, []]);
    const { changed, choice: after } = await answerChoice(context, SITE, 40, [2]);
    assert.equal(changed, "Answered choice 40: while.");
    assert.deepEqual([after.answer, after.canChange], [["while"], true]);
    await context.close();
  });

  it("refuses unknown and full options, several in a single choice, and a closed choice with Moodle's message", async () => {
    const context = await open(fakeChoice());
    await assert.rejects(answerChoice(context, SITE, 40, [9]), /has no option 9; its options are: 1 "for", 2 "while", 3 "do-while"/);
    await assert.rejects(answerChoice(context, SITE, 40, [3]), /is full/);
    await assert.rejects(answerChoice(context, SITE, 40, [1, 2]), /takes one option only/);
    await context.close();
    const closed = await open(fakeChoice({ open: false }));
    await assert.rejects(answerChoice(closed, SITE, 40, [1]), (error: Error) => error instanceof ChoiceError && /Moodle says: Sorry, this activity closed on 1 October\./.test(error.message));
    await closed.close();
  });

  it("choiceResults: each option's count and who chose it, the unanswered column apart, as the responses report shows them", async () => {
    // Shaped like Moodle 5.2's report.php for a teacher who can delete responses: a column per option
    // (the unanswered one first, id 0), the counts in the first row, the people in the second.
    const toggle = (id: number) => `<div><div class="form-check p-0"><input id="select-response-option-${id}" type="checkbox"><label class="accesshide">Select all</label></div></div>`;
    const person = (userId: number, option: number, name: string, unanswered = false) =>
      `<div class="mb-1"><input id="attempt-user${userId}-option${option}" name="${unanswered ? "userid[]" : "attemptid[]"}" type="checkbox"><label class="accesshide">${name}</label><a href="${SITE}user/view.php?id=${userId}&amp;course=2"><span class="userinitials" title="${name}">XX</span>${name}</a></div>`;
    const report = `<h2>Responses</h2><form id="attemptsform"><table class="results names table">
<thead><tr><th class="header c0">Choice options</th><th class="data header c1"><div class="text-center">Not answered yet${toggle(0)}</div></th><th class="data header c2"><div class="text-center">for${toggle(1)}</div></th><th class="data header c3"><div class="text-center">while${toggle(2)}</div></th></tr></thead>
<tbody><tr><th>Number of responses</th><td class="data"><div class="text-center">1</div></td><td class="data"><div class="text-center">0<br>Limit: 3</div></td><td class="data"><div class="text-center">2</div></td></tr>
<tr class="lastrow"><th>Users who chose this option</th><td class="data">${person(7, 0, "Eva Ruiz", true)}</td><td class="data"></td><td class="data">${person(4, 2, "Ana Student")}${person(5, 2, "Luis Gil")}</td></tr></tbody></table></form>`;
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/mod/choice/report.php": `<div id="region-main"><div role="main">${report}</div></div>` } });
    const results = await choiceResults(context, SITE, 40);
    assert.deepEqual(results, {
      id: 40,
      options: [
        { id: 1, text: "for", count: 0, users: [] },
        {
          id: 2,
          text: "while",
          count: 2,
          users: [
            { userId: 4, fullName: "Ana Student" },
            { userId: 5, fullName: "Luis Gil" },
          ],
        },
      ],
      notAnswered: [{ userId: 7, fullName: "Eva Ruiz" }],
    });
    await context.close();
  });

  it("choiceResults: the options with nothing counted when nobody answered, and Moodle's refusal named", async () => {
    // With no answers Moodle shows no table: the options come from the choice's own page.
    const context = await open(fakeChoice());
    await context.route(`${SITE}mod/choice/report.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-choice-report", body: `<div id="region-main"><h2>Responses</h2><h3>No users yet</h3></div>` }) }));
    assert.deepEqual(
      (await choiceResults(context, SITE, 40)).options.map((o) => [o.id, o.text, o.count]),
      [
        [1, "for", 0],
        [2, "while", 0],
        [3, "do-while", 0],
      ],
    );
    await context.close();
    const refused = await browser!.newContext();
    await serveFakeMoodle(refused, { user: { id: 4, fullName: "Student" } });
    const error = `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">Sorry, but you do not currently have permissions to do that (View responses).</p></div>`;
    await refused.route(`${SITE}mod/choice/report.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-choice-report", body: error }) }));
    await assert.rejects(choiceResults(refused, SITE, 40), (e: Error) => e instanceof ChoiceError && /mod\/choice:readresponses/.test(e.message) && /View responses/.test(e.message));
    await refused.close();
  });

  it("refuses another module's id, whose error page keeps the choice's body id", async () => {
    // The sandbox showed it: choice/view.php sets its URL before finding the activity, so Moodle 5.2's error page is "page-mod-choice-view".
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const error = `<div class="box errorbox alert alert-danger" data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>`;
    await context.route(`${SITE}mod/choice/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-choice-view", body: error }) }));
    await assert.rejects(getChoice(context, SITE, 41), (e: Error) => e instanceof ChoiceError && /Invalid course module ID/.test(e.message));
    await assert.rejects(answerChoice(context, SITE, 41, [1]), ChoiceError);
    await context.close();
  });
});
