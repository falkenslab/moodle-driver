// Question banks (Moodle 5: shared banks are qbank activities; quizzes keep private ones), their
// questions read from the bank page by field names and icons, questions imported from a GIFT or
// Moodle XML file through the import form, and single questions made through their edit form.
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { checkLocalFiles } from "../../core/files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
import { callService } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";

/** The bank isn't there, or Moodle refused the questions. */
export class QuestionBankError extends MoodleError {
  override name = "QuestionBankError";
  constructor(message: string) {
    super(message, "question-bank");
  }
}

/** A question bank of a course, as `questionBanks` lists it. */
export interface QuestionBank {
  /** The bank's course module id: a qbank activity's, or the quiz's whose private bank it is. */
  id: number;
  name: string;
  /** The module: "qbank" for a shared bank, "quiz"… for an activity's own. */
  type: string;
  /** Shared banks' questions can be used anywhere in the course; activities' only there. */
  shared: boolean;
}

/** A course's question banks: its shared ones and the activities' own, as the banks page lists them. */
export async function questionBanks(context: BrowserContext, siteUrl: string, courseId: number): Promise<QuestionBank[]> {
  const page = await openSitePage(context, siteUrl, `question/banks.php?courseid=${courseId}`);
  try {
    if ((await page.locator("body#page-question-banks").count()) === 0) {
      throw new QuestionBankError(`You can't see course ${courseId}'s question banks: the course doesn't exist, or you aren't allowed.`);
    }
    return await page.evaluate(() => {
      interface El {
        textContent: string | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        closest(s: string): El | null;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      return Array.from(doc.querySelectorAll(".question-banks-list li")).flatMap((item) => {
        const link = item.querySelector('a[href*="/mod/"][href*="view.php"]');
        const match = /\/mod\/([a-z0-9_]+)\/view\.php\?(?:.*&)?id=(\d+)/.exec(link?.getAttribute("href") ?? "");
        if (!match) return [];
        return [{ id: Number(match[2]), name: (link?.textContent ?? "").replace(/\s+/g, " ").trim(), type: match[1]!, shared: item.closest(".shared-banks") !== null }];
      });
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A question in a bank, as `questions` lists it. */
export interface BankQuestion {
  id: number;
  name: string;
  /** The question type: "multichoice", "truefalse", "shortanswer", "essay"… */
  type: string;
  /** "ready" or "draft". */
  status?: string;
  version?: string;
  categoryId: number;
}

/** A category of a bank's questions; the questions' `categoryId` refers to it. */
export interface BankCategory {
  id: number;
  name: string;
}

/** The bank page's categories (its category filter's options) and its context id. */
async function bankCategories(page: Page): Promise<{ contextId: number; categories: BankCategory[] }> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as {
      document: { querySelector(s: string): { getAttribute(n: string): string | null } | null; querySelectorAll(s: string): ArrayLike<{ value: string; textContent: string | null }> };
    }).document;
    const categories = Array.from(doc.querySelectorAll('[data-filterregion="filtertypedata"] select[data-field-name="category"] option'))
      .filter((option) => option.value !== "")
      // Names come indented, with their question count: "   Default for X (6)".
      .map((option) => ({ id: Number(option.value), name: (option.textContent ?? "").replace(/\s+/g, " ").replace(/\s*\(\d+\)$/, "").trim() }));
    return { contextId: Number(doc.querySelector(".questionbankwindow[data-contextid]")?.getAttribute("data-contextid")), categories };
  });
}

/** The questions on a bank page: id from their checkbox, type from their icon, name from the in-place editor. */
export function readBankQuestions(page: Page, categoryId: number): Promise<BankQuestion[]> {
  return page.evaluate((categoryId) => {
    interface El {
      textContent: string | null;
      value: string;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    return Array.from(doc.querySelectorAll("#categoryquestions tbody tr")).flatMap((row) => {
      const id = Number(/^q(\d+)$/.exec(row.querySelector('input[type="checkbox"][name^="q"]')?.getAttribute("name") ?? "")?.[1]);
      if (!id) return [];
      const type = /\/qtype_([a-z0-9_]+)\//.exec(row.querySelector('[data-columnid*="question_type_column"] img')?.getAttribute("src") ?? "")?.[1] ?? "";
      const name = row.querySelector('[data-itemtype="questionname"]')?.getAttribute("data-value") ?? "";
      const status = row.querySelector('select[name="question_status_dropdown"]')?.value;
      const version = (row.querySelector('[data-columnid*="version_number_column"]')?.textContent ?? "").trim();
      return [{ id, name, type, ...(status ? { status } : {}), ...(version ? { version } : {}), categoryId }];
    });
  }, categoryId);
}

// Modules that keep questions (FEATURE_USES_QUESTIONS in Moodle 5): a shared bank, a quiz's own.
const BANK_MODULES = new Set(["qbank", "quiz"]);
const bankModules = new Map<string, string>();

/**
 * Checks that a course module keeps questions before opening its bank: Moodle creates a bank's
 * categories for any activity whose bank page is opened (confirmed empirically, 5.2). The module
 * comes from its settings form, which changes nothing.
 */
async function checkBank(context: BrowserContext, siteUrl: string, activityId: number): Promise<void> {
  const key = `${siteUrl}|${activityId}`;
  let module = bankModules.get(key);
  if (!module) {
    const page = await openSitePage(context, siteUrl, `course/modedit.php?update=${activityId}`);
    try {
      module = (await formValue(page, "modulename")) ?? "";
    } finally {
      await page.close().catch(() => undefined);
    }
    if (module) bankModules.set(key, module);
  }
  if (!BANK_MODULES.has(module)) {
    throw new QuestionBankError(`Activity ${activityId} ${module ? `is a ${module}, which` : "doesn't exist, or you can't edit it, so it"} has no question bank. Take a bank's id from the course's question banks.`);
  }
}

// A bank page shows this many questions at most; more than that in one category isn't read.
const PER_PAGE = 1000;

/** A bank's categories and every question in them, category by category. */
export async function questions(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ categories: BankCategory[]; questions: BankQuestion[] }> {
  await checkBank(context, siteUrl, activityId);
  const page = await openSitePage(context, siteUrl, `question/edit.php?cmid=${activityId}`);
  try {
    if ((await page.locator("body#page-question-edit .questionbankwindow").count()) === 0) {
      throw new QuestionBankError(`Activity ${activityId} has no question bank you can see. Take a bank's id from the course's question banks.`);
    }
    const { contextId, categories } = await bankCategories(page);
    const found: BankQuestion[] = [];
    for (const category of categories) {
      await page.goto(new URL(`question/edit.php?cmid=${activityId}&cat=${category.id},${contextId}&qperpage=${PER_PAGE}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      found.push(...(await readBankQuestions(page, category.id)));
    }
    return { categories, questions: found };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The form's category option ("<id>,<context>") for a category id; the form's default without one. */
async function categoryOption(page: Page, categoryId: number | undefined): Promise<string | undefined> {
  if (categoryId === undefined) return undefined;
  const values = await page.evaluate(() =>
    Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll('form.mform select[name="category"] option')).map((o) => o.value),
  );
  const value = values.find((v) => v.split(",")[0] === String(categoryId));
  if (!value) throw new QuestionBankError(`The bank has no category ${categoryId}: take one from the bank's categories.`);
  return value;
}

/** Moodle's messages on the page after a form or an import (problems first). */
async function pageProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    interface El {
      textContent: string | null;
      cloneNode(deep: boolean): El;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    return Array.from(doc.querySelectorAll("#region-main .alert-danger, #region-main .notifyproblem, #region-main .errorbox, #region-main .alert-warning"))
      .map((element) => {
        // Without the close button, the error box's heading and its "more information" link.
        const copy = element.cloneNode(true);
        for (const extra of Array.from(copy.querySelectorAll("button, .visually-hidden, .errorcode, h2, h3, h4"))) extra.remove();
        return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
      })
      .filter(Boolean);
  });
}

/**
 * Imports questions into a bank from a GIFT or Moodle XML file (a local path) or text, through the
 * bank's import form; returns the questions created. A file Moodle can't parse comes back as a
 * `QuestionBankError` with its messages, and nothing is imported.
 */
export async function importQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { format, file, text, categoryId }: { format: "gift" | "xml"; file?: string; text?: string; categoryId?: number },
): Promise<{ changed: string; questions: BankQuestion[] }> {
  if ((file === undefined) === (text === undefined)) throw new QuestionBankError("Give the questions as a file or as text, one of the two.");
  if (file) await checkLocalFiles([file]);
  const before = new Set((await questions(context, siteUrl, activityId)).questions.map((q) => q.id));
  // Text goes up as a file, as a person would upload one.
  const dir = text !== undefined ? await mkdtemp(path.join(tmpdir(), "moodle-import-")) : undefined;
  const upload = dir ? path.join(dir, format === "gift" ? "questions.txt" : "questions.xml") : file!;
  if (dir) await writeFile(upload, text!, "utf8");
  const page = await openForm(context, siteUrl, `question/bank/importquestions/import.php?cmid=${activityId}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new QuestionBankError(`Activity ${activityId} has no question bank you can import into.`);
  });
  try {
    await uploadToDraft(page, (await formValue(page, "newfile"))!, [upload]);
    const values: Record<string, FieldValue> = { format };
    const category = await categoryOption(page, categoryId);
    // The file's own categories would override the one chosen. Unticking "category from file" also
    // disables "context from file", which then isn't sent (confirmed empirically, 5.2).
    if (category) Object.assign(values, { category, catfromfile: false });
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    const problems = await pageProblems(page);
    if (problems.length > 0) throw new QuestionBankError(`Moodle didn't import the questions: ${problems.join(" ")}`);
  } finally {
    await page.close().catch(() => undefined);
    if (dir) await rm(dir, { recursive: true, force: true });
  }
  const created = (await questions(context, siteUrl, activityId)).questions.filter((q) => !before.has(q.id));
  return { changed: `Imported ${created.length} question${created.length === 1 ? "" : "s"} into bank ${activityId}.`, questions: created };
}

/** The question types `createQuestion` makes through their form; others are imported (GIFT, Moodle XML). */
export const QUESTION_TYPES = ["multichoice", "truefalse", "shortanswer", "numerical", "essay"] as const;
/** One of `QUESTION_TYPES`. */
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** A question for `createQuestion`, or the changes for `updateQuestion` (without its type). */
export interface QuestionInput {
  type: QuestionType;
  name: string;
  /** The question's text (HTML). */
  text: string;
  /**
   * Multichoice, short answer and numerical answers: a fraction of the mark (1 right, 0 wrong, negatives for penalties), the nearest one Moodle offers.
   * A numerical answer's `tolerance` is the error accepted around it.
   */
  answers?: { text: string; fraction: number; feedback?: string; tolerance?: number }[];
  /** True/false: the right answer. */
  correct?: boolean;
  /** The bank's category it goes in; a new question goes in the bank's default one when left out. */
  categoryId?: number;
  defaultMark?: number;
  /** Any other field of the type's form, by name. */
  fields?: Record<string, FieldValue>;
}

/** The option of a fraction select nearest to `fraction` (Moodle offers 100%, 90%, 83.33%…). */
async function nearestFraction(page: Page, field: string, fraction: number): Promise<string> {
  const options = await page.evaluate(
    (field) => Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll(`select[name="${field}"] option`)).map((o) => o.value),
    field,
  );
  return options.reduce((best, value) => (Math.abs(Number(value) - fraction) < Math.abs(Number(best) - fraction) ? value : best), options[0] ?? "0.0");
}

/**
 * Creates one question in a bank through its type's edit form; returns its id. Imports are the way
 * for several; this is for one-offs.
 */
export async function createQuestion(context: BrowserContext, siteUrl: string, activityId: number, input: QuestionInput): Promise<{ changed: string; questionId?: number }> {
  if (!QUESTION_TYPES.includes(input.type)) throw new QuestionBankError(`Question type ${input.type} isn't one this creates (${QUESTION_TYPES.join(", ")}); import it as GIFT or Moodle XML instead.`);
  const answers = input.answers ?? [];
  if (["multichoice", "shortanswer", "numerical"].includes(input.type) && answers.length === 0) throw new QuestionBankError(`A ${input.type} question needs answers.`);
  if (input.type === "truefalse" && input.correct === undefined) throw new QuestionBankError("A true/false question needs its right answer (correct).");
  const { categories } = await questions(context, siteUrl, activityId);
  // The bank lists its "Top" category first, which holds no questions: its default one comes next.
  const category = input.categoryId ?? (categories[1] ?? categories[0])?.id;
  const page = await openForm(context, siteUrl, `question/bank/editquestion/question.php?cmid=${activityId}&category=${category}&qtype=${input.type}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new QuestionBankError(`Activity ${activityId} has no question bank you can add to, or category ${category} isn't in it.`);
  });
  try {
    await fillQuestionForm(page, input.type, input, { blankRest: false });
    await submitForm(page, "submitbutton");
    // Moodle lands on the bank, naming the question it changed last.
    const id = Number(new URL(page.url()).searchParams.get("lastchanged")) || undefined;
    return { changed: `Created ${input.type} question${id ? ` ${id}` : ""} "${input.name}" in bank ${activityId}.`, questionId: id };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Fills a question's edit form with what's given: name, text, mark, category, the right answer of a
 * true/false, the answers, and any other field by name. Editing (`blankRest`), the given answers
 * replace them all: the form's other answer rows are blanked, and Moodle drops blank answers.
 */
async function fillQuestionForm(page: Page, type: string, input: Partial<QuestionInput>, { blankRest }: { blankRest: boolean }): Promise<void> {
  const answers = input.answers;
  if (answers) {
    // The form comes with a few blank answers; "Blanks for more" adds three at a time.
    for (let i = 0; i < 10 && answers.length > Number((await formValue(page, "noanswers")) ?? answers.length); i++) {
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('form.mform [name="addanswers"]')]);
    }
  }
  const values: Record<string, FieldValue> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.text !== undefined) values["questiontext[text]"] = input.text;
  if (input.defaultMark !== undefined) values.defaultmark = input.defaultMark;
  const choice = await categoryOption(page, input.categoryId);
  if (choice) values.category = choice;
  if (type === "truefalse" && input.correct !== undefined) values.correctanswer = input.correct ? 1 : 0;
  if (answers) {
    if (type === "multichoice") values.single = answers.filter((a) => a.fraction > 0).length > 1 ? 0 : 1;
    const rows = blankRest ? Math.max(answers.length, Number((await formValue(page, "noanswers")) ?? 0)) : answers.length;
    for (let i = 0; i < rows; i++) {
      const answer = answers[i];
      values[type === "multichoice" ? `answer[${i}][text]` : `answer[${i}]`] = answer?.text ?? "";
      values[`fraction[${i}]`] = await nearestFraction(page, `fraction[${i}]`, answer?.fraction ?? 0);
      if (answer?.feedback !== undefined) values[`feedback[${i}][text]`] = answer.feedback;
      else if (!answer && (await formValue(page, `feedback[${i}][text]`)) !== undefined) values[`feedback[${i}][text]`] = "";
      if (answer?.tolerance !== undefined) values[`tolerance[${i}]`] = answer.tolerance;
    }
  }
  await setFields(page, { ...values, ...input.fields });
}

