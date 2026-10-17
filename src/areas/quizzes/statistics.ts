// A quiz's statistics report (mod/quiz/report.php?mode=statistics): the quiz's figures, each
// question's analysis, and with responses, how often each response was given. Moodle computes the
// report when it's opened and has nothing stored, and keeps it until "Recalculate now" or its ad hoc
// task (queued an hour after an attempt is submitted or deleted) clears it. Nobody is named in it.
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { inPage } from "../../core/inPage.js";
import { fetchSitePage, moodleErrorMessage, openSitePage, readMoodleConfig } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { QuizError } from "./attempts.js";

/** Which attempts the statistics are calculated from, as the report's "Calculate statistics from" offers. */
export type QuizStatisticsAttempts = "highest" | "all" | "first" | "last";

// The report's `whichattempts`: Moodle's grading method constants (QUIZ_GRADEHIGHEST…).
const WHICH: Record<QuizStatisticsAttempts, string> = { highest: "1", all: "2", first: "3", last: "4" };

/** The quiz's figures, as the report shows them (percentages with their sign, in the site's format). */
export interface QuizStatisticsFigures {
  firstAttemptsCount?: number;
  allAttemptsCount?: number;
  firstAttemptsAverage?: string;
  allAttemptsAverage?: string;
  lastAttemptsAverage?: string;
  highestAttemptsAverage?: string;
  /** These, for the attempts the statistics come from. */
  median?: string;
  standardDeviation?: string;
  skewness?: string;
  kurtosis?: string;
  /** Cronbach's alpha: "Coefficient of internal consistency". */
  internalConsistency?: string;
  errorRatio?: string;
  standardError?: string;
}

/** One question's analysis (or a sub-question's, or a variant's), as the report shows it; a figure Moodle leaves blank is left out. */
export interface QuizQuestionStatistics {
  /** The question's number in the quiz as shown ("1", or "i" for a description). */
  number?: string;
  name: string;
  /** The question type (`truefalse`, `multichoice`, `random`…), from its icon. */
  type?: string;
  /** The question's id in the bank; none for a random slot. */
  questionId?: number;
  /** The variant, for a question with variants. */
  variant?: number;
  /** How many attempts the figures come from ("1 - 3" for a range of parts). */
  attempts?: string;
  facility?: string;
  standardDeviation?: string;
  randomGuessScore?: string;
  intendedWeight?: string;
  effectiveWeight?: string;
  discriminationIndex?: string;
  discriminativeEfficiency?: string;
  /** Moodle marks it as possibly not pulling its weight (discriminative efficiency under 15%). */
  dubious?: true;
  /** How often each response was given, with `responses`; none for a type Moodle doesn't analyse (an essay). */
  responses?: QuizResponseCount[];
}

/** A slot of the quiz in the statistics report: its question, and the questions a random slot drew or the variants it was asked in. */
export interface QuizSlotStatistics extends QuizQuestionStatistics {
  slot: number;
  /** The sub-questions of a random slot and the variants, each with its own figures. */
  parts?: QuizQuestionStatistics[];
}

/** One row of a question's "Analysis of responses": a response and how often it was given. */
export interface QuizResponseCount {
  /** The part of the question, for one with several (a matching or cloze question). */
  part?: string;
  /** The model response (the class the responses fall in), when the type has several. */
  model?: string;
  /** The response given, as shown. */
  response?: string;
  /** The credit it earns, as shown ("100.00%"). */
  credit?: string;
  count: number;
  /** The count per try, when the quiz allows several tries at a question. */
  tries?: number[];
  /** Its share of the attempts, as shown. */
  frequency?: string;
}

/** A quiz's statistics report, as `quizStatistics` reads it. */
export interface QuizStatistics {
  quiz: { id: number };
  /** The attempts the figures come from: the quiz's grading method unless asked otherwise. */
  attempts?: QuizStatisticsAttempts;
  /** Moodle calculated the figures for this read: it had none stored, or `recalculate` cleared them (its report then shows no "Last calculated"). */
  calculatedNow: boolean;
  /** Otherwise, when Moodle calculated what it stored, as the report says it ("3 days 5 hours" ago), and the attempts finished since. */
  calculated?: { ago: string; attemptsSince: number };
  figures: QuizStatisticsFigures;
  questions: QuizSlotStatistics[];
}

