// The question types createQuestion and updateQuestion make and change through their edit forms:
// the inputs each type takes, checked before its form opens, the form filled by field names, and
// the forms that take more than one step (the calculated types' wildcards, the drag and drop onto
// an image types' files and their drop zones' menus, filled in by the page's script).
import type { Page } from "playwright-core";
import { checkLocalFiles } from "../../core/files.js";
import { deleteDraftFile, draftFiles, formValue, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { QuestionBankError } from "./errors.js";

/**
 * The question types `createQuestion` makes through their form: Moodle's own, then plugins'
 * (`coderunner`, `formulas`, `gapfill`, `ddmatch`), made when the site has them. Others are
 * imported (GIFT, Moodle XML).
 */
export const QUESTION_TYPES = [
  "multichoice",
  "truefalse",
  "shortanswer",
  "numerical",
  "essay",
  "calculated",
  "calculatedsimple",
  "calculatedmulti",
  "match",
  "randomsamatch",
  "ddwtos",
  "ddimageortext",
  "ddmarker",
  "gapselect",
  "multianswer",
  "ordering",
  "description",
  "coderunner",
  "formulas",
  "gapfill",
  "ddmatch",
] as const;
/** One of `QUESTION_TYPES`. */
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The plugin types among `QUESTION_TYPES`, by the name their plugin goes by. */
export const PLUGIN_QUESTION_TYPES: Partial<Record<string, string>> = { coderunner: "CodeRunner", formulas: "Formulas", gapfill: "Gap fill", ddmatch: "Drag and drop matching" };

/**
 * A drop zone of a drag and drop onto an image (`ddimageortext`: its top left corner, in pixels of
 * the background image) or of a drag and drop markers (`ddmarker`: its shape and coordinates, as
 * Moodle's form takes them: a circle "x,y;r", a rectangle "x,y;width,height", a polygon
 * "x1,y1;x2,y2;…"). `choice` is the number of the item or marker that goes there, from 1, in the
 * order given.
 */
export interface DropZone {
  choice: number;
  left?: number;
  top?: number;
  /** ddimageortext: the zone's label, for screen readers. */
  label?: string;
  shape?: "circle" | "rectangle" | "polygon";
  coords?: string;
}

/** A question for `createQuestion`, or the changes for `updateQuestion` (without its type). */
export interface QuestionInput {
  type: QuestionType;
  name: string;
  /**
   * The question's text (HTML). Its type's places go in it: `[[1]]`, `[[2]]`… for the choices of
   * ddwtos and gapselect, a Cloze question's answers (`{1:SHORTANSWER:=Paris}`), a gap fill's
   * `[gaps]`, a calculated question's `{wildcards}`.
   */
  text: string;
  /**
   * Answers: a fraction of the mark (1 right, 0 wrong, negatives for penalties), the nearest one
   * Moodle offers. Multichoice, short answer and numerical; and the calculated types, whose answer
   * is a formula of the wildcards (`{a} + {b}`; in calculatedmulti, `{={a} + {b}}` inside the text).
   * A numerical or calculated answer's `tolerance` is the error accepted around it.
   */
  answers?: { text: string; fraction: number; feedback?: string; tolerance?: number }[];
  /** True/false: the right answer. */
  correct?: boolean;
  /** Matching (match, ddmatch): each question and its answer; an answer without a question is a distractor. */
  pairs?: { question: string; answer: string }[];
  /** Random short-answer matching: how many short-answer questions of the category it draws. */
  choose?: number;
  /** Drag and drop into text, select missing words: the choices `[[1]]`, `[[2]]`… name, by position; a group (1 by default) is a set of choices that go in the same places; `unlimited` (ddwtos) lets a choice be used more than once. */
  choices?: { text: string; group?: number; unlimited?: boolean }[];
  /** Drag and drop onto an image, markers: the background image, a local file. */
  image?: string;
  /** Drag and drop onto an image: the draggable items, a word (`text`) or a local image file (`image`, with `text` as its alternative text). */
  drags?: { text?: string; image?: string; group?: number; unlimited?: boolean }[];
  /** Drag and drop markers: the markers, and how many times each can be placed (unlimited by default). */
  markers?: { text: string; count?: number }[];
  /** Drag and drop onto an image, markers: where the items or markers go. */
  drops?: DropZone[];
  /** Ordering: the items, in the right order. */
  items?: string[];
  /**
   * Calculated types: each wildcard's values, as a range Moodle draws them from (`min`, `max`,
   * `decimals`, `distribution`) or given (`values`, one per set). Without them Moodle's ranges
   * (1 to 10) are used.
   */
  wildcards?: { name: string; min?: number; max?: number; decimals?: number; distribution?: "uniform" | "loguniform"; values?: number[] }[];
  /** Calculated types: how many sets of values to draw (10 by default; the `values` given set it). */
  sets?: number;
  /** CodeRunner: its question type (the language and how it's run, "python3"…), a sample answer it's checked with when saved, and the test cases. */
  coderunner?: { type: string; answer?: string; testCases: { code: string; expected: string; stdin?: string; extra?: string; useAsExample?: boolean; mark?: number }[] };
  /** Formulas: its random and global variables, and its parts, each with its answer (and its own text, mark, unit, variables, grading criterion). */
  formulas?: {
    randomVariables?: string;
    globalVariables?: string;
    parts: { answer: string; text?: string; mark?: number; unit?: string; localVariables?: string; gradingVariables?: string; gradingCriterion?: string; feedback?: string }[];
  };
  /** The bank's category it goes in; a new question goes in the bank's default one when left out. */
  categoryId?: number;
  defaultMark?: number;
  /** Any other field of the type's form, by name. */
  fields?: Record<string, FieldValue>;
}

type TypeInput = "answers" | "correct" | "pairs" | "choose" | "choices" | "image" | "drags" | "markers" | "drops" | "items" | "wildcards" | "sets" | "coderunner" | "formulas";

/** The inputs each type takes beyond the common ones, the required first `required` of them. */
const TYPE_INPUTS: Record<string, { takes: TypeInput[]; required: number }> = {
  multichoice: { takes: ["answers"], required: 1 },
  truefalse: { takes: ["correct"], required: 1 },
  shortanswer: { takes: ["answers"], required: 1 },
  numerical: { takes: ["answers"], required: 1 },
  essay: { takes: [], required: 0 },
  calculated: { takes: ["answers", "wildcards", "sets"], required: 1 },
  calculatedsimple: { takes: ["answers", "wildcards", "sets"], required: 1 },
  calculatedmulti: { takes: ["answers", "wildcards", "sets"], required: 1 },
  match: { takes: ["pairs"], required: 1 },
  ddmatch: { takes: ["pairs"], required: 1 },
  randomsamatch: { takes: ["choose"], required: 0 },
  ddwtos: { takes: ["choices"], required: 1 },
  gapselect: { takes: ["choices"], required: 1 },
  ddimageortext: { takes: ["image", "drags", "drops"], required: 3 },
  ddmarker: { takes: ["image", "markers", "drops"], required: 3 },
  multianswer: { takes: [], required: 0 },
  ordering: { takes: ["items"], required: 1 },
  description: { takes: [], required: 0 },
  gapfill: { takes: [], required: 0 },
  coderunner: { takes: ["coderunner"], required: 1 },
  formulas: { takes: ["formulas"], required: 1 },
};

/** "A match", "An essay": a type's name with its article. */
const aType = (type: string) => `${/^[aeiou]/.test(type) ? "An" : "A"} ${type}`;

const TYPE_INPUT_NAMES: TypeInput[] = ["answers", "correct", "pairs", "choose", "choices", "image", "drags", "markers", "drops", "items", "wildcards", "sets", "coderunner", "formulas"];

/**
 * Checks a question's inputs against its type before its form opens: the type's required inputs
 * when creating (empty lists count as missing), no input another type takes, drop zones naming
 * items there are, wildcards' values of one length, local files there.
 */
export async function checkQuestionInput(type: string, input: Partial<QuestionInput>, { creating }: { creating: boolean }): Promise<void> {
  const spec = TYPE_INPUTS[type];
  const given = TYPE_INPUT_NAMES.filter((name) => input[name] !== undefined);
  if (!spec) {
    // A type this doesn't know (editing one made otherwise): its fields only.
    if (given.length > 0) throw new QuestionBankError(`${type ? `${aType(type)} question` : "A question of this type"} isn't changed with ${given.join(", ")}; give its form's fields instead.`);
    return;
  }
  const foreign = given.filter((name) => !spec.takes.includes(name));
  if (foreign.length > 0) throw new QuestionBankError(`${aType(type)} question doesn't take ${foreign.join(", ")}${spec.takes.length > 0 ? `: it takes ${spec.takes.join(", ")}` : ""}.`);
  if (creating) {
    const missing = spec.takes.slice(0, spec.required).filter((name) => {
      const value = input[name];
      return value === undefined || (Array.isArray(value) && value.length === 0);
    });
    if (type === "truefalse" && missing.length > 0) throw new QuestionBankError("A true/false question needs its right answer (correct).");
    if (missing.length > 0) throw new QuestionBankError(`${aType(type)} question needs ${missing.join(", ")}.`);
  }
  if (type === "ordering" && input.items && input.items.length < 2) throw new QuestionBankError("An ordering question needs two items at least.");
  if (input.coderunner && (!input.coderunner.type || input.coderunner.testCases.length === 0)) throw new QuestionBankError("A CodeRunner question needs its type and test cases.");
  if (input.formulas && input.formulas.parts.length === 0) throw new QuestionBankError("A Formulas question needs its parts.");
  const sources = type === "ddmarker" ? input.markers : input.drags;
  for (const drop of input.drops ?? []) {
    if (sources && !(drop.choice >= 1 && drop.choice <= sources.length)) throw new QuestionBankError(`A drop zone's choice is the number of one of the ${sources.length} ${type === "ddmarker" ? "markers" : "drags"}, from 1: ${drop.choice} isn't.`);
    if (type === "ddimageortext" && (drop.left === undefined || drop.top === undefined)) throw new QuestionBankError("A drop zone onto an image needs its left and top.");
    if (type === "ddmarker" && (!drop.shape || !drop.coords)) throw new QuestionBankError("A marker's drop zone needs its shape and coords.");
  }
  const lengths = new Set((input.wildcards ?? []).flatMap((w) => (w.values ? [w.values.length] : [])));
  if (lengths.size > 1 || lengths.has(0)) throw new QuestionBankError("The wildcards' values make sets: give each wildcard as many values, one per set.");
  if (input.sets !== undefined && !(Number.isInteger(input.sets) && input.sets >= 1 && input.sets <= 100)) throw new QuestionBankError(`Moodle keeps 1 to 100 sets of a calculated question's values, not ${input.sets}.`);
  const files = [input.image, ...(input.drags ?? []).map((d) => d.image)].filter((f): f is string => typeof f === "string");
  if (files.length > 0) await checkLocalFiles(files);
}

/** Clicks one of the form's buttons that sends it to come back (more blanks, a reload): the values set stay. */
async function reload(page: Page, button: string): Promise<void> {
  await submitForm(page, button);
}

/** Adds blank rows with the form's button until the form has `needed` (its count in the hidden `countField`). */
async function addRows(page: Page, countField: string, button: string, needed: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const count = Number((await formValue(page, countField)) ?? needed);
    if (count >= needed) return;
    // Ordering asks how many to add (10 at most); the others add a fixed number.
    if ((await formValue(page, "addanswerscount")) !== undefined) await setFields(page, { addanswerscount: String(Math.min(10, needed - count)) });
    await reload(page, button);
  }
}

