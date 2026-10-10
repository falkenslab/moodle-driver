import type { BrowserContext, Page } from "playwright-core";
import { setFields } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { openSitePage } from "../../core/session.js";

/** The two survey modules: the questionnaire plugin (mod_questionnaire) and Moodle's feedback. */
export type SurveyType = "questionnaire" | "feedback";

export class SurveyError extends Error {
  override name = "SurveyError";
}

/** One field of a survey question, by its form name. */
export interface SurveyField {
  name: string;
  kind: "choice" | "checkbox" | "text" | "select";
  label?: string;
  options?: { value: string; label: string }[];
  value?: string;
}

export interface SurveyQuestion {
  page: number;
  number?: string;
  text: string;
  required: boolean;
  fields: SurveyField[];
}

/** Where each module keeps its form, its questions, their text and their "required" mark. */
const LAYOUT: Record<SurveyType, { form: string; question: string; text: string; required: string; number: string; next: string; finish: string }> = {
  questionnaire: { form: "#phpesp_response", question: "fieldset.qn-container", text: ".qn-question", required: "img.req", number: ".qn-number", next: "next", finish: "submit" },
  feedback: { form: "form.feedback_form", question: ".feedback_itemlist", text: ".col-form-label", required: ".col-form-label .text-danger", number: ".itemnr", next: "gonextpage", finish: "savevalues" },
};

/** The questions on a survey page, with their fields read from the form (names, options, labels). */
export function readSurveyPage(page: Page, type: SurveyType, pageNumber: number): Promise<SurveyQuestion[]> {
  return inPage(
    page,
    ({ layout, pageNumber }: { layout: (typeof LAYOUT)[SurveyType]; pageNumber: number }) => {
      interface El {
        id: string;
        name: string;
        type: string;
        value: string;
        checked: boolean;
        tagName: string;
        innerText: string;
        options: ArrayLike<{ value: string; text: string; selected: boolean }>;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        closest(s: string): El | null;
        cloneNode(deep: boolean): El;
        remove(): void;
      }
      const doc = (globalThis as unknown as { document: El & { body: El & { appendChild(c: El): void } } }).document;
      // Text as shown, without what only screen readers get.
      const text = (el: El | null | undefined) => {
        if (!el) return "";
        const copy = el.cloneNode(true);
        for (const hidden of Array.from(copy.querySelectorAll(".accesshide, .visually-hidden, .sr-only, input"))) hidden.remove();
        doc.body.appendChild(copy);
        const shown = copy.innerText ?? "";
        copy.remove();
        return shown.replace(/\s+/g, " ").trim();
      };
      // An option's label: its own <label for>, the label around it, or (a rating row) nothing.
      const labelOf = (input: El) => {
        const own = input.id ? doc.querySelector(`label[for="${input.id}"]:not(.accesshide)`) : null;
        const around = input.closest("label");
        return text(own ?? around) || undefined;
      };
      const form = doc.querySelector(layout.form);
      if (!form) return [];
      return Array.from(form.querySelectorAll(layout.question)).map((question) => {
        const fields: SurveyField[] = [];
        for (const input of Array.from(question.querySelectorAll("input:not([type=hidden]), select, textarea"))) {
          if (!input.name) continue;
          if (input.type === "radio") {
            let field = fields.find((f) => f.name === input.name);
            if (!field) {
              // A rating row's item is the row's first cell.
              const row = input.closest("tr.raterow");
              field = { name: input.name, kind: "choice", options: [], ...(row ? { label: text(row.querySelector("td")) } : {}) };
              fields.push(field);
            }
            const label = labelOf(input);
            field.options!.push({ value: input.value, label: label && !label.includes(",") ? label : input.value === "-999" ? "(no answer)" : (label ?? input.value) });
            if (input.checked) field.value = input.value;
          } else if (input.type === "checkbox") {
            fields.push({ name: input.name, kind: "checkbox", label: labelOf(input), value: input.checked ? "1" : "0" });
          } else if (input.tagName === "SELECT") {
            const options = Array.from(input.options);
            fields.push({ name: input.name, kind: "select", options: options.map((o) => ({ value: o.value, label: o.text.trim() })), value: options.find((o) => o.selected)?.value });
          } else {
            fields.push({ name: input.name, kind: "text", ...(input.value ? { value: input.value } : {}) });
          }
        }
        return {
          page: pageNumber,
          number: text(question.querySelector(layout.number)) || undefined,
          text: text(question.querySelector(layout.text)),
          required: question.querySelector(layout.required) !== null,
          fields,
        };
      });
    },
    { layout: LAYOUT[type], pageNumber },
  );
}

