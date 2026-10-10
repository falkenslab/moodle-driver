// A quiz's attempts as its teacher reports show them (mod/quiz/report.php): the overview's grades and
// marks per question, and with responses, the responses report's answers. People as user id and
// full name: pseudonymizing them is the consumer's job.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "./inPage.js";
import { QuizError } from "./quiz.js";
import { moodleErrorMessage, openSitePage } from "./session.js";

export interface QuizAttemptResult {
  attemptId: number;
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
            attemptId,
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

async function readReport(context: BrowserContext, siteUrl: string, quizId: number, mode: "overview" | "responses"): Promise<QuizAttemptResult[]> {
  const all = new Map<number, QuizAttemptResult>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await openSitePage(context, siteUrl, `mod/quiz/report.php?id=${quizId}&mode=${mode}&attempts=enrolled_with&page=${p}`);
    try {
      if ((await page.locator("body#page-mod-quiz-report").count()) === 0 || (await moodleErrorMessage(page)) !== undefined) {
        throw new QuizError(`You can't see quiz ${quizId}'s results: ${(await moodleErrorMessage(page)) ?? "it isn't a quiz, or you aren't allowed"}`);
      }
      const rows = await readQuizReport(page, mode);
      const fresh = rows.filter((row) => !all.has(row.attemptId));
      if (fresh.length === 0) break;
      for (const row of fresh) all.set(row.attemptId, row);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return Array.from(all.values());
}

/**
 * A quiz's attempts as its grades report shows them: per attempt the user, state, dates, grade and
 * the mark per question; with `responses`, also the answer per question from the responses report.
 * Every page of the report.
 */
export async function quizResults(context: BrowserContext, siteUrl: string, quizId: number, { responses = false }: { responses?: boolean } = {}) {
  const attempts = await readReport(context, siteUrl, quizId, "overview");
  if (responses) {
    const answered = new Map((await readReport(context, siteUrl, quizId, "responses")).map((row) => [row.attemptId, row]));
    for (const attempt of attempts) {
      const other = answered.get(attempt.attemptId);
      for (const question of attempt.questions) {
        const response = other?.questions.find((q) => q.slot === question.slot)?.response;
        if (response !== undefined) question.response = response;
      }
    }
  }
  return { quiz: { id: quizId }, attempts };
}