/** Whether the form has a field by that name. */
async function has(page: Page, name: string): Promise<boolean> {
  return (await formValue(page, name)) !== undefined;
}

/** The option of a fraction select nearest to `fraction` (Moodle offers 100%, 90%, 83.33%…). */
async function nearestFraction(page: Page, field: string, fraction: number): Promise<string> {
  const options = await page.evaluate(
    (field) => Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll(`select[name="${field}"] option`)).map((o) => o.value),
    field,
  );
  return options.reduce((best, value) => (Math.abs(Number(value) - fraction) < Math.abs(Number(best) - fraction) ? value : best), options[0] ?? "0.0");
}

/**
 * Gives selects the options `1`…`count` they lack, all enabled: the drop zones' item menus, which
 * the page's script fills from the items only once it has drawn the background image, and where it
 * disables the items other zones have (a disabled option chosen isn't sent, and Moodle keeps the
 * zone's old item). Moodle's form takes any of them (confirmed empirically, 5.2).
 */
async function addOptions(page: Page, names: string[], count: number): Promise<void> {
  await page.evaluate(
    ({ names, count }) => {
      const doc = (globalThis as unknown as {
        document: {
          querySelector(s: string): { options: ArrayLike<{ value: string; disabled: boolean }>; appendChild(o: unknown): void } | null;
          createElement(tag: string): { value: string; textContent: string };
        };
      }).document;
      for (const name of names) {
        const select = doc.querySelector(`form.mform select[name="${name}"]`);
        if (!select) continue;
        for (const option of Array.from(select.options)) option.disabled = false;
        const values = Array.from(select.options).map((o) => o.value);
        for (let i = 1; i <= count; i++) {
          if (values.includes(String(i))) continue;
          const option = doc.createElement("option");
          option.value = String(i);
          option.textContent = String(i);
          select.appendChild(option);
        }
      }
    },
    { names, count },
  );
}

