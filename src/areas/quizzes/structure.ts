// What a quiz holds (its edit page's sections, slots and pages), filling it from a question bank as
// the edit page's "from question bank" and "a random question" actions do, and changing it as the
// edit page does: its own requests to edit_rest.php (move, delete, page breaks, section headings),
// edit.php's posts (repaginate, add a section) and the slots' service (maximum marks).
import type { BrowserContext, Page } from "playwright-core";
import { QuizError } from "./attempts.js";
import { callService } from "../../core/ajax.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";

/** A place for a question in a quiz, as `quizStructure` reads it from the quiz's edit page. */
export interface QuizSlot {
  /** Moodle's id for the slot. */
  id: number;
  /** The slot's place in the quiz, from 1: what the other functions take as `slot`. */
  slot: number;
  /** The question's number as shown (descriptions have none). */
  number?: number;
  page: number;
  /** The question's id; none for a random slot. */
  questionId?: number;
  /** The question type ("multichoice"…), "random" for a random question. */
  type: string;
  name: string;
  mark?: string;
}

/** A section of a quiz: a heading before a group of pages, whose questions may be shuffled. */
export interface QuizSection {
  id: number;
  /** Empty for an untitled section (the first one, by default). */
  heading: string;
  /** The slot it starts at. */
  firstSlot: number;
  shuffle: boolean;
}

/** The edit page's sections and slots in order, each slot with the page it's on; read by ids, classes and links. */
export function readQuizEditor(page: Page): Promise<{ sections: QuizSection[]; slots: QuizSlot[] }> {
  return page.evaluate(() => {
    interface El {
      id: string;
      className: string;
      checked: boolean;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const slots: QuizSlot[] = [];
    const sections: QuizSection[] = [];
    let current = 0;
    for (const item of Array.from(doc.querySelectorAll("li.section, li.page, li.slot"))) {
      const section = /^section-(\d+)$/.exec(item.id);
      if (section) {
        const title = item.querySelector(".instancesection");
        sections.push({
          id: Number(section[1]),
          // An untitled section's heading is a hidden placeholder in the site's language.
          heading: title && !/\bvisually-hidden\b/.test(title.className) ? (title.textContent ?? "").replace(/\s+/g, " ").trim() : "",
          firstSlot: slots.length + 1,
          shuffle: item.querySelector(`#shuffle-${section[1]}`)?.checked ?? false,
        });
        continue;
      }
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
        slot: slots.length + 1,
        ...(number ? { number } : {}),
        page: current,
        ...(questionId && type !== "random" ? { questionId } : {}),
        type,
        name: (item.querySelector(".questionname")?.textContent ?? item.querySelector(".instancename")?.textContent ?? "").replace(/\s+/g, " ").trim(),
        ...(mark ? { mark } : {}),
      });
    }
    // A section placed after the last slot would start nowhere: keep the ones that start at a slot.
    return { sections: sections.filter((s) => s.firstSlot <= slots.length), slots };
  });
}

/** The edit page's slots in order, each with the page it's on. */
export async function readQuizSlots(page: Page): Promise<QuizSlot[]> {
  return (await readQuizEditor(page)).slots;
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

/** A quiz's questions as its edit page lists them: slots with their page, question, type, name and mark, and its sections. */
export async function quizStructure(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] }> {
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    const { slots, sections } = await readQuizEditor(page);
    return { quiz: { id: activityId }, slots, sections };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The edit page's add menus are empty when the quiz can't change (it has attempts): Moodle's notice says why. */
async function checkEditable(page: Page, activityId: number): Promise<void> {
  if ((await page.locator(".add-menu-outer *").count()) > 0) return;
  const notice = ((await page.locator(".statusdisplay").first().textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim();
  throw new QuizError(`Quiz ${activityId} can't change its questions now: ${notice || "it has attempts already"}. Make a new quiz, or delete its attempts in Moodle.`);
}

/** Posts to the edit page as its forms do (adding, repaginating); Moodle redirects back to it, or shows an error. */
async function postEditPage(page: Page, activityId: number, fields: Record<string, string>): Promise<{ status: number; error?: string }> {
  return page.evaluate(
    async ({ fields, quizId }) => {
      const g = globalThis as unknown as {
        M: { cfg: { wwwroot: string; sesskey: string } };
        fetch(url: string, init: object): Promise<{ status: number; text(): Promise<string> }>;
        URLSearchParams: new (init: Record<string, string>) => unknown;
        DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): { textContent: string | null } | null } };
      };
      const response = await g.fetch(`${g.M.cfg.wwwroot}/mod/quiz/edit.php?cmid=${quizId}`, {
        method: "POST",
        credentials: "same-origin",
        body: new g.URLSearchParams({ ...fields, sesskey: g.M.cfg.sesskey }),
      });
      const answer = new g.DOMParser().parseFromString(await response.text(), "text/html");
      const error = (answer.querySelector('[data-rel="fatalerror"] .errormessage')?.textContent ?? "").replace(/\s+/g, " ").trim();
      return { status: response.status, ...(error ? { error } : {}) };
    },
    { fields, quizId: activityId },
  );
}

