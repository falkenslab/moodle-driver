import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuestionBankError, createQuestion, importQuestions, questionBanks, questions } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/**
 * A made-up course 3 with a shared bank (cmid 36: categories 13 and 14, context 70) and a quiz's own
 * (cmid 27), shaped like Moodle 5.2's pages: the banks page, the bank page per category, the import
 * form with its upload repository, and the multichoice edit form.
 */
function fakeBanks() {
  const bank = new Map<number, { id: number; name: string; type: string }[]>([
    [13, []],
    [14, [{ id: 20, name: "Loop", type: "multichoice" }]],
  ]);
  let nextId = 30;
  const uploads: string[] = [];
  const posted: URLSearchParams[] = [];
  const page = (bodyId: string, body: string) => moodlePage({ userId: 3, bodyId, body });
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  const go = (route: Route, to: string) => html(route, `<script>location.replace("${SITE}${to}")</script>`);
  const row = (q: { id: number; name: string; type: string }) =>
    `<tr><td data-columnid="core_question\\local\\bank\\checkbox_column-checkbox_column"><input type="checkbox" name="q${q.id}"></td>
<td data-columnid="qbank_viewquestiontype\\question_type_column-question_type_column"><img alt="Type" src="${SITE}theme/image.php/boost/qtype_${q.type}/1/icon"></td>
<td><span data-itemtype="questionname" data-value="${q.name}"><a href="#">${q.name}</a></span></td>
<td><select name="question_status_dropdown"><option value="ready" selected>Ready</option></select></td>
<td data-columnid="qbank_history\\version_number_column-version_number_column">v1</td></tr>`;
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}**`, async (route) => {
      const url = new URL(route.request().url());
      const activityId = url.searchParams.get("cmid") ?? url.searchParams.get("update");
      switch (url.pathname) {
        case "/question/banks.php":
          return html(
            route,
            page(
              "page-question-banks",
              `<div class="shared-banks"><div class="question-banks-list"><ul><li><a href="${SITE}mod/qbank/view.php?id=36">Course bank</a></li></ul></div></div>
<div class="private-banks"><div class="question-banks-list"><ul><li><a href="${SITE}mod/quiz/view.php?id=27">Quiz one</a></li></ul></div></div>`,
            ),
          );
        case "/course/modedit.php":
          return html(route, page("page-mod-x-mod", `<form class="mform"><input type="hidden" name="modulename" value="${activityId === "5" ? "page" : activityId === "27" ? "quiz" : "qbank"}"></form>`));
        case "/question/edit.php": {
          const cat = Number((url.searchParams.get("cat") ?? "14,70").split(",")[0]);
          const filter = `<div data-filterregion="filtertypedata"><select data-field-name="category"><option value="" disabled>Bank</option><option value="13">Top for Course bank</option><option value="14">&nbsp;&nbsp;&nbsp;Default for Course bank (${bank.get(14)!.length})</option></select></div>`;
          const table = `<table id="categoryquestions"><tbody>${(bank.get(cat) ?? []).map(row).join("")}</tbody></table>`;
          return html(route, page("page-question-edit", `<div class="questionbankwindow" data-contextid="70">${filter}${table}</div>`));
        }
        case "/question/bank/importquestions/import.php": {
          if (route.request().method() === "POST") {
            const form = new URLSearchParams(route.request().postData() ?? "");
            posted.push(form);
            if (uploads.at(-1)?.includes("::")) {
              for (const name of uploads.at(-1)!.match(/::([^:]+)::/g) ?? []) bank.get(14)!.push({ id: nextId++, name: name.slice(2, -2), type: "truefalse" });
              return html(route, page("page-question-bank-importquestions-import", "<p>Imported.</p>"));
            }
            return html(route, page("page-question-bank-importquestions-import", `<div id="region-main"><div class="errorbox"><h2>Import error</h2><p>There are no questions in the import file</p><p class="errorcode"><a href="#">More information</a></p></div></div>`));
          }
          // The page's file picker settings name the upload repository, as Moodle's do.
          return html(
            route,
            page(
              "page-question-bank-importquestions-import",
              `<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>
<form class="mform" method="post" action="${SITE}question/bank/importquestions/import.php?cmid=${activityId}"><input type="hidden" name="newfile" value="777">
<input type="radio" name="format" value="gift"><input type="radio" name="format" value="xml">
<select name="category"><option value="14,70">Default</option><option value="13,70">Top</option></select>
<input type="hidden" name="catfromfile" value="0"><input type="checkbox" name="catfromfile" value="1" checked><input type="hidden" name="contextfromfile" value="0"><input type="checkbox" name="contextfromfile" value="1" checked>
<input type="submit" name="submitbutton" value="Import"></form>`,
            ),
          );
        }
        case "/repository/repository_ajax.php": {
          const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
          uploads.push(body);
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: 1 }) });
        }
        case "/question/bank/editquestion/question.php": {
          if (route.request().method() === "POST") {
            const form = new URLSearchParams(route.request().postData() ?? "");
            posted.push(form);
            const id = nextId++;
            bank.get(14)!.push({ id, name: form.get("name")!, type: form.get("qtype")! });
            return go(route, `question/edit.php?cmid=36&lastchanged=${id}`);
          }
          const fractions = `<option value="0.0">None</option><option value="1.0">100%</option><option value="0.5">50%</option><option value="0.3333333">33.33333%</option><option value="-0.5">-50%</option>`;
          const answers = [0, 1].map((i) => `<textarea name="answer[${i}][text]"></textarea><select name="fraction[${i}]">${fractions}</select><textarea name="feedback[${i}][text]"></textarea>`).join("");
          return html(
            route,
            page(
              "page-question-type-multichoice",
              `<form class="mform" method="post" action="${SITE}question/bank/editquestion/question.php"><input type="hidden" name="qtype" value="multichoice"><input type="hidden" name="noanswers" value="2">
