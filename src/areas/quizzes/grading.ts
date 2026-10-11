// Grading quiz questions by hand: what waits for grading (the manual grading report's list of
// questions, and the overview report's attempts in "requires grading"), and one question of one
// attempt graded through Moodle's comment form (mod/quiz/comment.php); no service open to AJAX does it.
import type { BrowserContext, Page } from "playwright-core";
import { FormError } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { QuizError } from "./attempts.js";
import { readReport } from "./results.js";

/** A question (slot) of a quiz as the manual grading report lists it, with the attempts waiting for its grade. */
export interface QuestionToGrade {
  slot: number;
  /** The question's id in the bank. */
  questionId?: number;
  name: string;
  /** The question type ("essay"…). */
  type: string;
  /** Attempts waiting for a grade, already graded by hand, and in all. */
  toGrade: number;
  graded: number;
  total: number;
  /** The finished attempts whose answer to this question requires grading. */
  attempts: { id: number; userId: number; fullName: string }[];
}

/** The manual grading report's list of questions: slot and question from its links, type from its icon, counts by column. */
export function readQuestionsToGrade(page: Page): Promise<Omit<QuestionToGrade, "attempts">[]> {
  return inPage(
    page,
    () => {
      interface El {
        textContent: string | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const count = (el: El | undefined) => Number(/\d+/.exec(el?.textContent ?? "")?.[0] ?? 0);
      return Array.from(doc.querySelectorAll("table#questionstograde tbody tr")).flatMap((row) => {
        const cells = Array.from(row.querySelectorAll("td"));
        const link = row.querySelector('a.gradetheselink[href*="slot="]');
        if (!link || cells.length < 6) return [];
        const params = new URL(link.getAttribute("href") ?? "", "http://x/").searchParams;
        const slot = Number(params.get("slot"));
        if (!slot) return [];
        const questionId = Number(params.get("qid")) || undefined;
        // Columns: number, type, name, to grade, already graded, (automatically graded,) total.
        return [
          {
            slot,
            ...(questionId ? { questionId } : {}),
            name: (cells[2]?.textContent ?? "").replace(/\s+/g, " ").trim(),
            type: /\/qtype_([a-z0-9_]+)\//.exec(cells[1]?.querySelector("img")?.getAttribute("src") ?? "")?.[1] ?? "",
            toGrade: count(cells[3]),
            graded: count(cells[4]),
            total: count(cells[cells.length - 1]),
          },
        ];
      });
    },
    null,
  );
}

/**
 * The questions of a quiz that wait for grading by hand (essays…), as its manual grading report lists
 * them, each with the finished attempts whose answer requires grading (from the results report).
 * People as user id and full name.
 */
export async function questionsToGrade(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ quiz: { id: number }; questions: QuestionToGrade[] }> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/report.php?id=${activityId}&mode=grading`);
  let listed: Omit<QuestionToGrade, "attempts">[];
  try {
    if ((await page.locator("body#page-mod-quiz-report").count()) === 0 || (await moodleErrorMessage(page)) !== undefined) {
      throw new QuizError(`You can't grade quiz ${activityId}: ${((await moodleErrorMessage(page)) ?? "it isn't a quiz, or you aren't allowed").replace(/\.$/, "")}.`);
    }
    listed = await readQuestionsToGrade(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  const waiting = listed.some((q) => q.toGrade > 0) ? await readReport(context, siteUrl, activityId, "overview") : [];
  return {
    quiz: { id: activityId },
    questions: listed.map((question) => ({
      ...question,
      attempts: waiting
        .filter((attempt) => attempt.questions.some((q) => q.slot === question.slot && q.result === "requiresgrading"))
        .map((attempt) => ({ id: attempt.id, userId: attempt.userId, fullName: attempt.fullName })),
    })),
  };
}

/**
 * Grades one question of a finished attempt by hand, with a comment, through Moodle's comment form
 * (the review's "Make comment or override mark"): an essay waiting for grading, or any question whose
 * mark the teacher overrides. The mark is in the question's points (0 to its maximum in the quiz).
 * Returns the attempt's grade afterwards when the results report shows it.
 */