/** Puts one local file in a file picker's draft area, replacing what it had. */
async function replaceDraftFile(page: Page, field: string, file: string | undefined): Promise<void> {
  const draft = await formValue(page, field);
  if (!draft) throw new QuestionBankError(`The form has no file picker ${field}.`);
  for (const old of await draftFiles(page, draft)) await deleteDraftFile(page, draft, old.name);
  if (file) await uploadToDraft(page, draft, [file]);
}

/**
 * Fills a question's edit form with what's given: name, text, mark, category, and its type's
 * inputs, by the form's field names, then any other field by name. Editing (`blankRest`), a list
 * given replaces the question's: the form's other rows are blanked, and Moodle drops blank ones.
 */
export async function fillQuestionForm(page: Page, type: string, input: Partial<QuestionInput>, { blankRest, category }: { blankRest: boolean; category?: string }): Promise<void> {
  // Rows first: the buttons adding blanks send the form back.
  const lists: [unknown[] | undefined, string, string][] = [
    [input.answers ?? input.pairs ?? input.choices ?? input.formulas?.parts, "noanswers", "addanswers"],
    [input.items, "countanswers", "addanswers"],
    [input.drags ?? input.markers, "noitems", "additems"],
    [input.drops, "nodropzone", "adddropzone"],
    [input.coderunner?.testCases, "numtestcases", "addanswers"],
  ];
  for (const [list, count, button] of lists) if (list && (await has(page, count))) await addRows(page, count, button, list.length);

  const values: Record<string, FieldValue> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.text !== undefined) values["questiontext[text]"] = input.text;
  if (input.defaultMark !== undefined) values.defaultmark = input.defaultMark;
  if (category) values.category = category;
  if (type === "truefalse" && input.correct !== undefined) values.correctanswer = input.correct ? 1 : 0;
  if (input.choose !== undefined) values.choose = String(input.choose);
  // How many rows to fill: the given ones, and editing, every other row the form has, blanked.
  const rows = async (given: number, count: string) => (blankRest ? Math.max(given, Number((await formValue(page, count)) ?? 0)) : given);

  const answers = input.answers;
  if (answers) {
    if (await has(page, "single")) values.single = answers.filter((a) => a.fraction > 0).length > 1 ? 0 : 1;
    // Multichoice and calculatedmulti answers are editors; the others plain text.
    const editor = await has(page, "answer[0][text]");
    for (let i = 0; i < (await rows(answers.length, "noanswers")); i++) {
      const answer = answers[i];
      values[editor ? `answer[${i}][text]` : `answer[${i}]`] = answer?.text ?? "";
      values[`fraction[${i}]`] = await nearestFraction(page, `fraction[${i}]`, answer?.fraction ?? 0);
      if (answer?.feedback !== undefined) values[`feedback[${i}][text]`] = answer.feedback;
      else if (!answer && (await has(page, `feedback[${i}][text]`))) values[`feedback[${i}][text]`] = "";
      if (answer?.tolerance !== undefined) values[`tolerance[${i}]`] = answer.tolerance;
    }
  }
  if (input.pairs) {
    // Drag and drop matching's answers are editors too.
    const editor = await has(page, "subanswers[0][text]");
    for (let i = 0; i < (await rows(input.pairs.length, "noanswers")); i++) {
      values[`subquestions[${i}][text]`] = input.pairs[i]?.question ?? "";
      values[editor ? `subanswers[${i}][text]` : `subanswers[${i}]`] = input.pairs[i]?.answer ?? "";
    }
  }
  if (input.choices) {
    const infinite = await has(page, "choices[0][infinite]");
    for (let i = 0; i < (await rows(input.choices.length, "noanswers")); i++) {
      const choice = input.choices[i];
      values[`choices[${i}][answer]`] = choice?.text ?? "";
      values[`choices[${i}][choicegroup]`] = String(choice?.group ?? 1);
      if (infinite) values[`choices[${i}][infinite]`] = choice?.unlimited ?? false;
    }
  }
  if (input.items) {
    for (let i = 0; i < (await rows(input.items.length, "countanswers")); i++) values[`answer[${i}][text]`] = input.items[i] ?? "";
  }
  if (input.drags) {
    for (let i = 0; i < (await rows(input.drags.length, "noitems")); i++) {
      const drag = input.drags[i];
      values[`drags[${i}][dragitemtype]`] = drag?.image ? "image" : "word";
      values[`drags[${i}][draggroup]`] = String(drag?.group ?? 1);
      values[`drags[${i}][infinite]`] = drag?.unlimited ?? false;
      values[`draglabel[${i}]`] = drag?.text ?? "";
      if (drag?.image || blankRest) await replaceDraftFile(page, `dragitem[${i}]`, drag?.image);
    }
  }
  if (input.markers) {
    for (let i = 0; i < (await rows(input.markers.length, "noitems")); i++) {
      values[`drags[${i}][label]`] = input.markers[i]?.text ?? "";
      values[`drags[${i}][noofdrags]`] = String(input.markers[i]?.count ?? 0);
    }
  }
  if (input.image) await replaceDraftFile(page, "bgimage", input.image);
  if (input.coderunner) {
    const { type: kind, answer, testCases } = input.coderunner;
    // Choosing the type loads its template into the form: set first, on its own.
    await setFields(page, { coderunnertype: kind });
    if (answer !== undefined) values.answer = answer;
    for (let i = 0; i < (await rows(testCases.length, "numtestcases")); i++) {
      const test = testCases[i];
      values[`testcode[${i}]`] = test?.code ?? "";
      values[`expected[${i}]`] = test?.expected ?? "";
      if (test?.stdin !== undefined || (blankRest && !test)) values[`stdin[${i}]`] = test?.stdin ?? "";
      if (test?.extra !== undefined || (blankRest && !test)) values[`extra[${i}]`] = test?.extra ?? "";
      if (test?.useAsExample !== undefined) values[`useasexample[${i}]`] = test.useAsExample;
      if (test?.mark !== undefined) values[`mark[${i}]`] = test.mark;
    }
  }
  if (input.formulas) {
    const { randomVariables, globalVariables, parts } = input.formulas;
    if (randomVariables !== undefined) values.varsrandom = randomVariables;
    if (globalVariables !== undefined) values.varsglobal = globalVariables;
    for (let i = 0; i < (await rows(parts.length, "noanswers")); i++) {
      const part = parts[i];
      values[`answer[${i}]`] = part?.answer ?? "";
      if (part?.text !== undefined || (blankRest && !part)) values[`subqtext[${i}][text]`] = part?.text ?? "";
      if (part?.mark !== undefined) values[`answermark[${i}]`] = part.mark;
      if (part?.unit !== undefined) values[`postunit[${i}]`] = part.unit;
      if (part?.localVariables !== undefined) values[`vars1[${i}]`] = part.localVariables;
      if (part?.gradingVariables !== undefined) values[`vars2[${i}]`] = part.gradingVariables;
      if (part?.gradingCriterion !== undefined) values[`correctness[${i}]`] = part.gradingCriterion;
      if (part?.feedback !== undefined) values[`feedback[${i}][text]`] = part.feedback;
    }
  }
  await setFields(page, values);

  // The drop zones after the items: their menus list them.
  if (input.drops) {
    const drops: Record<string, FieldValue> = {};
    const count = await rows(input.drops.length, "nodropzone");
    const menus = Array.from({ length: count }, (_, i) => `drops[${i}][choice]`);
    await addOptions(page, menus, Number((await formValue(page, "noitems")) ?? 0));
    for (let i = 0; i < count; i++) {
      const drop = input.drops[i];
      drops[`drops[${i}][choice]`] = String(drop?.choice ?? 0);
      if (type === "ddmarker") {
        drops[`drops[${i}][shape]`] = drop?.shape ?? "0";
        drops[`drops[${i}][coords]`] = drop?.coords ?? "";
      } else {
        drops[`drops[${i}][xleft]`] = drop?.left ?? "";
        drops[`drops[${i}][ytop]`] = drop?.top ?? "";
        drops[`drops[${i}][droplabel]`] = drop?.label ?? "";
      }
    }
    await setFields(page, drops);
    await addOptions(page, menus, Number((await formValue(page, "noitems")) ?? 0));
  }
  if (input.fields) await setFields(page, input.fields);
}

