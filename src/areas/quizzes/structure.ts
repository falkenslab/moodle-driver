// What a quiz holds (its edit page's slots and pages), and filling it from a question bank as the
// edit page's "from question bank" and "a random question" actions do.
import type { BrowserContext, Page } from "playwright-core";
import { QuizError } from "./attempts.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";

export interface QuizSlot {
  /** Moodle's id for the slot, and its question number. */
  id: number;
  number?: number;
  page: number;
  /** The question's id; none for a random slot. */
  questionId?: number;
  /** The question type ("multichoice"…), "random" for a random question. */
  type: string;
  name: string;
  mark?: string;
}

/** The edit page's slots in order, each with the page it's on; read by ids, classes and links. */
export function readQuizSlots(page: Page): Promise<QuizSlot[]> {
  return page.evaluate(() => {
    interface El {
      id: string;
      className: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const slots: QuizSlot[] = [];
    let current = 0;
    for (const item of Array.from(doc.querySelectorAll("li.page, li.slot"))) {
      const page = /^page-(\d+)$/.exec(item.id);
      if (page) {
        current = Number(page[1]);
        continue;
      }
      const slotId = Number(/^slot-(\d+)$/.exec(item.id)?.[1]);
      if (!slotId) continue;
      // A random slot (a question set reference in Moodle 5) has an empty "qtype_" class (confirmed empirically, 5.2).
      const type = /\bqtype_([a-z0-9_]*)/.exec(item.className)?.[1] || "random";
      const edit = item.querySelector('a[href*="/question/bank/editquestion/question.php"]');
      const questionId = Number(new URL(edit?.getAttribute("href") ?? "", "http://x/").searchParams.get("id")) || undefined;
      const number = Number(((item.querySelector(".slotnumber.unshuffled") ?? item.querySelector(".slotnumber"))?.textContent ?? "").replace(/\D+/g, "")) || undefined;
      const mark = (item.querySelector(".instancemaxmark")?.textContent ?? "").replace(/\s+/g, " ").trim() || undefined;
      slots.push({
        id: slotId,
        ...(number ? { number } : {}),
        page: current,
        ...(questionId && type !== "random" ? { questionId } : {}),
        type,
        name: (item.querySelector(".questionname")?.textContent ?? item.querySelector(".instancename")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        ...(mark ? { mark } : {}),
      });
    }
    return slots;
  });
}

async function openEditPage(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/edit.php?cmid=${activityId}`);
  if ((await page.locator("body#page-mod-quiz-edit").count()) === 0) {
    const reason = await moodleErrorMessage(page);
    await page.close().catch(() => undefined);
    throw new QuizError(`You can't edit quiz ${activityId}: ${reason ?? "it isn't a quiz, or you aren't allowed"}.`);
  }
  return page;
}

/** A quiz's questions as its edit page lists them: slots with their page, question, type, name and mark. */
export async function quizStructure(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ quiz: { id: number }; slots: QuizSlot[] }> {
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    return { quiz: { id: activityId }, slots: await readQuizSlots(page) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Adds bank questions to a quiz by id, and random questions from a bank category, at the end or on a
 * page, as the edit page's bank actions post them. Returns the quiz's structure afterwards. A quiz
 * already attempted can't change its questions: Moodle refuses, and so does this.
 */
export async function addQuestionsToQuiz(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { questionIds = [], random, page: onPage }: { questionIds?: number[]; random?: { categoryId: number; count: number; includeSubcategories?: boolean }; page?: number },
): Promise<{ changed: string; quiz: { id: number }; slots: QuizSlot[] }> {
  if (questionIds.length === 0 && !random) throw new QuizError("Give the questions to add: their ids, or a category to draw random ones from.");
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    // The page's add menus are empty when the quiz can't change (it has attempts).
    if ((await page.locator(".add-menu-outer *").count()) === 0) {
      throw new QuizError(`Quiz ${activityId} can't change its questions now: it has attempts already. Make a new quiz, or delete its attempts in Moodle.`);
    }
    const before = (await readQuizSlots(page)).length;
    const posts: Record<string, string>[] = [];
    if (questionIds.length > 0) posts.push({ add: "1", addonpage: String(onPage ?? 0), ...Object.fromEntries(questionIds.map((id) => [`q${id}`, "1"])) });
    if (random) posts.push({ addrandom: "1", addonpage: String(onPage ?? 0), categoryid: String(random.categoryId), randomcount: String(random.count), recurse: random.includeSubcategories ? "1" : "0" });
    for (const fields of posts) {
      const status = await page.evaluate(
        async ({ fields, quizId }) => {
          const g = globalThis as unknown as {
            M: { cfg: { wwwroot: string; sesskey: string } };
            fetch(url: string, init: object): Promise<{ status: number }>;
            URLSearchParams: new (init: Record<string, string>) => unknown;
          };
          const response = await g.fetch(`${g.M.cfg.wwwroot}/mod/quiz/edit.php?cmid=${quizId}`, {
            method: "POST",
            credentials: "same-origin",
            body: new g.URLSearchParams({ ...fields, sesskey: g.M.cfg.sesskey }),
          });
          return response.status;
        },
        { fields, quizId: activityId },
      );
      if (status >= 400) throw new QuizError(`Moodle answered ${status} adding questions to quiz ${activityId}: check the questions' ids and the category.`);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    const slots = await readQuizSlots(page);
    const added = slots.length - before;
    if (added <= 0) throw new QuizError(`Moodle added no question to quiz ${activityId}: check the questions' ids (from the bank) and the category.`);
    return { changed: `Added ${added} question${added === 1 ? "" : "s"} to quiz ${activityId}.`, quiz: { id: activityId }, slots };
  } finally {
    await page.close().catch(() => undefined);
  }
}
