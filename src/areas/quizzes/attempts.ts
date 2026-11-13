import type { BrowserContext, Page } from "playwright-core";
import type { Trail } from "../../options.js";
import { dateSelectorValues, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { pause, readingSeconds } from "../../core/pace.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage, isSessionOrBrowserFailure, releaseTab, showOwnTab } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/** The quiz or attempt isn't there, or the person can't do what was asked. */
export class QuizError extends MoodleError {
  override name = "QuizError";
  constructor(message: string) {
    super(message, "quiz");
  }
}

/** A label and value as Moodle shows them (site language). */
export interface Detail {
  label: string;
  value: string;
}

/** What the quiz's page says: its info lines, dates, the person's attempts, whether they can start one. */
export interface QuizInfo {
  intro: string;
  info: string[];
  dates: Detail[];
  feedback?: string;
  attempts: { id: number; inProgress: boolean; details: Detail[] }[];
  canStart: boolean;
  messages: string[];
}

/** One input of a question, by its form name, with its options and current value. */
export interface QuestionField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
  value?: string;
}

/** A question as the attempt or review page shows it. */
export interface Question {
  slot: number;
  page?: number;
  number?: string;
  type: string;
  state: string;
  mark?: string;
  text: string;
  images: string[];
  fields: QuestionField[];
  feedback?: string;
  rightAnswer?: string;
  /** In a review, the teacher's comment (when graded by hand), as its paragraphs' text. */
  comment?: string;
}

const NOT_A_QUIZ = (id: number) => new QuizError(`Activity ${id} isn't a quiz you can open. Take the id of a quiz (module "quiz") from the course structure.`);

