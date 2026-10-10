import type { BrowserContext, Page } from "playwright-core";
import type { Trail } from "../../options.js";
import { dateSelectorValues, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { pause, readingSeconds } from "../../core/pace.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
import { MoodleDriverError } from "../../core/errors.js";

/** The quiz or attempt isn't there, or the person can't do what was asked. */
export class QuizError extends MoodleDriverError {
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
  attempts: { attemptId: number; inProgress: boolean; details: Detail[] }[];
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
      return id ? [{ attemptId: id, inProgress: /\/attempt\.php/.test(href), details }] : [];
    });
    return {
      intro: text(doc.querySelector("#intro")),
      info: Array.from(doc.querySelectorAll(".quizinfo p")).map((p) => text(p)),
      dates: Array.from(doc.querySelectorAll('[data-region="activity-dates"] .date-item')).map((item) => {
        const label = text(item.querySelector(".date-item-label"));
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
      options: ArrayLike<{ value: string; text: string; selected: boolean }>;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
      closest(s: string): El | null;
      cloneNode(deep: boolean): El;
      remove(): void;
    }
    const doc = (globalThis as unknown as { document: El & { getElementById(id: string): El | null; body: El & { appendChild(c: El): void } } }).document;
    // Text as the page shows it, without what only screen readers get ("Answer Question 4").
    const text = (el: El | null | undefined) => {
      if (!el) return "";
      const copy = el.cloneNode(true);
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
      const fields: QuestionField[] = [];
      const inputs = Array.from(q.querySelectorAll("input:not([type=hidden]), select, textarea")).filter((input) => !/:flagged$|_:sequencecheck$/.test(input.name) && input.name);
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
      return [
        {
          slot: Number(match[1]),
          number: text(q.querySelector(".qno")) || undefined,
          type: classes[1] ?? "",
          state: classes[3] ?? "",
          mark: text(q.querySelector(".info .grade")) || undefined,
          text: text(q.querySelector(".qtext")),
          images: Array.from(q.querySelectorAll(".qtext img")).map((img) => img.src),
          fields,
          feedback: [text(q.querySelector(".specificfeedback")), text(q.querySelector(".generalfeedback"))].filter(Boolean).join("\n") || undefined,
          rightAnswer: text(q.querySelector(".rightanswer")) || undefined,
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

export async function quizInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<QuizInfo> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-quiz-view").count()) === 0) throw NOT_A_QUIZ(activityId);
    return await readQuizView(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Starts an attempt, or continues the one in progress, as the quiz page's button does; returns its id. */
export async function startAttempt(context: BrowserContext, siteUrl: string, activityId: number): Promise<number> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-quiz-view").count()) === 0) throw NOT_A_QUIZ(activityId);
    const start = page.locator('form[action*="startattempt.php"] [type="submit"]').first();
    if ((await start.count()) === 0) throw new QuizError(`You can't start an attempt at quiz ${activityId} now: ${(await readQuizView(page)).messages.join(" ") || "see the quiz's information"}.`);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), start.click()]);
    // A time limit or a password first asks for confirmation on a form of its own.
    if ((await page.locator("#mod_quiz_preflight_form, form[action*='startattempt.php'] [name='submitbutton']").count()) > 0) {
      if ((await page.locator("#mod_quiz_preflight_form [name='quizpassword']").count()) > 0) throw new QuizError(`Quiz ${activityId} asks for a password, which this server doesn't type.`);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click("[name='submitbutton']")]);
    }
    const id = Number(new URL(page.url()).searchParams.get("attempt"));
    if (!id) throw new QuizError(`Quiz ${activityId} didn't open an attempt (it landed on ${new URL(page.url()).pathname}).`);
    return id;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Every question of an attempt, page by page, with the page each is on. */
export async function readAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<Question[]> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/attempt.php?attempt=${attemptId}&page=0`);
  try {
    if ((await page.locator("#responseform").count()) === 0) throw new QuizError(`Attempt ${attemptId} isn't open: it's finished, or not yours. Read its review instead.`);
    const pages = await readNavigation(page);
    const last = Math.max(0, ...Object.values(pages));
    const questions: Question[] = [];
    for (let p = 0; p <= last; p++) {
      if (p > 0) await page.goto(new URL(`mod/quiz/attempt.php?attempt=${attemptId}&page=${p}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      for (const question of await readQuestions(page)) questions.push({ ...question, page: p });
    }
    return questions;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Saves answers page by page, as the attempt's "next" button does; `beforeSave` runs with each
 * page's questions (the realistic trail's reading pause). Throws, saving nothing more, on a field
 * a page doesn't have.
 */
