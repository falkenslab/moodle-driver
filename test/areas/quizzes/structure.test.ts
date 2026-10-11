import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuizError, addQuestionsToQuiz, addQuizSection, editQuizSlot, quizStructure, removeQuizSlot, setQuizPages } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface FakeSlot {
  id: number;
  type: string;
  question?: number;
  name: string;
  page: number;
  mark: string;
}

/**
 * A quiz's edit page (cmid 41, instance 8) shaped like Moodle 5.2's, reduced and made up: sections,
 * pages and slots, which change as the page's posts, its edit_rest.php requests and the slots'
 * service would; an attempted quiz has empty add menus and Moodle's notice, and edit_rest refuses.
 */
function fakeQuizEditor({ attempted = false, slots: initial }: { attempted?: boolean; slots?: FakeSlot[] } = {}) {
  const slots: FakeSlot[] = initial ?? [{ id: 20, type: "truefalse", question: 21, name: "Range", page: 1, mark: "1.00" }];
  const sections: { id: number; heading: string; first: number; shuffle: boolean }[] = [{ id: 7, heading: "", first: 1, shuffle: false }];
  const posted: URLSearchParams[] = [];
  const rest: URLSearchParams[] = [];
  const services: { methodname: string; args: Record<string, unknown> }[] = [];
  const renumber = () => {
    // Moodle numbers pages from 1 without gaps.
    const order = [...new Set(slots.map((s) => s.page))];
    for (const s of slots) s.page = order.indexOf(s.page) + 1;
  };
  const slotHtml = (s: FakeSlot, n: number) =>
    `<li class="activity qtype_${s.type === "random" ? "" : s.type} slot" id="slot-${s.id}"><span class="slotnumber unshuffled"><span class="accesshide">Question</span> ${n}</span>
${s.question ? `<a href="${SITE}question/bank/editquestion/question.php?cmid=41&amp;id=${s.question}">` : "<a>"}<span class="instancename"><span class="questionname">${s.name}</span></span></a><span class="instancemaxmark">${s.mark}</span></li>`;
  const page = () => {
    let html = attempted ? `<div class="box statusdisplay"><p>You cannot add or remove questions because this quiz has attempts. (<a href="#">Attempts: 1</a>)</p></div>` : "";
    html += `<ul class="slots">`;
    let lastPage = 0;
    slots.forEach((s, i) => {
      const section = sections.find((x) => x.first === i + 1);
      if (section) {
        html += `<li id="section-${section.id}" class="section main"><span class="instancesection${section.heading ? "" : " visually-hidden"}">${section.heading || "Untitled section"}</span><input type="checkbox" id="shuffle-${section.id}"${section.shuffle ? " checked" : ""}><ul class="section">`;
      }
      if (s.page !== lastPage) html += `<li class="page" id="page-${s.page}"><span class="add-menu-outer">${attempted ? "" : "<span>Add</span>"}</span></li>`;
      lastPage = s.page;
      html += slotHtml(s, i + 1);
    });
    html += `</ul><script>M.mod_quiz.init_resource_toolbox({"courseid":"3","quizid":"8","ajaxurl":"\\/mod\\/quiz\\/edit_rest.php"});</script>`;
    return html;
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/quiz/edit.php**`, (route: Route) => {
      if (route.request().method() === "POST") {
        const form = new URLSearchParams(route.request().postData() ?? "");
        posted.push(form);
        if (attempted && (form.has("repaginate") || form.has("addsectionatpage"))) {
          return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-edit", body: `<div data-rel="fatalerror"><p class="errormessage">This quiz has been attempted.</p></div>` }) });
        }
        const last = slots.at(-1)?.page ?? 1;
        for (const [key] of form) if (/^q\d+$/.test(key)) slots.push({ id: 30 + slots.length, type: "multichoice", question: Number(key.slice(1)), name: `Question ${key.slice(1)}`, page: last, mark: "1.00" });
        for (let i = 0; i < Number(form.get("randomcount") ?? 0); i++) slots.push({ id: 40 + i, type: "random", name: "Random (Default)", page: last, mark: "1.00" });
        if (form.has("repaginate")) {
          const per = Number(form.get("questionsperpage"));
          slots.forEach((s, i) => (s.page = per ? Math.floor(i / per) + 1 : 1));
        }
        if (form.has("addsectionatpage")) {
          const first = slots.findIndex((s) => s.page === Number(form.get("addsectionatpage"))) + 1;
          sections.push({ id: 9, heading: "New heading", first, shuffle: false });
        }
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-edit", body: page() }) });
    });
    await context.route(`${SITE}mod/quiz/edit_rest.php`, (route: Route) => {
      const form = new URLSearchParams(route.request().postData() ?? "");
      rest.push(form);
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      if (attempted) return json({ error: "You cannot add or remove questions because this quiz has attempts.", errorcode: "cannoteditafterattempts" });
      const at = slots.findIndex((s) => s.id === Number(form.get("id")));
      if (form.get("class") === "section") {
        const section = sections.find((s) => s.id === Number(form.get("id")))!;
        if (form.get("field") === "updatesectiontitle") section.heading = form.get("newheading") ?? "";
        if (form.get("field") === "updateshufflequestions") section.shuffle = form.get("newshuffle") === "1";
      } else if (form.get("action") === "DELETE") {
        slots.splice(at, 1);
      } else if (form.get("field") === "move") {
        const [moving] = slots.splice(at, 1);
        const previous = slots.findIndex((s) => s.id === Number(form.get("previousid")));
        moving!.page = Number(form.get("page"));
        slots.splice(previous + 1, 0, moving!);
      } else if (form.get("field") === "updatepagebreak") {
        // The slot after the break: 2 splits there, 1 joins.
        const shift = form.get("value") === "2" ? 1 : -1;
        for (const s of slots.slice(at)) s.page += shift;
      }
      renumber();
      return json({ visible: true });
    });
  };
  const state = {
    services: {
      mod_quiz_update_slots: (args: Record<string, unknown>) => {
        services.push({ methodname: "mod_quiz_update_slots", args });
        for (const update of args.slots as { id: number; maxmark: number }[]) slots.find((s) => s.id === update.id)!.mark = update.maxmark.toFixed(2);
        return null;
      },
    },
  };
  return { routes, state, posted, rest, services };
}

async function open(fake: ReturnType<typeof fakeQuizEditor>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: fake.state.services });
  await fake.routes(context);
  return context;
}

const three = (): FakeSlot[] => [
  { id: 20, type: "truefalse", question: 21, name: "A", page: 1, mark: "1.00" },
  { id: 21, type: "truefalse", question: 22, name: "B", page: 2, mark: "1.00" },
  { id: 22, type: "truefalse", question: 23, name: "C", page: 3, mark: "1.00" },
];
const order = (result: { slots: { name: string; page: number }[] }) => result.slots.map((s) => `${s.name}@${s.page}`).join(" ");

describe("quiz structure", { skip: !browser && "no system browser" }, () => {
  it("reads the slots with their place, page, question, type and mark, and the sections", async () => {
    const context = await open(fakeQuizEditor());
    assert.deepEqual(await quizStructure(context, SITE, 41), {
      quiz: { id: 41 },
      slots: [{ id: 20, slot: 1, number: 1, page: 1, questionId: 21, type: "truefalse", name: "Range", mark: "1.00" }],
      sections: [{ id: 7, heading: "", firstSlot: 1, shuffle: false }],
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

  it("removes a slot, moves one first and changes its mark, as the edit page's requests and the slots' service do", async () => {
    const fake = fakeQuizEditor({ slots: three() });
    const context = await open(fake);
    const removed = await removeQuizSlot(context, SITE, 41, 2);
    assert.equal(removed.changed, 'Removed slot 2 ("B") from quiz 41.');
    assert.equal(order(removed), "A@1 C@2");
    assert.deepEqual([fake.rest[0]?.get("class"), fake.rest[0]?.get("action"), fake.rest[0]?.get("id"), fake.rest[0]?.get("quizid"), fake.rest[0]?.get("sesskey")], ["resource", "DELETE", "21", "8", "s1"]);
    const moved = await editQuizSlot(context, SITE, 41, 2, { moveAfter: 0, maxMark: 2 });
    assert.equal(moved.changed, 'In quiz 41: moved slot 2 first; set the maximum mark of question "C" to 2.');
    assert.deepEqual(moved.slots.map((s) => [s.slot, s.name, s.page, s.mark]), [[1, "C", 1, "2.00"], [2, "A", 1, "1.00"]]);
    assert.deepEqual([fake.rest[1]?.get("field"), fake.rest[1]?.get("id"), fake.rest[1]?.get("previousid"), fake.rest[1]?.get("page")], ["move", "22", "0", "1"]);
    assert.deepEqual(fake.services[0]?.args, { quizid: 8, slots: [{ id: 22, maxmark: 2 }] });
    await assert.rejects(editQuizSlot(context, SITE, 41, 5, { maxMark: 1 }), /Quiz 41 has no slot 5: it has 2/);
    await assert.rejects(editQuizSlot(context, SITE, 41, 1, {}), /Give what to change/);
    await context.close();
  });

  it("repaginates, and sets page breaks exactly after the slots given", async () => {
    const fake = fakeQuizEditor({ slots: three() });
    const context = await open(fake);
    assert.equal(order(await setQuizPages(context, SITE, 41, { perPage: 0 })), "A@1 B@1 C@1");
    assert.deepEqual([fake.posted[0]?.get("repaginate"), fake.posted[0]?.get("questionsperpage")], ["1", "0"]);
    const split = await setQuizPages(context, SITE, 41, { breaksAfter: [2] });
    assert.equal(split.changed, "Quiz 41's page breaks are now after slot 2.");
    assert.equal(order(split), "A@1 B@1 C@2");
    assert.deepEqual([fake.rest[0]?.get("field"), fake.rest[0]?.get("id"), fake.rest[0]?.get("value")], ["updatepagebreak", "22", "2"]);
    assert.equal(order(await setQuizPages(context, SITE, 41, { breaksAfter: [1] })), "A@1 B@2 C@2");
    await assert.rejects(setQuizPages(context, SITE, 41, { breaksAfter: [3] }), /from 1 to 2 in quiz 41; 3 isn't one/);
    await context.close();
  });

  it("adds a section at a page's first slot, with its heading and shuffled", async () => {
    const fake = fakeQuizEditor({ slots: three() });
    const context = await open(fake);
    const result = await addQuizSection(context, SITE, 41, { firstSlot: 2, heading: "Part B", shuffle: true });
    assert.equal(result.sectionId, 9);
    assert.deepEqual(result.sections, [
      { id: 7, heading: "", firstSlot: 1, shuffle: false },
      { id: 9, heading: "Part B", firstSlot: 2, shuffle: true },
    ]);
    assert.equal(fake.posted[0]?.get("addsectionatpage"), "2");
    await setQuizPages(context, SITE, 41, { perPage: 0 });
    await assert.rejects(addQuizSection(context, SITE, 41, { firstSlot: 3, heading: "Part C" }), /isn't the first of its page/);
    await context.close();
  });

  it("refuses to change an attempted quiz, with Moodle's notice, and nothing to add", async () => {
    const context = await open(fakeQuizEditor({ attempted: true }));
    await assert.rejects(addQuestionsToQuiz(context, SITE, 41, { questionIds: [22] }), (error: Error) => error instanceof QuizError && /because this quiz has attempts/.test(error.message));
    await assert.rejects(removeQuizSlot(context, SITE, 41, 1), /because this quiz has attempts/);
    await assert.rejects(setQuizPages(context, SITE, 41, { perPage: 1 }), /because this quiz has attempts/);
    await assert.rejects(addQuestionsToQuiz(context, SITE, 41, {}), /Give the questions to add/);
    await context.close();
  });
});