export function readQuizView(page: Page): Promise<QuizInfo> {
  return inPage(page, () => {
    interface El {
      innerText: string;
      getAttribute(n: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const text = (el: El | null | undefined) => (el?.innerText ?? "").replace(/[ \t]+/g, " ").trim();
    const attempts = Array.from(doc.querySelectorAll(".card")).flatMap((card) => {
      if (!card.querySelector("table.quizreviewsummary")) return [];
      const link = card.querySelector('a[href*="review.php?attempt="], a[href*="attempt.php?attempt="]');
      const href = link?.getAttribute("href") ?? "";
      const id = Number(/attempt=(\d+)/.exec(href)?.[1]);
      const details = Array.from(card.querySelectorAll("table.quizreviewsummary tr")).map((row) => ({ label: text(row.querySelector("th")), value: text(row.querySelector("td")) }));
      return id ? [{ id, inProgress: /\/attempt\.php/.test(href), details }] : [];
    });
    return {
      intro: text(doc.querySelector("#intro")),
      info: Array.from(doc.querySelectorAll(".quizinfo p")).map((p) => text(p)),
      dates: Array.from(doc.querySelectorAll('[data-region="activity-dates"] .date-item, [data-region="activity-dates"] > div:not(.date-item)')).map((item) => {
        const label = text(item.querySelector(".date-item-label, strong"));
        return { label: label.replace(/:$/, ""), value: text(item).slice(label.length).trim() };
      }),
      feedback: text(doc.querySelector("#feedback")) || undefined,
      attempts,
      canStart: doc.querySelector('form[action*="startattempt.php"]') !== null,
      messages: Array.from(doc.querySelectorAll(".quizattempt p, .quizattempt .alert")).map((p) => text(p)).filter(Boolean),
    };
  }, null);
}

/** The questions on an attempt or review page, with their fields read from the form. */
export function readQuestions(page: Page): Promise<Question[]> {
  return inPage(page, () => {
    interface El {
      id: string;
      className: string;
      innerText: string;
      name: string;
      type: string;
      value: string;
      checked: boolean;
      tagName: string;
      src: string;
      children: ArrayLike<El>;
      options: ArrayLike<{ value: string; text: string; selected: boolean }>;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
      closest(s: string): El | null;
      cloneNode(deep: boolean): El;
      remove(): void;
      replaceWith(node: unknown): void;
    }
    const doc = (globalThis as unknown as { document: El & { getElementById(id: string): El | null; createTextNode(text: string): unknown; body: El & { appendChild(c: El): void } } }).document;
    // Text as the page shows it, without what only screen readers get ("Answer Question 4"); `prepare`
    // changes the copy read first.
    const text = (el: El | null | undefined, prepare?: (copy: El) => void) => {
      if (!el) return "";
      const copy = el.cloneNode(true);
      prepare?.(copy);
      for (const hidden of Array.from(copy.querySelectorAll(".accesshide, .visually-hidden, .sr-only"))) hidden.remove();
      doc.body.appendChild(copy);
      const shown = copy.innerText ?? "";
      copy.remove();
      return shown.replace(/[ \t]+/g, " ").trim();
    };
    return Array.from(doc.querySelectorAll(".que")).flatMap((q) => {
      const match = /^question-\d+-(\d+)$/.exec(q.id);
      if (!match) return [];
      const classes = q.className.split(/\s+/);
      // The statement is the question's .qtext; a question that writes its text straight into its
      // formulation has none (CodeRunner, with its examples table after it): there the answer area
      // and the controls are left out. A field inside the text (a gap) reads as its name in brackets,
      // `[q238:3_p1]`, where it goes; innerText would drop it.
      const qtext = q.querySelector(".qtext");
      const textEl = qtext ?? q.querySelector(".formulation");
      const questionText = text(textEl, (copy) => {
        if (!qtext) {
          for (const control of Array.from(copy.querySelectorAll(".ablock, .answer, .prompt, .im-controls, .validationerror, .ace_editor, .ui_wrapper, label, button, input, select, textarea"))) control.remove();
        }
        for (const field of Array.from(copy.querySelectorAll("input:not([type=hidden]), select, textarea"))) {
          if (field.name) field.replaceWith(doc.createTextNode(`[${field.name}]`));
        }
      })
        .replace(/ *\n */g, "\n")
        .replace(/\n{3,}/g, "\n\n");
      const fields: QuestionField[] = [];
      // A question's buttons (CodeRunner's and adaptive mode's Check, "q9:4_-submit") aren't answers.
      const inputs = Array.from(q.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")).filter((input) => !/:flagged$|_:sequencecheck$/.test(input.name) && input.name);
      for (const input of inputs) {
        // An option's label, without its "a." numbering: the element named after the input, or its row.
        const labelEl = (doc.getElementById(`${input.id}_label`) ?? input.closest(".answer > div, label"))?.cloneNode(true);
        for (const numbering of Array.from(labelEl?.querySelectorAll(".answernumber") ?? [])) numbering.remove();
        const label = labelEl ? (labelEl.innerText ?? "").replace(/\s+/g, " ").trim() : undefined;
        if (input.type === "radio") {
          let field = fields.find((f) => f.name === input.name);
          if (!field) {
            field = { name: input.name, kind: "choice", options: [] };
            fields.push(field);
          }
          // A single-choice question's hidden "clear my choice" radio has the value -1 and no label of its own.
          field.options!.push({ value: input.value, label: label || (input.value === "-1" ? "(clear my choice)" : input.value) });
          if (input.checked) field.value = input.value;
        } else if (input.type === "checkbox") {
          fields.push({ name: input.name, kind: "checkbox", label, value: input.checked ? "1" : "0" });
        } else if (input.tagName === "SELECT") {
          const options = Array.from(input.options);
          fields.push({
            name: input.name,
            kind: "select",
            label: text(input.closest("tr")?.querySelector(".text")) || undefined,
            options: options.map((o) => ({ value: o.value, label: o.text.trim() })),
            value: options.find((o) => o.selected)?.value,
          });
        } else {
          fields.push({ name: input.name, kind: "text", value: input.value || undefined });
        }
      }
      // A teacher's comment: "Comment: <the comment's HTML>", the label in the site's language; its
      // paragraphs' text without it, or all of it for a comment without elements (confirmed empirically, 5.2).
      const commentBox = q.querySelector(".comment");
      let comment: string | undefined;
      if (commentBox && !commentBox.querySelector("textarea, input")) {
        const parts = Array.from(commentBox.children).filter((child) => !/^H\d$/.test(child.tagName));
        comment = (parts.length > 0 ? parts.map((part) => text(part)).filter(Boolean).join("\n") : text(commentBox)) || undefined;
      }
      return [
        {
          slot: Number(match[1]),
          number: text(q.querySelector(".qno")) || undefined,
          type: classes[1] ?? "",
          state: classes[3] ?? "",
          mark: text(q.querySelector(".info .grade")) || undefined,
          text: questionText,
          images: Array.from(textEl?.querySelectorAll("img") ?? []).map((img) => img.src),
          fields,
          feedback: [text(q.querySelector(".specificfeedback")), text(q.querySelector(".generalfeedback"))].filter(Boolean).join("\n") || undefined,
          rightAnswer: text(q.querySelector(".rightanswer")) || undefined,
          ...(comment ? { comment } : {}),
        },
      ];
    });
  }, null);
}

/** The pages of an attempt, from its navigation: slot → page. */
export function readNavigation(page: Page): Promise<Record<number, number>> {
  return page.evaluate(() => {
    const buttons = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; getAttribute(n: string): string | null }> } }).document.querySelectorAll(
      '.qnbutton[id^="quiznavbutton"]',
    );
    const pages: Record<number, number> = {};
    for (const button of Array.from(buttons)) pages[Number(button.id.slice("quiznavbutton".length))] = Number(button.getAttribute("data-quiz-page") ?? 0);
    return pages;
  });
}