/** Whether the person can answer now, and the survey's page message (completed, closed…). */
async function surveyStatus(context: BrowserContext, siteUrl: string, cmid: number, type: SurveyType): Promise<{ canAnswer: boolean; intro: string; messages: string[] }> {
  const page = await openSitePage(context, siteUrl, `mod/${type}/view.php?id=${cmid}`);
  try {
    if ((await page.locator(`body#page-mod-${type}-view`).count()) === 0) throw new SurveyError(`Activity ${cmid} isn't a ${type} you can open. Take its id and module from the course structure.`);
    return await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { innerText: string } | null; querySelectorAll(s: string): ArrayLike<{ innerText: string }> } }).document;
      return {
        canAnswer: doc.querySelector('#region-main a[href*="complete.php"]') !== null,
        intro: (doc.querySelector(".activity-description, #intro")?.innerText ?? "").trim(),
        messages: Array.from(doc.querySelectorAll("#region-main .alert, #region-main .notifymessage, #region-main .complete, #region-main .generalbox p"))
          .map((e) => e.innerText.replace(/\s+/g, " ").trim())
          .filter(Boolean)
          .slice(0, 6),
      };
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Every page of the survey's form: feedback pages through `gopage`, questionnaire sections through `sec`. */
async function readAllPages(context: BrowserContext, siteUrl: string, cmid: number, type: SurveyType): Promise<SurveyQuestion[]> {
  const layout = LAYOUT[type];
  const questions: SurveyQuestion[] = [];
  const page = await openSitePage(context, siteUrl, `mod/${type}/complete.php?id=${cmid}`);
  try {
    for (let p = 0; p < 50; p++) {
      if (p > 0) {
        const next = type === "feedback" ? `mod/feedback/complete.php?id=${cmid}&gopage=${p}` : `mod/questionnaire/complete.php?id=${cmid}&sec=${p + 1}`;
        await page.goto(new URL(next, siteUrl).href, { waitUntil: "domcontentloaded" });
      }
      const found = await readSurveyPage(page, type, p);
      if (found.length === 0) break;
      questions.push(...found);
      if ((await page.locator(`${layout.form} [name="${layout.next}"]`).count()) === 0) break;
    }
    return questions;
  } finally {
    await page.close().catch(() => undefined);
  }
}

// A course module's module never changes: one look per survey and site, for the process.
const surveyTypes = new Map<string, SurveyType>();