/**
 * Changes a question of a bank through its type's edit form, with the same inputs as
 * `createQuestion` and only what's given (`answers` replaces them all). Saving makes a new version
 * of the question, with an id of its own: the one returned, which quizzes using the latest version
 * get from then on.
 */
export async function updateQuestion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questionId: number,
  input: Partial<Omit<QuestionInput, "type">>,
): Promise<{ changed: string; questionId?: number }> {
  if (Object.keys(input).length === 0) throw new QuestionBankError("Give what to change in the question: its name, text, answers, mark, category or fields.");
  await checkBank(context, siteUrl, activityId);
  const page = await openForm(context, siteUrl, `question/bank/editquestion/question.php?cmid=${activityId}&id=${questionId}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new QuestionBankError(`Bank ${activityId} has no question ${questionId} you can edit. Take its id from the bank's questions.`);
  });
  try {
    const type = (await formValue(page, "qtype")) ?? "";
    if (input.answers && !["multichoice", "shortanswer", "numerical"].includes(type)) {
      throw new QuestionBankError(`A ${type || "question of this type"}'s answers aren't changed this way; give its form's fields instead.`);
    }
    await fillQuestionForm(page, type, input, { blankRest: true });
    await submitForm(page, "submitbutton");
    const id = Number(new URL(page.url()).searchParams.get("lastchanged")) || undefined;
    return { changed: `Saved question ${questionId}${id && id !== questionId ? ` as a new version, question ${id},` : ""} in bank ${activityId}.`, questionId: id };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Whether a question can still be opened for editing: a deleted one can't, a hidden one can. */
async function questionExists(context: BrowserContext, siteUrl: string, activityId: number, questionId: number): Promise<boolean> {
  const page = await openSitePage(context, siteUrl, `question/bank/editquestion/question.php?cmid=${activityId}&id=${questionId}`);
  try {
    return (await page.locator('form.mform [name="qtype"]').count()) > 0;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The delete page's answer: its fatal error, if any, and the confirmation it asks for (its own `confirm`). */
async function postDelete(page: Page, fields: Record<string, string>): Promise<{ error?: string; confirm?: string }> {
  return page.evaluate(async (fields) => {
    const g = globalThis as unknown as {
      M: { cfg: { wwwroot: string; sesskey: string } };
      fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
      URLSearchParams: new (init: Record<string, string>) => unknown;
      DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): { textContent: string | null; value?: string } | null } };
    };
    const response = await g.fetch(`${g.M.cfg.wwwroot}/question/bank/deletequestion/delete.php`, {
      method: "POST",
      credentials: "same-origin",
      body: new g.URLSearchParams({ ...fields, sesskey: g.M.cfg.sesskey }),
    });
    const html = await response.text();
    const doc = new g.DOMParser().parseFromString(html, "text/html");
    const error = (doc.querySelector('[data-rel="fatalerror"] .errormessage')?.textContent ?? "").replace(/\s+/g, " ").trim();
    // The confirmation's Delete button: a form with the value as a hidden field, or a link carrying it.
    const confirm = doc.querySelector('form input[name="confirm"]')?.value || /[?&;]confirm=([0-9a-f]{32})/.exec(html)?.[1];
    return { ...(error ? { error } : {}), ...(confirm ? { confirm } : {}) };
  }, fields);
}