/** A quiz's page as the person sees it: its description and dates, the person's attempts with their summary, and whether they can start one. */
export async function quizInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuizInfo> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-quiz-view").count()) === 0) throw NOT_A_QUIZ(activityId);
    return await readQuizView(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Where an attempt is, as the person sees it: the page it's on, how many pages it has, and that
 * page's questions. Once the last page is saved the attempt is at its summary, ready to finish:
 * `page` is absent, `questions` empty, and `summary` gives each question's status.
 */
export type AttemptPage = {
  attemptId: number;
  /** The attempt's page shown, from 0; absent at the summary. */
  page?: number;
  /** How many pages the attempt has. */
  pages: number;
  /** The questions on that page. */
  questions: Question[];
  /** At the summary, each question's status, as its table shows it. */
  summary?: SummaryRow[];
};

/** A question's row in an attempt's summary. */
export type SummaryRow = {
  slot: number;
  number: string;
  /** Moodle's state class ("answersaved", "notyetanswered"…). */
  state: string;
  /** The status as the page says it, in the site's language. */
  status: string;
};

// An attempt's tab stays open between calls, as a person's does (#100): reopening the page it's on
// would log another view. This program's calls find it by the attempt; another program on a browser
// left open (ADR-014) by its address. (A window name set on the tab didn't find it again on Moodle
// 5.2's attempt pages: seen on the sandbox, cause not traced.)
const attemptTabs = new WeakMap<BrowserContext, Map<number, Page>>();

/** The attempt's tab, if one is open. */
async function keptTab(context: BrowserContext, attemptId: number): Promise<Page | undefined> {
  const showsIt = (page: Page) => {
    if (page.isClosed()) return false;
    const url = new URL(page.url());
    return /\/mod\/quiz\/(attempt|summary)\.php$/.test(url.pathname) && url.searchParams.get("attempt") === String(attemptId);
  };
  const mine = attemptTabs.get(context)?.get(attemptId);
  if (mine && showsIt(mine)) return mine;
  return context.pages().find(showsIt);
}

async function keep(page: Page, attemptId: number): Promise<Page> {
  const tabs = attemptTabs.get(page.context()) ?? new Map<number, Page>();
  attemptTabs.set(page.context(), tabs.set(attemptId, page));
  return page;
}

/** The attempt's tab, or a new one on `page` (0 when not given) when none is open; `QuizError` when the attempt isn't open. */
async function attemptTab(context: BrowserContext, siteUrl: string, attemptId: number, page?: number): Promise<Page> {
  const kept = await keptTab(context, attemptId);
  if (kept) return kept;
  const tab = await openSitePage(context, siteUrl, `mod/quiz/attempt.php?attempt=${attemptId}&page=${page ?? 0}`, { follow: false });
  if ((await tab.locator("#responseform").count()) === 0) {
    await tab.close().catch(() => undefined);
    throw new QuizError(`Attempt ${attemptId} isn't open: it's finished, or not yours. Read its review instead.`);
  }
  return keep(tab, attemptId);
}

/** The page of the attempt the tab shows, or undefined at the summary. */
function pageShown(tab: Page): number | undefined {
  const url = new URL(tab.url());
  return url.pathname.endsWith("/mod/quiz/summary.php") ? undefined : Number(url.searchParams.get("page") ?? 0);
}

/** Takes the tab to the attempt's page `page`, unless it's there already. */
async function goToPage(tab: Page, siteUrl: string, attemptId: number, page: number): Promise<void> {
  if (pageShown(tab) === page) return;
  await tab.goto(new URL(`mod/quiz/attempt.php?attempt=${attemptId}&page=${page}`, siteUrl).href, { waitUntil: "domcontentloaded" });
  if ((await tab.locator("#responseform").count()) === 0) throw new QuizError(`Attempt ${attemptId} has no page ${page} open to you: it's finished, or its navigation is sequential and that page is behind.`);
}

/** The summary's rows, by structure: Moodle names each row `quizsummary<slot> <state>`. */
function readSummary(tab: Page): Promise<SummaryRow[]> {
  return tab.evaluate(() =>
    Array.from(
      (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ className: string; querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> }> } }).document.querySelectorAll(
        "table.quizsummaryofattempt tr[class*='quizsummary']",
      ),
    ).flatMap((row) => {
      const match = /\bquizsummary(\d+)\s+(\S+)/.exec(row.className);
      if (!match) return [];
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
      return [{ slot: Number(match[1]), number: cells[0] ?? "", state: match[2]!, status: cells[1] ?? "" }];
    }),
  );
}