/** A dataset field of the wildcards' form: `number[k]` with its wildcard and item id. */
interface DatasetItem {
  k: number;
  wildcard: string;
  itemId: number;
}

/** The wildcards' form as it stands: each range's wildcard by its index, and the values' fields. */
async function readDatasets(page: Page): Promise<{ wildcards: string[]; items: DatasetItem[] }> {
  const fields = await page.evaluate(() =>
    Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string; value: string }> } }).document.querySelectorAll("form.mform input[name]")).map((f) => [f.name, f.value] as [string, string]),
  );
  const read = (prefix: string) =>
    new Map(
      fields.flatMap(([field, value]) => {
        const m = new RegExp(`^${prefix}\\[(\\d+)\\]$`).exec(field);
        return m ? [[Number(m[1]), value] as [number, string]] : [];
      }),
    );
  const itemIds = read("itemid");
  // A dataset definition reads "<type>-<category>-<wildcard>".
  const name = (def: string) => def.split("-").slice(2).join("-");
  const defs = Array.from(read("datasetdef").entries()).sort((a, b) => a[0] - b[0]).map(([, def]) => name(def));
  const items = Array.from(read("definition").entries()).map(([k, def]) => ({ k, wildcard: name(def), itemId: Number(itemIds.get(k) ?? 0) })).sort((a, b) => a.k - b.k);
  if (defs.length > 0) return { wildcards: defs, items };
  // The wizard's last page: the ranges follow the "item to add", the last ones listed.
  const ranges = await page.locator('form.mform [name^="calcmin["]').count();
  const toAdd = items.slice(items.length - ranges);
  return { wildcards: toAdd.map((item) => item.wildcard), items: items.slice(0, items.length - ranges) };
}

