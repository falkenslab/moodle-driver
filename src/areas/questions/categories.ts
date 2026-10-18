// A question bank's categories as its categories page (qbank_managecategories) shows them: the tree
// read by its data attributes, categories added and edited through the page's own dynamic form,
// deleted through its delete link (and the form asking where their questions go), and questions
// moved between them through the bank's bulk "Move to" service.
import { createHash } from "node:crypto";
import type { BrowserContext, Page } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { bankRef, postBankPage, QuestionBankError, type BankRef } from "./banks.js";

/** A category of a bank, as `questionCategories` reads it from the bank's categories page. */
export interface QuestionCategory {
  id: number;
  name: string;
  /** The category it's in: the bank's hidden "Top" category for a top-level one (the first category `questions` lists). */
  parentId: number;
  /** Its description, as HTML ("" without one). */
  description: string;
  /** The questions directly in it, not in its subcategories. */
  questionCount: number;
}

/** The categories page read: the bank's context, its Top category, and its categories in tree order. */
interface CategoryTree {
  contextId: number;
  topId: number;
  categories: QuestionCategory[];
}

const MANAGE = "moodle/question:managecategory";

/** Reads the categories page open in `page`: every category of the bank's context, parents before children. */
export function readCategoryTree(page: Page): Promise<CategoryTree> {
  return page.evaluate(() => {
    interface El {
      textContent: string | null;
      innerHTML: string;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const contextId = Number(doc.querySelector("#categoryroot")?.getAttribute("data-contextid"));
    const topId = Number(doc.querySelector(`#categoryroot ul.qbank_managecategories-categorylist[data-contextid="${contextId}"]`)?.getAttribute("data-categoryid"));
    const categories = Array.from(doc.querySelectorAll(`li.qbank_managecategories-item[data-categoryid][data-contextid="${contextId}"]`)).map((item) => {
      const id = Number(item.getAttribute("data-categoryid"));
      // The item's own details come before its children's, so the first match is its own.
      const details = item.querySelector(".qbank_managecategories-details");
      // The edit action carries the count; the name's link shows it too, "Name (3)".
      const counted = item.querySelector(`[data-action="addeditcategory"][data-categoryid="${id}"]`)?.getAttribute("data-questioncount");
      const shown = /\((\d+)\)\s*$/.exec(details?.querySelector('a[href*="/question/edit.php"]')?.textContent ?? "")?.[1];
      return {
        id,
        name: item.getAttribute("data-categoryname") ?? "",
        parentId: Number(item.getAttribute("data-parent")),
        description: (details?.querySelector(".qbank_managecategories-description")?.innerHTML ?? "").trim(),
        questionCount: Number(counted ?? shown ?? 0),
      };
    });
    return { contextId, topId, categories };
  });
}

/** Opens a bank's categories page, checked: the module keeps questions, and the person can manage its categories. */
async function openCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ page: Page; bank: BankRef }> {
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openSitePage(context, siteUrl, `question/bank/managecategories/category.php?${bank.query}`);
  if ((await page.locator("#categoryroot[data-contextid]").count()) === 0) {
    const refused = await moodleErrorMessage(page);
    await page.close().catch(() => undefined);
    throw new QuestionBankError(`You can't manage bank ${activityId}'s categories: it takes Moodle's capability ${MANAGE}, which editing teachers have in their courses.${refused ? ` Moodle said: ${refused}` : ""}`);
  }
  return { page, bank };
}

/** The tree, and how the bank's pages and forms are addressed. */
type BankTree = CategoryTree & { bank: BankRef };

