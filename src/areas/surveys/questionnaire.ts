// A questionnaire's questions (mod_questionnaire) as its teacher builds them: the questions page
// (`questions.php`: the questions in order, page breaks among them, its "Add" menu and the "View all
// responses" tab once someone answered) and each question's form (`questions.php?action=question`,
// its type's fields). The plugin has no service for any of it (its only one submits a response).
import type { BrowserContext, Page } from "playwright-core";
import {
  openForm,
  setFields,
  submitForm,
  type FieldValue,
} from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { SurveyError } from "./surveys.js";

/**
 * The kinds of questionnaire question, by the plugin's own names (`label` is its "Label", which it
 * calls sectiontext): yes/no, a text box, an essay box, radio buttons, check boxes, a dropdown box, a
 * rate scale, a date, a number, a slider, a file, a label and a page break.
 */
export const QUESTIONNAIRE_QUESTION_TYPES = [
  "yesno",
  "text",
  "essay",
  "radio",
  "check",
  "drop",
  "rate",
  "date",
  "numeric",
  "slider",
  "file",
  "label",
  "pagebreak",
] as const;
/** One of `QUESTIONNAIRE_QUESTION_TYPES`. */
export type QuestionnaireQuestionType =
  (typeof QUESTIONNAIRE_QUESTION_TYPES)[number];

/** A rate question's kind of scale: normal, with a "not applicable" column, without repeating a value, or Osgood's (two opposite ends). */
export type QuestionnaireRateKind =
  "normal" | "na-column" | "no-duplicates" | "osgood";

/** A text shown for one of a rate scale's values instead of the number. */
export interface QuestionnaireNamedDegree {
  value: number;
  text: string;
}

/** The type ids the plugin gives each kind (QUES* in mod/questionnaire/classes/question/question.php). */
const TYPE_IDS: Record<QuestionnaireQuestionType, number> = {
  yesno: 1,
  text: 2,
  essay: 3,
  radio: 4,
  check: 5,
  drop: 6,
  rate: 8,
  date: 9,
  numeric: 10,
  slider: 11,
  file: 12,
  pagebreak: 99,
  label: 100,
};
const RATE_KINDS: QuestionnaireRateKind[] = [
  "normal",
  "na-column",
  "no-duplicates",
  "osgood",
];
const WITH_CHOICES: readonly QuestionnaireQuestionType[] = [
  "radio",
  "check",
  "drop",
  "rate",
];
// Their forms have no "Required" setting.
const NEVER_REQUIRED: readonly QuestionnaireQuestionType[] = [
  "label",
  "slider",
  "pagebreak",
];
// The driver doesn't build these yet: a slider's and a file's own settings.
const NOT_ADDED: readonly QuestionnaireQuestionType[] = ["slider", "file"];

/** A question of a questionnaire as its teacher defines it (`questionnaireQuestions`); page breaks are listed too. */
export interface QuestionnaireQuestion {
  id: number;
  type: QuestionnaireQuestionType;
  /** Its place in the questionnaire, from 1, page breaks counted. */
  position: number;
  /** The page it's on, from 1; a page break's is the page it starts. */
  page: number;
  /** The plugin's "Question name": a short name for reports and dependencies; empty when it has none. */
  name: string;
  /** The question's text, as HTML; a label's contents; empty for a page break. */
  question: string;
  required: boolean;
  /** Radio buttons, check boxes, dropdown boxes and rate questions: their choices (a rate's rows), one line each as the plugin keeps them (`!other=` lines included). */
  choices?: string[];
  /** Radio buttons side by side. */
  horizontal?: boolean;
  /** Check boxes: how many must be ticked at least and at most (0 is no limit). */
  minChecked?: number;
  maxChecked?: number;
  /** A text box's width and the most characters it takes. */
  width?: number;
  maxLength?: number;
  /** An essay box: how many lines it shows, and whether it's an HTML editor (otherwise plain text). */
  lines?: number;
  editor?: boolean;
  /** A numeric question: its most digits, and decimal places. */
  maxDigits?: number;
  decimals?: number;
  /** A rate question: how many values its scale has, its kind, and the texts shown instead of some values. */
  scale?: number;
  rateKind?: QuestionnaireRateKind;
  namedDegrees?: QuestionnaireNamedDegree[];
}