/** The ranges given, as the wildcards' form fields; refuses a wildcard the question doesn't have. */
function rangeFields(wildcards: string[], given: NonNullable<QuestionInput["wildcards"]>, canDistribute: boolean): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const wildcard of given) {
    const j = wildcards.indexOf(wildcard.name) + 1;
    if (j === 0) throw new QuestionBankError(`The question's wildcards are ${wildcards.join(", ") || "none"}: it has no {${wildcard.name}}. Its answers' formulas name them.`);
    if (wildcard.min !== undefined) values[`calcmin[${j}]`] = wildcard.min;
    if (wildcard.max !== undefined) values[`calcmax[${j}]`] = wildcard.max;
    if (wildcard.decimals !== undefined) values[`calclength[${j}]`] = String(wildcard.decimals);
    if (wildcard.distribution !== undefined && canDistribute) values[`calcdistribution[${j}]`] = wildcard.distribution;
  }
  return values;
}

/** The given values, in the form's values' fields: set `n` of item `k` is `ceil(k / wildcards)`, as Moodle numbers them. */
function valueFields(wildcards: string[], items: DatasetItem[], given: QuestionInput["wildcards"]): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  for (const item of items) {
    const value = given?.find((w) => w.name === item.wildcard)?.values?.[Math.ceil(item.k / wildcards.length) - 1];
    if (value !== undefined) values[`number[${item.k}]`] = value;
  }
  return values;
}

