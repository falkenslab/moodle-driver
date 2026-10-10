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
import { MoodleDriverError } from "../../core/errors.js";

/** The bank isn't there, or Moodle refused the questions. */
export class QuestionBankError extends MoodleDriverError {
  override name = "QuestionBankError";
  constructor(message: string) {
    super(message, "question-bank");
  }
}

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
    // The file's own categories would override the one chosen.
    if (category) Object.assign(values, { category, catfromfile: false, contextfromfile: false });
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

export const QUESTION_TYPES = ["multichoice", "truefalse", "shortanswer", "numerical", "essay"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface QuestionInput {
  type: QuestionType;
  name: string;
  /** The question's text (HTML). */
  text: string;
  /** Multichoice, short answer and numerical answers: a fraction of the mark (1 right, 0 wrong, negatives for penalties), the nearest one Moodle offers. */
  answers?: { text: string; fraction: number; feedback?: string; tolerance?: number }[];
  /** True/false: the right answer. */
  correct?: boolean;
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
    // The form comes with a few blank answers; "Blanks for more" adds three at a time.
    for (let i = 0; i < 10 && answers.length > Number((await formValue(page, "noanswers")) ?? answers.length); i++) {
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('form.mform [name="addanswers"]')]);
    }
    const values: Record<string, FieldValue> = { name: input.name, "questiontext[text]": input.text, ...(input.defaultMark !== undefined ? { defaultmark: input.defaultMark } : {}) };
    const choice = await categoryOption(page, input.categoryId);
    if (choice) values.category = choice;
    if (input.type === "truefalse") values.correctanswer = input.correct ? 1 : 0;
    if (input.type === "multichoice") values.single = answers.filter((a) => a.fraction > 0).length > 1 ? 0 : 1;
    for (const [i, answer] of answers.entries()) {
      values[input.type === "multichoice" ? `answer[${i}][text]` : `answer[${i}]`] = answer.text;
      values[`fraction[${i}]`] = await nearestFraction(page, `fraction[${i}]`, answer.fraction);
      if (answer.feedback !== undefined) values[`feedback[${i}][text]`] = answer.feedback;
      if (answer.tolerance !== undefined) values[`tolerance[${i}]`] = answer.tolerance;
    }
    await setFields(page, { ...values, ...input.fields });
    await submitForm(page, "submitbutton");
    // Moodle lands on the bank, naming the question it changed last.
    const id = Number(new URL(page.url()).searchParams.get("lastchanged")) || undefined;
    return { changed: `Created ${input.type} question${id ? ` ${id}` : ""} "${input.name}" in bank ${activityId}.`, questionId: id };
  } finally {
    await page.close().catch(() => undefined);
  }
}
