// What people answered in a survey, as a teacher reads it: a feedback's questions from its print
// page, its responses from the "Show responses" tables (who) and their CSV downloads (every answer);
// a questionnaire's responses one by one from its report's individual responses. Neither module's
// services are open to AJAX (confirmed empirically, Moodle 5.2).
import type { BrowserContext, Page } from "playwright-core";
import { siteFetch } from "../../core/http.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { SurveyError, surveyType, type SurveyType } from "./surveys.js";

/** One response to a survey: who gave it, where the survey names people. */
export interface SurveyResponse {
  /** The response's id in Moodle (a feedback's completed id, a questionnaire's response id). */
  id: number;
  /** Given anonymously: no name or user id. */
  anonymous: boolean;
  userId?: number;
  fullName?: string;
  /** A feedback's anonymous response number, as its responses table shows it. */
  number?: number;
}

/** How many answers chose an option. */
export interface SurveyOptionCount {
  option: string;
  count: number;
}

/** A question of a survey with everyone's answers (`surveyResults`). */
export interface SurveyResultQuestion {
  /** The question's id: a feedback's item id, a questionnaire's question id. */
  id: number;
  /** Its number as shown, where the survey numbers them. */
  number?: string;
  text: string;
  /** The module's own type: feedback's `multichoice`, `multichoicerated`, `numeric`, `textfield`, `textarea`…; the questionnaire's `radio`, `check`, `drop`, `yesno`, `rate`, `text`, `essay`, `numeric`, `date`… */
  type: string;
  /** Each response's answer: the option or options chosen, the text or number given; a rate question's rows as "row: option". Responses that left it blank aren't listed. */
  answers: { responseId: number; values: string[] }[];
  /** Choice questions: every option the question offers, with how many answers chose it. */
  counts?: SurveyOptionCount[];
  /** Numeric questions and feedback's rated choices (by the options' weights): the mean, to two decimals. */
  average?: number;
  /** A questionnaire's rate question: each row's counts per option and its average rank. */
  rows?: { row: string; counts: SurveyOptionCount[]; average?: number }[];
}

/** What people answered in a feedback or a questionnaire (`surveyResults`). */
export interface SurveyResults {
  id: number;
  type: SurveyType;
  responses: SurveyResponse[];
  questions: SurveyResultQuestion[];
}

/** The mean, to two decimals as Moodle shows it; none for no numbers. */
function mean(numbers: number[]): number | undefined {
  if (numbers.length === 0) return undefined;
  return Math.round((numbers.reduce((a, b) => a + b, 0) / numbers.length) * 100) / 100;
}

/** A number as a person typed it or Moodle printed it ("4.5", "4,5"). */
function toNumber(text: string): number {
  return Number(text.includes(".") ? text : text.replace(",", "."));
}

/** Every option, in order, with how many of `chosen` name it; chosen texts the options don't list come last. */
function countOptions(options: string[], chosen: string[]): SurveyOptionCount[] {
  const counts = new Map<string, number>(options.map((o) => [o, 0]));
  for (const c of chosen) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts].map(([option, count]) => ({ option, count }));
}

/** Rows of a CSV file as Moodle's dataformat writes it (quoted fields may hold commas, quotes and line breaks). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Without the byte order mark Moodle starts it with.
  const body = text.startsWith(String.fromCharCode(0xfeff)) ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && body[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows;
}

/** A feedback's item as its print page shows it: what it asks and the options it offers. */
export interface FeedbackItem {
  id: number;
  type: string;
  number?: string;
  text: string;
  /** Several options can be chosen (a multichoice item of the "multiple answers" kind). */
  multiple: boolean;
  /** The options of a choice item, with their weights where it's rated. */
  options: { label: string; weight?: number }[];
}

/**
 * The items that take answers on a feedback's print page (`mod/feedback/print.php`, open to those
 * who edit items or view reports), by their element ids (`fitem_id_<type>_<id>`, `fgroup_id_group_<type>_<id>`).
 */