/** A question for `addQuestionnaireQuestions`: its type, text and the settings its type takes. */
export interface QuestionnaireQuestionInput {
  /** Any type but `slider` and `file`, which the driver doesn't build yet. */
  type: QuestionnaireQuestionType;
  /** The question's text (HTML); every type but a page break needs one (a label's contents). */
  question?: string;
  /** The plugin's "Question name". */
  name?: string;
  /** Not for labels and page breaks. By default not required. */
  required?: boolean;
  /** Radio buttons, check boxes, dropdown boxes and rate questions: their choices in order, a line each (`!other=Other:` adds an "Other" field). */
  choices?: string[];
  horizontal?: boolean;
  minChecked?: number;
  maxChecked?: number;
  width?: number;
  maxLength?: number;
  lines?: number;
  editor?: boolean;
  maxDigits?: number;
  decimals?: number;
  scale?: number;
  rateKind?: QuestionnaireRateKind;
  namedDegrees?: QuestionnaireNamedDegree[];
  /** Any other field of the question's form, by name. */
  fields?: Record<string, FieldValue>;
}

/** What the questions page tells: the questions' ids in order (page breaks marked), the types its menu offers, and whether anyone has answered. */
interface QuestionsPage {
  entries: { id: number; pagebreak: boolean }[];
  typeIds: string[];
  answered: boolean;
}

function questionsPath(activityId: number): string {
  return `mod/questionnaire/questions.php?id=${activityId}`;
}

/** The questions page, or `SurveyError` with Moodle's reason. */
async function openQuestionsPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<Page> {
  const page = await openSitePage(context, siteUrl, questionsPath(activityId));
  const error = await moodleErrorMessage(page);
  if (
    (await page.locator("body#page-mod-questionnaire-questions").count()) ===
      0 ||
    error !== undefined
  ) {
    await page.close().catch(() => undefined);
    throw new SurveyError(
      `Moodle didn't show the questions of questionnaire ${activityId}${error ? ` (Moodle says: ${error})` : ""}. Building them takes a questionnaire's id (module "questionnaire") from the course structure and the capability mod/questionnaire:editquestions, which editing teachers have.`,
    );
  }
  return page;
}

