import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuestionBankError, createQuestion, updateQuestion, type QuestionInput } from "../../../src/index.js";
import { checkQuestionInput } from "../../../src/areas/questions/types.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const dir = await mkdtemp(path.join(tmpdir(), "qtypes-test-"));
after(() => rm(dir, { recursive: true, force: true }));
const image = path.join(dir, "background.png");
await writeFile(image, "not really a png");

/**
 * A made-up shared bank (cmid 36, category 14 in context 70) whose edit forms are shaped like
 * Moodle 5.2's, per type: the rows its blanks buttons add, a drag and drop onto an image's file
 * pickers and its drop zones' menus left empty (the page's script fills them), the calculated
 * wizard's three pages (the question, its wildcards' datasets, their values, with Moodle's add and
 * delete buttons) and the calculated simple question's one page (find the wildcards, generate).
 * Plugin types aren't installed: their form is an error page. Question 50 is a match, 51 a
 * calculated question with two sets.
 */
function fakeForms() {
  const posted: URLSearchParams[] = [];
  const uploads: string[] = [];
  // The calculated wizard's sets of values: how many, and the values saved.
  let sets = 0;
  const saved = new Map<string, string>();
  // The wildcards' ranges, kept from one post to the next as Moodle keeps them.
  const ranges = new Map<string, string>();
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  const go = (route: Route, to: string) => html(route, `<script>location.replace("${SITE}${to}")</script>`);
  const page = (qtype: string, inner: string, hidden: Record<string, string> = {}) =>
    moodlePage({
      userId: 3,
      bodyId: `page-question-type-${qtype}`,
      body: `<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>
<form class="mform" method="post" action="${SITE}question/bank/editquestion/question.php?cmid=36${hidden.wizardnow ? `&wizardnow=${hidden.wizardnow}` : ""}">
<input type="hidden" name="qtype" value="${qtype}">${Object.entries(hidden).map(([n, v]) => `<input type="hidden" name="${n}" value="${v}">`).join("")}
<select name="category"><option value="14,70">Default</option></select><input name="name" value=""><textarea name="questiontext[text]"></textarea><input name="defaultmark" value="1">
${inner}<input type="submit" name="submitbutton" value="Save"></form>`,
    });
  const select = (name: string, values: (string | number)[], selected?: string) => `<select name="${name}">${values.map((v) => `<option value="${v}"${String(v) === selected ? " selected" : ""}>${v}</option>`).join("")}</select>`;
  const range = (n: number) => Array.from({ length: n }, (_, i) => i);
  const fractions = ["0.0", "1.0", "0.5", "-0.5"];
  const forms: Record<string, (rows: number, form?: URLSearchParams) => string> = {
    match: (rows) => range(rows).map((i) => `<textarea name="subquestions[${i}][text]"></textarea><input name="subanswers[${i}]">`).join("") + `<input type="submit" name="addanswers">`,
    ddwtos: (rows) => range(rows).map((i) => `<input name="choices[${i}][answer]">${select(`choices[${i}][choicegroup]`, [1, 2, 3])}<input type="hidden" name="choices[${i}][infinite]" value="0"><input type="checkbox" name="choices[${i}][infinite]" value="1">`).join("") + `<input type="submit" name="addanswers">`,
    ordering: (rows) => range(rows).map((i) => `<textarea name="answer[${i}][text]"></textarea>`).join("") + `${select("addanswerscount", range(10).map((i) => i + 1))}<input type="submit" name="addanswers">`,
    ddimageortext: (rows) =>
      `<input type="hidden" name="bgimage" value="500">` +
      range(rows).map((i) => `${select(`drags[${i}][dragitemtype]`, ["image", "word"])}${select(`drags[${i}][draggroup]`, [1, 2])}<input type="hidden" name="drags[${i}][infinite]" value="0"><input type="checkbox" name="drags[${i}][infinite]" value="1"><input type="hidden" name="dragitem[${i}]" value="60${i}"><input name="draglabel[${i}]">`).join("") +
      `<input type="submit" name="additems">` +
      range(2).map((i) => `<input name="drops[${i}][xleft]"><input name="drops[${i}][ytop]">${select(`drops[${i}][choice]`, [0])}<input name="drops[${i}][droplabel]">`).join(""),
    calculated: () => `<input name="answer[0]">${select("fraction[0]", fractions)}<input name="tolerance[0]" value="0.01">`,
    calculatedsimple: (_rows, form) => {
      // Found wildcards: x and y; after Generate, as many sets as asked, numbered as Moodle does.
      const found = form?.has("analyzequestion") || form?.has("addbutton") || form?.has("datasetdef[1]");
      const generated = form?.has("addbutton") ? Number(form.get("selectadd")) : 0;
      const keep = (name: string) => form?.get(name) ?? "";
      return (
        `<input name="answer[0]" value="${keep("answer[0]")}">${select("fraction[0]", fractions, keep("fraction[0]"))}<input type="submit" name="analyzequestion">` +
        (found
          ? `<input type="hidden" name="datasetdef[1]" value="1-0-x"><input type="hidden" name="datasetdef[2]" value="1-0-y"><input name="calcmin[1]" value="${keep("calcmin[1]") || "1.0"}"><input name="calcmax[1]"><input name="calcmin[2]"><input name="calcmax[2]">${select("selectadd", [1, 10, 20])}<input type="submit" name="addbutton">` +
            range(generated * 2)
              .map((i) => `<input type="hidden" name="definition[${i + 1}]" value="1-0-${i % 2 === 0 ? "y" : "x"}"><input type="hidden" name="itemid[${i + 1}]" value="0"><input type="hidden" name="number[${i + 1}]" value="9">`)
              .join("")
          : "")
      );
    },
  };
  const rowsAtStart: Record<string, [string, number]> = { match: ["noanswers", 3], ddwtos: ["noanswers", 6], ordering: ["countanswers", 3], ddimageortext: ["noitems", 2], calculated: ["noanswers", 1], calculatedsimple: ["noanswers", 1] };
  // The wizard's values page: the sets (wildcard b then a in each, as Moodle lists them), then the "item to add".
  const datasetItems = () => {
    const items = range(sets * 2).map((i) => {
      const k = i + 1;
      const wildcard = k % 2 === 1 ? "b" : "a";
      return `<input type="hidden" name="definition[${k}]" value="1-0-${wildcard}"><input type="hidden" name="itemid[${k}]" value="${100 + k}"><input name="number[${k}]" value="${saved.get(String(k)) ?? 5}">`;
    });
    const toAdd = ["a", "b"].map((w, j) => `<input type="hidden" name="definition[${sets * 2 + j + 1}]" value="1-0-${w}"><input type="hidden" name="itemid[${sets * 2 + j + 1}]" value="0"><input name="number[${sets * 2 + j + 1}]" value="3"><input name="calcmin[${j + 1}]" value="${ranges.get(`calcmin[${j + 1}]`) ?? "1.0"}"><input name="calcmax[${j + 1}]" value="${ranges.get(`calcmax[${j + 1}]`) ?? "10.0"}">${select(`calclength[${j + 1}]`, range(11))}`);
    return moodlePage({
      userId: 3,
      bodyId: "page-question-type-calculated",
      body: `<form class="mform" method="post" action="${SITE}question/bank/editquestion/question.php?id=51&cmid=36&wizardnow=datasetitems"><input type="hidden" name="qtype" value="calculated"><input type="hidden" name="wizard" value="datasetitems">
${items.join("")}${toAdd.join("")}<input type="submit" name="addbutton">${select("selectadd", [1, 10, 20])}${sets > 0 ? `<input type="submit" name="deletebutton">${select("selectdelete", [1, 10, 20])}` : ""}<input type="submit" name="savechanges"></form>`,
    });
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}**`, async (route) => {
      const url = new URL(route.request().url());
      const post = route.request().method() === "POST" ? new URLSearchParams(route.request().postData() ?? "") : undefined;
      switch (url.pathname) {
        case "/course/modedit.php":
          return html(route, moodlePage({ userId: 3, bodyId: "page-mod-qbank-mod", body: `<form class="mform"><input type="hidden" name="modulename" value="qbank"></form>` }));
        case "/question/edit.php":
          return html(route, moodlePage({ userId: 3, bodyId: "page-question-edit", body: `<div class="questionbankwindow" data-contextid="70"><div data-filterregion="filtertypedata"><select data-field-name="category"><option value="13">Top</option><option value="14">Default</option></select></div><table id="categoryquestions"><tbody></tbody></table></div>` }));
        case "/repository/repository_ajax.php":
          uploads.push(route.request().postDataBuffer()?.toString("utf8") ?? "");
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/5/user/draft/500/background.png` }) });
        case "/repository/draftfiles_ajax.php":
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ list: [] }) });
        case "/question/bank/editquestion/question.php": {
          const wizard = url.searchParams.get("wizardnow");
          if (wizard === "datasetdefinitions") {
            if (post) {
              posted.push(post);
              return go(route, "question/bank/editquestion/question.php?id=51&cmid=36&wizardnow=datasetitems");
            }
            return html(route, moodlePage({ userId: 3, bodyId: "page-question-type-calculated", body: `<form class="mform" method="post" action="${SITE}question/bank/editquestion/question.php?id=51&cmid=36&wizardnow=datasetdefinitions">${select("dataset[0]", ["1-0-a", "1-14-a"])}<input type="submit" name="submitbutton"></form>` }));
          }
          if (wizard === "datasetitems") {
            if (post) {
              posted.push(post);
              for (const [name, value] of post) if (/^calc(min|max)\[/.test(name)) ranges.set(name, value);
              if (post.has("addbutton")) sets += Number(post.get("selectadd"));
              else if (post.has("deletebutton")) sets -= Number(post.get("selectdelete"));
              else if (post.has("savechanges")) {
                for (const [name, value] of post) if (/^number\[\d+\]$/.test(name)) saved.set(name.slice(7, -1), value);
                return go(route, "question/edit.php?cmid=36&lastchanged=51");
              }
              return go(route, "question/bank/editquestion/question.php?id=51&cmid=36&wizardnow=datasetitems");
            }
            return html(route, datasetItems());
          }
          const editing = Number(url.searchParams.get("id") ?? post?.get("id"));
          const qtype = post?.get("qtype") ?? url.searchParams.get("qtype") ?? (editing === 51 ? "calculated" : "match");
          const build = forms[qtype];
          if (!build) return html(route, moodlePage({ userId: 3, bodyId: "page-question-bank-editquestion-question", body: `<div data-rel="fatalerror"><p class="errormessage">Missing question type plugin</p></div>` }));
          const [countName, start] = rowsAtStart[qtype]!;
          let rows = Number(post?.get(countName) ?? (editing === 50 ? 4 : start));
          if (post) {
            posted.push(post);
            // A blanks button sends the form back with more rows.
            if (post.has("addanswers") || post.has("additems")) rows += qtype === "ordering" ? Number(post.get("addanswerscount")) : 3;
            else if (!post.has("analyzequestion") && !post.has("addbutton")) {
              return qtype === "calculated" ? go(route, "question/bank/editquestion/question.php?id=51&cmid=36&wizardnow=datasetdefinitions") : go(route, `question/edit.php?cmid=36&lastchanged=${editing ? editing + 10 : 40}`);
            }
          }
          return html(route, page(qtype, build(rows, post), { [countName]: String(rows), ...(editing ? { id: String(editing) } : {}) }));
        }
        default:
          return route.fallback();
      }
    });
  };
  return { routes, posted, uploads, saved, sets: () => sets };
}