<select name="category"><option value="14,70">Default</option></select><input name="name"><textarea name="questiontext[text]"></textarea>
<select name="single"><option value="0">Multiple</option><option value="1">One</option></select>${answers}<input type="submit" name="submitbutton" value="Save"></form>`,
            ),
          );
        }
        default:
          return route.fallback();
      }
    });
  };
  return { routes, uploads, posted };
}

async function open(fake: ReturnType<typeof fakeBanks>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await fake.routes(context);
  return context;
}

describe("questionBanks and questions", { skip: !browser && "no system browser" }, () => {
  it("lists the shared banks and the activities' own, and a bank's questions by category", async () => {
    const context = await open(fakeBanks());
    assert.deepEqual(await questionBanks(context, SITE, 3), [
      { id: 36, name: "Course bank", type: "qbank", shared: true },
      { id: 27, name: "Quiz one", type: "quiz", shared: false },
    ]);
    assert.deepEqual(await questions(context, SITE, 36), {
      categories: [
        { id: 13, name: "Top for Course bank" },
        { id: 14, name: "Default for Course bank" },
      ],
      questions: [{ id: 20, name: "Loop", type: "multichoice", status: "ready", version: "v1", categoryId: 14 }],
    });
    await context.close();
  });

  it("refuses an activity that keeps no questions, before opening its bank", async () => {
    const context = await open(fakeBanks());
    await assert.rejects(questions(context, SITE, 5), (error: Error) => error instanceof QuestionBankError && /is a page, which has no question bank/.test(error.message));
    await context.close();
  });
});

describe("importQuestions", { skip: !browser && "no system browser" }, () => {
  it("uploads GIFT text as a file into a chosen category and returns the questions created", async () => {
    const fake = fakeBanks();
    const context = await open(fake);
    const result = await importQuestions(context, SITE, 36, { format: "gift", text: "::Range:: range(3) ends at 2. {T}\n\n::Indent:: Python uses indentation. {T}", categoryId: 14 });
    assert.deepEqual(result.questions.map((q) => q.name), ["Range", "Indent"]);
    assert.match(fake.uploads[0]!, /filename="questions\.txt"/);
    const form = fake.posted[0]!;
    assert.deepEqual([form.get("format"), form.get("category"), form.getAll("catfromfile")], ["gift", "14,70", ["0"]]);
    await context.close();
  });

  it("passes Moodle's parse errors, and checks a file is there", async () => {
    const fake = fakeBanks();
    const context = await open(fake);
    await assert.rejects(importQuestions(context, SITE, 36, { format: "gift", text: "not gift at all" }), /Moodle didn't import the questions: There are no questions in the import file$/);
    const dir = await mkdtemp(path.join(tmpdir(), "qbank-test-"));
    await writeFile(path.join(dir, "q.xml"), "<quiz></quiz>");
    await assert.rejects(importQuestions(context, SITE, 36, { format: "xml", file: path.join(dir, "missing.xml") }), /There's no file at/);
    await assert.rejects(importQuestions(context, SITE, 36, { format: "xml" }), /as a file or as text/);
    await context.close();
  });
});

describe("createQuestion", { skip: !browser && "no system browser" }, () => {
  it("fills the type's form with the nearest fractions Moodle offers and returns the new id", async () => {
    const fake = fakeBanks();
    const context = await open(fake);
    const result = await createQuestion(context, SITE, 36, {
      type: "multichoice",
      name: "Infinite loop",
      text: "<p>Which never ends?</p>",
      answers: [
        { text: "while True", fraction: 1, feedback: "Right." },
        { text: "for i in range(3)", fraction: -0.4 },
      ],
    });
    assert.equal(result.questionId, 30);
    const form = fake.posted[0]!;
    assert.deepEqual([form.get("name"), form.get("single"), form.get("fraction[0]"), form.get("fraction[1]"), form.get("feedback[0][text]")], ["Infinite loop", "1", "1.0", "-0.5", "Right."]);
    await assert.rejects(createQuestion(context, SITE, 36, { type: "truefalse", name: "X", text: "X" }), /needs its right answer/);
    await context.close();
  });
});
