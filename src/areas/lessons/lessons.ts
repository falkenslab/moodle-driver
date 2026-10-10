// Going through a lesson page by page, as a student does on its pages: content pages with their
// buttons, question pages with their form, the feedback after an answer, and the end of the lesson.
// Moodle keeps where the person is; starting and ending the attempt happen as they move on.
import type { BrowserContext, Page } from "playwright-core";
import type { Trail } from "../../options.js";
import { setFields } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { pause, readingSeconds } from "../../core/pace.js";
import { openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/** The lesson isn't there, or the page can't take that answer. */
export class LessonError extends MoodleError {
  override name = "LessonError";
  constructor(message: string) {
    super(message, "lesson");
  }
}

/** One input of a question page, by its form name. */
export interface LessonField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
}

export interface LessonPage {
  /** What the page is: content with buttons, a question, the feedback after an answer, or the lesson's end. */
  kind: "content" | "question" | "feedback" | "end";
  /** The page's id; for feedback, the page it goes on to (-9 is the end). */
  pageId?: number;
  title?: string;
  /** The page's text as shown: its content, the question, Moodle's messages, the score at the end. */
  text: string;
  /** A content page's buttons, by label, and the page each jumps to (Moodle's jump codes: -1 next, -9 end…). */
  buttons?: { label: string; jumpTo: number }[];
  /** A question page's inputs. */
  fields?: LessonField[];
  /** After an answer: whether Moodle took it as right, and the teacher's response to it. */
  feedback?: { correct?: boolean; response?: string };
}

