import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuestionBankError, addQuestionCategory, deleteQuestionCategory, editQuestionCategory, moveQuestions, questionCategories } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface Cat {
  id: number;
  name: string;
  parent: number;
  info: string;
  count: number;
}

/**
 * A made-up shared bank (cmid 36, context 70, Top 13) shaped like Moodle 5.2's categories page: the
 * tree by data attributes, the delete link and the form asking where questions go, the edit form
 * served and taken by core_form_dynamic_form, and the bulk move service.
 */
function fakeCategories() {
  const cats: Cat[] = [
    { id: 14, name: "Default for Course bank", parent: 13, info: "<div class=\"text_to_html\">The default category</div>", count: 2 },
    { id: 15, name: "Loops & <b>", parent: 14, info: "", count: 0 },
  ];
  let nextId = 20;
  const forms: URLSearchParams[] = [];
  const moves: Record<string, unknown>[] = [];
  const deletes: string[] = [];
  const state = { denyMove: false };
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const item = (c: Cat): string => {
    const children = cats.filter((x) => x.parent === c.id);
    return `<li class="qbank_managecategories-item" id="category-${c.id}" data-categoryid="${c.id}" data-contextid="70" data-categoryname="${escape(c.name)}" data-parent="${c.parent}" data-sortorder="1">
<div class="qbank_managecategories-details"><strong><a href="${SITE}question/edit.php?cmid=36&amp;cat=${c.id}%2C70">${escape(c.name)} (${c.count})</a></strong>
<div class="qbank_managecategories-description">${c.info}</div></div>
<a href="#" data-action="addeditcategory" data-actiontype="edit" data-categoryid="${c.id}" data-questioncount="${c.count}">Edit settings</a>
<a href="${SITE}question/bank/managecategories/category.php?delete=${c.id}&amp;sesskey=s1&amp;cmid=36">Delete</a>
<div id="childlist${c.id}"><ul class="qbank_managecategories-categorylist" data-categoryid="${c.id}">${children.map(item).join("")}</ul></div></li>`;
  };
  const tree = () =>
    `<div id="categoryroot" data-contextid="70" data-cmid="36"><ul class="qbank_managecategories-categorylist" data-contextid="70" data-categoryid="13">${cats.filter((c) => c.parent === 13).map(item).join("")}</ul></div>`;
  const descendants = (id: number): number[] => cats.filter((c) => c.parent === id).flatMap((c) => [c.id, ...descendants(c.id)]);
  const editForm = (params: URLSearchParams, error?: string) => {
    const id = Number(params.get("categoryid") ?? params.get("id") ?? 0);
    const current = cats.find((c) => c.id === id);
    const onlyTop = current?.parent === 13 && cats.filter((c) => c.parent === 13).length === 1;
    const options = [13, ...cats.map((c) => c.id)].filter((c) => c !== id && !descendants(id).includes(c));
    const parent = current ? `${current.parent},70` : "13,70";
    const select = onlyTop ? "" : `<select name="parent">${options.map((o) => `<option value="${o},70"${`${o},70` === parent ? " selected" : ""}>${o}</option>`).join("")}</select>`;
    return `<form class="mform"><input type="hidden" name="contextid" value="70"><input type="hidden" name="cmid" value="36"><input type="hidden" name="id" value="${id}">
<input type="hidden" name="_qf__qbank_managecategories_form_question_category_edit_form" value="1">${select}
<input name="name" value="${escape(current?.name ?? "")}">${error ? `<div id="id_error_name_AbCdEfGhIjKlMnO">${error}</div>` : ""}<textarea name="info[text]">${escape(current?.info ?? "")}</textarea><input type="hidden" name="info[format]" value="1"></form>`;
  };
  const services = {
    core_form_dynamic_form: (args: Record<string, unknown>) => {
      const params = new URLSearchParams(String(args.formdata));
      if (!params.has("_qf__qbank_managecategories_form_question_category_edit_form")) return { html: editForm(params) };
      forms.push(params);
      const name = params.get("name") ?? "";
      if (!name.trim()) return { submitted: false, html: editForm(params, "The category name cannot be blank."), data: "" };
      const id = Number(params.get("id"));
      const parent = Number((params.get("parent") ?? "").split(",")[0]);
      let cat = cats.find((c) => c.id === id);
      if (!cat) cats.push((cat = { id: nextId++, name, parent: parent || 13, info: "", count: 0 }));
      cat.name = name;
      cat.info = params.get("info[text]") ?? "";
      if (parent) cat.parent = parent;
      return { submitted: true, html: "", data: JSON.stringify([{ name: "categories", action: "put", fields: { id: String(cat.id), name, parent: String(cat.parent) } }]) };
    },
    core_question_move_questions: (args: Record<string, unknown>) => {
      if (state.denyMove) throw new ServiceFailure("nopermissions");
      moves.push(args);
      return `${SITE}question/edit.php?cmid=36`;
    },
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}**`, async (route: Route) => {
      const url = new URL(route.request().url());
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      const page = (body: string) => html(moodlePage({ userId: 3, bodyId: "page-question-bank-managecategories-category", body }));
      switch (url.pathname) {
        case "/course/modedit.php":
          return html(moodlePage({ userId: 3, bodyId: "page-mod-x-mod", body: `<form class="mform"><input type="hidden" name="modulename" value="${url.searchParams.get("update") === "5" ? "page" : "qbank"}"></form>` }));
        case "/question/bank/managecategories/category.php": {
          if (url.searchParams.get("cmid") === "40") return page(`<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Manage question categories).</p></div>`);
          const form = new URLSearchParams(route.request().postData() ?? "");
          const target = Number(url.searchParams.get("delete") ?? form.get("delete"));
          if (target) {
            const cat = cats.find((c) => c.id === target)!;
            if (cat.count > 0 && !form.get("category")) {
              const options = cats.filter((c) => c.id !== target).map((c) => `<option value="${c.id},70">${c.name}</option>`).join("");
              return page(`<div class="generalbox">It has ${cat.count} questions.</div><form class="mform" method="post" action="${SITE}question/bank/managecategories/category.php"><input type="hidden" name="cmid" value="36"><input type="hidden" name="delete" value="${target}"><select name="category">${options}</select><input type="submit" name="submitbutton" value="Save"></form>`);
            }
            deletes.push(`${target}${form.get("category") ? `>${form.get("category")}` : ""}`);
            const moveTo = cats.find((c) => `${c.id},70` === form.get("category"));
            if (moveTo) moveTo.count += cat.count;
            for (const child of cats.filter((c) => c.parent === target)) child.parent = cat.parent;
            cats.splice(cats.indexOf(cat), 1);
          }
          return page(tree());
        }
        default:
          return route.fallback();
      }
    });
  };
  return { cats, forms, moves, deletes, state, services, routes };
}

async function open(fake: ReturnType<typeof fakeCategories>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: fake.services });
  await fake.routes(context);
  return context;
}

describe("questionCategories", { skip: !browser && "no system browser" }, () => {
  it("reads the tree by its data attributes: parents, descriptions, counts", async () => {
    const context = await open(fakeCategories());
    assert.deepEqual(await questionCategories(context, SITE, 36), [
      { id: 14, name: "Default for Course bank", parentId: 13, description: '<div class="text_to_html">The default category</div>', questionCount: 2 },
      { id: 15, name: "Loops & <b>", parentId: 14, description: "", questionCount: 0 },
    ]);
    await assert.rejects(questionCategories(context, SITE, 40), (error: Error) => error instanceof QuestionBankError && /moodle\/question:managecategory/.test(error.message));
    await assert.rejects(questionCategories(context, SITE, 5), /is a page, which has no question bank/);
    await context.close();
  });
});

describe("addQuestionCategory and editQuestionCategory", { skip: !browser && "no system browser" }, () => {
  it("adds through the dynamic form, at the top level or inside a category", async () => {
    const fake = fakeCategories();
    const context = await open(fake);
    const top = await addQuestionCategory(context, SITE, 36, { name: "Arrays", description: "<p>Lists</p>" });
    assert.deepEqual(top, { changed: 'Added category 20 "Arrays" to bank 36.', category: { id: 20, name: "Arrays", parentId: 13, description: "<p>Lists</p>", questionCount: 0 } });
    assert.equal(fake.forms[0]?.get("parent"), "13,70");
    const inside = await addQuestionCategory(context, SITE, 36, { name: "Nested", parentId: 15 });
    assert.equal(inside.category.parentId, 15);
    await assert.rejects(addQuestionCategory(context, SITE, 36, { name: "X", parentId: 99 }), /Bank 36 has no parent category 99/);
    await context.close();
  });

  it("changes only what's given, and refuses a parent the form doesn't offer", async () => {
    const fake = fakeCategories();
    const context = await open(fake);
    const renamed = await editQuestionCategory(context, SITE, 36, 15, { name: "While loops" });
    assert.deepEqual(renamed, { changed: "Category 15 of bank 36: renamed it.", category: { id: 15, name: "While loops", parentId: 14, description: "", questionCount: 0 } });
    assert.equal(fake.forms[0]?.get("parent"), "14,70", "the parent stays as the form loaded it");
    const moved = await editQuestionCategory(context, SITE, 36, 15, { parentId: 13 });
    assert.equal(moved.category.parentId, 13);
    assert.equal(moved.changed, "Category 15 of bank 36: moved it to the top level.");
    // Into its own subcategory: the form leaves those out.
    fake.cats.push({ id: 16, name: "Nested", parent: 14, info: "", count: 0 });
    await assert.rejects(editQuestionCategory(context, SITE, 36, 14, { parentId: 16 }), /it's the category itself or one of its subcategories/);
    await assert.rejects(editQuestionCategory(context, SITE, 36, 14, {}), /Give what to change/);
    await assert.rejects(editQuestionCategory(context, SITE, 36, 15, { name: " " }), /can't be blank/);
    await context.close();
  });

  it("refuses to move the bank's only top-level category, and passes Moodle's form errors", async () => {
    const fake = fakeCategories();
    const context = await open(fake);
    await assert.rejects(editQuestionCategory(context, SITE, 36, 14, { parentId: 15 }), /only top-level category/);
    fake.cats.push({ id: 16, name: "", parent: 13, info: "", count: 0 });
    await assert.rejects(editQuestionCategory(context, SITE, 36, 16, { description: "x" }), /Moodle refused the category: name: The category name cannot be blank\./);
    await context.close();
  });
});

describe("deleteQuestionCategory and moveQuestions", { skip: !browser && "no system browser" }, () => {
  it("deletes through the page's link, asking moveTo for a category with questions", async () => {
    const fake = fakeCategories();
    fake.cats.push({ id: 16, name: "Old", parent: 13, info: "", count: 3 }, { id: 17, name: "Child", parent: 16, info: "", count: 0 });
    const context = await open(fake);
    await assert.rejects(deleteQuestionCategory(context, SITE, 36, 16), /has 3 questions: give moveTo/);
    assert.deepEqual(fake.deletes, [], "nothing deleted without moveTo");
    const result = await deleteQuestionCategory(context, SITE, 36, 16, { moveTo: 15 });
    assert.equal(result.changed, 'Deleted category 16 "Old" from bank 36, its questions moved to category 15.');
    assert.deepEqual(fake.deletes, ["16>15,70"]);
    const tree = await questionCategories(context, SITE, 36);
    assert.deepEqual(tree.map((c) => [c.id, c.parentId, c.questionCount]), [[14, 13, 2], [15, 14, 3], [17, 13, 0]]);
    await deleteQuestionCategory(context, SITE, 36, 17);
    await assert.rejects(deleteQuestionCategory(context, SITE, 36, 14, { moveTo: 15 }), /only top-level category: Moodle keeps it/);
    await assert.rejects(deleteQuestionCategory(context, SITE, 36, 15, { moveTo: 15 }), /can't move to itself/);
    await context.close();
  });

  it("moves several questions with the bulk move service, naming the capabilities when refused", async () => {
    const fake = fakeCategories();
    const context = await open(fake);
    assert.deepEqual(await moveQuestions(context, SITE, 36, [7, 8], 15), { changed: "Moved questions 7, 8 into category 15 of bank 36.", questionIds: [7, 8], categoryId: 15 });
    assert.deepEqual(fake.moves, [{ newcontextid: 70, newcategoryid: 15, questionids: "7,8", returnurl: "/question/edit.php?cmid=36" }]);
    await assert.rejects(moveQuestions(context, SITE, 36, [7], 99), /Bank 36 has no category 99/);
    await assert.rejects(moveQuestions(context, SITE, 36, [], 15), /Give the ids/);
    fake.state.denyMove = true;
    await assert.rejects(moveQuestions(context, SITE, 36, [7], 15), (error: Error) => error instanceof QuestionBankError && /moodle\/question:moveall/.test(error.message));
    await context.close();
  });
});

describe("categories on Moodle 4.x", { skip: !browser && "no system browser" }, () => {
  it("works the course's bank by its id: the form with the course, the move page confirmed with the list's MD5", async () => {
    const moves: URLSearchParams[] = [];
    const calls: { methodname: string; args: Record<string, unknown> }[] = [];
    const tree = `<div id="categoryroot" data-contextid="248"><ul class="qbank_managecategories-categorylist" data-contextid="248" data-categoryid="17">