/** Where the attempt in `tab` is now, read from the page it shows (and, while the person watches, shown). */
async function here(tab: Page, attemptId: number): Promise<AttemptPage> {
  await showOwnTab(tab.context(), tab);
  const navigation = await readNavigation(tab);
  const pages = Math.max(0, ...Object.values(navigation)) + 1;
  const page = pageShown(tab);
  if (page === undefined) return { attemptId, pages, questions: [], summary: await readSummary(tab) };
  return { attemptId, page, pages, questions: (await readQuestions(tab)).map((question) => ({ ...question, page })) };
}

/**
 * Starts an attempt, or continues the one in progress, as the quiz page's button does; gives its id
 * and the tab it opened in, left open.
 *
 * A quiz with a time limit or a password asks first, on its preflight form (`#mod_quiz_preflight_form`):
 * with JavaScript, the start button opens it in a dialog on the same page instead of leaving it; before
 * the page's script is ready, the button posts and Moodle shows the form as a page of its own (both
 * confirmed empirically, Moodle 5.2). So after the click this waits for whichever comes: the dialog,
 * or another page; then confirms the form, or refuses a password with `QuizError` (the driver never
 * types one). A quiz meant for a secure pop-up window opens the attempt in a new window, which is the one kept.
 */
async function startAttempt(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ attemptId: number; tab: Page }> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/view.php?id=${activityId}`, { follow: false });
  const opened = new Set<Page>([page]);
  let kept: Page | undefined;
  try {
    if ((await page.locator("body#page-mod-quiz-view").count()) === 0) throw NOT_A_QUIZ(activityId);
    const start = page.locator('form[action*="startattempt.php"] [type="submit"]').first();
    if ((await start.count()) === 0) throw new QuizError(`You can't start an attempt at quiz ${activityId} now: ${(await readQuizView(page)).messages.join(" ") || "see the quiz's information"}.`);
    const PREFLIGHT = "#mod_quiz_preflight_form";
    // Moodle marks the start button of a quiz that runs in a secure pop-up window.
    const popup = (await page.locator(".quizsecuremoderequired").count()) > 0;
    // The view page holds the preflight form hidden from the start: it counts once shown, or off the view page.
    let landed = await afterClick(context, page, () => start.click(), { popup, shown: page.locator(PREFLIGHT).waitFor({ state: "visible" }) });
    opened.add(landed);
    const attempt = () => Number(new URL(landed.url()).searchParams.get("attempt"));
    // A timed quiz in a pop-up asks twice: in the dialog, then in the pop-up as a page (confirmed empirically, 5.2).
    for (let round = 0; round < 2 && !attempt() && (await landed.locator(PREFLIGHT).count()) > 0; round++) {
      if ((await landed.locator(`${PREFLIGHT} [name='quizpassword']`).count()) > 0) {
        throw new QuizError(`Quiz ${activityId} asks for a password before an attempt: the driver never types one, so start this attempt in Moodle.`);
      }
      const at = landed;
      landed = await afterClick(context, at, () => at.locator(`${PREFLIGHT} [name='submitbutton']`).click(), { popup: popup && at === page });
      opened.add(landed);
    }
    if (!attempt()) {
      const moodle = await moodleErrorMessage(landed);
      throw new QuizError(`Quiz ${activityId} didn't open an attempt${moodle ? `: ${moodle}` : ` (it landed on ${new URL(landed.url()).pathname})`}.`);
    }
    kept = await keep(landed, attempt());
    return { attemptId: attempt(), tab: kept };
  } finally {
    for (const other of opened) if (other !== kept) await other.close().catch(() => undefined);
  }
}