/** The lesson page on screen, read by its forms and blocks. */
export function readLessonPage(page: Page): Promise<LessonPage> {
  return inPage(
    page,
    () => {
      interface El {
        id: string;
        name: string;
        type: string;
        value: string;
        className: string;
        tagName: string;
        innerText: string;
        options: ArrayLike<{ value: string; text: string }>;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        closest(s: string): El | null;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const main = doc.querySelector('#region-main [role="main"]') ?? doc.querySelector("#region-main");
      const text = (el: El | null | undefined) => (el?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      const title = text(main?.querySelector("h2")) || undefined;
      const question = main?.querySelector('form.mform[action*="/mod/lesson/continue.php"]');
      const pageIdOf = (form: El | null | undefined) => Number(form?.querySelector('input[name="pageid"]')?.getAttribute("value")) || undefined;
      if (question) {
        const fields: LessonField[] = [];
        for (const input of Array.from(question.querySelectorAll("input:not([type=hidden]), select, textarea"))) {
          if (!input.name || input.type === "submit") continue;
          const label = text(input.closest("label")) || undefined;
          if (input.type === "radio") {
            let field = fields.find((f) => f.name === input.name);
            if (!field) {
              field = { name: input.name, kind: "choice", options: [] };
              fields.push(field);
            }
            field.options!.push({ value: input.value, label: label ?? input.value });
          } else if (input.type === "checkbox") fields.push({ name: input.name, kind: "checkbox", ...(label ? { label } : {}) });
          else if (input.tagName === "SELECT") {
            fields.push({ name: input.name, kind: "select", ...(label ? { label } : {}), options: Array.from(input.options).map((o) => ({ value: o.value, label: o.text.trim() })) });
          } else fields.push({ name: input.name, kind: "text", ...(label ? { label } : {}) });
        }
        return { kind: "question", pageId: pageIdOf(question), ...(title ? { title } : {}), text: text(question.querySelector(".contents")), fields } as LessonPage;
      }
      const buttons = Array.from(main?.querySelectorAll('.branchbuttoncontainer form[action*="/mod/lesson/continue.php"]') ?? []);
      if (buttons.length > 0) {
        return {
          kind: "content",
          pageId: pageIdOf(buttons[0]),
          ...(title ? { title } : {}),
          text: text(main?.querySelector(".contents")),
          buttons: buttons.map((form) => ({ label: text(form.querySelector("button, [type=submit]")), jumpTo: Number(form.querySelector('input[name="jumpto"]')?.getAttribute("value")) })),
        } as LessonPage;
      }
      const next = main?.querySelector('form[action*="/mod/lesson/view.php"]');
      if (next) {
        const response = main?.querySelector(".response");
        const correct = response ? (/\bcorrect\b/.test(response.className) ? true : /\bincorrect\b/.test(response.className) ? false : undefined) : undefined;
        return {
          kind: "feedback",
          pageId: pageIdOf(next),
          text: text(main).replace(text(next), "").trim(),
          feedback: { ...(correct !== undefined ? { correct } : {}), ...(response ? { response: text(response).replace(/^[^:\n]*:\s*/, "") } : {}) },
        } as LessonPage;
      }
      return { kind: "end", ...(title ? { title } : {}), text: text(main) } as LessonPage;
    },
    null,
  );
}

/** Opens the lesson where the person is: Moodle asks whether to go on from the last page seen, and they do. */
async function openLesson(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/lesson/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-lesson-view").count()) === 0) {
      throw new LessonError(`Activity ${activityId} isn't a lesson you can open. Take the id of a lesson (module "lesson") from the course structure.`);
    }
    const resume = page.locator('#region-main a[href*="startlastseen=yes"]');
    if ((await resume.count()) > 0) await page.goto((await resume.first().getAttribute("href"))!, { waitUntil: "domcontentloaded" });
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** The lesson page the person is on (starting the lesson the first time). */
export async function lessonPage(context: BrowserContext, siteUrl: string, activityId: number): Promise<LessonPage> {
  const page = await openLesson(context, siteUrl, activityId);
  try {
    return await readLessonPage(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Answers the page the person is on: a content page's button (its label or position), or a
 * question's fields by name. Returns Moodle's feedback when it gives one, and the page that follows,
 * going on past the feedback as its "Continue" does; reaching the end ends the attempt. With the
 * realistic trail it first takes the time a reader needs for the page (ADR-005).
 */
export async function answerLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  answer: { button?: string | number; responses?: Record<string, string> },
  { trail = "realistic", onProgress }: { trail?: Trail; onProgress?: (elapsed: number, total: number) => void } = {},
): Promise<{ changed: string; feedback?: LessonPage; page: LessonPage }> {
  const page = await openLesson(context, siteUrl, activityId);
  try {
    const current = await readLessonPage(page);
    // What the answer can't be is told before the reading pause, not after it.
    const buttons = current.buttons ?? [];
    const index = typeof answer.button === "number" ? answer.button : buttons.findIndex((b) => b.label === answer.button);
    if (current.kind === "content" && (answer.button === undefined || index < 0 || index >= buttons.length)) {
      throw new LessonError(`This content page's buttons are: ${buttons.map((b, i) => `${i}: "${b.label}"`).join(", ")}. Give one by label or position.`);
    }
    if (current.kind === "question" && (!answer.responses || Object.keys(answer.responses).length === 0)) {
      throw new LessonError("This page is a question: answer it with its fields' values (responses).");
    }
    if (current.kind === "end" || current.kind === "feedback") {
      throw new LessonError(current.kind === "end" ? "The lesson has ended: there's nothing more to answer." : "This page only goes on: answer the page it leads to.");
    }
    if (trail === "realistic") {
      const seconds = readingSeconds([current.text, ...(current.fields ?? []).flatMap((f) => [f.label ?? "", ...(f.options ?? []).map((o) => o.label)])].join(" "));
      await pause(seconds, (elapsed) => onProgress?.(elapsed, seconds));
    }
    if (current.kind === "content") {
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.locator('.branchbuttoncontainer form[action*="/mod/lesson/continue.php"] [type=submit], .branchbuttoncontainer form button').nth(index).click()]);
    } else {
      const form = 'form.mform[action*="/mod/lesson/continue.php"]';
      await setFields(page, answer.responses!, form);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`${form} [name="submitbutton"]`)]);
    }
    let next = await readLessonPage(page);
    let feedback: LessonPage | undefined;
    if (next.kind === "feedback") {
      feedback = next;
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('#region-main form[action*="/mod/lesson/view.php"] [type=submit], #region-main form[action*="/mod/lesson/view.php"] button')]);
      next = await readLessonPage(page);
    }
    const changed = current.kind === "content" ? `Went on from lesson ${activityId}'s page with "${buttons[index]!.label}".` : `Answered lesson ${activityId}'s question.`;
    return { changed, ...(feedback ? { feedback } : {}), page: next };
  } finally {
    await page.close().catch(() => undefined);
  }
}