/** Which survey module an activity is, from the page each module answers with its own view (body id). */
export async function surveyType(context: BrowserContext, siteUrl: string, cmid: number): Promise<SurveyType> {
  const key = `${siteUrl}|${cmid}`;
  const known = surveyTypes.get(key);
  if (known) return known;
  for (const type of ["questionnaire", "feedback"] as const) {
    const page = await openSitePage(context, siteUrl, `mod/${type}/view.php?id=${cmid}`, { follow: false });
    try {
      if ((await page.locator(`body#page-mod-${type}-view`).count()) > 0) {
        surveyTypes.set(key, type);
        return type;
      }
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  throw new SurveyError(`Activity ${cmid} isn't a questionnaire or a feedback activity you can open. Take its id and module from the course structure.`);
}

/** A survey (questionnaire or feedback): whether it can be answered, its intro and messages, and its questions page by page. Its module is found when not given. */
export async function getSurvey(context: BrowserContext, siteUrl: string, cmid: number, type?: SurveyType) {
  type ??= await surveyType(context, siteUrl, cmid);
  const status = await surveyStatus(context, siteUrl, cmid, type);
  return { ...status, questions: status.canAnswer ? await readAllPages(context, siteUrl, cmid, type) : [] };
}

/**
 * Fills the survey page by page with `responses` (field name → value) and submits it on the last
 * page. Every name is checked against the form first, so nothing is sent with a wrong one.
 */
export function submitSurvey(context: BrowserContext, siteUrl: string, cmid: number, type: SurveyType, responses: Record<string, string>): Promise<{ messages: string[] }>;
export function submitSurvey(context: BrowserContext, siteUrl: string, cmid: number, responses: Record<string, string>, options?: { type?: SurveyType }): Promise<{ messages: string[] }>;
export async function submitSurvey(
  context: BrowserContext,
  siteUrl: string,
  cmid: number,
  typeOrResponses: SurveyType | Record<string, string>,
  responsesOrOptions?: Record<string, string> | { type?: SurveyType },
): Promise<{ messages: string[] }> {
  // (cmid, type, responses), as before 0.2, or (cmid, responses, { type }), the module found when not given.
  const responses = (typeof typeOrResponses === "string" ? responsesOrOptions : typeOrResponses) as Record<string, string>;
  const type = typeof typeOrResponses === "string" ? typeOrResponses : ((responsesOrOptions as { type?: SurveyType } | undefined)?.type ?? (await surveyType(context, siteUrl, cmid)));
  const layout = LAYOUT[type];
  const status = await surveyStatus(context, siteUrl, cmid, type);
  if (!status.canAnswer) throw new SurveyError(`You can't answer ${type} ${cmid} now: ${status.messages.join(" ") || "it's completed, closed or not open yet"}.`);
  const known = new Set((await readAllPages(context, siteUrl, cmid, type)).flatMap((q) => q.fields.map((f) => f.name)));
  const unknown = Object.keys(responses).filter((name) => !known.has(name));
  if (unknown.length > 0) throw new SurveyError(`The survey has no field ${unknown.join(", ")}: take the names from the survey's questions.`);

  const page = await openSitePage(context, siteUrl, `mod/${type}/complete.php?id=${cmid}`);
  try {
    for (let p = 0; p < 50; p++) {
      const here = new Set((await readSurveyPage(page, type, p)).flatMap((q) => q.fields.map((f) => f.name)));
      const values = Object.fromEntries(Object.entries(responses).filter(([name]) => here.has(name)));
      await setFields(page, values, layout.form);
      const last = (await page.locator(`${layout.form} [name="${layout.next}"]`).count()) === 0;
      const [response] = await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`${layout.form} [name="${last ? layout.finish : layout.next}"]`)]);
      if (response && response.status() >= 500) {
        throw new SurveyError(`The site answered ${response.status()} ${last ? "on submitting" : "on the way"}; it may or may not have recorded the answers. Read the survey again before trying again.`);
      }
      // Moodle sends the page back when something's missing or wrong.
      const problems = await page.evaluate((form) => {
        interface El {
          id: string;
          innerText: string;
          cloneNode(deep: boolean): El;
          querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
        }
        const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<El> } }).document;
        const messages = Array.from(doc.querySelectorAll(`${form} [id^="id_error_"], #region-main .alert-danger`)).map((e) => {
          // Without the notification's close button ("Dismiss this notification").
          const copy = e.cloneNode(true);
          for (const button of Array.from(copy.querySelectorAll("button, .close, .visually-hidden"))) button.remove();
          const text = (copy.innerText ?? e.innerText).replace(/\s+/g, " ").trim();
          return text ? `${e.id ? e.id.replace("id_error_", "") + ": " : ""}${text}` : "";
        });
        return [...new Set(messages.filter(Boolean))];
      }, layout.form);
      if (problems.length > 0) throw new SurveyError(`Moodle didn't accept the answers on page ${p + 1}: ${problems.join("; ")}`);
      if (last) break;
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  return { messages: (await surveyStatus(context, siteUrl, cmid, type)).messages };
}