export function readFeedbackItems(page: Page): Promise<FeedbackItem[]> {
  return inPage(page, () => {
    interface El {
      id: string;
      value: string;
      type: string;
      className: string;
      textContent: string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
      closest(s: string): El | null;
      cloneNode(deep: boolean): El;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    // An element's text without what only screen readers get, icons, a numeric item's range and a rated option's weight.
    const text = (el: El | null | undefined) => {
      if (!el) return "";
      const copy = el.cloneNode(true);
      for (const extra of Array.from(copy.querySelectorAll(".visually-hidden, .accesshide, .icon, .boundaries, .weight, input, select"))) extra.remove();
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    };
    const items: FeedbackItem[] = [];
    for (const el of Array.from(doc.querySelectorAll(".feedback_itemlist.feedback_hasvalue"))) {
      const match = /^f(?:item|group)_id_(?:group_)?([a-z]+)_(\d+)$/.exec(el.id);
      if (!match) continue;
      const options: FeedbackItem["options"] = [];
      for (const input of Array.from(el.querySelectorAll('input[type="radio"], input[type="checkbox"]'))) {
        // A choice that isn't required offers "Not selected" (value 0): no option of the item's.
        if (input.value === "0") continue;
        const label = input.closest("label");
        const weight = /-?\d+(?:\.\d+)?/.exec(label?.querySelector(".weight")?.textContent ?? "")?.[0];
        options.push({ label: text(label), ...(weight !== undefined ? { weight: Number(weight) } : {}) });
      }
      for (const option of Array.from(el.querySelectorAll("select option"))) {
        // The empty first option ("0") is "not selected".
        if (option.value === "0" || !text(option)) continue;
        const weight = /-?\d+(?:\.\d+)?/.exec(option.querySelector(".weight")?.textContent ?? "")?.[0];
        options.push({ label: text(option), ...(weight !== undefined ? { weight: Number(weight) } : {}) });
      }
      const number = text(el.querySelector(".itemnr"));
      items.push({
        id: Number(match[2]),
        type: match[1]!,
        ...(number ? { number } : {}),
        text: text(el.querySelector(".col-form-label")),
        multiple: / multichoice-c( |$)/.test(` ${el.className}`),
        options,
      });
    }
    return items;
  }, null);
}

/** A row of a feedback's responses tables: its completed id, and who, where it isn't anonymous. */
export interface FeedbackEntry {
  id: number;
  userId?: number;
  fullName?: string;
  number?: number;
}

/**
 * The rows of a feedback's "Show responses" tables (`#showentrytable`, `#showentryanontable`): each
 * response's link (`showcompleted=<id>`, with `userid=` when named), the named ones' full name cell,
 * the anonymous ones' response number.
 */
export function readFeedbackEntries(page: Page): Promise<{ named: FeedbackEntry[]; anonymous: FeedbackEntry[] }> {
  return inPage(page, () => {
    interface El {
      href: string;
      textContent: string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const rows = (table: string) =>
      Array.from(doc.querySelectorAll(`${table} tbody tr:not(.emptyrow)`)).flatMap((row) => {
        const link = row.querySelector('a[href*="showcompleted="]');
        if (!link) return [];
        const params = new URL(link.href).searchParams;
        const profile = row.querySelector('a[href*="/user/view.php"]');
        const userId = Number(params.get("userid") ?? (profile ? new URL(profile.href).searchParams.get("id") : 0));
        const fullName = (row.querySelector("td.fullname")?.textContent ?? "").replace(/\s+/g, " ").trim();
        const number = /(\d+)\s*$/.exec(row.querySelector("td.random_response")?.textContent ?? "")?.[1];
        return [{ id: Number(params.get("showcompleted")), ...(userId ? { userId } : {}), ...(fullName ? { fullName } : {}), ...(number ? { number: Number(number) } : {}) }];
      });
    return { named: rows("#showentrytable"), anonymous: rows("#showentryanontable") };
  }, null);
}

/** Opens a feedback report page, or throws `SurveyError` with Moodle's reason. */
async function openFeedbackPage(context: BrowserContext, siteUrl: string, activityId: number, path: string, bodyId: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, path);
  const error = await moodleErrorMessage(page);
  if ((await page.locator(`body#${bodyId}`).count()) === 0 || error !== undefined) {
    await page.close().catch(() => undefined);
    throw new SurveyError(
      `Moodle didn't show the responses of feedback ${activityId}${error ? ` (Moodle says: ${error})` : ""}. Reading them takes a feedback's id (module "feedback") from the course structure and the capability mod/feedback:viewreports, which teachers have.`,
    );
  }
  return page;
}

/** A responses table's download as CSV rows (header first), as its "Download table data as" sends it. */
async function feedbackCsv(context: BrowserContext, siteUrl: string, activityId: number, param: "download" | "adownload"): Promise<string[][]> {
  const response = await siteFetch(context, new URL(`mod/feedback/show_entries.php?id=${activityId}&${param}=csv`, siteUrl).href);
  const rows = parseCsv(response.body);
  if (response.status !== 200 || /^\s*</.test(response.body) || rows.length === 0) {
    throw new SurveyError(`Moodle didn't send the responses of feedback ${activityId} as CSV (status ${response.status}). Try again, or read them on its "Show responses" page.`);
  }
  return rows;
}

async function feedbackResults(context: BrowserContext, siteUrl: string, activityId: number): Promise<SurveyResults> {
  const print = await openFeedbackPage(context, siteUrl, activityId, `mod/feedback/print.php?id=${activityId}`, "page-mod-feedback-print");
  let items: FeedbackItem[];
  try {
    items = await readFeedbackItems(print);
  } finally {
    await print.close().catch(() => undefined);
  }
  const entriesPage = await openFeedbackPage(context, siteUrl, activityId, `mod/feedback/show_entries.php?id=${activityId}&showall=1&ashowall=1`, "page-mod-feedback-show_entries");
  let entries: Awaited<ReturnType<typeof readFeedbackEntries>>;
  try {
    entries = await readFeedbackEntries(entriesPage);
  } finally {
    await entriesPage.close().catch(() => undefined);
  }

  // The tables show ten questions at most; their downloads have them all, as the last columns, in the items' order.
  const responses: SurveyResponse[] = [];
  const answers: { responseId: number; row: string[] }[] = [];
  const valuesOf = (rows: string[][]) => {
    const header = rows[0] ?? [];
    if (header.length < items.length + 1) throw new SurveyError(`The responses of feedback ${activityId} came with ${header.length} columns for ${items.length} questions: the download isn't as expected.`);
    return rows.slice(1).filter((row) => row.length === header.length);
  };
  if (entries.named.length > 0) {
    // A named row's first column is the person's full name, as in the table: matched to the table's rows by it.
    const left = [...entries.named];
    for (const row of valuesOf(await feedbackCsv(context, siteUrl, activityId, "download"))) {
      const at = left.findIndex((entry) => entry.fullName === row[0]);
      const entry = at >= 0 ? left.splice(at, 1)[0]! : left.shift();
      if (!entry) continue;
      responses.push({ id: entry.id, anonymous: false, ...(entry.userId ? { userId: entry.userId } : {}), fullName: entry.fullName ?? row[0] ?? "" });
      answers.push({ responseId: entry.id, row: row.slice(row.length - items.length) });
    }
  }
  if (entries.anonymous.length > 0) {
    // An anonymous row's first column is its response number, as in the table.
    for (const row of valuesOf(await feedbackCsv(context, siteUrl, activityId, "adownload"))) {
      const number = Number(row[0]);
      const entry = entries.anonymous.find((e) => e.number === number);
      if (!entry) continue;
      responses.push({ id: entry.id, anonymous: true, number });
      answers.push({ responseId: entry.id, row: row.slice(row.length - items.length) });
    }
  }

  const questions = items.map((item, i): SurveyResultQuestion => {
    const choice = item.options.length > 0;
    const given = answers
      .map(({ responseId, row }) => {
        const value = (row[i] ?? "").trim();
        // Several options chosen come one per line.
        return { responseId, values: value === "" ? [] : item.multiple ? value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean) : [value] };
      })
      .filter((answer) => answer.values.length > 0);
    const question: SurveyResultQuestion = { id: item.id, ...(item.number ? { number: item.number } : {}), text: item.text, type: item.type, answers: given };
    if (choice) {
      question.counts = countOptions(
        item.options.map((o) => o.label),
        given.flatMap((a) => a.values),
      );
      if (item.options.some((o) => o.weight !== undefined)) {
        const weights = new Map(item.options.map((o) => [o.label, o.weight]));
        const average = mean(given.flatMap((a) => a.values.map((v) => weights.get(v)).filter((w): w is number => w !== undefined)));
        if (average !== undefined) question.average = average;
      }
    } else if (item.type === "numeric") {
      const average = mean(given.map((a) => toNumber(a.values[0]!)).filter((n) => !Number.isNaN(n)));
      if (average !== undefined) question.average = average;
    }
    return question;
  });
  return { id: activityId, type: "feedback", responses, questions };
}