<li class="qbank_managecategories-item" id="category-18" data-categoryid="18" data-contextid="248" data-categoryname="Default for dc" data-parent="17"><div class="qbank_managecategories-details"></div></li>
<li class="qbank_managecategories-item" id="category-19" data-categoryid="19" data-contextid="248" data-categoryname="Loops" data-parent="17"><div class="qbank_managecategories-details"></div></li></ul></div>`;
    const context = await browser!.newContext();
    const services = {
      core_form_dynamic_form: (args: Record<string, unknown>) =>
        new URLSearchParams(String(args.formdata)).has("_qf__qbank_managecategories_form_question_category_edit_form")
          ? { submitted: true, html: "", data: JSON.stringify([{ name: "categories", action: "put", fields: { id: "19" } }]) }
          : { html: `<form class="mform"><input type="hidden" name="_qf__qbank_managecategories_form_question_category_edit_form" value="1"><select name="parent"><option value="17,248">Top</option></select><input name="name"></form>` },
    };
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services, serviceCalls: calls });
    await context.route(`${SITE}**`, async (route) => {
      const url = new URL(route.request().url());
      const html = (body: string, status = 200) => route.fulfill({ status, contentType: "text/html", body });
      if (url.pathname === "/mod/qbank/pix/monologo.svg") return html("Not found", 404);
      if (url.pathname === "/question/bank/managecategories/category.php" && url.searchParams.get("courseid") === "12") return html(moodlePage({ userId: 3, body: tree }));
      if (url.pathname === "/question/bank/bulkmove/move.php") {
        moves.push(new URLSearchParams(route.request().postData() ?? ""));
        return html(moodlePage({ userId: 3, bodyId: "page-question-edit" }));
      }
      return route.fallback();
    });
    assert.deepEqual((await questionCategories(context, SITE, 12)).map((c) => c.id), [18, 19]);
    await addQuestionCategory(context, SITE, 12, { name: "Loops" });
    const rendered = new URLSearchParams(String(calls.find((c) => c.methodname === "core_form_dynamic_form")?.args.formdata));
    assert.deepEqual([rendered.get("cmid"), rendered.get("courseid"), rendered.get("contextid")], ["0", "12", "248"]);
    assert.deepEqual(await moveQuestions(context, SITE, 12, [7, 8], 19), { changed: "Moved questions 7, 8 into category 19 of bank 12.", questionIds: [7, 8], categoryId: 19 });
    const [move] = moves;
    assert.deepEqual(
      [move?.get("courseid"), move?.get("movequestionsselected"), move?.get("confirm"), move?.get("category"), move?.get("returnurl"), move?.get("sesskey")],
      ["12", "7,8", createHash("md5").update("7,8").digest("hex"), "19,248", "/question/edit.php?courseid=12&filter=%7B%7D", "s1"],
    );
    assert.equal(calls.filter((c) => c.methodname === "core_question_move_questions").length, 0);
    await context.close();
  });
});
