// Question banks (Moodle 5: shared banks are qbank activities; quizzes keep private ones. Moodle 4.x:
// each course has its own bank), their questions read from the bank page by field names and icons,
// questions imported from a GIFT or Moodle XML file through the import form and exported through the
// export form, and single questions made through their edit form. Categories are in categories.ts.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { checkLocalFiles, type DownloadedFile } from "../../core/files.js";
import { siteFetch } from "../../core/http.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
import { callService } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";
import { compareBranches, moodleVersion } from "../../core/version.js";
import { pageWindow, sliceWindow, toPage, type ListPage, type PageOptions, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { QuestionBankError } from "./errors.js";
import { PLUGIN_QUESTION_TYPES, QUESTION_TYPES, checkQuestionInput, fillQuestionForm, saveQuestionForm, type QuestionInput } from "./types.js";

export { QuestionBankError };
export { QUESTION_TYPES, type QuestionType, type QuestionInput, type DropZone } from "./types.js";

/** A question bank of a course, as `questionBanks` lists it. */
export interface QuestionBank {
  /**
   * The id the other functions take: on Moodle 5, the bank's course module id (a qbank activity's,
   * or the quiz's whose private bank it is); on Moodle 4.x, the course's id (its course bank).
   */
  id: number;
  name: string;
  /** "qbank" for a shared bank, "quiz"… for an activity's own (Moodle 5); "course" for a course's bank (Moodle 4.x). */
  type: string;
  /** Shared banks' questions can be used anywhere in the course; activities' only there. */
  shared: boolean;
}

// Whether each site keeps its banks as qbank activities (Moodle 5.0 and later), per browser context.
const bankActivitySites = new WeakMap<BrowserContext, Map<string, Promise<boolean>>>();

/**
 * Whether the site keeps question banks as qbank activities (Moodle 5.0 and later) or each course
 * has its own (Moodle 4.x): by the site's branch, or, when it's unknown, by the qbank module's icon,
 * a static file anyone can fetch, which 4.x answers with a 404 (confirmed empirically, 4.5). Asked
 * once per site.
 */
export function hasBankActivities(context: BrowserContext, siteUrl: string): Promise<boolean> {
  let sites = bankActivitySites.get(context);
  if (!sites) bankActivitySites.set(context, (sites = new Map()));
  let found = sites.get(siteUrl);
  if (!found) {
    const asked = moodleVersion(context, siteUrl).then(async ({ branch }) =>
      branch !== "unknown" ? compareBranches(branch, "5.0") >= 0 : (await siteFetch(context, new URL("mod/qbank/pix/monologo.svg", siteUrl).href)).status !== 404,
    );
    // A failed request is asked again next time.
    asked.catch(() => sites.delete(siteUrl));
    sites.set(siteUrl, asked);
    found = asked;
  }
  return found;
}

/** How a bank's pages are addressed: `cmid` on Moodle 5, `courseid` on Moodle 4.x. */
export interface BankRef {
  /** "cmid=36" or "courseid=12": the bank pages' parameter. */
  query: string;
  /** The same as a form's field: { cmid: "36" } or { courseid: "12" }. */
  field: Record<string, string>;
  /** Moodle 4.x: the id is a course's, its bank the course's. */
  course: boolean;
}

/** The bank pages' parameter for a bank id; on Moodle 5 the module is checked first (see `checkBank`). */
export async function bankRef(context: BrowserContext, siteUrl: string, bankId: number): Promise<BankRef> {
  if (await hasBankActivities(context, siteUrl)) {
    await checkBank(context, siteUrl, bankId);
    return { query: `cmid=${bankId}`, field: { cmid: String(bankId) }, course: false };
  }
  return { query: `courseid=${bankId}`, field: { courseid: String(bankId) }, course: true };
}

/**
 * A course's question banks: on Moodle 5 its shared ones and the activities' own, as the banks page
 * lists them; on Moodle 4.x the course's own bank, whose id is the course's.
 */
export async function questionBanks(context: BrowserContext, siteUrl: string, courseId: number): Promise<QuestionBank[]> {
  if (!(await hasBankActivities(context, siteUrl))) return [await courseBank(context, siteUrl, courseId)];
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

/** Moodle 4.x: the course's bank, if the person can see its bank page, named as the course. */
async function courseBank(context: BrowserContext, siteUrl: string, courseId: number): Promise<QuestionBank> {
  const page = await openSitePage(context, siteUrl, `question/edit.php?courseid=${courseId}`);
  try {
    if ((await page.locator("body#page-question-edit .questionbankwindow").count()) === 0) {
      throw new QuestionBankError(`You can't see course ${courseId}'s question bank: the course doesn't exist, or you aren't allowed.`);
    }
    const name = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }).document;
      return (doc.querySelector("#page-header h1, .page-header-headings h1")?.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    return { id: courseId, name, type: "course", shared: true };
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

/**
 * The bank page's categories (its category filter's options) and its context id: the page's own
 * context, in the body's classes. Moodle 4.x's filter lists the parent contexts' categories too (the
 * course category's, the system's, for whoever can use them), each context after an option without a
 * value: the first context's are the bank's own (confirmed empirically, 4.5).
 */
async function bankCategories(page: Page): Promise<{ contextId: number; categories: BankCategory[] }> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as {
      document: {
        body: { className: string };
        querySelector(s: string): { getAttribute(n: string): string | null } | null;
        querySelectorAll(s: string): ArrayLike<{ value: string; textContent: string | null }>;
      };
    }).document;
    const categories: BankCategory[] = [];
    for (const option of Array.from(doc.querySelectorAll('[data-filterregion="filtertypedata"] select[data-field-name="category"] option'))) {
      if (option.value === "") {
        if (categories.length > 0) break;
        continue;
      }
      // Names come indented, with their question count: "   Default for X (6)".
      categories.push({ id: Number(option.value), name: (option.textContent ?? "").replace(/\s+/g, " ").replace(/\s*\(\d+\)$/, "").trim() });
    }
    // The bank window's context is the category shown's, which on 4.x may be a parent context's.
    const contextId = Number(/\bcontext-(\d+)\b/.exec(doc.body.className)?.[1]) || Number(doc.querySelector(".questionbankwindow[data-contextid]")?.getAttribute("data-contextid"));
    return { contextId, categories };
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
export async function checkBank(context: BrowserContext, siteUrl: string, activityId: number): Promise<void> {
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

/** The bank page didn't open: the bank's own words for it on each version. */
function noBank(bankId: number, bank: BankRef): QuestionBankError {
  return new QuestionBankError(
    bank.course
      ? `Course ${bankId} has no question bank you can see (on Moodle 4.x a bank's id is its course's): the course doesn't exist, or you can't manage its questions.`
      : `Activity ${bankId} has no question bank you can see. Take a bank's id from the course's question banks.`,
  );
}

// A bank page shows this many questions at most; more than that in one category isn't read.
const PER_PAGE = 1000;

/** A bank's questions as `questions` reads them: its categories, and its questions (a list, or a page of them). */
export interface BankQuestions<Q = BankQuestion[]> {
  categories: BankCategory[];
  questions: Q;
}

/**
 * A bank's categories and every question in them, category by category. With `limit`, `questions` is
 * a page of them in that order (see "Long lists" in the docs' concepts), the categories all: the bank
 * is read category by category until the page is full, each category whole and cut (its page counts
 * aren't reliable enough to skip by).
 */
export function questions(context: BrowserContext, siteUrl: string, activityId: number, options: WithLimit<PageOptions>): Promise<BankQuestions<ListPage<BankQuestion>>>;
export function questions(context: BrowserContext, siteUrl: string, activityId: number, options?: WithoutLimit<PageOptions>): Promise<BankQuestions>;
export function questions(context: BrowserContext, siteUrl: string, activityId: number, options?: PageOptions): Promise<BankQuestions<BankQuestion[] | ListPage<BankQuestion>>>;
export async function questions(context: BrowserContext, siteUrl: string, activityId: number, options: PageOptions = {}): Promise<BankQuestions<BankQuestion[] | ListPage<BankQuestion>>> {
  const window = pageWindow(options);
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openSitePage(context, siteUrl, `question/edit.php?${bank.query}`);
  try {
    if ((await page.locator("body#page-question-edit .questionbankwindow").count()) === 0) throw noBank(activityId, bank);
    const { contextId, categories } = await bankCategories(page);
    const found: BankQuestion[] = [];
    for (const category of categories) {
      if (window.count !== undefined && found.length >= window.offset + window.count) break;
      await page.goto(new URL(`question/edit.php?${bank.query}&cat=${category.id},${contextId}&qperpage=${PER_PAGE}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      found.push(...(await readBankQuestions(page, category.id)));
    }
    return { categories, questions: toPage(sliceWindow(found, window), options.limit) };
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
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openForm(context, siteUrl, `question/bank/importquestions/import.php?${bank.query}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new QuestionBankError(`${bank.course ? "Course" : "Activity"} ${activityId} has no question bank you can import into.`);
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

/**
 * Exports a bank's questions, or a category's (its subcategories' included), to a local GIFT or
 * Moodle XML file, through the bank's export form; `file` (an absolute path) is written, replacing
 * one there. The file names each question's category, as Moodle writes it by default, so importing
 * it without a category recreates them. Hidden questions aren't exported, and a question's latest
 * version only.
 */
export async function exportQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { format, categoryId, file }: { format: "gift" | "xml"; categoryId?: number; file: string },
): Promise<DownloadedFile> {
  if (format !== "gift" && format !== "xml") throw new QuestionBankError(`Questions export as "gift" or "xml", not "${String(format)}".`);
  if (!file || !path.isAbsolute(file)) throw new MoodleError(`Give the file to write as an absolute path: "${file}".`, "invalid-input");
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openForm(context, siteUrl, `question/bank/exportquestions/export.php?${bank.query}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new QuestionBankError(`You can't export bank ${activityId}'s questions: it takes Moodle's capability moodle/question:viewall (or viewmine, for your own).`);
  });
  let link: string | null;
  try {
    // Without a category, the bank's Top, which the form lists first: everything under it (confirmed empirically, 5.2).
    const category =
      (await categoryOption(page, categoryId)) ??
      (await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector('form.mform select[name="category"] option')?.value));
    await setFields(page, { format, ...(category ? { category } : {}) });
    // The answer page links the file and sends the tab there a second later, as a download that
    // replaces it: the filled form is sent as the tab would send it, but with the session's own
    // requests, and the file fetched from the link in the answer.
    const { action, body } = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): { action: string } | null };
        FormData: new (form: unknown) => { append(name: string, value: string): void } & Iterable<[string, string]>;
        URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
      };
      const form = g.document.querySelector("form.mform");
      const data = new g.FormData(form);
      data.append("submitbutton", "1");
      return { action: form?.action ?? "", body: new g.URLSearchParams(data).toString() };
    });
    const answer = await siteFetch(context, action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
    const href = /href="([^"]*\/pluginfile\.php\/[^"]*\/question\/export\/[^"]*)"/.exec(answer.body)?.[1];
    link = href ? href.replaceAll("&amp;", "&") : null;
  } finally {
    await page.close().catch(() => undefined);
  }
  if (!link) throw new QuestionBankError(`Moodle didn't export bank ${activityId}'s questions: its export page gave no file.`);
  const response = await siteFetch(context, new URL(link, siteUrl).href);
  // Nothing to export answers with Moodle's error page ("no questions"), not a file.
  if (response.status !== 200 || /^\s*<!DOCTYPE html/i.test(response.body)) {
    const reason = /class="errormessage"[^>]*>([\s\S]*?)<\//.exec(response.body)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    throw new QuestionBankError(`Moodle didn't export ${categoryId === undefined ? `bank ${activityId}` : `category ${categoryId}`}: ${reason || "it has no questions to export"}.`);
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, response.body, "utf8");
  return { path: file, name: path.basename(file), size: Buffer.byteLength(response.body, "utf8"), contentType: format === "xml" ? "application/xml" : "text/plain" };
}