/** The questions page's questions by their buttons (`removebutton[<id>]`; a page break's edit button is disabled), its type menu and its responses tab. */
export function readQuestionsPage(page: Page): Promise<QuestionsPage> {
  return page.evaluate(() => {
    interface El {
      name: string;
      value: string;
      disabled: boolean;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const entries: { id: number; pagebreak: boolean }[] = [];
    // The deletion area's questions have restore and delete buttons instead (confirmed empirically, plugin 5.0.3, Moodle 5.2).
    for (const remove of Array.from(
      doc.querySelectorAll('form.mform input[name^="removebutton["]'),
    )) {
      const id = Number(/\[(\d+)\]/.exec(remove.name)?.[1]);
      if (!id) continue;
      entries.push({
        id,
        pagebreak:
          doc.querySelector(`form.mform input[name="editbutton[${id}]"]`)
            ?.disabled ?? false,
      });
    }
    const typeIds = Array.from(
      doc.querySelectorAll('form.mform select[name="type_id"] option'),
    ).map((o) => o.value);
    // The "View all responses" tab is there once someone answered (tabs.php), for those who can read them.
    const answered =
      doc.querySelectorAll('a[href*="/mod/questionnaire/report.php?instance="]')
        .length > 0;
    return { entries, typeIds, answered };
  });
}

async function questionsPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<QuestionsPage> {
  const page = await openQuestionsPage(context, siteUrl, activityId);
  try {
    return await readQuestionsPage(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A question form's values by field name (a radio's checked one; a visible field over its hidden twin), and its selects' options. */
export function readQuestionForm(
  page: Page,
): Promise<{
  values: Record<string, string>;
  options: Record<string, string[]>;
}> {
  return page.evaluate(() => {
    interface Field {
      name: string;
      type: string;
      tagName: string;
      value: string;
      checked: boolean;
      options?: ArrayLike<{ value: string }>;
    }
    const doc = (
      globalThis as unknown as {
        document: {
          querySelector(
            s: string,
          ): { querySelectorAll(s: string): ArrayLike<Field> } | null;
        };
      }
    ).document;
    const form = doc.querySelector(
      'form.mform:has(input[name="_qf__mod_questionnaire_edit_question_form"])',
    );
    const values: Record<string, string> = {};
    const options: Record<string, string[]> = {};
    const hidden = new Set<string>();
    for (const field of Array.from(form?.querySelectorAll("[name]") ?? [])) {
      if (
        (field.type === "radio" || field.type === "checkbox") &&
        !field.checked
      )
        continue;
      if (field.type === "submit" || field.type === "image") continue;
      if (field.type === "hidden") {
        if (field.name in values && !hidden.has(field.name)) continue;
        hidden.add(field.name);
      } else hidden.delete(field.name);
      values[field.name] = field.value;
      if (field.tagName === "SELECT")
        options[field.name] = Array.from(field.options ?? []).map(
          (o) => o.value,
        );
    }
    return { values, options };
  });
}

const lines = (text: string | undefined) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim() !== "");
const int = (text: string | undefined) =>
  text === undefined || text === "" ? undefined : Number(text);

/** A question's definition from its form's values. */
export function questionnaireQuestionOf(
  id: number,
  values: Record<string, string>,
  place: { position: number; page: number },
): QuestionnaireQuestion {
  const typeId = Number(values.type_id);
  const type =
    (Object.entries(TYPE_IDS).find(([, tid]) => tid === typeId)?.[0] as
      QuestionnaireQuestionType | undefined) ?? undefined;
  if (!type)
    throw new SurveyError(
      `Question ${id} is of a type the driver doesn't know (type id ${values.type_id}).`,
    );
  const question: QuestionnaireQuestion = {
    id,
    type,
    ...place,
    name: values.name ?? "",
    question: (values["content[text]"] ?? "").trim(),
    required: values.required === "y",
  };
  if (WITH_CHOICES.includes(type)) question.choices = lines(values.allchoices);
  const length = int(values.length);
  const precise = int(values.precise);
  if (type === "radio") question.horizontal = length === 1;
  if (type === "check")
    Object.assign(question, {
      minChecked: length ?? 0,
      maxChecked: precise ?? 0,
    });
  if (type === "text")
    Object.assign(question, { width: length, maxLength: precise });
  // The essay's form names them the other way round: "precise" is the format, "length" the lines (form_length and form_precise in essay.php).
  if (type === "essay")
    Object.assign(question, { lines: length, editor: precise === 0 });
  if (type === "numeric")
    Object.assign(question, { maxDigits: length, decimals: precise });
  if (type === "rate") {
    Object.assign(question, {
      scale: length,
      rateKind: RATE_KINDS[precise ?? 0] ?? "normal",
    });
    const degrees = lines(values.allnameddegrees).flatMap((line) => {
      const match = /^(\d+)=(.*)$/.exec(line.trim());
      return match ? [{ value: Number(match[1]), text: match[2]! }] : [];
    });
    if (degrees.length > 0) question.namedDegrees = degrees;
  }
  return question;
}

/** Every question's definition: the questions page's order and page breaks, each question's form for the rest. */
async function readQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  entries: QuestionsPage["entries"],
): Promise<QuestionnaireQuestion[]> {
  const questions: QuestionnaireQuestion[] = [];
  let page = 1;
  let tab: Page | undefined;
  try {
    for (const [i, entry] of entries.entries()) {
      const place = { position: i + 1, page };
      if (entry.pagebreak) {
        page++;
        questions.push({
          id: entry.id,
          type: "pagebreak",
          position: i + 1,
          page,
          name: "",
          question: "",
          required: false,
        });
        continue;
      }
      const path = `${questionsPath(activityId)}&action=question&qid=${entry.id}`;
      if (!tab) tab = await openSitePage(context, siteUrl, path);
      else
        await tab.goto(new URL(path, siteUrl).href, {
          waitUntil: "domcontentloaded",
        });
      const { values } = await readQuestionForm(tab);
      if (values.qid !== String(entry.id))
        throw new SurveyError(
          `Moodle didn't show the form of question ${entry.id} of questionnaire ${activityId}${(await moodleErrorMessage(tab)) ? ` (Moodle says: ${await moodleErrorMessage(tab)})` : ""}.`,
        );
      questions.push(questionnaireQuestionOf(entry.id, values, place));
    }
  } finally {
    await tab?.close().catch(() => undefined);
  }
  return questions;
}

/**
 * The questions of a questionnaire as its teacher builds them, in order and page by page: each one's
 * id, type, position, page, name, text, whether it's required, its choices and its type's settings
 * (a text box's width, an essay's lines, a rate's scale and named degrees…); page breaks are listed
 * too. Read from the questions page and each question's form, which take
 * `mod/questionnaire:editquestions`; throws `SurveyError` without it.
 */
export async function questionnaireQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<QuestionnaireQuestion[]> {
  const { entries } = await questionsPage(context, siteUrl, activityId);
  return readQuestions(context, siteUrl, activityId, entries);
}

/** Throws unless every given setting is one the type takes. */
function only(
  input: QuestionnaireQuestionInput,
  settings: Partial<
    Record<
      keyof QuestionnaireQuestionInput,
      readonly QuestionnaireQuestionType[]
    >
  >,
): void {
  for (const [key, types] of Object.entries(settings) as [
    keyof QuestionnaireQuestionInput,
    readonly QuestionnaireQuestionType[],
  ][]) {
    if (input[key] !== undefined && !types.includes(input.type))
      throw new SurveyError(
        `A ${input.type} question takes no ${key} (only ${types.join(", ")} questions do).`,
      );
  }
}

function wholeNumber(value: number | undefined, what: string, min = 0): void {
  if (value !== undefined && !(Number.isInteger(value) && value >= min))
    throw new SurveyError(
      `${what} is a whole number from ${min}: ${value} isn't one.`,
    );
}

/** Checks a question before anything is saved: its type, its text, and the settings its type takes. */
export function checkQuestionnaireInput(
  input: QuestionnaireQuestionInput,
): void {
  if (!(QUESTIONNAIRE_QUESTION_TYPES as readonly string[]).includes(input.type))
    throw new SurveyError(
      `"${String(input.type)}" isn't a questionnaire question type: they are ${QUESTIONNAIRE_QUESTION_TYPES.join(", ")}.`,
    );
  if (NOT_ADDED.includes(input.type))
    throw new SurveyError(
      `The driver doesn't add ${input.type} questions yet: their own settings aren't built here. Add them on the questionnaire's questions page.`,
    );
  if (input.type === "pagebreak") {
    const extra = Object.keys(input).filter((key) => key !== "type");
    if (extra.length > 0)
      throw new SurveyError(
        `A page break takes nothing but its place: ${extra.join(", ")} given.`,
      );
    return;
  }
  if (!input.question?.trim())
    throw new SurveyError(
      `A ${input.type} question needs its text (question).`,
    );
  if (input.required !== undefined && NEVER_REQUIRED.includes(input.type))
    throw new SurveyError(
      `A ${input.type} can't be required: its form has no "Required" setting.`,
    );
  only(input, {
    choices: WITH_CHOICES,
    horizontal: ["radio"],
    minChecked: ["check"],
    maxChecked: ["check"],
    width: ["text"],
    maxLength: ["text"],
    lines: ["essay"],
    editor: ["essay"],
    maxDigits: ["numeric"],
    decimals: ["numeric"],
    scale: ["rate"],
    rateKind: ["rate"],
    namedDegrees: ["rate"],
  });
  if (WITH_CHOICES.includes(input.type)) {
    if (!input.choices || input.choices.length === 0)
      throw new SurveyError(`A ${input.type} question needs its choices.`);
    for (const choice of input.choices)
      if (!choice.trim() || /[\r\n]/.test(choice))
        throw new SurveyError(
          `A choice is one line of text: ${JSON.stringify(choice)} isn't one.`,
        );
  }
  wholeNumber(input.minChecked, "minChecked");
  wholeNumber(input.maxChecked, "maxChecked");
  if (
    input.minChecked !== undefined &&
    input.maxChecked &&
    input.maxChecked < input.minChecked
  )
    throw new SurveyError(
      `maxChecked (${input.maxChecked}) is under minChecked (${input.minChecked}).`,
    );
  wholeNumber(input.width, "width", 1);
  wholeNumber(input.maxLength, "maxLength", 1);
  wholeNumber(input.maxDigits, "maxDigits", 1);
  wholeNumber(input.decimals, "decimals");
  wholeNumber(input.scale, "scale", 2);
  if (input.rateKind !== undefined && !RATE_KINDS.includes(input.rateKind))
    throw new SurveyError(
      `A rate question's kind is ${RATE_KINDS.join(", ")}, not "${String(input.rateKind)}".`,
    );
  for (const degree of input.namedDegrees ?? []) {
    if (
      !(
        Number.isInteger(degree.value) &&
        degree.value >= 0 &&
        degree.value < 1000
      ) ||
      !degree.text.trim() ||
      /[\r\n]/.test(degree.text)
    ) {
      throw new SurveyError(
        `A named degree is a value from 0 to 999 and a line of text: ${JSON.stringify(degree)} isn't one.`,
      );
    }
  }
}

/** The form values for a checked question, its select fields checked against what the form offers. */
export function questionnaireFormValues(
  input: QuestionnaireQuestionInput,
  options: Record<string, string[]>,
): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {
    "content[text]": input.question ?? "",
  };
  if (input.name !== undefined) values.name = input.name;
  if (!NEVER_REQUIRED.includes(input.type))
    values.required = input.required ? "y" : "n";
  if (input.choices) values.allchoices = input.choices.join("\n");
  const offered = (field: string, value: number, what: string) => {
    if (options[field] && !options[field].includes(String(value)))
      throw new SurveyError(
        `A ${input.type} question's ${what} is one of ${options[field].join(", ")}, not ${value}.`,
      );
    values[field] = String(value);
  };
  if (input.horizontal !== undefined)
    values.length = input.horizontal ? "1" : "0";
  if (input.minChecked !== undefined) values.length = String(input.minChecked);
  if (input.maxChecked !== undefined) values.precise = String(input.maxChecked);
  if (input.width !== undefined) values.length = String(input.width);
  if (input.maxLength !== undefined) values.precise = String(input.maxLength);
  if (input.lines !== undefined)
    offered("length", input.lines, "number of lines");
  if (input.editor !== undefined) values.precise = input.editor ? "0" : "1";
  if (input.maxDigits !== undefined) values.length = String(input.maxDigits);
  if (input.decimals !== undefined) values.precise = String(input.decimals);
  if (input.scale !== undefined) values.length = String(input.scale);
  if (input.rateKind !== undefined)
    values.precise = String(RATE_KINDS.indexOf(input.rateKind));
  if (input.namedDegrees !== undefined)
    values.allnameddegrees = input.namedDegrees
      .map((d) => `${d.value}=${d.text}`)
      .join("\n");
  return { ...values, ...input.fields };
}

