import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { LessonError, answerLessonPage, lessonPage } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/**
 * A made-up lesson (cmid 39) shaped like Moodle 5.2's pages: a content page, a multichoice question
 * (2 right, 3 wrong), feedback after each answer, and the end. Moodle keeps where the person is.
 */
function fakeLesson() {
  let at: "content" | "question" | "end" = "content";
  let seenMore = false;
  const page = (main: string) => moodlePage({ userId: 5, bodyId: "page-mod-lesson-view", body: `<div id="region-main"><div role="main">${main}</div></div>` });
  const CONTENT = `<h2>Introduction</h2><div class="contents"><p>A loop repeats.</p></div>
<div class="branchbuttoncontainer"><form method="post" action="${SITE}mod/lesson/continue.php"><input type="hidden" name="pageid" value="1"><input type="hidden" name="jumpto" value="-1"><button type="submit">Go on</button></form>
<form method="post" action="${SITE}mod/lesson/continue.php"><input type="hidden" name="pageid" value="1"><input type="hidden" name="jumpto" value="-9"><button type="submit">Skip</button></form></div>`;
  const QUESTION = `<form class="mform" method="post" action="${SITE}mod/lesson/continue.php"><input type="hidden" name="pageid" value="2"><div class="contents"><p>Which loop walks a list?</p></div>
<label><input type="radio" name="answerid" value="2"> for</label><label><input type="radio" name="answerid" value="3"> while</label><input type="submit" name="submitbutton" value="Submit"></form>`;
  const feedback = (right: boolean) =>
    `<div class="generalbox">Which loop walks a list?</div><div class="response ${right ? "correct" : "incorrect"}"><em>Response</em>: <p>${right ? "Well done!" : "Not quite."}</p></div>
<form method="post" action="${SITE}mod/lesson/view.php"><input type="hidden" name="pageid" value="${right ? -9 : 2}"><button type="submit">Continue</button></form>`;
  const END = `<h2>End of lesson reached</h2><div class="generalbox">Your score is 1 (out of 1).</div><a href="${SITE}grade/index.php?id=3">View grades</a>`;
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/lesson/**`, (route: Route) => {
      const url = new URL(route.request().url());
      const html = (main: string) => route.fulfill({ status: 200, contentType: "text/html", body: page(main) });
      if (url.pathname === "/mod/lesson/continue.php") {
        const form = new URLSearchParams(route.request().postData() ?? "");
        if (form.get("jumpto")) {
          at = form.get("jumpto") === "-9" ? "end" : "question";
          seenMore = true;
          return html(at === "end" ? END : QUESTION);
        }
        const right = form.get("answerid") === "2";
        return html(feedback(right));
      }
      // view.php: a pageid from a "Continue" form moves on; the first visit asks to resume once there's more than one page seen.
      const form = new URLSearchParams(route.request().postData() ?? "");
      const pageid = form.get("pageid") ?? url.searchParams.get("pageid");
      if (pageid === "-9") at = "end";
      if (!pageid && !url.searchParams.has("startlastseen") && seenMore && at !== "end") {
        return html(`<div class="generalbox">Start at the last page you saw?</div><a href="${SITE}mod/lesson/view.php?id=39&amp;pageid=2&amp;startlastseen=yes">Yes</a>`);
      }
      return html(at === "content" ? CONTENT : at === "question" ? QUESTION : END);
    });
  };
  return { routes };
}

async function open(): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 5, fullName: "Ana Student" } });
  await fakeLesson().routes(context);
  return context;
}

describe("lessons", { skip: !browser && "no system browser" }, () => {
  it("goes through a content page, a wrong and a right answer, to the end", async () => {
    const context = await open();
    assert.deepEqual(await lessonPage(context, SITE, 39), {
      kind: "content",
      pageId: 1,
      title: "Introduction",
      text: "A loop repeats.",
      buttons: [
        { label: "Go on", jumpTo: -1 },
        { label: "Skip", jumpTo: -9 },
      ],
    });
    const question = await answerLessonPage(context, SITE, 39, { button: "Go on" }, { trail: "fast" });
    assert.deepEqual(question.page.fields, [{ name: "answerid", kind: "choice", options: [{ value: "2", label: "for" }, { value: "3", label: "while" }] }]);
    // Moodle asks to resume from the last page seen: the lesson goes on there.
    const wrong = await answerLessonPage(context, SITE, 39, { responses: { answerid: "3" } }, { trail: "fast" });
    assert.deepEqual(wrong.feedback?.feedback, { correct: false, response: "Not quite." });
    assert.equal(wrong.feedback?.pageId, 2);
    assert.equal(wrong.page.kind, "question");
    const right = await answerLessonPage(context, SITE, 39, { responses: { answerid: "2" } }, { trail: "fast" });
    assert.deepEqual([right.feedback?.feedback?.correct, right.feedback?.pageId], [true, -9]);
    assert.equal(right.page.kind, "end");
    assert.match(right.page.text, /Your score is 1 \(out of 1\)/);
    await assert.rejects(answerLessonPage(context, SITE, 39, { button: 0 }, { trail: "fast" }), /The lesson has ended/);
    await context.close();
  });

  it("asks for a button a content page has, and answers for a question", async () => {
    const context = await open();
    await assert.rejects(answerLessonPage(context, SITE, 39, { button: "Nope" }, { trail: "fast" }), (error: Error) => error instanceof LessonError && /0: "Go on", 1: "Skip"/.test(error.message));
    await answerLessonPage(context, SITE, 39, { button: 0 }, { trail: "fast" });
    await assert.rejects(answerLessonPage(context, SITE, 39, { button: 0 }, { trail: "fast" }), /This page is a question/);
    await context.close();
  });
});
