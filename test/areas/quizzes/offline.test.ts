import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import {
  QuizError,
  addQuestionsToOfflineQuiz,
  createOfflineQuizForms,
  offlineQuizGroups,
} from "../../../src/index.js";
import {
  SITE,
  launchTestBrowser,
  moodlePage,
  serveFakeMoodle,
} from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/**
 * An offline quiz (cmid 51, context 900) shaped like the plugin's v5.2.0 pages on Moodle 5.2, reduced
 * and made up: each group's edit page (its group menu, slots, total of marks, maximum grade, add
 * menus, and once the forms exist the status box linking to them), its bank post, and the forms page,
 * which creates the forms the first time unless a group is empty.
 */
function fakeOfflineQuiz({
  groups = [[] as number[], [] as number[]],
  formsCreated = false,
} = {}) {
  const state = {
    formsCreated,
    posts: [] as { group: string | null; form: URLSearchParams }[],
  };
  const name = (id: number) => `Question ${id}`;
  const editPage = (group: number) => {
    const ids = groups[group - 1]!;
    const slots = ids
      .map(
        (id, i) =>
          `<li class="activity multichoice qtype_multichoice slot" id="slot-${100 * group + i}"><span class="slotnumber"><span class="accesshide hidden">Question</span> ${i + 1}</span>` +
          `<a href="${SITE}question/bank/editquestion/question.php?returnurl=%2Fmod%2Fofflinequiz%2Fedit.php&amp;cmid=51&amp;id=${id}"><span class="instancename"><span class="questionname">${name(id)}</span></span></a><span class="instancemaxmark decimalplaces_2">1.00</span></li>`,
      )
      .join("");
    const menu = `<span class="add-menu-outer">${state.formsCreated ? "" : '<a class="add-menu" href="#">Add</a>'}</span>`;
    return `<form><select name="groupnumber">${groups.map((_, i) => `<option value="${i + 1}"${i + 1 === group ? " selected" : ""}>Group ${String.fromCharCode(65 + i)}</option>`).join("")}</select></form>
<input type="text" id="inputmaxgrade" name="maxgrade" value="10.00"><span class="mod_offlinequiz_summarks col-4">${ids.length.toFixed(2)}</span>
<div class="warnings">${state.formsCreated ? `<div class="statusdisplay box"><p>Forms already created (<a href="${SITE}mod/offlinequiz/createquiz.php?q=4&amp;mode=createpdfs">Download forms</a>)</p></div>` : '<div class="emptystatusdisplay box"></div>'}</div>
<ul class="slots"><li id="section-1" class="section main"><ul class="section">${ids.length > 0 ? `<li class="pagenumber activity page" id="page-1">${menu}</li>` : ""}${slots}</ul></li></ul><div class="last-add-menu">${menu}</div>`;
  };
  const link = (kind: string, group: number) =>
    `<a href="${SITE}pluginfile.php/900/mod_offlinequiz/pdfs/0/${kind}_form_${String.fromCharCode(64 + group)}_20261112.pdf?forcedownload=1">${kind} form for group ${String.fromCharCode(64 + group)}</a><br />`;
  const formsPage = () => {
    const empty = groups.flatMap((ids, i) =>
      ids.length === 0 ? [String.fromCharCode(65 + i)] : [],
    );
    if (empty.length > 0 && !state.formsCreated) {
      return `<div id="region-main">${empty.map((g) => `<div class="alert alert-info">No questions for group ${g}</div>`).join("")}<div class="alert alert-danger">No forms created</div></div>`;
    }
    state.formsCreated = true;
    const box = (kind: string) =>
      `<div class="box py-3 generalbox linkbox docsbox">${groups.map((_, i) => link(kind, i + 1)).join("")}</div>`;
    return `<div id="region-main">${box("question")}${box("answer")}${box("correction")}</div>`;
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/offlinequiz/**`, (route: Route) => {
      const url = new URL(route.request().url());
      const page = (bodyId: string, body: string) =>
        route.fulfill({
          status: 200,
          contentType: "text/html",
          body: moodlePage({ userId: 3, bodyId, body }),
        });
      if (url.pathname === "/mod/offlinequiz/createquiz.php")
        return page("page-mod-offlinequiz-createquiz", formsPage());
      if (url.searchParams.get("cmid") !== "51")
        return page(
          "page-mod-offlinequiz-edit",
          `<div data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>`,
        );
      const group = Number(url.searchParams.get("groupnumber") ?? 1);
      if (!groups[group - 1])
        return page(
          "page-mod-offlinequiz-edit",
          `<div data-rel="fatalerror"><p class="errormessage">Invalid group number</p></div>`,
        );
      if (route.request().method() === "POST") {
        const form = new URLSearchParams(route.request().postData() ?? "");
        state.posts.push({ group: url.searchParams.get("groupnumber"), form });
        if (state.formsCreated)
          return page(
            "page-mod-offlinequiz-edit",
            `<div data-rel="fatalerror"><p class="errormessage">You cannot add or remove questions because there are already complete results.</p></div>`,
          );
        for (const [key] of form)
          if (
            /^q\d+$/.test(key) &&
            !groups[group - 1]!.includes(Number(key.slice(1)))
          )
            groups[group - 1]!.push(Number(key.slice(1)));
      }
      return page("page-mod-offlinequiz-edit", editPage(group));
    });
  };
  return { routes, state, groups };
}

async function open(
  fake: ReturnType<typeof fakeOfflineQuiz>,
): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await fake.routes(context);
  return context;
}

describe("offline quizzes", { skip: !browser && "no system browser" }, () => {
  it("reads every group's questions, its marks and grade, and whether it can change", async () => {
    const context = await open(fakeOfflineQuiz({ groups: [[7, 8], [9]] }));
    const groups = await offlineQuizGroups(context, SITE, 51);
    assert.deepEqual(groups, {
      offlineQuiz: { id: 51 },
      maxGrade: "10.00",
      formsCreated: false,
      editable: true,
      groups: [
        {
          number: 1,
          letter: "A",
          totalMarks: "2.00",
          slots: [
            {
              id: 100,
              slot: 1,
              number: 1,
              page: 1,
              questionId: 7,
              type: "multichoice",
              name: "Question 7",
              mark: "1.00",
            },
            {
              id: 101,
              slot: 2,
              number: 2,
              page: 1,
              questionId: 8,
              type: "multichoice",
              name: "Question 8",
              mark: "1.00",
            },
          ],
        },
        {
          number: 2,
          letter: "B",
          totalMarks: "1.00",
          slots: [
            {
              id: 200,
              slot: 1,
              number: 1,
              page: 1,
              questionId: 9,
              type: "multichoice",
              name: "Question 9",
              mark: "1.00",
            },
          ],
        },
      ],
    });
    await context.close();
  });

  it("adds bank questions to a group as the bank action posts them, and gives the group afterwards", async () => {
    const fake = fakeOfflineQuiz();
    const context = await open(fake);
    const result = await addQuestionsToOfflineQuiz(context, SITE, 51, {
      group: 2,
      questionIds: [7, 8],
      page: 1,
    });
    assert.equal(
      result.changed,
      "Added 2 questions to group B of offline quiz 51.",
    );
    assert.deepEqual(
      result.group.slots.map((s) => s.questionId),
      [7, 8],
    );
    assert.equal(result.group.letter, "B");
    const [post] = fake.state.posts;
    assert.equal(post!.group, "2");
    assert.deepEqual(Object.fromEntries(post!.form), {
      add: "1",
      addonpage: "1",
      q7: "1",
      q8: "1",
      sesskey: "s1",
    });
    assert.deepEqual(fake.groups[0], []);
    await context.close();
  });

  it("refuses a group the offline quiz hasn't, nothing to add, and questions already there", async () => {
    const fake = fakeOfflineQuiz({ groups: [[7], []] });
    const context = await open(fake);
    await assert.rejects(
      addQuestionsToOfflineQuiz(context, SITE, 51, {
        group: 3,
        questionIds: [8],
      }),
      /has groups A, B \(1 to 2\), not 3/,
    );
    await assert.rejects(
      addQuestionsToOfflineQuiz(context, SITE, 51, { questionIds: [] }),
      QuizError,
    );
    await assert.rejects(
      addQuestionsToOfflineQuiz(context, SITE, 51, { questionIds: [7] }),
      /added no question to group A/,
    );
    await assert.rejects(
      offlineQuizGroups(context, SITE, 52),
      /You can't edit offline quiz 52 \(Moodle says: Invalid course module ID\)/,
    );
    await context.close();
  });

  it("creates the forms of every group, and then refuses new questions with the plugin's notice", async () => {
    const fake = fakeOfflineQuiz({ groups: [[7], [8]] });
    const context = await open(fake);
    const created = await createOfflineQuizForms(context, SITE, 51);
    assert.equal(
      created.changed,
      "Created the forms of offline quiz 51, for groups A, B.",
    );
    assert.deepEqual(created.forms[1], {
      group: "B",
      questionForm: `${SITE}pluginfile.php/900/mod_offlinequiz/pdfs/0/question_form_B_20261112.pdf?forcedownload=1`,
      answerForm: `${SITE}pluginfile.php/900/mod_offlinequiz/pdfs/0/answer_form_B_20261112.pdf?forcedownload=1`,
      correctionForm: `${SITE}pluginfile.php/900/mod_offlinequiz/pdfs/0/correction_form_B_20261112.pdf?forcedownload=1`,
    });
    const groups = await offlineQuizGroups(context, SITE, 51);
    assert.deepEqual([groups.formsCreated, groups.editable], [true, false]);
    await assert.rejects(
      addQuestionsToOfflineQuiz(context, SITE, 51, { questionIds: [9] }),
      /can't change its questions now: Forms already created \(Download forms\)/,
    );
    assert.equal(fake.state.posts.length, 0);
    assert.equal(
      (await createOfflineQuizForms(context, SITE, 51)).changed,
      "Offline quiz 51 had its forms already.",
    );
    await context.close();
  });

  it("throws the plugin's notices when a group has no questions", async () => {
    const context = await open(fakeOfflineQuiz({ groups: [[7], []] }));
    await assert.rejects(
      createOfflineQuizForms(context, SITE, 51),
      /created no forms for offline quiz 51: No questions for group B No forms created/,
    );
    await context.close();
  });
});