/** The quiz's instance id, which the edit page's own requests carry (its toolboxes' settings). */
async function quizInstanceId(page: Page, activityId: number): Promise<number> {
  const html = await page.content();
  const id = Number(/"quizid":"?(\d+)/.exec(html)?.[1]);
  if (!id) throw new QuizError(`Quiz ${activityId}'s edit page doesn't say which quiz it is: Moodle's page isn't what the driver expects.`);
  return id;
}

/** One of the edit page's requests to edit_rest.php, with the sesskey and the quiz; throws Moodle's error as a `QuizError`. */
async function editRest(page: Page, quizId: number, activityId: number, fields: Record<string, string | number>): Promise<unknown> {
  const answer = await page.evaluate(
    async ({ fields, quizId }) => {
      const g = globalThis as unknown as {
        M: { cfg: { wwwroot: string; sesskey: string } };
        fetch(url: string, init: object): Promise<{ status: number; text(): Promise<string> }>;
        URLSearchParams: new (init: Record<string, string>) => unknown;
      };
      const body: Record<string, string> = { sesskey: g.M.cfg.sesskey, quizid: String(quizId) };
      for (const [key, value] of Object.entries(fields)) body[key] = String(value);
      const response = await g.fetch(`${g.M.cfg.wwwroot}/mod/quiz/edit_rest.php`, { method: "POST", credentials: "same-origin", body: new g.URLSearchParams(body) });
      return { status: response.status, text: await response.text() };
    },
    { fields, quizId },
  );
  let json: unknown;
  try {
    json = JSON.parse(answer.text);
  } catch {
    throw new QuizError(`Moodle didn't change quiz ${activityId}: its answer (HTTP ${answer.status}) isn't the edit page's JSON.`);
  }
  const error = (json as { error?: string } | null)?.error;
  if (error) throw new QuizError(`Moodle didn't change quiz ${activityId}: ${error.replace(/\.$/, "")}.`);
  return json;
}

function slotAt(slots: QuizSlot[], slot: number, activityId: number): QuizSlot {
  const found = slots.find((s) => s.slot === slot);
  if (!found) throw new QuizError(`Quiz ${activityId} has no slot ${slot}: it has ${slots.length} (see its structure).`);
  return found;
}

/** What a change to a quiz's structure answers: what changed, and the quiz's slots and sections afterwards. */
export type QuizChange = { changed: string; quiz: { id: number }; slots: QuizSlot[]; sections: QuizSection[] };

async function afterChange(page: Page, activityId: number, changed: string): Promise<QuizChange> {
  await page.reload({ waitUntil: "domcontentloaded" });
  const { slots, sections } = await readQuizEditor(page);
  return { changed, quiz: { id: activityId }, slots, sections };
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
): Promise<QuizChange> {
  if (questionIds.length === 0 && !random) throw new QuizError("Give the questions to add: their ids, or a category to draw random ones from.");
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    await checkEditable(page, activityId);
    const before = (await readQuizSlots(page)).length;
    const posts: Record<string, string>[] = [];
    if (questionIds.length > 0) posts.push({ add: "1", addonpage: String(onPage ?? 0), ...Object.fromEntries(questionIds.map((id) => [`q${id}`, "1"])) });
    if (random) posts.push({ addrandom: "1", addonpage: String(onPage ?? 0), categoryid: String(random.categoryId), randomcount: String(random.count), recurse: random.includeSubcategories ? "1" : "0" });
    for (const fields of posts) {
      const { status } = await postEditPage(page, activityId, fields);
      if (status >= 400) throw new QuizError(`Moodle answered ${status} adding questions to quiz ${activityId}: check the questions' ids and the category.`);
    }
    const result = await afterChange(page, activityId, "");
    const added = result.slots.length - before;
    if (added <= 0) throw new QuizError(`Moodle added no question to quiz ${activityId}: check the questions' ids (from the bank) and the category.`);
    return { ...result, changed: `Added ${added} question${added === 1 ? "" : "s"} to quiz ${activityId}.` };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Changes one slot of a quiz (by its place, from 1): its maximum mark, through the slots' service,
 * and where it is, as dragging it on the edit page does: after another slot (`moveAfter`, 0 for
 * first) and on a page. Moodle lets the mark change after attempts (it regrades them), not the rest.
 */
export async function editQuizSlot(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  slot: number,
  { maxMark, moveAfter, page: toPage }: { maxMark?: number; moveAfter?: number; page?: number },
): Promise<QuizChange> {
  if (maxMark === undefined && moveAfter === undefined && toPage === undefined) throw new QuizError("Give what to change in the slot: maxMark, moveAfter or page.");
  if (maxMark !== undefined && !(Number.isFinite(maxMark) && maxMark >= 0)) throw new QuizError("The maximum mark is a number of points, 0 or more.");
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    const quizId = await quizInstanceId(page, activityId);
    const { slots } = await readQuizEditor(page);
    const moving = slotAt(slots, slot, activityId);
    const done: string[] = [];
    if (moveAfter !== undefined || toPage !== undefined) {
      await checkEditable(page, activityId);
      // Staying in place unless moved: after the slot before it.
      const after = moveAfter ?? slot - 1;
      const previous = after > 0 ? slotAt(slots, after, activityId) : undefined;
      if (previous?.id === moving.id) throw new QuizError(`Slot ${slot} can't move after itself.`);
      // Moodle takes a page from the previous slot's to the next one's; by default the previous slot's.
      const target = toPage ?? previous?.page ?? 1;
      await editRest(page, quizId, activityId, { class: "resource", field: "move", id: moving.id, previousid: previous?.id ?? 0, page: target });
      done.push(moveAfter !== undefined ? `moved slot ${slot} ${after === 0 ? "first" : `after slot ${after}`}${toPage !== undefined ? `, on page ${toPage}` : ""}` : `moved slot ${slot} to page ${toPage}`);
    }
    if (maxMark !== undefined) {
      await callService(context, siteUrl, "mod_quiz_update_slots", { quizid: quizId, slots: [{ id: moving.id, maxmark: maxMark }] });
      done.push(`set the maximum mark of question "${moving.name}" to ${maxMark}`);
    }
    return await afterChange(page, activityId, `In quiz ${activityId}: ${done.join("; ")}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Removes a slot (by its place, from 1) from a quiz, as the edit page's delete icon does; the question stays in its bank. */
export async function removeQuizSlot(context: BrowserContext, siteUrl: string, activityId: number, slot: number): Promise<QuizChange> {
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    await checkEditable(page, activityId);
    const quizId = await quizInstanceId(page, activityId);
    const removed = slotAt(await readQuizSlots(page), slot, activityId);
    // The edit page simulates a DELETE request with this parameter.
    await editRest(page, quizId, activityId, { class: "resource", action: "DELETE", id: removed.id });
    return await afterChange(page, activityId, `Removed slot ${slot} ("${removed.name}") from quiz ${activityId}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Sets a quiz's pages: `perPage` questions a page (0 for all on one), as the edit page's
 * "Repaginate" does, or page breaks exactly after the given slots (and nowhere else), as its page
 * break icons do one by one.
 */
export async function setQuizPages(context: BrowserContext, siteUrl: string, activityId: number, pages: { perPage: number } | { breaksAfter: number[] }): Promise<QuizChange> {
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    await checkEditable(page, activityId);
    if ("perPage" in pages) {
      if (!(Number.isInteger(pages.perPage) && pages.perPage >= 0)) throw new QuizError("perPage is a whole number of questions, 0 for all on one page.");
      const { status, error } = await postEditPage(page, activityId, { repaginate: "1", questionsperpage: String(pages.perPage) });
      if (error || status >= 400) throw new QuizError(`Moodle didn't repaginate quiz ${activityId}: ${error ?? `HTTP ${status}`}.`);
      return await afterChange(page, activityId, `Repaginated quiz ${activityId}: ${pages.perPage ? `${pages.perPage} question${pages.perPage === 1 ? "" : "s"} a page` : "all questions on one page"}.`);
    }
    const quizId = await quizInstanceId(page, activityId);
    const slots = await readQuizSlots(page);
    for (const after of pages.breaksAfter) {
      if (after < 1 || after >= slots.length) throw new QuizError(`A page break goes after a slot from 1 to ${slots.length - 1} in quiz ${activityId}; ${after} isn't one.`);
    }
    let toggled = 0;
    for (let i = 1; i < slots.length; i++) {
      const wanted = pages.breaksAfter.includes(i);
      const has = slots[i]!.page !== slots[i - 1]!.page;
      if (wanted === has) continue;
      // The request names the slot after the break: 2 splits the page there, 1 joins it to the previous one.
      await editRest(page, quizId, activityId, { class: "resource", field: "updatepagebreak", id: slots[i]!.id, value: wanted ? 2 : 1 });
      toggled++;
    }
    const where = pages.breaksAfter.length > 0 ? `after slot${pages.breaksAfter.length === 1 ? "" : "s"} ${[...pages.breaksAfter].sort((a, b) => a - b).join(", ")}` : "nowhere (one page)";
    return await afterChange(page, activityId, toggled > 0 ? `Quiz ${activityId}'s page breaks are now ${where}.` : `Quiz ${activityId} already had its page breaks ${where}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Adds a section to a quiz starting at a slot, with its heading and whether its questions are
 * shuffled, as the edit page's "Add a new section heading" and its heading and shuffle controls do.
 * A section starts at a page: the slot must be the first of its page (see `setQuizPages`).
 */
export async function addQuizSection(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { firstSlot, heading, shuffle = false }: { firstSlot: number; heading: string; shuffle?: boolean },
): Promise<QuizChange & { sectionId: number }> {
  const page = await openEditPage(context, siteUrl, activityId);
  try {
    await checkEditable(page, activityId);
    const quizId = await quizInstanceId(page, activityId);
    const before = await readQuizEditor(page);
    const first = slotAt(before.slots, firstSlot, activityId);
    if (before.slots.some((s) => s.slot < firstSlot && s.page === first.page)) {
      throw new QuizError(`Slot ${firstSlot} isn't the first of its page in quiz ${activityId}, and a section starts at a page: put a page break before it first.`);
    }
    let sectionId = before.sections.find((s) => s.firstSlot === firstSlot)?.id;
    if (sectionId !== undefined) throw new QuizError(`Quiz ${activityId} already has a section starting at slot ${firstSlot} (section ${sectionId}).`);
    const { status, error } = await postEditPage(page, activityId, { addsectionatpage: String(first.page) });
    if (error || status >= 400) throw new QuizError(`Moodle didn't add a section to quiz ${activityId}: ${error ?? `HTTP ${status}`}.`);
    await page.reload({ waitUntil: "domcontentloaded" });
    sectionId = (await readQuizEditor(page)).sections.find((s) => !before.sections.some((old) => old.id === s.id))?.id;
    if (sectionId === undefined) throw new QuizError(`Moodle added no section to quiz ${activityId}.`);
    await editRest(page, quizId, activityId, { class: "section", field: "updatesectiontitle", id: sectionId, newheading: heading });
    if (shuffle) await editRest(page, quizId, activityId, { class: "section", field: "updateshufflequestions", id: sectionId, newshuffle: 1 });
    const result = await afterChange(page, activityId, `Added section "${heading}" to quiz ${activityId} at slot ${firstSlot}${shuffle ? ", its questions shuffled" : ""}.`);
    return { ...result, sectionId };
  } finally {
    await page.close().catch(() => undefined);
  }
}