/** One question of a questionnaire's individual response page, as the response shows it. */
export interface QuestionnaireAnswer {
  id: number;
  number?: string;
  text: string;
  type: string;
  /** The options the question offers (choice questions), or a rate question's columns. */
  options: string[];
  /** The options chosen (choice questions). */
  chosen: string[];
  /** The answer as shown: options chosen (with an "other" text after a colon), the text, the number. */
  values: string[];
  /** A rate question's rows, each with the column chosen. */
  rows: { row: string; value?: string }[];
}

/**
 * The questions of a questionnaire's individual response page (`report.php?action=vresp&rid=…`):
 * each `fieldset.qn-container` (`qn-<question id>`), its answer by the response template's classes
 * (`questionnaire_<type>`, `.selected`, a rate's `table.individual`; an essay's `.response.text`).
 */
export function readQuestionnaireResponse(page: Page): Promise<QuestionnaireAnswer[]> {
  return inPage(page, () => {
    interface El {
      id: string;
      value: string;
      selected: boolean;
      className: string;
      textContent: string | null;
      classList: { contains(c: string): boolean };
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
      cloneNode(deep: boolean): El;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const text = (el: El | null | undefined) => {
      if (!el) return "";
      const copy = el.cloneNode(true);
      for (const extra of Array.from(copy.querySelectorAll(".accesshide, .visually-hidden, .response.text, input, select"))) extra.remove();
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    };
    const answers: QuestionnaireAnswer[] = [];
    for (const fieldset of Array.from(doc.querySelectorAll("fieldset.qn-container"))) {
      const answer = fieldset.querySelector(".qn-answer");
      const box = answer?.querySelector(".questionnaire_response");
      const essay = answer?.querySelector(".response.text");
      // A section text has no answer.
      if (!box && !essay) continue;
      const number = text(fieldset.querySelector(".qn-number"));
      const base = { id: Number(fieldset.id.replace("qn-", "")), ...(number ? { number } : {}), text: text(fieldset.querySelector(".qn-question")), options: [] as string[], chosen: [] as string[], values: [] as string[], rows: [] as QuestionnaireAnswer["rows"] };
      if (!box) {
        const value = (essay?.textContent ?? "").trim();
        answers.push({ ...base, type: "essay", values: value ? [value] : [] });
        continue;
      }
      const table = box.querySelector("table.individual");
      if (table) {
        const trs = Array.from(table.querySelectorAll("tr"));
        const columns = Array.from(trs[0]?.querySelectorAll("td.smalltext") ?? []).map((td) => text(td));
        const rows = trs.slice(1).map((tr) => {
          const cells = Array.from(tr.querySelectorAll("td")).filter((td) => td.querySelector("span.selected, span.unselected") !== null);
          const at = cells.findIndex((td) => td.classList.contains("selected"));
          return { row: text(tr.querySelector("td")), ...(at >= 0 && columns[at] !== undefined ? { value: columns[at] } : {}) };
        });
        answers.push({ ...base, type: "rate", options: columns, rows, values: rows.filter((r) => r.value !== undefined).map((r) => `${r.row}: ${r.value}`) });
        continue;
      }
      const type = /questionnaire_(?!response)(\w+)/.exec(box.className)?.[1] ?? "text";
      if (type === "drop") {
        const options = Array.from(box.querySelectorAll("select option")).filter((o) => o.value !== "");
        const chosen = options.filter((o) => o.selected).map((o) => text(o));
        answers.push({ ...base, type, options: options.map((o) => text(o)), chosen, values: chosen });
      } else if (type === "radio" || type === "check" || type === "yesno") {
        const spans = Array.from(box.querySelectorAll("span.selected, span.unselected"));
        const selected = spans.filter((s) => s.classList.contains("selected"));
        const chosen = selected.map((s) => text(s));
        const values = selected.map((s, i) => {
          const other = (s.querySelector(".response.text")?.textContent ?? "").trim();
          return other ? `${chosen[i]}: ${other}` : chosen[i]!;
        });
        answers.push({ ...base, type, options: spans.map((s) => text(s)), chosen, values });
      } else {
        const value = text(box.querySelector(".selected"));
        answers.push({ ...base, type, values: value ? [value] : [] });
      }
    }
    return answers;
  }, null);
}

/** A questionnaire's responses from its report's list (`report.php?action=vresp&byresponse=1`): ids, and names unless anonymous. */
export function readQuestionnaireRespondents(page: Page): Promise<SurveyResponse[]> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ href: string; title: string; textContent: string | null }> } }).document;
    // Named responses' links carry their date as a title; anonymous ones an empty title and "Response <n>".
    return Array.from(doc.querySelectorAll('.respondentscolumn a[href*="rid="]')).map((link) => {
      const id = Number(new URL(link.href).searchParams.get("rid"));
      const anonymous = link.title.trim() === "";
      return anonymous ? { id, anonymous } : { id, anonymous, fullName: (link.textContent ?? "").replace(/\s+/g, " ").trim() };
    });
  });
}