/** What `quizStatistics` takes. */
export interface QuizStatisticsOptions {
  /** The attempts to calculate from; the quiz's grading method by default, as the report. */
  attempts?: QuizStatisticsAttempts;
  /** Clear what Moodle has stored and calculate it again now ("Recalculate now"), for attempts finished since. */
  recalculate?: boolean;
  /** Also each question's analysis of responses, from its own page (one page per question, sub-question and variant). */
  responses?: boolean;
}

/** One page of the report, as it is: the settings form, the info table, the caching notice and the tables' cells by column. */
export interface StatisticsPage {
  which?: string;
  whichText?: string;
  info?: [string, string][];
  notice?: string;
  rows?: StatisticsRow[];
  responses?: { headers: string[]; numeric: boolean[]; rows: string[][] };
}

/** A row of the questions' table: its cells by Moodle's column name, its links' ids. */
export interface StatisticsRow {
  className: string;
  cells: Record<string, string>;
  href?: string;
  editId?: number;
  type?: string;
  dubious: boolean;
}

/** Reads a statistics page by its structure: tables by id and class, the questions' columns by their `data-column`. */
export function readStatisticsPage(page: Page): Promise<StatisticsPage> {
  return inPage(
    page,
    () => {
      interface El {
        className: string;
        textContent: string | null;
        value: string;
        selectedIndex: number;
        options: ArrayLike<El>;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        cloneNode(deep: boolean): El;
        remove(): void;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const main = doc.querySelector("#region-main") ?? doc;
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const result: StatisticsPage = {};
      const select = main.querySelector('select[name="whichattempts"]');
      if (select) {
        result.which = select.value;
        result.whichText = clean(select.options[select.selectedIndex]?.textContent);
      }
      // The quiz information: the first label/value table (a question's page has its own instead).
      const info = main.querySelector("table.titlesleft");
      if (info) result.info = Array.from(info.querySelectorAll("tr")).map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => clean(td.textContent)) as [string, string]);
      const notice = main.querySelector("#cachingnotice");
      if (notice) {
        const copy = notice.cloneNode(true);
        for (const button of Array.from(copy.querySelectorAll(".singlebutton, form"))) button.remove();
        result.notice = clean(copy.textContent);
      }
      const table = main.querySelector("table#questionstatistics");
      if (table) {
        const columns = Array.from(table.querySelectorAll("thead th")).map((th) => th.querySelector("[data-column]")?.getAttribute("data-column") ?? "");
        result.rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
          const tds = Array.from(tr.querySelectorAll("td"));
          const cells: Record<string, string> = {};
          tds.forEach((td, i) => {
            if (columns[i]) cells[columns[i]!] = clean(td.textContent);
          });
          const at = (column: string) => tds[columns.indexOf(column)];
          const link = at("name")?.querySelector("a[href]");
          const edit = at("actions")?.querySelector('a.questioneditbutton[href], a.preview[href]');
          const icon = at("icon")?.querySelector("img[src]");
          const type = /\/qtype_([a-z0-9_]+)\//.exec(icon?.getAttribute("src") ?? "")?.[1];
          const editId = Number(new URL(edit?.getAttribute("href") ?? "http://x/", "http://x/").searchParams.get("id"));
          return {
            className: tr.className,
            cells,
            ...(link ? { href: link.getAttribute("href")! } : {}),
            ...(editId ? { editId } : {}),
            ...(type ? { type } : {}),
            dubious: Boolean(at("name")?.querySelector(".dubious")),
          };
        });
      }
      const analysis = main.querySelector("table.quizresponseanalysis");
      if (analysis) {
        const ths = Array.from(analysis.querySelectorAll("thead th"));
        result.responses = {
          headers: ths.map((th) => clean(th.textContent)),
          numeric: ths.map((th) => /\bnumcol\b/.test(th.className)),
          rows: Array.from(analysis.querySelectorAll("tbody tr"))
            .filter((tr) => !/\bemptyrow\b/.test(tr.className))
            .map((tr) => Array.from(tr.querySelectorAll("td")).map((td) => clean(td.textContent))),
        };
      }
      return result;
    },
    undefined,
  );
}

