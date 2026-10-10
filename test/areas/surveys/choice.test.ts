import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { ChoiceError, answerChoice, getChoice } from "../../../src/index.js";
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
});
