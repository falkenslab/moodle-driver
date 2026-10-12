// A quiz's attempts as its teacher reports show them (mod/quiz/report.php): the overview's grades and
// marks per question, and with responses, the responses report's answers. People as user id and
// full name: pseudonymizing them is the consumer's job.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { QuizError } from "./attempts.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { mapItems, numberedPage, pageWindow, paged, sliceWindow, type ListPage, type PageOptions, type PageWindow, type WithLimit, type WithoutLimit } from "../../core/paging.js";

/** An attempt at a quiz, as `quizResults` reads it from the quiz's reports. */
export interface QuizAttemptResult {
  id: number;
  userId: number;
  fullName: string;
  /** As the report shows them, in the site's language. */
  state?: string;
  started?: string;
  completed?: string;
  duration?: string;
  grade?: string;
  questions: {
    slot: number;
    /** The mark (overview) as shown; "-" left out. */
    mark?: string;
    /** The answer given, with `responses` (the responses report). */
    response?: string;
    /** How it was marked: "correct", "incorrect", "partiallycorrect", "notanswered", "requiresgrading"… */
    result?: string;
  }[];
}

/** One report page's rows: ids from inputs and links, the grade column by its class, the rest by position from it. */
export function readQuizReport(page: Page, mode: "overview" | "responses"): Promise<QuizAttemptResult[]> {
  return inPage(
    page,
    (mode: string) => {
      interface El {
        className: string;
        textContent: string | null;
        value: string;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const table = doc.querySelector("#attempts") ?? doc.querySelector("#region-main table.generaltable");
      if (!table) return [];
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      // The grade column is the bold one that isn't the name's (sticky).
      const headers = Array.from(table.querySelectorAll("thead th"));
      const gradeAt = headers.findIndex((th) => /\bbold\b/.test(th.className) && !/\bsticky-column\b/.test(th.className));
      return Array.from(table.querySelectorAll("tbody tr")).flatMap((row) => {
        const attemptId = Number(row.querySelector('input[name="attemptid[]"]')?.value);
        const user = row.querySelector('td:not(.picture) a[href*="/user/view.php?id="]');
        if (!attemptId || !user) return [];
        const cells = Array.from(row.querySelectorAll("td"));
        const at = (i: number) => (i >= 0 && cells[i] ? clean(cells[i]!.textContent) || undefined : undefined);
        const questions = cells.flatMap((cell) => {
          const link = cell.querySelector('a[href*="reviewquestion.php"]');
          const slot = Number(new URL(link?.getAttribute("href") ?? "", "http://x/").searchParams.get("slot"));
          if (!link || !slot) return [];
          const shown = link.querySelector(".que span:last-child") ?? link;
          const value = clean(shown.textContent);
          const result = (shown.className.split(/\s+/).find(Boolean) ?? "") || undefined;
          return [{ slot, ...(value && value !== "-" ? (mode === "responses" ? { response: value } : { mark: value }) : {}), ...(result ? { result } : {}) }];
        });
        // Overview: state, started, completed and duration come right before the grade; responses: the state alone.
        const before = mode === "overview" ? [4, 3, 2, 1] : [1];
        const [state, started, completed, duration] = before.map((n) => at(gradeAt - n));
        return [
          {
            id: attemptId,
            userId: Number(new URL(user.getAttribute("href") ?? "", "http://x/").searchParams.get("id")),
            fullName: clean(user.textContent),
            ...(state ? { state } : {}),
            ...(started ? { started } : {}),
            ...(completed ? { completed } : {}),
            ...(duration ? { duration } : {}),
            ...(at(gradeAt) && at(gradeAt) !== "-" ? { grade: at(gradeAt) } : {}),
            questions,
          },
        ];
      });
    },
    mode,
  );
}

const MAX_PAGES = 100;

/** One page of one of a quiz's reports; `size` (its `pagesize`, not saved as the person's preference) when given. */
async function reportPage(context: BrowserContext, siteUrl: string, activityId: number, mode: "overview" | "responses", index: number, size?: number): Promise<QuizAttemptResult[]> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/report.php?id=${activityId}&mode=${mode}&attempts=enrolled_with${size ? `&pagesize=${size}` : ""}&page=${index}`);
  try {
    if ((await page.locator("body#page-mod-quiz-report").count()) === 0 || (await moodleErrorMessage(page)) !== undefined) {
      throw new QuizError(`You can't see quiz ${activityId}'s results: ${(await moodleErrorMessage(page)) ?? "it isn't a quiz, or you aren't allowed"}`);
    }
    return await readQuizReport(page, mode);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * One of a quiz's reports in the window asked: every page, its attempts once each, or for a window
 * the one page of the report's own paging (`pagesize`, `page`) that holds it.
 */
export async function readReport(context: BrowserContext, siteUrl: string, activityId: number, mode: "overview" | "responses", window: PageWindow = { offset: 0 }): Promise<QuizAttemptResult[]> {
  if (window.count !== undefined) {
    const { size, index, skip } = numberedPage({ offset: window.offset, count: window.count });
    return sliceWindow(await reportPage(context, siteUrl, activityId, mode, index, size), { offset: skip, count: window.count });
  }
  const all = new Map<number, QuizAttemptResult>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const rows = await reportPage(context, siteUrl, activityId, mode, p);
    const fresh = rows.filter((row) => !all.has(row.id));
    if (fresh.length === 0) break;
    for (const row of fresh) all.set(row.id, row);
  }
  return sliceWindow(Array.from(all.values()), window);
}

/** A quiz's attempts, as `quizResults` reads them: the attempts are a list, or a page of them. */
export interface QuizResults<A = QuizAttemptResult[]> {
  quiz: { id: number };
  attempts: A;
}

/**
 * A quiz's attempts as its grades report shows them: per attempt the user, state, dates, grade and
 * the mark per question; with `responses`, also the answer per question from the responses report.
 * Every page of the report; with `limit`, `attempts` is a page of them in the report's order (see
 * "Long lists" in the docs' concepts), read from the one page of the report's own paging that holds it.
 */
export function quizResults(context: BrowserContext, siteUrl: string, activityId: number, options: WithLimit<QuizResultsOptions>): Promise<QuizResults<ListPage<QuizAttemptResult>>>;
export function quizResults(context: BrowserContext, siteUrl: string, activityId: number, options?: WithoutLimit<QuizResultsOptions>): Promise<QuizResults>;
export function quizResults(context: BrowserContext, siteUrl: string, activityId: number, options?: QuizResultsOptions): Promise<QuizResults<QuizAttemptResult[] | ListPage<QuizAttemptResult>>>;
export async function quizResults(context: BrowserContext, siteUrl: string, activityId: number, options: QuizResultsOptions = {}): Promise<QuizResults<QuizAttemptResult[] | ListPage<QuizAttemptResult>>> {
  const page = await paged(options, (window) => readReport(context, siteUrl, activityId, "overview", window));
  return { quiz: { id: activityId }, attempts: await mapItems(page, (attempts) => withResponses(context, siteUrl, activityId, attempts, options)) };
}

/** What `quizResults` takes: the responses too, and a page of the attempts. */
export interface QuizResultsOptions extends PageOptions {
  /** Also the answer per question, from the responses report. */
  responses?: boolean;
}

/** The attempts with their answers from the responses report when asked: the same window of it, or every page when some attempt isn't there. */
async function withResponses(context: BrowserContext, siteUrl: string, activityId: number, attempts: QuizAttemptResult[], { responses = false, limit, offset }: QuizResultsOptions): Promise<QuizAttemptResult[]> {
  if (responses && attempts.length > 0) {
    let read = await readReport(context, siteUrl, activityId, "responses", pageWindow({ limit, offset }));
    // The two reports may sort differently (each keeps the person's own sort): then every page.
    if (limit !== undefined && attempts.some((attempt) => !read.some((row) => row.id === attempt.id))) read = await readReport(context, siteUrl, activityId, "responses");
    const answered = new Map(read.map((row) => [row.id, row]));
    for (const attempt of attempts) {
      const other = answered.get(attempt.id);
      for (const question of attempt.questions) {
        const response = other?.questions.find((q) => q.slot === question.slot)?.response;
        if (response !== undefined) question.response = response;
      }
    }
  }
  return attempts;
}