/** Opens a questionnaire's page; a site without the plugin answers with the web server's 404, not a Moodle page. */
async function openQuestionnairePage(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const path = `mod/questionnaire/view.php?id=${activityId}`;
  let page: Page;
  try {
    page = await openSitePage(context, siteUrl, path);
  } catch (error) {
    if (error instanceof MoodleError && error.code === "not-found") {
      throw new SurveyError("The questionnaire plugin (mod_questionnaire) isn't installed on this site.");
    }
    throw error;
  }
  if ((await page.locator("body#page-mod-questionnaire-view").count()) === 0) {
    await page.close().catch(() => undefined);
    throw new SurveyError(`Activity ${activityId} isn't a questionnaire you can open. Take its id and module from the course structure.`);
  }
  return page;
}

async function questionnaireResults(context: BrowserContext, siteUrl: string, activityId: number): Promise<SurveyResults> {
  const page = await openQuestionnairePage(context, siteUrl, activityId);
  try {
    // The report takes the questionnaire's instance id, which the page links to for those who can read all responses.
    const report = await page.locator('a[href*="/mod/questionnaire/report.php?instance="]').first().getAttribute("href").catch(() => null);
    const instance = report ? Number(new URL(report, siteUrl).searchParams.get("instance")) : 0;
    if (!instance) {
      throw new SurveyError(
        `Questionnaire ${activityId} doesn't link to its responses: nobody has answered it yet, or reading them takes the capability mod/questionnaire:readallresponses (teachers have it; students where the questionnaire lets them see all responses).`,
      );
    }
    const listPath = `mod/questionnaire/report.php?instance=${instance}&action=vresp&byresponse=1&group=0`;
    await page.goto(new URL(listPath, siteUrl).href, { waitUntil: "domcontentloaded" });
    const error = await moodleErrorMessage(page);
    if (error !== undefined) throw new SurveyError(`Moodle didn't show the responses of questionnaire ${activityId} (Moodle says: ${error}). Reading them takes the capability mod/questionnaire:readallresponses.`);
    const responses = await readQuestionnaireRespondents(page);

    // Each response on its own page, in the list's order; the questions as they first appear.
    const questions = new Map<number, SurveyResultQuestion & { options: string[]; chosen: string[]; rateRows: { row: string; values: string[] }[]; columns: string[] }>();
    for (const response of responses) {
      await page.goto(new URL(`mod/questionnaire/report.php?instance=${instance}&action=vresp&individualresponse=1&rid=${response.id}&group=0`, siteUrl).href, { waitUntil: "domcontentloaded" });
      const failed = await moodleErrorMessage(page);
      if (failed !== undefined) throw new SurveyError(`Moodle didn't show response ${response.id} of questionnaire ${activityId} (Moodle says: ${failed}).`);
      for (const answer of await readQuestionnaireResponse(page)) {
        let question = questions.get(answer.id);
        if (!question) {
          question = { id: answer.id, ...(answer.number ? { number: answer.number } : {}), text: answer.text, type: answer.type, answers: [], options: [], chosen: [], rateRows: [], columns: [] };
          questions.set(answer.id, question);
        }
        if (question.options.length === 0) question.options = answer.type === "rate" ? [] : answer.options;
        if (question.columns.length === 0 && answer.type === "rate") question.columns = answer.options;
        question.chosen.push(...answer.chosen);
        for (const row of answer.rows) {
          let rateRow = question.rateRows.find((r) => r.row === row.row);
          if (!rateRow) question.rateRows.push((rateRow = { row: row.row, values: [] }));
          if (row.value !== undefined) rateRow.values.push(row.value);
        }
        if (answer.values.length > 0) question.answers.push({ responseId: response.id, values: answer.values });
      }
    }

    return {
      id: activityId,
      type: "questionnaire",
      responses,
      questions: [...questions.values()].map(({ options, chosen, rateRows, columns, ...question }) => {
        if (options.length > 0) question.counts = countOptions(options, chosen);
        if (question.type === "rate") {
          // A row's average rank: the columns' own numbers (1 to 5…), or their positions when they're named.
          const numeric = columns.every((c) => !Number.isNaN(toNumber(c)));
          question.rows = rateRows.map(({ row, values }) => {
            const average = mean(values.map((v) => (numeric ? toNumber(v) : columns.indexOf(v) + 1)));
            return { row, counts: countOptions(columns, values), ...(average !== undefined ? { average } : {}) };
          });
        } else if (question.type === "numeric" || question.type === "slider") {
          const average = mean(question.answers.map((a) => toNumber(a.values[0]!)).filter((n) => !Number.isNaN(n)));
          if (average !== undefined) question.average = average;
        }
        return question;
      }),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * What people answered in a feedback or a questionnaire, as its reports show a teacher: every
 * response (who gave it, unless anonymous) and, per question, each response's answer, the counts of
 * a choice question's options (counted from the answers, as Moodle's analysis counts them) and the
 * average of numeric and rated ones. The module is found when not given.
 *
 * A feedback is read from its print page (the questions), its "Show responses" tables (who) and
 * their CSV downloads (every answer: the tables show ten questions at most); it needs
 * `mod/feedback:viewreports`. A questionnaire is read from its report's individual responses, one
 * page each (in-progress ones too, as its list shows them), and names people without their user
 * ids; it needs `mod/questionnaire:readallresponses` (students have it too, where the questionnaire
 * lets them see all responses), and its page links to the report only once someone has answered.
 * Throws `SurveyError` with Moodle's reason otherwise, or when the questionnaire plugin isn't installed.
 */
export async function surveyResults(context: BrowserContext, siteUrl: string, activityId: number, { type }: { type?: SurveyType } = {}): Promise<SurveyResults> {
  type ??= await surveyType(context, siteUrl, activityId);
  return type === "feedback" ? feedbackResults(context, siteUrl, activityId) : questionnaireResults(context, siteUrl, activityId);
}
