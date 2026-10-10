// A choice activity read and answered on its page, as a student does: its options with their ids,
// whether the answer can be changed, and the current answer. Its services aren't open to AJAX.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/** The choice isn't there, or the person can't answer it now. */
export class ChoiceError extends MoodleError {
  override name = "ChoiceError";
  constructor(message: string) {
    super(message, "choice");
  }
}

export interface Choice {
  id: number;
  name: string;
  intro: string;
  /** The options with the ids answers take; full ones can't be chosen. */
  options: { id: number; text: string; selected: boolean; full: boolean }[];
  /** Several options at once. */
  multiple: boolean;
  /** The form is there: the choice is open and the person may answer (or change their answer). */
  canAnswer: boolean;
  /** Whether a given answer can be removed or changed. */
  canChange: boolean;
  /** The options chosen, as the page names them, also where the form is gone. */
  answer: string[];
  /** The page's notices: closed, not open yet, results not published… */
  messages: string[];
}

/** The choice page, by its form's inputs and the selection block. */
export function readChoice(page: Page): Promise<Omit<Choice, "id">> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      id: string;
      value: string;
      type: string;
      checked: boolean;
      disabled: boolean;
      innerText: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
      cloneNode(deep: boolean): El;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const text = (el: El | null | undefined) => (el?.innerText ?? "").replace(/\s+/g, " ").trim();
    const form = doc.querySelector('#region-main form[action*="/mod/choice/view.php"]');
    const inputs = Array.from(form?.querySelectorAll('input[name="answer"], input[name="answer[]"]') ?? []);
    const options = inputs.map((input) => ({
      id: Number(input.value),
      text: text(doc.querySelector(`label[for="${input.id}"]`)),
      selected: input.checked,
      full: input.disabled,
    }));
    // "Your selection: while" (several joined with "; ")? The label before the colon is the site's language.
    const selection = text(doc.querySelector("#yourselection"));
    const fromBlock = selection.includes(":") ? selection.slice(selection.indexOf(":") + 1).split(/;\s*/).map((s) => s.trim()).filter(Boolean) : [];
    return {
      name: doc.querySelector("[data-activityname]")?.getAttribute("data-activityname") ?? "",
      intro: text(doc.querySelector(".activity-description, #intro")),
      options,
      multiple: inputs.some((input) => input.type === "checkbox"),
      canAnswer: form !== null && options.length > 0,
      canChange: doc.querySelector('#region-main a[href*="action=delchoice"]') !== null,
      answer: options.some((o) => o.selected) ? options.filter((o) => o.selected).map((o) => o.text) : fromBlock,
      messages: Array.from(doc.querySelectorAll("#region-main .alert, #region-main .generalbox"))
        .filter((box) => box.id !== "yourselection" && !box.querySelector("form"))
        .map((box) => {
          // Without the notification's close button, whose label is in the site's language.
          const copy = box.cloneNode(true);
          for (const extra of Array.from(copy.querySelectorAll("button, .visually-hidden"))) extra.remove();
          return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
        })
        .filter(Boolean),
    };
  }, null);
}

async function openChoice(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/choice/view.php?id=${activityId}`);
  if ((await page.locator("body#page-mod-choice-view").count()) === 0) {
    await page.close().catch(() => undefined);
    throw new ChoiceError(`Activity ${activityId} isn't a choice you can open. Take the id of a choice (module "choice") from the course structure.`);
  }
  return page;
}

/** A choice: its options, whether it can be answered or changed, and the person's answer. */
export async function getChoice(context: BrowserContext, siteUrl: string, activityId: number): Promise<Choice> {
  const page = await openChoice(context, siteUrl, activityId);
  try {
    return { id: activityId, ...(await readChoice(page)) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Answers a choice with one option (several where it allows them) by id, as "Save my choice" does; returns the choice afterwards. */
export async function answerChoice(context: BrowserContext, siteUrl: string, activityId: number, optionIds: number[]): Promise<{ changed: string; choice: Choice }> {
  if (optionIds.length === 0) throw new ChoiceError("Give the id of the option to choose.");
  const page = await openChoice(context, siteUrl, activityId);
  try {
    const choice = await readChoice(page);
    if (!choice.canAnswer) {
      // Moodle explains only some cases (closed before answering); an answered, closed choice just shows the answer.
      const answered = choice.answer.length > 0 ? ` Your answer stays: ${choice.answer.join(", ")}.` : "";
      const said = choice.messages.length > 0 ? ` Moodle says: ${choice.messages.join(" ")}` : "";
      throw new ChoiceError(`You can't answer choice ${activityId} now: it's closed, not open yet, or doesn't let answers change.${answered}${said}`);
    }
    if (!choice.multiple && optionIds.length > 1) throw new ChoiceError(`Choice ${activityId} takes one option only.`);
    for (const id of optionIds) {
      const option = choice.options.find((o) => o.id === id);
      if (!option) throw new ChoiceError(`Choice ${activityId} has no option ${id}; its options are: ${choice.options.map((o) => `${o.id} "${o.text}"`).join(", ")}.`);
      if (option.full) throw new ChoiceError(`Option ${id} "${option.text}" is full.`);
    }
    const form = '#region-main form[action*="/mod/choice/view.php"]';
    for (const option of choice.options) {
      const input = page.locator(`${form} input[name^="answer"][value="${option.id}"]`);
      if (optionIds.includes(option.id)) await input.check();
      else if (choice.multiple) await input.uncheck();
    }
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`${form} [type="submit"]`)]);
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await getChoice(context, siteUrl, activityId);
  return { changed: `Answered choice ${activityId}: ${after.answer.join(", ") || optionIds.join(", ")}.`, choice: after };
}
