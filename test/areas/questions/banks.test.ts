import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuestionBankError, createQuestion, deleteQuestions, exportQuestions, importQuestions, questionBanks, questionTypes, questions, setQuestionStatus, updateQuestion } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** The "Create a new question" chooser a bank page carries, shaped like Moodle 4.5's and 5.2's: one fieldset per group, the types that ask something first. */
function chooser(groups: { legend: string; types: [type: string, name: string, summary: string][] }[]): string {
  const option = ([type, name, summary]: [string, string, string]) => `<div class="option">
  <label for="item_qtype_${type}"><input type="radio" name="qtype" id="item_qtype_${type}" value="${type}">
    <span class="modicon"><img class="icon" alt="${name}" src="${SITE}theme/image.php/boost/qtype_${type}/1/icon"></span>
    <span class="typename">${name}</span></label>
  <div class="typesummary">
    <p>${summary}</p>
  </div></div>`;
  return `<div class="chooserdialoguebody"><div class="choosercontainer"><div id="chooseform"><form action="${SITE}question/bank/editquestion/question.php" id="chooserform" method="get">
<div class="options"><div class="instruction">Select a question type to see its description.</div><div class="alloptions">
${groups.map((g) => `<fieldset><legend class="moduletypetitle">${g.legend}</legend>${g.types.map(option).join("")}</fieldset>`).join("")}
</div></div></form></div></div></div>`;
}

/**
 * A made-up course 3 with a shared bank (cmid 36: categories 13 and 14, context 70) and a quiz's own
 * (cmid 27), shaped like Moodle 5.2's pages: the banks page, the bank page per category, the import
 * form with its upload repository, the multichoice edit form (new, or question 20 with three answers,
 * saved as a new version), and the delete page (asking, then confirming; question 20 is in use).
 */