/** The selects' options: Moodle's add and delete menus offer 1, 10, 20… 100. */
function chunk(count: number): number {
  return count >= 10 ? Math.min(100, Math.floor(count / 10) * 10) : 1;
}

/**
 * The calculated wizard's last page (calculated, calculatedmulti): the ranges set, the sets added
 * or deleted to the number wanted (Moodle draws an added set's values itself), the values given
 * written over them; then saved. Ranges changed without values draw every set again.
 */
async function fillWizardDatasets(page: Page, input: Partial<QuestionInput>): Promise<void> {
  let { wildcards, items } = await readDatasets(page);
  const given = input.wildcards ?? [];
  const ranges = rangeFields(wildcards, given, true);
  const drawn = given.find((w) => w.values)?.values?.length;
  const have = () => items.length / Math.max(1, wildcards.length);
  let want = drawn ?? input.sets ?? (have() > 0 ? have() : 10);
  // New ranges without values: every set drawn again from them.
  const redraw = drawn === undefined && (Object.keys(ranges).length > 0 || input.sets !== undefined);
  if (redraw) want = input.sets ?? (have() > 0 ? have() : 10);
  await setFields(page, ranges);
  for (let i = 0; i < 40 && redraw && have() > 0; i++) {
    await setFields(page, { selectdelete: String(chunk(have())) });
    await reload(page, "deletebutton");
    ({ wildcards, items } = await readDatasets(page));
  }
  for (let i = 0; i < 40 && have() !== want; i++) {
    if (have() < want) {
      await setFields(page, { selectadd: String(chunk(want - have())) });
      await reload(page, "addbutton");
    } else {
      await setFields(page, { selectdelete: String(chunk(have() - want)) });
      await reload(page, "deletebutton");
    }
    ({ wildcards, items } = await readDatasets(page));
  }
  await setFields(page, valueFields(wildcards, items, input.wildcards));
  await submitForm(page, "savechanges");
}