export async function saveAnswers(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  answers: { slot: number; responses: Record<string, string> }[],
  beforeSave?: (questions: Question[]) => Promise<void>,
): Promise<void> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/attempt.php?attempt=${attemptId}&page=0`);
  try {
    if ((await page.locator("#responseform").count()) === 0) throw new QuizError(`Attempt ${attemptId} isn't open: it's finished, or not yours.`);
    const pages = await readNavigation(page);
    const byPage = new Map<number, Record<string, string>>();
    for (const answer of answers) {
      const p = pages[answer.slot];
      if (p === undefined) throw new QuizError(`Attempt ${attemptId} has no question in slot ${answer.slot}.`);
      byPage.set(p, { ...byPage.get(p), ...answer.responses });
    }
    for (const [p, responses] of [...byPage].sort(([a], [b]) => a - b)) {
      await page.goto(new URL(`mod/quiz/attempt.php?attempt=${attemptId}&page=${p}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      await setFields(page, responses, "#responseform");
      await beforeSave?.(await readQuestions(page));
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('#responseform [name="next"]')]);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Submits the attempt for grading, as "Submit all and finish" does, without its confirm dialog. */
export async function finishAttempt(context: BrowserContext, siteUrl: string, attemptId: number): Promise<void> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/summary.php?attempt=${attemptId}`);
  try {
    const form = page.locator('form[action*="processattempt.php"]:has([name="finishattempt"])');
    if ((await form.count()) === 0) throw new QuizError(`Attempt ${attemptId} can't be finished: it's already finished, or not yours.`);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), form.evaluate((f) => (f as unknown as { submit(): void }).submit())]);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A finished attempt's review, as far as the quiz's review options let the person see it. */
export async function readReview(context: BrowserContext, siteUrl: string, attemptId: number): Promise<{ summary: Detail[]; questions: Question[] }> {
  const page = await openSitePage(context, siteUrl, `mod/quiz/review.php?attempt=${attemptId}&showall=1`);
  try {
    if ((await page.locator("body#page-mod-quiz-review").count()) === 0) throw new QuizError(`Attempt ${attemptId}'s review isn't available to you (not finished, not yours, or the quiz doesn't show reviews yet).`);
    const summary = await page.evaluate(() =>
      Array.from(
        (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ querySelector(s: string): { innerText: string } | null }> } }).document.querySelectorAll("table.quizreviewsummary tr"),
      ).map((row) => ({ label: (row.querySelector("th")?.innerText ?? "").trim(), value: (row.querySelector("td")?.innerText ?? "").replace(/\s+/g, " ").trim() })),
    );
    return { summary, questions: await readQuestions(page) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Starts an attempt, or continues the one in progress, and gives its questions. */
export async function startQuizAttempt(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ attemptId: number; questions: Question[] }> {
  const attemptId = await startAttempt(context, siteUrl, activityId);
  return { attemptId, questions: await readAttempt(context, siteUrl, attemptId) };
}

/**
 * Saves answers in an attempt in progress without finishing it, and gives its questions afterwards.
 * With the realistic trail, it first takes the time a reader needs for the questions and their
 * options (ADR-005), calling `onProgress` with the seconds elapsed and the total.
 */
export async function answerQuizQuestions(
  context: BrowserContext,
  siteUrl: string,
  attemptId: number,
  answers: { slot: number; responses: Record<string, string> }[],
  { trail = "realistic", onProgress }: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void } = {},
): Promise<{ attemptId: number; questions: Question[] }> {
  const beforeSave =
    trail === "realistic"
      ? async (questions: Question[]) => {
          const seconds = readingSeconds(questions.map((q) => [q.text, ...q.fields.flatMap((f) => [f.label ?? "", ...(f.options ?? []).map((o) => o.label)])].join(" ")).join(" "));
          await pause(seconds, (elapsed) => onProgress?.(elapsed, seconds));
        }
      : undefined;
  await saveAnswers(context, siteUrl, attemptId, answers, beforeSave);
  return { attemptId, questions: await readAttempt(context, siteUrl, attemptId) };
}

/** Submits an attempt for grading, and gives its review when the quiz shows it. */
export async function finishQuizAttempt(context: BrowserContext, siteUrl: string, attemptId: number) {
  await finishAttempt(context, siteUrl, attemptId);
  const review = await readReview(context, siteUrl, attemptId).catch(() => undefined);
  return { attemptId, finished: true as const, review };
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
    if (error instanceof NotLoggedInError) throw error;
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