/**
 * Creates one question in a bank through its type's edit form, of any type in `QUESTION_TYPES`;
 * returns its id. Each type's required inputs are checked before the form opens. Calculated types
 * go through their wildcards' pages too; a plugin type the site doesn't have is refused naming the
 * plugin. Imports are the way for several; this is for one-offs.
 */
export async function createQuestion(context: BrowserContext, siteUrl: string, activityId: number, input: QuestionInput): Promise<{ changed: string; questionId?: number }> {
  if (!QUESTION_TYPES.includes(input.type)) throw new QuestionBankError(`Question type ${input.type} isn't one this creates (${QUESTION_TYPES.join(", ")}); import it as GIFT or Moodle XML instead.`);
  await checkQuestionInput(input.type, input, { creating: true });
  const { categories } = await questions(context, siteUrl, activityId);
  // The bank lists its "Top" category first, which holds no questions: its default one comes next.
  const category = input.categoryId ?? (categories[1] ?? categories[0])?.id;
  const plugin = PLUGIN_QUESTION_TYPES[input.type];
  const missingPlugin = () => new QuestionBankError(`This site has no ${plugin} question type (the qtype_${input.type} plugin): its administrator would have to install it.`);
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openForm(context, siteUrl, `question/bank/editquestion/question.php?${bank.query}&category=${category}&qtype=${input.type}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    // The bank and its category were read just now: a plugin's form missing is the plugin missing.
    if (plugin) throw missingPlugin();
    throw new QuestionBankError(`${bank.course ? "Course" : "Activity"} ${activityId} has no question bank you can add to, or category ${category} isn't in it.`);
  });
  try {
    if ((await formValue(page, "qtype")) !== input.type) {
      if (plugin) throw missingPlugin();
      throw new QuestionBankError(`Moodle didn't open a ${input.type} question's form.`);
    }
    await fillQuestionForm(page, input.type, input, { blankRest: false, category: await categoryOption(page, input.categoryId) });
    await saveQuestionForm(page, input.type, input, { blankRest: false });
    // Moodle lands on the bank, naming the question it changed last.
    const id = Number(new URL(page.url()).searchParams.get("lastchanged")) || undefined;
    return { changed: `Created ${input.type} question${id ? ` ${id}` : ""} "${input.name}" in bank ${activityId}.`, questionId: id };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Changes a question of a bank through its type's edit form (its wildcards' pages too, for the
 * calculated types), with the same inputs as `createQuestion` and only what's given: a list given
 * (`answers`, `pairs`, `choices`, `items`, `drags`, `markers`, `drops`, the wildcards' values)
 * replaces the question's. Saving makes a new version of the question, with an id of its own: the
 * one returned, which quizzes using the latest version get from then on.
 */
export async function updateQuestion(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questionId: number,
  input: Partial<Omit<QuestionInput, "type">>,
): Promise<{ changed: string; questionId?: number }> {
  if (Object.keys(input).length === 0) throw new QuestionBankError("Give what to change in the question: its name, text, mark, category, its type's inputs or fields.");
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openForm(context, siteUrl, `question/bank/editquestion/question.php?${bank.query}&id=${questionId}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new QuestionBankError(`Bank ${activityId} has no question ${questionId} you can edit. Take its id from the bank's questions.`);
  });
  try {
    const type = (await formValue(page, "qtype")) ?? "";
    await checkQuestionInput(type, input, { creating: false });
    await fillQuestionForm(page, type, input, { blankRest: true, category: await categoryOption(page, input.categoryId) });
    await saveQuestionForm(page, type, input, { blankRest: true });
    const id = Number(new URL(page.url()).searchParams.get("lastchanged")) || undefined;
    return { changed: `Saved question ${questionId}${id && id !== questionId ? ` as a new version, question ${id},` : ""} in bank ${activityId}.`, questionId: id };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Whether a question can still be opened for editing: a deleted one can't, a hidden one can. */
async function questionExists(context: BrowserContext, siteUrl: string, bank: BankRef, questionId: number): Promise<boolean> {
  const page = await openSitePage(context, siteUrl, `question/bank/editquestion/question.php?${bank.query}&id=${questionId}`);
  try {
    return (await page.locator('form.mform [name="qtype"]').count()) > 0;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Posts to one of the bank's pages (`path`, from the site's root) from a bank page open in `page`,
 * with its sesskey; its answer: its fatal error, if any, and the confirmation it asks for (its own
 * `confirm`).
 */
export async function postBankPage(page: Page, path: string, fields: Record<string, string>): Promise<{ error?: string; confirm?: string }> {
  return page.evaluate(async ({ path, fields }) => {
    const g = globalThis as unknown as {
      M: { cfg: { wwwroot: string; sesskey: string } };
      fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
      URLSearchParams: new (init: Record<string, string>) => unknown;
      DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): { textContent: string | null; value?: string } | null } };
    };
    const response = await g.fetch(`${g.M.cfg.wwwroot}/${path}`, {
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
  }, { path, fields });
}

const DELETE_PAGE = "question/bank/deletequestion/delete.php";

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
  const bank = await bankRef(context, siteUrl, activityId);
  const page = await openSitePage(context, siteUrl, `question/edit.php?${bank.query}`);
  try {
    if ((await page.locator("body#page-question-edit .questionbankwindow").count()) === 0) throw noBank(activityId, bank);
    const list = questionIds.join(",");
    const common = { deleteselected: list, deleteall: "1", ...bank.field, returnurl: `/question/edit.php?${bank.query}` };
    const asked = await postBankPage(page, DELETE_PAGE, { ...common, ...Object.fromEntries(questionIds.map((id) => [`q${id}`, "1"])) });
    if (asked.error || !asked.confirm) throw new QuestionBankError(`Moodle didn't delete the questions from bank ${activityId}: ${(asked.error ?? "its delete page didn't ask to confirm").replace(/\.$/, "")}.`);
    const done = await postBankPage(page, DELETE_PAGE, { ...common, confirm: asked.confirm });
    if (done.error) throw new QuestionBankError(`Moodle didn't delete the questions from bank ${activityId}: ${done.error.replace(/\.$/, "")}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const deleted: number[] = [];
  const hidden: number[] = [];
  for (const id of questionIds) ((await questionExists(context, siteUrl, bank, id)) ? hidden : deleted).push(id);
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