function fakeBanks(
  bank = new Map<number, { id: number; name: string; type: string }[]>([
    [13, []],
    [14, [{ id: 20, name: "Loop", type: "multichoice" }]],
  ]),
) {
  // The categories whose questions were listed, in order.
  const listed: number[] = [];
  let nextId = 30;
  const uploads: string[] = [];
  const posted: URLSearchParams[] = [];
  const deleted = new Set<number>();
  const hidden = new Set<number>();
  // The export files fetched.
  const fetched: string[] = [];
  const page =(bodyId: string, body: string) => moodlePage({ userId: 3, bodyId, body });
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
          if (url.searchParams.has("cat")) listed.push(cat);
          const filter = `<div data-filterregion="filtertypedata"><select data-field-name="category"><option value="" disabled>Bank</option><option value="13">Top for Course bank</option><option value="14">&nbsp;&nbsp;&nbsp;Default for Course bank (${bank.get(14)!.length})</option></select></div>`;
          const table = `<table id="categoryquestions"><tbody>${(bank.get(cat) ?? []).map(row).join("")}</tbody></table>`;
          const types = chooser([
            { legend: "Questions", types: [["multichoice", "Multiple choice", "Allows the selection of a single or multiple responses."], ["coderunner", "CodeRunner", "Runs the student's code."]] },
            { legend: "Other", types: [["description", "Description", "This is not actually a question."]] },
          ]);
          return html(route, page("page-question-edit", `<div class="questionbankwindow" data-contextid="70">${filter}${table}</div>${types}`));
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
<input type="checkbox" name="catfromfile" value="1" checked><input type="checkbox" name="contextfromfile" value="1" checked>
<script>document.querySelector('[name="catfromfile"]').addEventListener("change", (e) => { document.querySelector('[name="contextfromfile"]').disabled = !e.target.checked; });</script>
<input type="submit" name="submitbutton" value="Import"></form>`,
            ),
          );
        }
        case "/question/bank/exportquestions/export.php": {
          if (route.request().method() === "POST") {
            const form = new URLSearchParams(route.request().postData() ?? "");
            posted.push(form);
            const [cat] = (form.get("category") ?? "").split(",");
            const file = `${SITE}pluginfile.php/70/question/export/${cat}/${form.get("format")}/withcategories/withcontexts/questions.txt?forcedownload=1`;
            // As Moodle's: the link, and the page sending itself to the file (a second later in Moodle, at once here).
            return html(route, page("page-question-bank-exportquestions-export", `<div id="region-main"><div class="box">Your file should download: <a href="${file}">${file}</a></div><script>setTimeout(() => location.replace(${JSON.stringify(file)}), 0)</script></div>`));
          }
          return html(
            route,
            page(
              "page-question-bank-exportquestions-export",
              `<form class="mform" method="post" action="${SITE}question/bank/exportquestions/export.php"><input type="hidden" name="cmid" value="${activityId}">
<input type="radio" name="format" value="gift"><input type="radio" name="format" value="xml">
<select name="category"><option value="13,70">Top</option><option value="14,70" selected>Default</option><option value="15,70">Empty</option></select>
<input type="checkbox" name="cattofile" value="1" checked><input type="checkbox" name="contexttofile" value="1" checked><input type="submit" name="submitbutton" value="Export questions"></form>`,
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
            // Editing saves a new version in the old one's place.
            const old = bank.get(14)!.findIndex((q) => q.id === Number(form.get("id")));
            if (old >= 0) bank.get(14)!.splice(old, 1);
            bank.get(14)!.push({ id, name: form.get("name")!, type: form.get("qtype")! });
            return go(route, `question/edit.php?cmid=36&lastchanged=${id}`);
          }
          const fractions = `<option value="0.0">None</option><option value="1.0">100%</option><option value="0.5">50%</option><option value="0.3333333">33.33333%</option><option value="-0.5">-50%</option>`;
          const editing = Number(url.searchParams.get("id"));
          if (editing && deleted.has(editing)) return html(route, page("page-question-bank-editquestion-question", `<div data-rel="fatalerror"><p class="errormessage">This question does not exist</p></div>`));
          const rows = editing ? ["while", "do", "for"] : ["", ""];
          const answers = rows.map((text, i) => `<textarea name="answer[${i}][text]">${text}</textarea><select name="fraction[${i}]">${fractions}</select><textarea name="feedback[${i}][text]"></textarea>`).join("");
          return html(
            route,
            page(
              "page-question-type-multichoice",
              `<form class="mform" method="post" action="${SITE}question/bank/editquestion/question.php"><input type="hidden" name="qtype" value="multichoice"><input type="hidden" name="noanswers" value="${rows.length}">${editing ? `<input type="hidden" name="id" value="${editing}">` : ""}
<select name="category"><option value="14,70">Default</option></select><input name="name" value="${editing ? "Loop" : ""}"><textarea name="questiontext[text]"></textarea>
<select name="single"><option value="0">Multiple</option><option value="1">One</option></select>${answers}<input type="submit" name="submitbutton" value="Save"></form>`,
            ),
          );
        }
        case "/question/bank/deletequestion/delete.php": {
          const form = new URLSearchParams(route.request().postData() ?? "");
          posted.push(form);
          const ids = (form.get("deleteselected") ?? "").split(",").map(Number);
          if (!form.get("confirm")) {
            return html(route, page("page-question-bank-deletequestion-delete", `<form method="post" action="${SITE}question/bank/deletequestion/delete.php"><input type="hidden" name="deleteselected" value="${ids.join(",")}"><input type="hidden" name="confirm" value="0123456789abcdef0123456789abcdef"><button type="submit">Delete</button></form>`));
          }
          for (const id of ids) (id === 20 ? hidden : deleted).add(id);
          return go(route, "question/edit.php?cmid=36");
        }
        default:
          if (url.pathname.startsWith("/pluginfile.php/70/question/export/")) {
            fetched.push(url.pathname);
            // An empty category answers with Moodle's error page.
            if (url.pathname.includes("/export/15/")) return html(route, page("page-site-index", `<div data-rel="fatalerror"><p class="errormessage">No questions were found that could be exported. Make sure that you have selected a category to export that contains questions.</p></div>`));
            return route.fulfill({ status: 200, contentType: "text/plain", body: "// question: 20  name: Loop\n::Loop::Which loop? {=while ~for}\n" });
          }
          return route.fallback();
      }
    });
  };
  return { routes, uploads, posted, deleted, hidden, listed, fetched };
}

async function open(fake: ReturnType<typeof fakeBanks>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  const statuses = (args: Record<string, unknown>) => (args.status === "ready" || args.status === "draft" ? { status: true, statusname: String(args.status) } : { status: false, statusname: "", error: "Unrecognised status" });
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, release: "5.2.4 (Build: 20261006)", services: { qbank_editquestion_set_status: statuses } });
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

  it("gives a page of the questions, reading only the categories it needs", async () => {
    const q = (id: number) => ({ id, name: `Q${id}`, type: "truefalse" });
    const fake = fakeBanks(new Map([[13, [41, 42].map(q)], [14, [43, 44, 45].map(q)]]));
    const context = await open(fake);
    const first = await questions(context, SITE, 36, { limit: 2 });
    assert.deepEqual([first.categories.length, first.questions.items.map((x) => x.id), first.questions.more, fake.listed], [2, [41, 42], true, [13, 14]]);
    const next = await questions(context, SITE, 36, { limit: 2, offset: 2 });
    assert.deepEqual([next.questions.items.map((x) => x.id), next.questions.more], [[43, 44], true]);
    const last = await questions(context, SITE, 36, { limit: 2, offset: 4 });
    assert.deepEqual([last.questions.items.map((x) => x.id), last.questions.more], [[45], false]);
    fake.listed.length = 0;
    await questions(context, SITE, 36, { limit: 1 });
    assert.deepEqual(fake.listed, [13], "the second category isn't read for a page the first one fills");
    assert.deepEqual((await questions(context, SITE, 36)).questions.map((x) => x.id), [41, 42, 43, 44, 45]);
    await context.close();
  });

  it("questionTypes: the chooser's types in its order, plugins marked, the other group apart", async () => {
    const context = await open(fakeBanks());
    assert.deepEqual(await questionTypes(context, SITE, 36), [
      { type: "multichoice", name: "Multiple choice", summary: "Allows the selection of a single or multiple responses.", plugin: false, group: "question" },
      { type: "coderunner", name: "CodeRunner", summary: "Runs the student's code.", plugin: true, group: "question" },
      { type: "description", name: "Description", summary: "This is not actually a question.", plugin: false, group: "other" },
    ]);
    await assert.rejects(questionTypes(context, SITE, 5), QuestionBankError);
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
    // Unticking "category from file" disables "context from file" (Moodle's disabledIf on the group): neither is sent.
    assert.deepEqual([form.get("format"), form.get("category"), form.getAll("catfromfile"), form.getAll("contextfromfile")], ["gift", "14,70", [], []]);
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

describe("exportQuestions", { skip: !browser && "no system browser" }, () => {
  it("exports the whole bank (its Top) or a category through the form, and writes the file", async () => {
    const fake = fakeBanks();
    const context = await open(fake);
    const dir = await mkdtemp(path.join(tmpdir(), "qbank-export-"));
    const file = path.join(dir, "out", "bank.gift.txt");
    const saved = await exportQuestions(context, SITE, 36, { format: "gift", file });
    assert.deepEqual(saved, { path: file, name: "bank.gift.txt", size: 62, contentType: "text/plain" });
    assert.match(await readFile(file, "utf8"), /::Loop::/);
    assert.deepEqual([fake.posted[0]?.get("format"), fake.posted[0]?.get("category")], ["gift", "13,70"]);
    await exportQuestions(context, SITE, 36, { format: "xml", categoryId: 14, file });
    assert.deepEqual(fake.fetched, ["/pluginfile.php/70/question/export/13/gift/withcategories/withcontexts/questions.txt", "/pluginfile.php/70/question/export/14/xml/withcategories/withcontexts/questions.txt"]);
    await assert.rejects(exportQuestions(context, SITE, 36, { format: "gift", categoryId: 15, file }), /Moodle didn't export category 15: No questions were found that could be exported. Make sure that you have selected a category to export that contains questions.$/);
    await assert.rejects(exportQuestions(context, SITE, 36, { format: "gift", categoryId: 99, file }), /The bank has no category 99/);
    await assert.rejects(exportQuestions(context, SITE, 36, { format: "gift", file: "relative.txt" }), /absolute path/);
    await assert.rejects(exportQuestions(context, SITE, 36, { format: "aiken" as "gift", file }), /"gift" or "xml"/);
    await rm(dir, { recursive: true, force: true });
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

describe("updateQuestion, deleteQuestions and setQuestionStatus", { skip: !browser && "no system browser" }, () => {
  it("changes only what's given, replaces the answers, and returns the new version's id", async () => {
    const fake = fakeBanks();
    const context = await open(fake);
    const result = await updateQuestion(context, SITE, 36, 20, { text: "<p>Which checks first?</p>", answers: [{ text: "while", fraction: 1 }, { text: "do", fraction: 0 }] });
    assert.deepEqual(result, { changed: "Saved question 20 as a new version, question 30, in bank 36.", questionId: 30 });
    const form = fake.posted[0]!;
    assert.deepEqual([form.get("name"), form.get("questiontext[text]"), form.get("answer[1][text]"), form.get("answer[2][text]"), form.get("fraction[0]"), form.get("single")], ["Loop", "<p>Which checks first?</p>", "do", "", "1.0", "1"]);
    assert.deepEqual((await questions(context, SITE, 36)).questions.map((q) => q.id), [30]);
    await assert.rejects(updateQuestion(context, SITE, 36, 20, {}), /Give what to change/);
    await context.close();
  });

  it("deletes questions, telling those Moodle hid because they're in use", async () => {
    const fake = fakeBanks();
    const context = await open(fake);
    const result = await deleteQuestions(context, SITE, 36, [20, 25]);
    assert.deepEqual(result, { changed: "In bank 36: deleted question 25; hid 20, in use.", deleted: [25], hidden: [20] });
    const [ask, confirm] = fake.posted;
    assert.deepEqual([ask?.get("deleteselected"), ask?.get("q25"), ask?.get("deleteall"), ask?.get("confirm"), ask?.get("sesskey")], ["20,25", "1", "1", null, "s1"]);
    assert.deepEqual([confirm?.get("deleteselected"), confirm?.get("confirm"), confirm?.get("cmid")], ["20,25", "0123456789abcdef0123456789abcdef", "36"]);
    await assert.rejects(deleteQuestions(context, SITE, 36, []), /Give the ids/);
    await context.close();
  });

  it("sets a question ready or draft through the bank's service", async () => {
    const context = await open(fakeBanks());
    assert.deepEqual(await setQuestionStatus(context, SITE, 20, "draft"), { changed: "Question 20 is now draft.", questionId: 20, status: "draft" });
    await assert.rejects(setQuestionStatus(context, SITE, 20, "hidden" as "ready"), /"ready" or "draft"/);
    await context.close();
  });
});

/**
 * A made-up Moodle 4.5 course 12 (context 248) with its own bank, shaped like 4.5's pages: no
 * mod/qbank, the bank page by courseid whose category filter lists the system's categories after
 * the course's (as for an admin, whose bank window shows the system context), and the delete page.
 * Course 13's bank page refuses (a student's).
 */
function fakeCourseBank() {
  const listed: string[] = [];
  const posted: URLSearchParams[] = [];
  const deleted = new Set<number>();
  const html = (route: Route, body: string, status = 200) => route.fulfill({ status, contentType: "text/html; charset=utf-8", body });
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}**`, async (route) => {
      const url = new URL(route.request().url());
      const page = (bodyId: string, body: string) => moodlePage({ userId: 3, bodyId, bodyClass: "format-topics course-12 context-248", heading: "Driver course", body });
      switch (url.pathname) {
        case "/mod/qbank/pix/monologo.svg":
          return html(route, "<!DOCTYPE html><title>Not found</title>", 404);
        case "/question/edit.php": {
          if (url.searchParams.get("courseid") !== "12") return html(route, moodlePage({ userId: 3, bodyId: "page-question-edit", body: `<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that.</p></div>` }));
          if (url.searchParams.has("cat")) listed.push(url.search);
          const cat = Number((url.searchParams.get("cat") ?? "6,1").split(",")[0]);
          const filter = `<div data-filterregion="filtertypedata"><select data-field-name="category"><option value="">Course: dc</option><option value="17">Top for Driver course</option><option value="18">&nbsp;&nbsp;&nbsp;Default for dc (1)</option><option value="">System</option><option value="5">Top for System</option><option value="6">CR_PROTOTYPES (19)</option></select></div>`;
          const rows = cat === 18 && !deleted.has(40) ? `<tr><td><input type="checkbox" name="q40"></td><td data-columnid="qbank_viewquestiontype\\question_type_column-question_type_column"><img src="${SITE}theme/image.php/classic/qtype_truefalse/1/icon"></td><td><span data-itemtype="questionname" data-value="Water"></span></td></tr>` : "";
          const types = chooser([
            { legend: "Preguntas", types: [["truefalse", "Verdadero/Falso", "Una pregunta de dos opciones."], ["gapfill", "Gapfill", "Fill in the gaps."]] },
            { legend: "Otro", types: [["description", "Descripción", "No es una pregunta."]] },
          ]);
          return html(route, page("page-question-edit", `<div class="questionbankwindow" data-contextid="1">${filter}<table id="categoryquestions"><tbody>${rows}</tbody></table></div>${types}`));
        }
        case "/question/bank/deletequestion/delete.php": {
          const form = new URLSearchParams(route.request().postData() ?? "");
          posted.push(form);
          if (!form.get("confirm")) return html(route, page("page-question-bank-deletequestion-delete", `<form><input type="hidden" name="confirm" value="0123456789abcdef0123456789abcdef"></form>`));
          deleted.add(40);
          return html(route, page("page-question-edit", ""));
        }
        case "/question/bank/editquestion/question.php":
          return html(route, page("page-question-bank-editquestion-question", `<div data-rel="fatalerror"><p class="errormessage">This question does not exist</p></div>`));
        default:
          return route.fallback();
      }
    });
  };
  return { routes, listed, posted };
}