async function open(fake: ReturnType<typeof fakeForms>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, release: "5.2.4 (Build: 20261006)" });
  await fake.routes(context);
  return context;
}

describe("createQuestion of every type", { skip: !browser && "no system browser" }, () => {
  it("fills a matching question's pairs, adding blanks for more", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    const pairs = [1, 2, 3, 4].map((n) => ({ question: `${n} + ${n}`, answer: String(2 * n) }));
    const result = await createQuestion(context, SITE, 36, { type: "match", name: "Sums", text: "<p>Match.</p>", pairs });
    assert.equal(result.questionId, 40);
    const form = fake.posted.at(-1)!;
    assert.deepEqual([form.get("noanswers"), form.get("subquestions[3][text]"), form.get("subanswers[3]"), form.get("subanswers[0]")], ["6", "4 + 4", "8", "2"]);
    await context.close();
  });

  it("fills choices with their groups, and an ordering's items (asking for as many blanks as needed)", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    await createQuestion(context, SITE, 36, { type: "ddwtos", name: "Cat", text: "<p>The [[1]] on the [[2]].</p>", choices: [{ text: "cat" }, { text: "mat", group: 2, unlimited: true }] });
    let form = fake.posted.at(-1)!;
    assert.deepEqual([form.get("choices[0][answer]"), form.get("choices[1][choicegroup]"), form.getAll("choices[1][infinite]"), form.getAll("choices[0][infinite]")], ["cat", "2", ["0", "1"], ["0"]]);
    await createQuestion(context, SITE, 36, { type: "ordering", name: "Order", text: "<p>Order.</p>", items: ["a", "b", "c", "d", "e"] });
    form = fake.posted.at(-1)!;
    assert.deepEqual([form.get("countanswers"), form.get("answer[4][text]")], ["5", "e"]);
    assert.equal(fake.posted.at(-2)?.get("addanswerscount"), "2", "two more rows asked for, as the form's menu does");
    await context.close();
  });

  it("uploads a drag and drop's background and gives its drop zones' empty menus the items", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    await createQuestion(context, SITE, 36, {
      type: "ddimageortext",
      name: "Map",
      text: "<p>Place them.</p>",
      image,
      drags: [{ text: "North" }, { text: "South", group: 2 }],
      drops: [{ choice: 2, left: 10, top: 200, label: "bottom" }, { choice: 1, left: 10, top: 10 }],
    });
    assert.match(fake.uploads[0]!, /name="itemid"\r\n\r\n500\r\n/);
    const form = fake.posted.at(-1)!;
    assert.deepEqual(
      [form.get("drags[1][dragitemtype]"), form.get("draglabel[1]"), form.get("drags[1][draggroup]"), form.get("drops[0][choice]"), form.get("drops[0][ytop]"), form.get("drops[0][droplabel]"), form.get("drops[1][choice]")],
      ["word", "South", "2", "2", "200", "bottom", "1"],
    );
    await context.close();
  });

  it("goes through the calculated wizard: ranges, sets added, the values given written over Moodle's", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    const result = await createQuestion(context, SITE, 36, {
      type: "calculated",
      name: "Product",
      text: "<p>{a} times {b}?</p>",
      answers: [{ text: "{a} * {b}", fraction: 1, tolerance: 0.1 }],
      wildcards: [{ name: "a", values: [2, 4], min: 1 }, { name: "b", values: [1.5, 2.5], max: 3 }],
    });
    assert.equal(result.questionId, 51);
    assert.equal(fake.sets(), 2);
    // Set 1 is items 1 (b) and 2 (a); set 2, items 3 and 4.
    assert.deepEqual([...fake.saved].filter(([k]) => Number(k) <= 4).sort(), [["1", "1.5"], ["2", "2"], ["3", "2.5"], ["4", "4"]]);
    const last = fake.posted.at(-1)!;
    assert.deepEqual([last.get("calcmin[1]"), last.get("calcmax[2]")], ["1", "3"], "the ranges by the item to add's wildcards, a then b");
    await context.close();
  });

  it("updates a calculated question's sets: deleted down to the values given", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    await createQuestion(context, SITE, 36, { type: "calculated", name: "P", text: "<p>{a}{b}</p>", answers: [{ text: "{a} * {b}", fraction: 1 }], sets: 3 });
    assert.equal(fake.sets(), 3);
    await updateQuestion(context, SITE, 36, 51, { wildcards: [{ name: "a", values: [7] }, { name: "b", values: [8] }] });
    assert.equal(fake.sets(), 1);
    assert.deepEqual([fake.saved.get("1"), fake.saved.get("2")], ["8", "7"]);
    await assert.rejects(updateQuestion(context, SITE, 36, 51, { wildcards: [{ name: "c", min: 1 }] }), /wildcards are a, b: it has no \{c\}/);
    await context.close();
  });

  it("finds a calculated simple question's wildcards and generates as many sets as values given", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    await createQuestion(context, SITE, 36, { type: "calculatedsimple", name: "Sum", text: "<p>{x} + {y}</p>", answers: [{ text: "{x} + {y}", fraction: 1 }], wildcards: [{ name: "x", values: [1, 2, 3], min: 0 }, { name: "y", values: [4, 5, 6] }] });
    const [analyze, generate, save] = fake.posted.slice(-3);
    assert.ok(analyze?.has("analyzequestion") && generate?.has("addbutton") && save?.has("submitbutton"));
    assert.deepEqual([analyze?.get("answer[0]"), generate?.get("selectadd"), generate?.get("calcmin[1]")], ["{x} + {y}", "3", "0"]);
    // Items 1, 3, 5 are y; 2, 4, 6 are x.
    assert.deepEqual([1, 2, 5, 6].map((k) => save?.get(`number[${k}]`)), ["4", "1", "6", "3"]);
    await context.close();
  });

  it("names the plugin a type needs when the site doesn't have it", async () => {
    const context = await open(fakeForms());
    await assert.rejects(
      createQuestion(context, SITE, 36, { type: "coderunner", name: "Hi", text: "<p>Print hi.</p>", coderunner: { type: "python3", testCases: [{ code: "", expected: "hi" }] } }),
      (error: unknown) => error instanceof QuestionBankError && error.message === "This site has no CodeRunner question type (the qtype_coderunner plugin): its administrator would have to install it.",
    );
    await context.close();
  });

  it("replaces a question's pairs when updating, blanking the form's other rows", async () => {
    const fake = fakeForms();
    const context = await open(fake);
    const result = await updateQuestion(context, SITE, 36, 50, { pairs: [{ question: "a", answer: "1" }, { question: "b", answer: "2" }] });
    assert.equal(result.questionId, 60);
    const form = fake.posted.at(-1)!;
    assert.deepEqual([form.get("subanswers[1]"), form.get("subquestions[3][text]"), form.get("subanswers[3]")], ["2", "", ""]);
    await context.close();
  });
});

