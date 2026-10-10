import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuizError, addQuestionsToQuiz, quizStructure } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/**
 * A quiz's edit page (cmid 41) shaped like Moodle 5.2's, reduced and made up: pages and slots, which
 * change as the page's "add" and "addrandom" posts would; an attempted quiz has empty add menus.
 */
function fakeQuizEditor({ attempted = false } = {}) {
  const slots: { id: number; type: string; question?: number; name: string }[] = [{ id: 20, type: "truefalse", question: 21, name: "Range" }];
  const posted: URLSearchParams[] = [];
  const slot = (s: (typeof slots)[number], n: number) =>
    `<li class="activity qtype_${s.type === "random" ? "" : s.type} slot" id="slot-${s.id}"><span class="slotnumber unshuffled"><span class="accesshide">Question</span> ${n}</span>
${s.question ? `<a href="${SITE}question/bank/editquestion/question.php?cmid=41&amp;id=${s.question}">` : "<a>"}<span class="instancename"><span class="questionname">${s.name}</span></span></a><span class="instancemaxmark">1.00</span></li>`;
  const page = () =>
    `<ul>${slots.map((s, i) => `<li class="page" id="page-${i + 1}"><span class="add-menu-outer">${attempted ? "" : "<span>Add</span>"}</span></li>${slot(s, i + 1)}`).join("")}</ul>`;
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/quiz/edit.php**`, (route: Route) => {
      if (route.request().method() === "POST") {
        const form = new URLSearchParams(route.request().postData() ?? "");
        posted.push(form);
        for (const [key] of form) if (/^q\d+$/.test(key)) slots.push({ id: 30 + slots.length, type: "multichoice", question: Number(key.slice(1)), name: `Question ${key.slice(1)}` });
        for (let i = 0; i < Number(form.get("randomcount") ?? 0); i++) slots.push({ id: 40 + i, type: "random", name: "Random (Default)" });
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-edit", body: page() }) });
    });
  };
  return { routes, posted };
}

async function open(fake: ReturnType<typeof fakeQuizEditor>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await fake.routes(context);
  return context;
}

describe("quiz structure", { skip: !browser && "no system browser" }, () => {
  it("reads the slots with their page, question, type and mark", async () => {
    const context = await open(fakeQuizEditor());
    assert.deepEqual(await quizStructure(context, SITE, 41), {
      quiz: { id: 41 },
      slots: [{ id: 20, number: 1, page: 1, questionId: 21, type: "truefalse", name: "Range", mark: "1.00" }],
    });
    await context.close();
  });

  it("adds bank questions and random ones as the edit page posts them, and gives the new structure", async () => {
    const fake = fakeQuizEditor();
    const context = await open(fake);
    const result = await addQuestionsToQuiz(context, SITE, 41, { questionIds: [22, 23], random: { categoryId: 14, count: 1 } });
    assert.equal(result.changed, "Added 3 questions to quiz 41.");
    assert.deepEqual(result.slots.map((s) => [s.type, s.questionId]), [["truefalse", 21], ["multichoice", 22], ["multichoice", 23], ["random", undefined]]);
    assert.deepEqual([fake.posted[0]?.get("add"), fake.posted[0]?.get("q22"), fake.posted[0]?.get("addonpage"), fake.posted[0]?.get("sesskey")], ["1", "1", "0", "s1"]);
    assert.deepEqual([fake.posted[1]?.get("addrandom"), fake.posted[1]?.get("categoryid"), fake.posted[1]?.get("randomcount")], ["1", "14", "1"]);
    await context.close();
  });

  it("refuses an attempted quiz, and nothing to add", async () => {
    const context = await open(fakeQuizEditor({ attempted: true }));
    await assert.rejects(addQuestionsToQuiz(context, SITE, 41, { questionIds: [22] }), (error: Error) => error instanceof QuizError && /has attempts already/.test(error.message));
    await assert.rejects(addQuestionsToQuiz(context, SITE, 41, {}), /Give the questions to add/);
    await context.close();
  });
});