async function categoryTree(context: BrowserContext, siteUrl: string, activityId: number): Promise<BankTree> {
  const { page, bank } = await openCategories(context, siteUrl, activityId);
  try {
    return { ...(await readCategoryTree(page)), bank };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The categories form's bank fields: Moodle 5 takes the bank's cmid, 4.x the course's id. */
function formBank(bank: BankRef): { cmid: string; courseid: string } {
  return { cmid: bank.field.cmid ?? "0", courseid: bank.field.courseid ?? "0" };
}

/** The bank's category by id, or `QuestionBankError` naming the bank's own. */
function inBank(tree: CategoryTree, activityId: number, categoryId: number, what = "category"): QuestionCategory {
  const category = tree.categories.find((c) => c.id === categoryId);
  if (!category) throw new QuestionBankError(`Bank ${activityId} has no ${what} ${categoryId}: its categories are ${tree.categories.map((c) => `${c.id} (${c.name})`).join(", ")}.`);
  return category;
}

/**
 * A bank's categories as its categories page shows them, parents before their subcategories: each
 * one's id, name, parent, description and the questions directly in it. The bank's hidden "Top"
 * category isn't one of them: it's the `parentId` of the top-level ones. Reading the page takes the
 * capability to manage the bank's categories, which `questions` doesn't, so it's a function of its own.
 */
export async function questionCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuestionCategory[]> {
  return (await categoryTree(context, siteUrl, activityId)).categories;
}

const EDIT_FORM = "qbank_managecategories\\form\\question_category_edit_form";

/**
 * Fills the categories page's dynamic form (add or edit) as its modal does: rendered by
 * core_form_dynamic_form with the modal's arguments, filled in a blank tab, sent back serialized.
 * Returns the id of the category saved, from Moodle's state update.
 */
async function saveCategoryForm(
  context: BrowserContext,
  siteUrl: string,
  params: Record<string, string | number>,
  input: { name?: string; description?: string; parent?: string },
  activityId: number,
): Promise<number> {
  const formdata = new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();
  const rendered = await callService<{ html: string }>(context, siteUrl, "core_form_dynamic_form", { form: EDIT_FORM, formdata });
  const page = await context.newPage();
  try {
    await page.setContent(rendered.html);
    if (input.parent !== undefined) {
      const parents = await page.evaluate(() =>
        Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll('form.mform select[name="parent"] option')).map((o) => o.value),
      );
      // The bank's only top-level category has its parent frozen: Moodle keeps one there.
      if (parents.length === 0) throw new QuestionBankError(`Category ${params.categoryid} is bank ${activityId}'s only top-level category: Moodle doesn't move it. Add another one first.`);
      // The form leaves out the category itself and its subcategories.
      if (!parents.includes(input.parent)) throw new QuestionBankError(`Category ${input.parent.split(",")[0]} can't hold category ${params.categoryid}: it's the category itself or one of its subcategories.`);
    }
    const values: Record<string, FieldValue> = {};
    if (input.parent !== undefined) values.parent = input.parent;
    if (input.name !== undefined) values.name = input.name;
    if (input.description !== undefined) values["info[text]"] = input.description;
    await setFields(page, values);
    const serialized = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown };
        FormData: new (form: unknown) => Iterable<[string, string]>;
        URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
      };
      return new g.URLSearchParams(new g.FormData(g.document.querySelector("form.mform"))).toString();
    });
    const answer = await callService<{ submitted: boolean; html: string; data?: string }>(context, siteUrl, "core_form_dynamic_form", { form: EDIT_FORM, formdata: serialized });
    if (!answer.submitted) {
      // Back unsubmitted: the form again, with its errors (ids carry a random suffix).
      await page.setContent(answer.html);
      const errors = await page.evaluate(() =>
        Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document.querySelectorAll('[id^="id_error_"]'))
          .map((element) => ({ field: element.id.slice("id_error_".length).replace(/_[A-Za-z0-9]{15}$/, ""), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
          .filter((error) => error.message !== ""),
      );
      throw new QuestionBankError(`Moodle refused the category: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ") || "no reason given"}.`);
    }
    // A reactive state update: [{ name: "categories", action: "put", fields: { id, … } }].
    const updates = JSON.parse(answer.data ?? "[]") as { fields?: { id?: number | string } }[];
    const id = Number(updates[0]?.fields?.id);
    if (!id) throw new QuestionBankError("Moodle saved the category without saying which: read the bank's categories.");
    return id;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The category a write left, read again from the page. */
async function savedCategory(context: BrowserContext, siteUrl: string, activityId: number, categoryId: number): Promise<QuestionCategory> {
  return inBank(await categoryTree(context, siteUrl, activityId), activityId, categoryId);
}

/**
 * Adds a category to a bank, as the categories page's "Add category" does: at the top level, or
 * inside `parentId`, with an optional description (HTML). Returns the category made.
 */
export async function addQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { name, parentId, description }: { name: string; parentId?: number; description?: string },
): Promise<{ changed: string; category: QuestionCategory }> {
  if (!name?.trim()) throw new QuestionBankError("Give the new category a name.");
  const tree = await categoryTree(context, siteUrl, activityId);
  const parent = parentId ?? tree.topId;
  if (parent !== tree.topId) inBank(tree, activityId, parent, "parent category");
  const id = await saveCategoryForm(context, siteUrl, { ...formBank(tree.bank), contextid: tree.contextId }, { name, description, parent: `${parent},${tree.contextId}` }, activityId);
  const category = await savedCategory(context, siteUrl, activityId, id);
  return { changed: `Added category ${id} "${category.name}" to bank ${activityId}${parent === tree.topId ? "" : ` inside category ${parent}`}.`, category };
}

/**
 * Changes a bank's category as its "Edit settings" does, only what's given: its name, its description
 * (HTML), or its parent (`parentId`, which moves it with its subcategories and questions; the bank's
 * Top, the top-level categories' `parentId`, moves it to the top level). Returns the category afterwards.
 */
export async function editQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  categoryId: number,
  changes: { name?: string; description?: string; parentId?: number },
): Promise<{ changed: string; category: QuestionCategory }> {
  const { name, description, parentId } = changes;
  if (name === undefined && description === undefined && parentId === undefined) throw new QuestionBankError("Give what to change in the category: its name, description or parentId.");
  if (name !== undefined && !name.trim()) throw new QuestionBankError("A category's name can't be blank.");
  const tree = await categoryTree(context, siteUrl, activityId);
  const current = inBank(tree, activityId, categoryId);
  if (parentId !== undefined && parentId !== tree.topId) inBank(tree, activityId, parentId, "parent category");
  await saveCategoryForm(
    context,
    siteUrl,
    // What the page's edit action passes: the form loads the category's values from them.
    { ...formBank(tree.bank), contextid: tree.contextId, categoryid: categoryId, parent: `${current.parentId},${tree.contextId}`, questioncount: current.questionCount },
    { name, description, parent: parentId === undefined || parentId === current.parentId ? undefined : `${parentId},${tree.contextId}` },
    activityId,
  );
  const category = await savedCategory(context, siteUrl, activityId, categoryId);
  const what = [name !== undefined && "renamed it", description !== undefined && "set its description", parentId !== undefined && parentId !== current.parentId && `moved it ${parentId === tree.topId ? "to the top level" : `into category ${parentId}`}`].filter(Boolean);
  return { changed: `Category ${categoryId} of bank ${activityId}: ${what.join(", ") || "nothing changed"}.`, category };
}