/**
 * Deletes questions from a bank, every version of each, as the bank's delete action does: asked,
 * then confirmed. Moodle doesn't delete a question a quiz uses: it hides it, and `hidden` lists those.
 */
export async function deleteQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questionIds: number[],
): Promise<{ changed: string; deleted: number[]; hidden: number[] }> {
  if (questionIds.length === 0) throw new QuestionBankError("Give the ids of the questions to delete.");
  await checkBank(context, siteUrl, activityId);
  const page = await openSitePage(context, siteUrl, `question/edit.php?cmid=${activityId}`);
  try {
    if ((await page.locator("body#page-question-edit .questionbankwindow").count()) === 0) {
      throw new QuestionBankError(`Activity ${activityId} has no question bank you can see. Take a bank's id from the course's question banks.`);
    }
    const list = questionIds.join(",");
    const common = { deleteselected: list, deleteall: "1", cmid: String(activityId), returnurl: `/question/edit.php?cmid=${activityId}` };
    const asked = await postDelete(page, { ...common, ...Object.fromEntries(questionIds.map((id) => [`q${id}`, "1"])) });
    if (asked.error || !asked.confirm) throw new QuestionBankError(`Moodle didn't delete the questions from bank ${activityId}: ${(asked.error ?? "its delete page didn't ask to confirm").replace(/\.$/, "")}.`);
    const done = await postDelete(page, { ...common, confirm: asked.confirm });
    if (done.error) throw new QuestionBankError(`Moodle didn't delete the questions from bank ${activityId}: ${done.error.replace(/\.$/, "")}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const deleted: number[] = [];
  const hidden: number[] = [];
  for (const id of questionIds) ((await questionExists(context, siteUrl, activityId, id)) ? hidden : deleted).push(id);
  const parts = [deleted.length > 0 && `deleted question${deleted.length === 1 ? "" : "s"} ${deleted.join(", ")}`, hidden.length > 0 && `hid ${hidden.join(", ")}, in use`].filter(Boolean);
  return { changed: `In bank ${activityId}: ${parts.join("; ")}.`, deleted, hidden };
}

/** Sets a question ready (quizzes can use it) or draft, as the bank's status menu does, through its service. */
export async function setQuestionStatus(
  context: BrowserContext,
  siteUrl: string,
  questionId: number,
  status: "ready" | "draft",
): Promise<{ changed: string; questionId: number; status: "ready" | "draft" }> {
  if (status !== "ready" && status !== "draft") throw new QuestionBankError(`A question's status is "ready" or "draft", not "${String(status)}".`);
  const answer = await callService<{ status: boolean; error?: string }>(context, siteUrl, "qbank_editquestion_set_status", { questionid: questionId, status });
  if (!answer.status) throw new QuestionBankError(`Moodle didn't change question ${questionId}'s status: ${answer.error || "no reason given"}.`);
  return { changed: `Question ${questionId} is now ${status}.`, questionId, status };
}