/**
 * A calculated simple question's wildcards, on its one page: found in the answers, the ranges set,
 * the sets drawn (Generate replaces them all), the values given written over them.
 */
async function fillSimpleDatasets(page: Page, input: Partial<QuestionInput>, { creating }: { creating: boolean }): Promise<void> {
  if (!creating && !input.answers && !input.wildcards && input.sets === undefined) return;
  await reload(page, "analyzequestion");
  let { wildcards, items } = await readDatasets(page);
  await setFields(page, rangeFields(wildcards, input.wildcards ?? [], false));
  const drawn = input.wildcards?.find((w) => w.values)?.values?.length;
  const have = items.length / Math.max(1, wildcards.length);
  // Unchanged ranges and as many sets: the question's values stay.
  if (creating || input.wildcards || input.sets !== undefined || have === 0) {
    const want = drawn ?? input.sets ?? (have > 0 ? have : 10);
    // Its form reads how many to generate from the request, any number (confirmed empirically, 5.2).
    await addOptions(page, ["selectadd"], want);
    await setFields(page, { selectadd: String(want) });
    await reload(page, "addbutton");
    ({ wildcards, items } = await readDatasets(page));
  }
  await setFields(page, valueFields(wildcards, items, input.wildcards));
}

/**
 * Saves a filled question form: its one page, or the calculated wizard's pages (the question, its
 * wildcards' datasets, their values: confirmed empirically, 5.2). Moodle lands on the bank.
 */
export async function saveQuestionForm(page: Page, type: string, input: Partial<QuestionInput>, { blankRest }: { blankRest: boolean }): Promise<void> {
  if (type === "calculatedsimple") await fillSimpleDatasets(page, input, { creating: !blankRest });
  await submitForm(page, "submitbutton");
  if (type !== "calculated" && type !== "calculatedmulti") return;
  // The question is saved by now; its wildcards are private to it (the definitions page's default).
  if (new URL(page.url()).searchParams.get("wizardnow") === "datasetdefinitions") await submitForm(page, "submitbutton");
  if (new URL(page.url()).searchParams.get("wizardnow") !== "datasetitems") throw new QuestionBankError(`Moodle didn't show the ${type} question's wildcards page after saving it.`);
  await fillWizardDatasets(page, input);
}