describe("checkQuestionInput", () => {
  const check = (input: Omit<Partial<QuestionInput>, "type"> & { type: string }, creating = true) => checkQuestionInput(input.type, input as Partial<QuestionInput>, { creating });
  it("asks for each type's required inputs, and refuses another type's", async () => {
    await assert.rejects(check({ type: "match", name: "x", text: "x", pairs: [] }), /A match question needs pairs\./);
    await assert.rejects(check({ type: "ddimageortext", name: "x", text: "x", image }), /needs drags, drops/);
    await assert.rejects(check({ type: "ordering", name: "x", text: "x", items: ["one"] }), /two items at least/);
    await assert.rejects(check({ type: "essay", name: "x", text: "x", choices: [{ text: "a" }] }), /An essay question doesn't take choices\.$/);
    await assert.rejects(check({ type: "ddwtos", pairs: [{ question: "a", answer: "b" }] }, false), /doesn't take pairs: it takes choices/);
    await assert.rejects(check({ type: "qtypefromaplugin", choices: [] }, false), /isn't changed with choices; give its form's fields/);
    await check({ type: "multianswer", name: "x", text: "{1:SHORTANSWER:=a}" });
  });

  it("checks drop zones against the items, wildcards' values against each other, and files", async () => {
    await assert.rejects(check({ type: "ddmarker", name: "x", text: "x", image, markers: [{ text: "A" }], drops: [{ choice: 2, shape: "circle", coords: "1,1;1" }] }), /one of the 1 markers, from 1: 2 isn't/);
    await assert.rejects(check({ type: "ddmarker", name: "x", text: "x", image, markers: [{ text: "A" }], drops: [{ choice: 1 }] }), /needs its shape and coords/);
    await assert.rejects(check({ type: "calculated", name: "x", text: "x", answers: [{ text: "{a}", fraction: 1 }], wildcards: [{ name: "a", values: [1, 2] }, { name: "b", values: [1] }] }), /as many values/);
    await assert.rejects(check({ type: "calculated", name: "x", text: "x", answers: [{ text: "{a}", fraction: 1 }], sets: 101 }), /1 to 100 sets/);
    await assert.rejects(check({ type: "ddimageortext", name: "x", text: "x", image: path.join(dir, "missing.png"), drags: [{ text: "a" }], drops: [{ choice: 1, left: 0, top: 0 }] }), /There's no file at/);
  });
});