describe("question banks on Moodle 4.x", { skip: !browser && "no system browser" }, () => {
  it("lists the course's own bank by the course's id, and reads only its own categories", async () => {
    const fake = fakeCourseBank();
    const context = await browser!.newContext();
    // A site that hides its release: its version unknown, the qbank icon's 404 tells 4.x.
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
    await fake.routes(context);
    assert.deepEqual(await questionBanks(context, SITE, 12), [{ id: 12, name: "Driver course", type: "course", shared: true }]);
    assert.deepEqual(await questions(context, SITE, 12), {
      categories: [
        { id: 17, name: "Top for Driver course" },
        { id: 18, name: "Default for dc" },
      ],
      questions: [{ id: 40, name: "Water", type: "truefalse", categoryId: 18 }],
    });
    // The course's pages, with the course's context (not the bank window's, the system's here).
    assert.deepEqual(fake.listed.map(decodeURIComponent), ["?courseid=12&cat=17,248&qperpage=1000", "?courseid=12&cat=18,248&qperpage=1000"]);
    await assert.rejects(questionBanks(context, SITE, 13), (error: Error) => error instanceof QuestionBankError && /You can't see course 13's question bank/.test(error.message));
    await assert.rejects(questions(context, SITE, 13), (error: Error) => error instanceof QuestionBankError && /Course 13 has no question bank you can see \(on Moodle 4.x a bank's id is its course's\)/.test(error.message));
    // The chooser of the course's bank, by the course's id, in the site's language: the groups by their order.
    assert.deepEqual(
      (await questionTypes(context, SITE, 12)).map((t) => [t.type, t.name, t.plugin, t.group]),
      [
        ["truefalse", "Verdadero/Falso", false, "question"],
        ["gapfill", "Gapfill", true, "question"],
        ["description", "Descripción", false, "other"],
      ],
    );
    await assert.rejects(questionTypes(context, SITE, 13), QuestionBankError);
    await context.close();
  });

  it("deletes through the course's delete page", async () => {
    const fake = fakeCourseBank();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, release: "4.5.15 (Build: 20261005)" });
    await fake.routes(context);
    assert.deepEqual(await deleteQuestions(context, SITE, 12, [40]), { changed: "In bank 12: deleted question 40.", deleted: [40], hidden: [] });
    const [ask, confirm] = fake.posted;
    assert.deepEqual([ask?.get("courseid"), ask?.get("cmid"), ask?.get("q40"), ask?.get("returnurl")], ["12", null, "1", "/question/edit.php?courseid=12"]);
    assert.deepEqual([confirm?.get("courseid"), confirm?.get("confirm")], ["12", "0123456789abcdef0123456789abcdef"]);
    await context.close();
  });
});