/**
 * Clicks, then waits for the first of: the page reaching another page than its own or startattempt.php
 * (which only redirects, or shows the preflight form: `shown` waits for that), `shown` (the form, in a
 * dialog or as a page), Moodle's error page, or with `popup` a new window (a quiz in a secure pop-up).
 * Gives the page that holds what came next.
 */
async function afterClick(context: BrowserContext, page: Page, click: () => Promise<void>, { popup = false, shown }: { popup?: boolean; shown?: Promise<void> } = {}): Promise<Page> {
  const from = page.url();
  const waits = [
    page.waitForURL((url) => url.href !== from && !url.pathname.endsWith("/mod/quiz/startattempt.php"), { waitUntil: "domcontentloaded" }).then(() => page),
    page.locator('[data-rel="fatalerror"]').waitFor({ state: "attached" }).then(() => page),
  ];
  if (shown) waits.push(shown.then(() => page));
  if (popup) {
    waits.push(
      context.waitForEvent("page").then(async (opened) => {
        await opened.waitForURL(/\/mod\/quiz\/(attempt|startattempt)\.php/, { waitUntil: "domcontentloaded" });
        return opened;
      }),
    );
  }
  // The waits that lose end with the page or time out: nobody else listens to them.
  for (const wait of waits) wait.catch(() => undefined);
  await click();
  return Promise.any(waits).catch(() => {
    throw new QuizError(`The quiz's page at ${new URL(from).pathname} neither moved on nor asked anything after its button.`);
  });
}

/**
 * One page of an attempt in progress: `page` (from 0), or without it the page the attempt is on in
 * its tab (page 0 when no tab is open). Loads nothing when the attempt's tab already shows it.
 */
export async function readAttempt(context: BrowserContext, siteUrl: string, attemptId: number, options: { page?: number } = {}): Promise<AttemptPage> {
  const tab = await attemptTab(context, siteUrl, attemptId, options.page);
  if (options.page !== undefined) await goToPage(tab, siteUrl, attemptId, options.page);
  return here(tab, attemptId);
}

/**
 * Saves answers page by page, as the attempt's "next" button does, in the attempt's tab;
 * `beforeSave` runs with each page's questions (the realistic trail's reading pause). Throws, saving
 * nothing more, on a field a page doesn't have. Leaves the tab where the last "next" led.
 */