// The quiz information's labels: Moodle's strings (quiz_statistics), some for the attempts the figures come from.
const FIGURES: [string, keyof QuizStatisticsFigures, boolean][] = [
  ["firstattemptscount", "firstAttemptsCount", false],
  ["allattemptscount", "allAttemptsCount", false],
  ["firstattemptsavg", "firstAttemptsAverage", false],
  ["allattemptsavg", "allAttemptsAverage", false],
  ["lastattemptsavg", "lastAttemptsAverage", false],
  ["highestattemptsavg", "highestAttemptsAverage", false],
  ["median", "median", true],
  ["standarddeviation", "standardDeviation", true],
  ["skewness", "skewness", true],
  ["kurtosis", "kurtosis", true],
  ["cic", "internalConsistency", true],
  ["errorratio", "errorRatio", true],
  ["standarderror", "standardError", true],
];
const AGO = "@@ago@@";
const SINCE = "@@since@@";
const PART_HEADERS = { partofquestion: "part", modelresponse: "model", actualresponse: "response", response: "response" } as const;

/** Moodle's strings the report's labels are made of, in the person's language. */
export interface StatisticsStrings {
  figures: Map<string, keyof QuizStatisticsFigures>;
  lastCalculated?: string;
  headers: Map<string, "part" | "model" | "response">;
}

async function statisticsStrings(context: BrowserContext, siteUrl: string, whichText: string | undefined): Promise<StatisticsStrings> {
  const asked = [
    ...FIGURES.filter(([, , param]) => !param || whichText !== undefined).map(([stringid, , param]) => ({ stringid, component: "quiz_statistics", ...(param ? { stringparams: [{ value: whichText }] } : {}) })),
    { stringid: "lastcalculated", component: "quiz_statistics", stringparams: [{ name: "lastcalculated", value: AGO }, { name: "count", value: SINCE }] },
    ...Object.keys(PART_HEADERS).map((stringid) => ({ stringid, component: "quiz_statistics" })),
  ];
  const strings = await callService<{ stringid: string; string: string }[]>(context, siteUrl, "core_get_strings", { strings: asked });
  const text = (id: string) => strings.find((s) => s.stringid === id)?.string;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const figures = new Map<string, keyof QuizStatisticsFigures>();
  for (const [id, key] of FIGURES) {
    const label = text(id);
    if (label !== undefined) figures.set(norm(label), key);
  }
  const headers = new Map<string, "part" | "model" | "response">();
  for (const [id, kind] of Object.entries(PART_HEADERS)) {
    const label = text(id);
    if (label !== undefined) headers.set(norm(label), kind);
  }
  const lastCalculated = text("lastcalculated");
  return { figures, headers, ...(lastCalculated !== undefined ? { lastCalculated: norm(lastCalculated) } : {}) };
}

/** The quiz's figures from the information table, each label matched against Moodle's own string. */
export function figuresFrom(info: [string, string][], strings: StatisticsStrings): QuizStatisticsFigures {
  const figures: QuizStatisticsFigures = {};
  for (const [label, value] of info) {
    const key = strings.figures.get(label);
    if (!key || value === "") continue;
    if (key === "firstAttemptsCount" || key === "allAttemptsCount") figures[key] = Number(value);
    else figures[key] = value;
  }
  return figures;
}

/** "Last calculated … ago there have been N attempts since then", read with Moodle's own sentence. */
export function calculatedFrom(notice: string | undefined, strings: StatisticsStrings): QuizStatistics["calculated"] {
  if (notice === undefined || strings.lastCalculated === undefined) return undefined;
  const pattern = strings.lastCalculated.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(AGO, "(.+?)").replace(SINCE, "(\\d+)");
  const match = new RegExp(`^${pattern}$`).exec(notice);
  return match ? { ago: match[1]!, attemptsSince: Number(match[2]) } : undefined;
}

const STATS: [string, keyof QuizQuestionStatistics][] = [
  ["s", "attempts"],
  ["facility", "facility"],
  ["sd", "standardDeviation"],
  ["random_guess_score", "randomGuessScore"],
  ["intended_weight", "intendedWeight"],
  ["effective_weight", "effectiveWeight"],
  ["discrimination_index", "discriminationIndex"],
  ["discriminative_efficiency", "discriminativeEfficiency"],
];