/**
 * Adds questions to a questionnaire, after the ones it has, in the order given: questions of its
 * types with their text, name, whether they're required, their choices and their type's settings
 * (`fields` for any other of the form's), and page breaks among them, which start a new page. Each
 * goes through its form as on the questions page. Everything is checked before anything is saved:
 * the types and their settings, and the page breaks (the plugin drops one first, one after another
 * and one at the end, so they're refused). A questionnaire someone has answered keeps those responses
 * without the new questions: the plugin lets it change anyway (confirmed empirically, plugin 5.0.3,
 * Moodle 5.2), the driver refuses unless `evenWithResponses`. Returns the new questions' ids and every
 * question afterwards.
 */
export async function addQuestionnaireQuestions(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  questions: QuestionnaireQuestionInput[],
  { evenWithResponses = false }: { evenWithResponses?: boolean } = {},
): Promise<{
  changed: string;
  questionIds: number[];
  questions: QuestionnaireQuestion[];
}> {
  if (questions.length === 0)
    throw new SurveyError("Give the questions to add.");
  for (const input of questions) checkQuestionnaireInput(input);
  const before = await questionsPage(context, siteUrl, activityId);
  if (before.answered && !evenWithResponses) {
    throw new SurveyError(
      `Questionnaire ${activityId} has responses already: those wouldn't have the new questions. Make a new questionnaire, delete its responses in Moodle, or pass evenWithResponses to add them anyway.`,
    );
  }
  let previous = before.entries.at(-1)?.pagebreak ?? true;
  for (const [i, input] of questions.entries()) {
    const isBreak = input.type === "pagebreak";
    if (isBreak && previous)
      throw new SurveyError(
        `Question ${i + 1} is a page break ${before.entries.length === 0 && i === 0 ? "first" : "right after another one"}: the plugin drops those.`,
      );
    previous = isBreak;
  }
  if (previous)
    throw new SurveyError(
      "The last question given is a page break: the plugin drops one at the end.",
    );
  for (const input of questions) {
    if (
      input.type !== "pagebreak" &&
      !before.typeIds.includes(String(TYPE_IDS[input.type]))
    )
      throw new SurveyError(
        `Questionnaire ${activityId}'s "Add questions" menu doesn't offer ${input.type} questions.`,
      );
  }

  const questionIds: number[] = [];
  let known = before.entries.map((e) => e.id);
  for (const input of questions) {
    if (input.type === "pagebreak") {
      // As the menu's "Add selected question type" does with "Page Break": added at once, without a form.
      const page = await openForm(context, siteUrl, questionsPath(activityId));
      try {
        await setFields(page, { type_id: String(TYPE_IDS.pagebreak) });
        await submitForm(page, "addqbutton");
      } finally {
        await page.close().catch(() => undefined);
      }
    } else {
      const page = await openForm(
        context,
        siteUrl,
        `${questionsPath(activityId)}&action=question&type_id=${TYPE_IDS[input.type]}`,
      );
      try {
        const { values, options } = await readQuestionForm(page);
        if (values.type_id !== String(TYPE_IDS[input.type]))
          throw new SurveyError(
            `Moodle didn't show the form for a ${input.type} question of questionnaire ${activityId}.`,
          );
        await setFields(page, questionnaireFormValues(input, options));
        await submitForm(page, "submitbutton");
      } finally {
        await page.close().catch(() => undefined);
      }
    }
    const now = (await questionsPage(context, siteUrl, activityId)).entries.map(
      (e) => e.id,
    );
    const added = now.find((id) => !known.includes(id));
    if (!added) {
      const done =
        questionIds.length > 0
          ? ` (the ${questionIds.length} before it were added: ${questionIds.join(", ")})`
          : "";
      throw new SurveyError(
        `Moodle added no ${input.type} question to questionnaire ${activityId}${done}.`,
      );
    }
    questionIds.push(added);
    known = now;
  }
  const after = await questionsPage(context, siteUrl, activityId);
  const all = await readQuestions(context, siteUrl, activityId, after.entries);
  const counted =
    questionIds.length === 1 ? "1 question" : `${questionIds.length} questions`;
  return {
    changed: `Added ${counted} to questionnaire ${activityId}.`,
    questionIds,
    questions: all,
  };
}