async function saveAnswers(
  tab: Page,
  siteUrl: string,
  attemptId: number,
  answers: { slot: number; responses: Record<string, string> }[],
  beforeSave?: (questions: Question[]) => Promise<void>,
): Promise<void> {
  const pages = await readNavigation(tab);
  const byPage = new Map<number, Record<string, string>>();
  for (const answer of answers) {
    const p = pages[answer.slot];
    if (p === undefined) throw new QuizError(`Attempt ${attemptId} has no question in slot ${answer.slot}.`);
    byPage.set(p, { ...byPage.get(p), ...answer.responses });
  }
  for (const [p, responses] of [...byPage].sort(([a], [b]) => a - b)) {
    await goToPage(tab, siteUrl, attemptId, p);
    await setFields(tab, responses, "#responseform");
    await beforeSave?.(await readQuestions(tab));
    await Promise.all([tab.waitForNavigation({ waitUntil: "domcontentloaded" }), tab.click('#responseform [name="next"]')]);
  }
}

/** Submits the attempt for grading, as "Submit all and finish" does, without its confirm dialog; gives the tab where Moodle led. */
async function finishAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<Page> {
  const kept = await keptTab(context, attemptId);
  const tab = kept ?? (await openSitePage(context, siteUrl, `mod/quiz/summary.php?attempt=${attemptId}`, { follow: false }));
  try {
    if (pageShown(tab) !== undefined) await tab.goto(new URL(`mod/quiz/summary.php?attempt=${attemptId}`, siteUrl).href, { waitUntil: "domcontentloaded" });
    const form = tab.locator('form[action*="processattempt.php"]:has([name="finishattempt"])');
    if ((await form.count()) === 0) throw new QuizError(`Attempt ${attemptId} can't be finished: it's already finished, or not yours.`);
    await Promise.all([tab.waitForNavigation({ waitUntil: "domcontentloaded" }), form.evaluate((f) => (f as unknown as { submit(): void }).submit())]);
    return tab;
  } catch (error) {
    await tab.close().catch(() => undefined);
    throw error;
  }
}

/** The review a page shows, or `QuizError` when it isn't one. */
async function reviewOn(page: Page, attemptId: number): Promise<{ summary: Detail[]; questions: Question[] }> {
  if ((await page.locator("body#page-mod-quiz-review").count()) === 0) throw new QuizError(`Attempt ${attemptId}'s review isn't available to you (not finished, not yours, or the quiz doesn't show reviews yet).`);
  const summary = await page.evaluate(() =>
    Array.from(
      (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ querySelector(s: string): { innerText: string } | null }> } }).document.querySelectorAll("table.quizreviewsummary tr"),
    ).map((row) => ({ label: (row.querySelector("th")?.innerText ?? "").trim(), value: (row.querySelector("td")?.innerText ?? "").replace(/\s+/g, " ").trim() })),
  );
  return { summary, questions: await readQuestions(page) };
}