export async function gradeQuizQuestion(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  slot: number,
  { mark, comment }: { mark: number; comment?: string },
): Promise<{ changed: string; attemptId: number; slot: number; mark: number; maxMark?: number; grade?: string }> {
  if (!Number.isFinite(mark)) throw new QuizError("Give the mark as a number of points.");
  const page = await openSitePage(context, siteUrl, `mod/quiz/comment.php?attempt=${attemptId}&slot=${slot}`);
  let activityId: number;
  let maxMark: number | undefined;
  try {
    if ((await page.locator("body#page-mod-quiz-comment form#manualgradingform").count()) === 0) {
      throw new QuizError(`You can't grade question ${slot} of attempt ${attemptId}: ${((await moodleErrorMessage(page)) ?? "the attempt isn't finished, the slot isn't in it, or you aren't allowed").replace(/\.$/, "")}.`);
    }
    // The course module id is in the body's classes (cmid-<id>).
    activityId = Number(/\bcmid-(\d+)\b/.exec((await page.locator("body").getAttribute("class")) ?? "")?.[1]);
    const outcome = await page.evaluate(
      async ({ mark, comment }) => {
        interface El {
          name: string;
          value: string;
          textContent: string | null;
          querySelector(s: string): El | null;
          querySelectorAll(s: string): ArrayLike<El>;
        }
        const g = globalThis as unknown as {
          document: El;
          fetch(url: string, init: object): Promise<{ status: number; text(): Promise<string> }>;
          FormData: new (form: unknown) => unknown;
          URLSearchParams: new (init: unknown) => { set(name: string, value: string): void };
          DOMParser: new () => { parseFromString(html: string, type: string): El };
        };
        const form = g.document.querySelector("form#manualgradingform") as unknown as El & { action: string };
        const fields = Array.from(form.querySelectorAll("[name]"));
        const markField = fields.find((f) => /_-mark$/.test(f.name));
        const commentField = fields.find((f) => /_-comment$/.test(f.name));
        const maxMark = fields.find((f) => /_-maxmark$/.test(f.name))?.value;
        if (!markField) return { kind: "nomark" as const };
        // Sent as the form would be, URL-encoded (it has no files).
        const data = new g.URLSearchParams(new g.FormData(form));
        data.set(markField.name, String(mark));
        if (comment !== undefined && commentField) data.set(commentField.name, comment);
        data.set("submit", "1");
        const response = await g.fetch(form.action, { method: "POST", body: data, credentials: "same-origin" });
        const answer = new g.DOMParser().parseFromString(await response.text(), "text/html");
        // A mark out of range or badly written: the form again, its mark marked as an error.
        const fieldError = (answer.querySelector(".que .comment span.error")?.textContent ?? "").replace(/\s+/g, " ").trim();
        if (fieldError) return { kind: "field" as const, message: fieldError, maxMark };
        if (answer.querySelector("form#manualgradingform")) {
          return { kind: "refused" as const, message: (answer.querySelector("#region-main .alert-danger, #region-main .alert-error")?.textContent ?? "").replace(/\s+/g, " ").trim(), maxMark };
        }
        if (response.status >= 400) return { kind: "refused" as const, message: `HTTP ${response.status}`, maxMark };
        return { kind: "saved" as const, maxMark };
      },
      { mark, comment },
    );
    if (outcome.kind === "nomark") throw new QuizError(`Question ${slot} of attempt ${attemptId} has no mark to set: it's a description, or not graded.`);
    maxMark = outcome.maxMark !== undefined ? Number(outcome.maxMark) : undefined;
    if (outcome.kind === "field") throw new FormError(`Moodle refused the mark for question ${slot} of attempt ${attemptId}:`, [{ field: "mark", message: outcome.message }]);
    if (outcome.kind === "refused") throw new QuizError(`Moodle didn't save the grade for question ${slot} of attempt ${attemptId}: ${outcome.message || "it showed the form again"}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const grade = activityId ? (await readReport(context, siteUrl, activityId, "overview").catch(() => [])).find((a) => a.id === attemptId)?.grade : undefined;
  return {
    changed: `Graded question ${slot} of attempt ${attemptId}: ${mark}${maxMark !== undefined ? ` out of ${maxMark}` : ""}${comment !== undefined ? ", with a comment" : ""}${grade ? `; the attempt's grade is now ${grade}` : ""}.`,
    attemptId,
    slot,
    mark,
    ...(maxMark !== undefined ? { maxMark } : {}),
    ...(grade ? { grade } : {}),
  };
}