/**
 * Deletes a bank's category as its delete action does. Its subcategories move up to its parent, as
 * Moodle does. A category with questions takes `moveTo`, the bank's category its questions go to,
 * which Moodle asks for before deleting; without it nothing is deleted. Moodle keeps a bank's last
 * top-level category.
 */
export async function deleteQuestionCategory(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  categoryId: number,
  { moveTo }: { moveTo?: number } = {},
): Promise<{ changed: string }> {
  const { page } = await openCategories(context, siteUrl, activityId);
  try {
    const tree = await readCategoryTree(page);
    const category = inBank(tree, activityId, categoryId);
    if (category.parentId === tree.topId && tree.categories.filter((c) => c.parentId === tree.topId).length === 1) {
      throw new QuestionBankError(`Category ${categoryId} is bank ${activityId}'s only top-level category: Moodle keeps it.`);
    }
    if (moveTo !== undefined) {
      if (moveTo === categoryId) throw new QuestionBankError(`Category ${categoryId}'s questions can't move to itself: give another category in moveTo.`);
      inBank(tree, activityId, moveTo, "category to move the questions to");
    } else if (category.questionCount > 0) {
      throw new QuestionBankError(`Category ${categoryId} has ${category.questionCount} question${category.questionCount === 1 ? "" : "s"}: give moveTo, the category they go to, and it's deleted after moving them.`);
    }
    // The page's own delete link, with its sesskey.
    const link = await page.locator(`#categoryroot a[href*="delete=${categoryId}&"], #categoryroot a[href$="delete=${categoryId}"]`).first().getAttribute("href");
    if (!link) throw new QuestionBankError(`Bank ${activityId}'s categories page doesn't offer to delete category ${categoryId}.`);
    await page.goto(new URL(link, siteUrl).href, { waitUntil: "domcontentloaded" });
    // With questions left (hidden ones the count leaves out too), Moodle asks where they go.
    if ((await page.locator('form.mform input[name="delete"]').count()) > 0) {
      if (moveTo === undefined) throw new QuestionBankError(`Category ${categoryId} still has questions (hidden ones, or in use by quizzes): give moveTo, the category they go to.`);
      const option = `${moveTo},${tree.contextId}`;
      const offered = await page.locator(`form.mform select[name="category"] option[value="${option}"]`).count();
      if (offered === 0) throw new QuestionBankError(`Moodle doesn't offer category ${moveTo} for category ${categoryId}'s questions.`);
      await setFields(page, { category: option });
      await submitForm(page, "submitbutton");
    }
    if ((await page.locator("#categoryroot").count()) === 0 || (await page.locator(`#category-${categoryId}`).count()) > 0) {
      const refused = await moodleErrorMessage(page);
      throw new QuestionBankError(`Moodle didn't delete category ${categoryId} of bank ${activityId}${refused ? `: ${refused}` : "."}`);
    }
    return { changed: `Deleted category ${categoryId} "${category.name}" from bank ${activityId}${moveTo !== undefined ? `, its questions moved to category ${moveTo}` : ""}.` };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Moves questions into a category of a bank, several at once, as the bank's bulk "Move to" does
 * (Moodle 5's core_question_move_questions service; 4.x's move page, confirmed with the list's MD5
 * as its own link does). A question keeps its id and versions.
 */
export async function moveQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questionIds: number[],
  categoryId: number,
): Promise<{ changed: string; questionIds: number[]; categoryId: number }> {
  if (questionIds.length === 0) throw new QuestionBankError("Give the ids of the questions to move.");
  const tree = await categoryTree(context, siteUrl, activityId);
  inBank(tree, activityId, categoryId);
  const done = { changed: `Moved question${questionIds.length === 1 ? "" : "s"} ${questionIds.join(", ")} into category ${categoryId} of bank ${activityId}.`, questionIds, categoryId };
  if (tree.bank.course) {
    const page = await openSitePage(context, siteUrl, `question/edit.php?${tree.bank.query}`);
    try {
      const list = questionIds.join(",");
      const answer = await postBankPage(page, "question/bank/bulkmove/move.php", {
        ...tree.bank.field,
        movequestionsselected: list,
        confirm: createHash("md5").update(list).digest("hex"),
        category: `${categoryId},${tree.contextId}`,
        // After moving, the page sets the return URL's filter to the category, failing when the
        // URL has none (confirmed empirically, 4.5): an empty one, which it fills in.
        returnurl: `/question/edit.php?${tree.bank.query}&filter=%7B%7D`,
      });
      if (answer.error) throw new QuestionBankError(`Moodle didn't move the questions into bank ${activityId}: ${answer.error.replace(/\.$/, "")}. Moving takes Moodle's capability moodle/question:moveall (movemine for your own questions).`);
    } finally {
      await page.close().catch(() => undefined);
    }
    return done;
  }
  try {
    // Without a return URL Moodle refuses the call (invalidparameter), confirmed empirically, 5.2.
    await callService(context, siteUrl, "core_question_move_questions", {
      newcontextid: tree.contextId,
      newcategoryid: categoryId,
      questionids: questionIds.join(","),
      returnurl: `/question/edit.php?${tree.bank.query}`,
    });
  } catch (error) {
    if (error instanceof MoodleServiceError && /^nopermission|^required_capability/.test(error.errorcode)) {
      throw new QuestionBankError(
        `You can't move these questions into bank ${activityId}: it takes Moodle's capabilities moodle/question:moveall (moodle/question:movemine for your own questions) and moodle/question:add in the bank. Moodle said: ${error.message}`,
      );
    }
    throw error;
  }
  return done;
}