/** A row's question: its figures by column, the ids from its links (`qid`, `variant`) and its edit link. */
export function questionFrom(row: StatisticsRow): QuizQuestionStatistics {
  const params = new URL(row.href ?? "http://x/", "http://x/").searchParams;
  const qid = Number(params.get("qid"));
  const variant = params.get("variant");
  const questionId = qid || row.editId;
  const question: QuizQuestionStatistics = {
    ...(row.cells.number ? { number: row.cells.number } : {}),
    name: row.cells.name ?? "",
    ...(row.type ? { type: row.type } : {}),
    ...(questionId ? { questionId } : {}),
    ...(variant !== null && variant !== "" ? { variant: Number(variant) } : {}),
  };
  for (const [column, key] of STATS) {
    const value = row.cells[column];
    if (value) (question as unknown as Record<string, string>)[key] = value;
  }
  if (row.dubious) question.dubious = true;
  return question;
}

/** A question's row, with the slot its link (or its summary row's) names, and whether a summary row says it has parts. */
interface QuestionRow {
  row: StatisticsRow;
  slot?: number;
  summarized: boolean;
}

/**
 * The rows that are questions: not the hidden spacers, the separators or the summaries of a slot's
 * parts. A random slot's row, or one with variants, has no link (confirmed empirically, Moodle 5.2):
 * its summary row, right after, links to the slot's page.
 */
function questionRows(rows: StatisticsRow[]): QuestionRow[] {
  const slotOf = (href: string | undefined) => Number(new URL(href ?? "http://x/", "http://x/").searchParams.get("slot")) || undefined;
  const out: QuestionRow[] = [];
  for (const row of rows) {
    if (/\b(d-none|hidden|emptyrow)\b/.test(row.className) || Object.values(row.cells).every((cell) => cell === "")) continue;
    if (/\bquiz_statistics-summaryrow\b/.test(row.className)) {
      const last = out.at(-1);
      if (last) {
        last.summarized = true;
        last.slot ??= slotOf(row.href);
      }
      continue;
    }
    const slot = slotOf(row.href);
    out.push({ row, ...(slot ? { slot } : {}), summarized: false });
  }
  return out;
}

/** The analysis of responses' rows: the text columns by Moodle's headers, the credit, the counts and the frequency by position among the numeric ones. */
export function responsesFrom(table: NonNullable<StatisticsPage["responses"]>, strings: StatisticsStrings): QuizResponseCount[] {
  const firstNumeric = table.numeric.indexOf(true);
  const lastNumeric = table.numeric.lastIndexOf(true);
  if (firstNumeric < 0) return [];
  const kinds = table.headers.slice(0, firstNumeric).map((header) => strings.headers.get(header) ?? "response");
  const counts = Array.from({ length: Math.max(0, lastNumeric - firstNumeric - 1) }, (_, i) => firstNumeric + 1 + i);
  const carried: Partial<Record<"part" | "model", string>> = {};
  const out: QuizResponseCount[] = [];
  for (const cells of table.rows) {
    if (cells.every((cell) => cell === "")) continue;
    const row: QuizResponseCount = { count: 0 };
    kinds.forEach((kind, i) => {
      // Moodle leaves a part or model response blank where it repeats the row above.
      const value = cells[i] || (kind !== "response" ? carried[kind] : undefined);
      if (!value) return;
      row[kind] = value;
      if (kind !== "response") carried[kind] = value;
    });
    if (cells[firstNumeric]) row.credit = cells[firstNumeric];
    const numbers = counts.map((i) => Number(cells[i]) || 0);
    row.count = numbers.reduce((a, b) => a + b, 0);
    if (counts.length > 1) row.tries = numbers;
    if (lastNumeric > firstNumeric && cells[lastNumeric]) row.frequency = cells[lastNumeric];
    out.push(row);
  }
  return out;
}

const NOT_ALLOWED = (id: number, why: string) =>
  new QuizError(`You can't see quiz ${id}'s statistics: ${why}. The statistics report takes the capability quiz/statistics:view (a teacher's, in the quiz's course).`);