/** A finished attempt's review, as far as the quiz's review options let the person see it. */
export async function readReview(context: BrowserContext, siteUrl: string, attemptId: number): Promise<{ summary: Detail[]; questions: Question[] }> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/review.php?attempt=${attemptId}&showall=1`);
  try {
    return await reviewOn(page, attemptId);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Starts an attempt, or continues the one in progress, and gives the page it opens on with its
 * questions; the attempt's tab stays open for the next calls.
 */
export async function startQuizAttempt(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ changed: string } & AttemptPage> {
  const { attemptId, tab } = await startAttempt(context, siteUrl, activityId);
  return { changed: `Attempt ${attemptId} of quiz ${activityId} is open.`, ...(await here(tab, attemptId)) };
}

/**
 * Saves answers in an attempt in progress without finishing it, page by page as "next" does, and
 * gives where that leaves the attempt: the page after the last one saved, or its summary after the
 * last page. With the realistic trail, it first takes the time a reader needs for each page's
 * questions and their options (ADR-005), calling `onProgress` with the seconds elapsed and the total.
 */
export async function answerQuizQuestions(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  answers: { slot: number; responses: Record<string, string> }[],
  { trail = "realistic", onProgress }: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void } = {},
): Promise<{ changed: string } & AttemptPage> {
  const beforeSave =
    trail === "realistic"
      ? async (questions: Question[]) => {
          const seconds = readingSeconds(questions.map((q) => [q.text, ...q.fields.flatMap((f) => [f.label ?? "", ...(f.options ?? []).map((o) => o.label)])].join(" ")).join(" "));
          await pause(seconds, (elapsed) => onProgress?.(elapsed, seconds));
        }
      : undefined;
  const tab = await attemptTab(context, siteUrl, attemptId);
  await saveAnswers(tab, siteUrl, attemptId, answers, beforeSave);
  return {
    changed: `Saved answers to ${answers.length} question${answers.length === 1 ? "" : "s"} in attempt ${attemptId}.`,
    ...(await here(tab, attemptId)),
  };
}

/**
 * Submits an attempt for grading from its summary (where its tab is, or opened), and gives its review
 * when the quiz shows it: the page Moodle leads to, all its questions at once when there are several pages.
 */
export async function finishQuizAttempt(context: BrowserContext, siteUrl: string, attemptId: number) {
  const tab = await finishAttempt(context, siteUrl, attemptId);
  try {
    // A review in pages links to all of it on one page, as a person would open it.
    const showAll = tab.locator('a[href*="showall=1"]');
    if ((await showAll.count()) > 0) await tab.goto(new URL(`mod/quiz/review.php?attempt=${attemptId}&showall=1`, siteUrl).href, { waitUntil: "domcontentloaded" });
    const review = await reviewOn(tab, attemptId).catch(() => undefined);
    return { changed: `Finished attempt ${attemptId}.`, attemptId, finished: true as const, review };
  } finally {
    // While the person watches, the review stays in sight as the working tab.
    await releaseTab(context, tab);
  }
}

/**
 * Sets a user override on a quiz, through its override form: other opening and closing dates, a time
 * limit in minutes, or a number of attempts (0 unlimited); what isn't given stays the quiz's.
 */
export async function setQuizOverride(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  { open, close, timeLimitMinutes, attempts }: { open?: Date; close?: Date; timeLimitMinutes?: number; attempts?: number },
): Promise<{ changed: string }> {
  const page = await openForm(context, siteUrl, `mod/quiz/overrideedit.php?action=adduser&cmid=${activityId}`).catch((error: unknown) => {
    if (isSessionOrBrowserFailure(error)) throw error;
    throw new QuizError(`You can't add overrides to activity ${activityId}: it isn't a quiz, or you aren't allowed.`);
  });
  try {
    const values: Record<string, FieldValue> = { userid: String(userId) };
    if (open) Object.assign(values, { "timeopen[enabled]": true, ...(await dateSelectorValues(page, "timeopen", open)) });
    if (close) Object.assign(values, { "timeclose[enabled]": true, ...(await dateSelectorValues(page, "timeclose", close)) });
    if (timeLimitMinutes !== undefined) Object.assign(values, { "timelimit[enabled]": true, "timelimit[number]": timeLimitMinutes, "timelimit[timeunit]": 60 });
    if (attempts !== undefined) values.attempts = String(attempts);
    const offered = await page.evaluate(
      (user) => (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector(`form.mform select[name="userid"] option[value="${user}"]`) !== null,
      userId,
    );
    if (!offered) throw new QuizError(`User ${userId} can't get an override in quiz ${activityId}: not a participant, or already overridden (change that override in Moodle).`);
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  const what = [open && `opens ${open.toISOString()}`, close && `closes ${close.toISOString()}`, timeLimitMinutes !== undefined && `${timeLimitMinutes} minutes`, attempts !== undefined && `${attempts || "unlimited"} attempts`].filter(Boolean);
  return { changed: `Override for user ${userId} in quiz ${activityId}: ${what.join(", ") || "the quiz's settings"}.` };
}