/** One page of the report, read; refused when it isn't the report (not a quiz, not allowed). */
async function statisticsPage(context: BrowserContext, siteUrl: string, activityId: number, path: string): Promise<StatisticsPage> {
  const page = await openSitePage(context, siteUrl, path);
  try {
    if ((await page.locator("body#page-mod-quiz-report").count()) === 0 || (await moodleErrorMessage(page)) !== undefined) {
      throw NOT_ALLOWED(activityId, (await moodleErrorMessage(page)) ?? "it isn't a quiz, or you aren't allowed");
    }
    return await readStatisticsPage(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * A quiz's statistics report: the quiz's figures (attempts, averages, median, standard deviation,
 * skewness, kurtosis, internal consistency, error ratio, standard error) and per question its
 * facility index, standard deviation, weights, discrimination index and efficiency; a random slot's
 * questions and a question's variants each with their own; with `responses`, how often each response
 * was given. Figures as the report shows them. Moodle calculates the report when it's opened with
 * nothing stored (confirmed empirically, Moodle 5.2), so a read never waits for its scheduled task;
 * what it stored stays until `recalculate` (or Moodle's own recalculation, an hour after an attempt):
 * `calculatedNow` and `calculated` say which, how old and how many attempts finished since. Throws `QuizError` when the
 * person can't see the report (it takes `quiz/statistics:view`), the activity isn't a quiz, it has no
 * questions, or no attempt is finished and graded (attempts waiting for manual grading don't count).
 */
export async function quizStatistics(context: BrowserContext, siteUrl: string, activityId: number, options: QuizStatisticsOptions = {}): Promise<QuizStatistics> {
  if (options.attempts !== undefined && !(options.attempts in WHICH)) throw new MoodleError(`attempts must be one of ${Object.keys(WHICH).join(", ")}.`, "invalid-input");
  const base = `mod/quiz/report.php?id=${activityId}&mode=statistics${options.attempts ? `&whichattempts=${WHICH[options.attempts]}` : ""}`;
  let path = base;
  if (options.recalculate) {
    // As the report's "Recalculate now" button: Moodle clears what it stored and sends to the report, which calculates it again.
    const { html } = await fetchSitePage(context, siteUrl, "user/preferences.php", { follow: false });
    const sesskey = readMoodleConfig(html)?.sesskey;
    if (typeof sesskey === "string") path = `${base}&recalculate=1&sesskey=${encodeURIComponent(sesskey)}`;
  }
  const main = await statisticsPage(context, siteUrl, activityId, path);
  if (!main.info) throw new QuizError(`Quiz ${activityId} shows no statistics: it has no questions, or Moodle is still calculating them (try again later).`);
  if (!main.rows) throw new QuizError(`Quiz ${activityId} has no finished, graded attempts${options.attempts ? ` (${options.attempts})` : ""} to calculate statistics from: attempts waiting for manual grading don't count.`);
  const strings = await statisticsStrings(context, siteUrl, main.whichText);
  const attempts = (Object.keys(WHICH) as QuizStatisticsAttempts[]).find((key) => WHICH[key] === main.which);
  const calculated = calculatedFrom(main.notice, strings);
  const questions: QuizSlotStatistics[] = [];
  for (const { row, slot, summarized } of questionRows(main.rows)) {
    if (!slot) continue;
    const entry: QuizSlotStatistics = { slot, ...questionFrom(row) };
    // A random slot or a question with variants: its page lists the slot first, then its parts, each
    // linking to its own analysis (a sub-question with variants doesn't: its variants do).
    let partLinks: (string | undefined)[] = [];
    if (summarized) {
      const parts = questionRows((await statisticsPage(context, siteUrl, activityId, `${base}&slot=${slot}`)).rows ?? []).slice(1);
      entry.parts = parts.map(({ row: r }) => questionFrom(r));
      partLinks = parts.map(({ row: r }) => r.href);
      // Moodle 5.2 draws a random slot with the missing type's icon (confirmed empirically): its parts are the questions it drew.
      if (partLinks.some((href) => href && new URL(href, siteUrl).searchParams.has("qid"))) entry.type = "random";
    }
    if (options.responses) {
      if (entry.parts) {
        for (const [i, href] of partLinks.entries()) {
          if (!href) continue;
          const query = new URL(href, siteUrl).searchParams;
          const target = `${base}${query.has("qid") ? `&qid=${query.get("qid")}` : `&slot=${slot}`}${query.has("variant") ? `&variant=${query.get("variant")}` : ""}`;
          const read = await statisticsPage(context, siteUrl, activityId, target);
          if (read.responses) entry.parts[i]!.responses = responsesFrom(read.responses, strings);
        }
      } else {
        const read = await statisticsPage(context, siteUrl, activityId, `${base}&slot=${slot}`);
        if (read.responses) entry.responses = responsesFrom(read.responses, strings);
      }
    }
    questions.push(entry);
  }
  return {
    quiz: { id: activityId },
    ...(attempts ? { attempts } : {}),
    calculatedNow: main.notice === undefined,
    ...(calculated ? { calculated } : {}),
    figures: figuresFrom(main.info, strings),
    questions,
  };
}
