// A feedback's items (its questions, texts and page breaks) as its teacher builds them: the
// questions page (`mod/feedback/edit.php`: the types offered, the delete links), the items' export
// (`export.php`, every item's settings in order), each type's form (`edit_item.php`), the reorder
// service its drag and drop uses, and the templates (`manage_templates.php`, its dynamic forms).
// Moodle's other feedback services aren't open to AJAX (confirmed empirically, Moodle 5.2).
import type { BrowserContext, Page } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { FormError, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { siteFetch } from "../../core/http.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, moodleErrorMessage, openSitePage } from "../../core/session.js";
import { SurveyError } from "./surveys.js";

/** The kinds of feedback item, by Moodle's own names: choices, rated choices, short and long text, a number, information, a label, a CAPTCHA and a page break. */
export const FEEDBACK_ITEM_TYPES = ["multichoice", "multichoicerated", "textfield", "textarea", "numeric", "info", "label", "captcha", "pagebreak"] as const;
/** One of `FEEDBACK_ITEM_TYPES`. */
export type FeedbackItemType = (typeof FEEDBACK_ITEM_TYPES)[number];

/** How a choice item shows its options: radio buttons, checkboxes (several answers) or a drop-down list. */
export type FeedbackChoiceDisplay = "radio" | "checkbox" | "dropdown";

/** What an information item shows: when the response was given, the course or its category. */
export type FeedbackInfoKind = "response-time" | "course" | "category";

/** An option of a choice item; a rated choice's options carry their weight. */
export interface FeedbackItemOption {
  text: string;
  weight?: number;
}

/** An item of a feedback as its teacher defines it (`feedbackItems`). */
export interface FeedbackItemDefinition {
  id: number;
  type: FeedbackItemType;
  /** Its place in the feedback, from 1. */
  position: number;
  /** The question (Moodle's "Question" field); empty for a label or a page break. */
  question: string;
  /** Moodle's "Label" field: a short name for the item in reports and dependencies. */
  label?: string;
  required: boolean;
  /** Choice items: the options, in order. */
  options?: FeedbackItemOption[];
  /** Choice items: radio buttons, checkboxes (multichoice only) or a drop-down list. */
  display?: FeedbackChoiceDisplay;
  /** Choice items: the options side by side. */
  horizontal?: boolean;
  /** Choice items: without the "Not selected" option. */
  hideNotSelected?: boolean;
  /** Choice items: empty answers left out of the analysis. */
  ignoreEmpty?: boolean;
  /** A numeric item's range, where it has one. */
  range?: { from?: number; to?: number };
  /** An information item's kind. */
  info?: FeedbackInfoKind;
  /** A label's contents (HTML). */
  contents?: string;
  /** Shown only when another item (by its id) was answered with this value. */
  dependsOn?: { itemId: number; value: string };
}

/** An item for `addFeedbackItem`, or the changes for `editFeedbackItem` (without its type). */
export interface FeedbackItemInput {
  type: FeedbackItemType;
  /** The question; every type but a label and a page break needs one. */
  question?: string;
  label?: string;
  /** Not for information items, labels and page breaks, which Moodle never makes required. */
  required?: boolean;
  /** Choice items: the options, in order (given, they replace them all); a rated choice's with their weights. */
  options?: (string | FeedbackItemOption)[];
  display?: FeedbackChoiceDisplay;
  horizontal?: boolean;
  hideNotSelected?: boolean;
  ignoreEmpty?: boolean;
  /** A numeric item's range; a bound left out is none. */
  range?: { from?: number; to?: number };
  info?: FeedbackInfoKind;
  /** A label's contents (HTML). */
  contents?: string;
  /** Show it only when another item (by its id) was answered with this value; `null` removes the dependency. */
  dependsOn?: { itemId: number; value: string } | null;
  /** Any other field of the item's form, by name (`itemsize`, `itemmaxlength`, `itemwidth`, `itemheight`…). */
  fields?: Record<string, FieldValue>;
}

/** A feedback template: the course's own, or public (the whole site's). */
export interface FeedbackTemplate {
  id: number;
  name: string;
  public: boolean;
}

// Moodle's separators in an item's presentation (FEEDBACK_MULTICHOICE_* in mod/feedback/item/*/lib.php).
const TYPE_SEP = ">>>>>";
const LINE_SEP = "|";
const ADJUST_SEP = "<<<<<";
const RATED_SEP = "####";
const DISPLAYS: Record<string, FeedbackChoiceDisplay> = { r: "radio", c: "checkbox", d: "dropdown" };
const INFO_KINDS: Record<string, FeedbackInfoKind> = { "1": "response-time", "2": "course", "3": "category" };
const CHOICES: readonly FeedbackItemType[] = ["multichoice", "multichoicerated"];
// Items Moodle never makes required: their forms have no "Required" checkbox.
const NEVER_REQUIRED: readonly FeedbackItemType[] = ["info", "label", "pagebreak"];
// Items without a form: opening their "Add question" link adds them at the end (a CAPTCHA, named
// and required by Moodle, one per feedback; confirmed empirically, 5.2), and they have nothing to change.
const FORMLESS: readonly FeedbackItemType[] = ["pagebreak", "captcha"];

/** An item as the export file has it. */
export interface RawFeedbackItem {
  id: number;
  type: string;
  required: boolean;
  name: string;
  label: string;
  presentation: string;
  options: string;
  dependItem: number;
  dependValue: string;
}

/** The items of a feedback's export file (`export.php?action=exportfile`), in order: each `<ITEM>`'s attributes and CDATA fields. */
export function parseFeedbackExport(xml: string): RawFeedbackItem[] {
  const items: RawFeedbackItem[] = [];
  for (const match of xml.matchAll(/<ITEM\s+TYPE="([^"]*)"\s+REQUIRED="(\d*)"\s*>([\s\S]*?)<\/ITEM>/g)) {
    const body = match[3]!;
    const field = (tag: string) => /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1] ?? "")?.[1] ?? "";
    items.push({
      id: Number(field("ITEMID")),
      type: match[1]!,
      required: match[2] === "1",
      name: field("ITEMTEXT"),
      label: field("ITEMLABEL"),
      presentation: field("PRESENTATION"),
      options: field("OPTIONS"),
      dependItem: Number(field("DEPENDITEM")) || 0,
      dependValue: field("DEPENDVALUE"),
    });
  }
  return items;
}

/** An item's definition from its export: its presentation decoded as each type's form reads it. */
export function feedbackItemOf(raw: RawFeedbackItem, position: number): FeedbackItemDefinition {
  const type = (FEEDBACK_ITEM_TYPES as readonly string[]).includes(raw.type) ? (raw.type as FeedbackItemType) : undefined;
  if (!type) throw new SurveyError(`Item ${raw.id} is of a type the driver doesn't know ("${raw.type}").`);
  const item: FeedbackItemDefinition = {
    id: raw.id,
    type,
    position,
    question: type === "label" || type === "pagebreak" ? "" : raw.name,
    ...(raw.label && type !== "label" ? { label: raw.label } : {}),
    required: raw.required,
  };
  if (CHOICES.includes(type)) {
    const at = raw.presentation.indexOf(TYPE_SEP);
    const subtype = at >= 0 ? raw.presentation.slice(0, at) : "r";
    const [values = "", adjust] = (at >= 0 ? raw.presentation.slice(at + TYPE_SEP.length) : raw.presentation).split(ADJUST_SEP);
    // A form's textarea sends its lines with "\r\n": Moodle may keep the "\r".
    item.options = values
      .split(LINE_SEP)
      .map((line) => line.replaceAll("\r", ""))
      .filter((line) => line !== "")
      .map((line) => {
        if (type === "multichoice") return { text: line };
        const [weight, ...text] = line.split(RATED_SEP);
        return text.length > 0 ? { text: text.join(RATED_SEP), weight: Number(weight) } : { text: line, weight: 0 };
      });
    item.display = DISPLAYS[subtype] ?? "radio";
    item.horizontal = adjust === "1";
    item.hideNotSelected = raw.options.includes("h");
    item.ignoreEmpty = raw.options.includes("i");
  } else if (type === "numeric") {
    const [from, to] = raw.presentation.split("|").map((bound) => (bound === "-" || bound === "" || bound === undefined ? undefined : Number(bound)));
    if (from !== undefined || to !== undefined) item.range = { ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}) };
  } else if (type === "info") {
    item.info = INFO_KINDS[raw.presentation] ?? "course";
  } else if (type === "label") {
    item.contents = raw.presentation;
  }
  if (raw.dependItem) item.dependsOn = { itemId: raw.dependItem, value: raw.dependValue };
  return item;
}

/** What the questions page tells: the sesskey, the item types its "Add question" menu offers, and whether it can export items. */
interface EditorState {
  sesskey: string;
  types: string[];
  hasItems: boolean;
}

/** The feedback's questions page, or `SurveyError` naming the capability it takes. */
async function openEditor(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/feedback/edit.php?id=${activityId}`);
  // Without the capability, Moodle's error comes on a page of the same body id.
  const error = await moodleErrorMessage(page);
  if ((await page.locator("body#page-mod-feedback-edit").count()) === 0 || error !== undefined) {
    await page.close().catch(() => undefined);
    throw new SurveyError(
      `Moodle didn't show the questions of feedback ${activityId}${error ? ` (Moodle says: ${error})` : ""}. Building them takes a feedback's id (module "feedback") from the course structure and the capability mod/feedback:edititems, which editing teachers have.`,
    );
  }
  return page;
}

function readEditor(page: Page): Promise<EditorState> {
  return page.evaluate(() => {
    const g = globalThis as unknown as { M: { cfg: { sesskey: string } }; document: { querySelectorAll(s: string): ArrayLike<{ href: string }> } };
    const types = Array.from(g.document.querySelectorAll('#region-main a[href*="/mod/feedback/edit_item.php"][href*="typ="]')).map((a) => new URL(a.href).searchParams.get("typ") ?? "");
    return { sesskey: g.M.cfg.sesskey, types: [...new Set(types.filter(Boolean))], hasItems: g.document.querySelectorAll('#region-main a[href*="/mod/feedback/export.php"]').length > 0 };
  });
}

async function editorState(context: BrowserContext, siteUrl: string, activityId: number): Promise<EditorState> {
  const page = await openEditor(context, siteUrl, activityId);
  try {
    return await readEditor(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The items from the export file, once the questions page has said there are some. */
async function exportedItems(context: BrowserContext, siteUrl: string, activityId: number): Promise<RawFeedbackItem[]> {
  const response = await siteFetch(context, new URL(`mod/feedback/export.php?action=exportfile&id=${activityId}`, siteUrl).href);
  if (response.status !== 200 || !/^\s*<\?xml/.test(response.body)) {
    throw new SurveyError(`Moodle didn't send the items of feedback ${activityId} (status ${response.status}). Try again, or look at its questions page.`);
  }
  return parseFeedbackExport(response.body);
}

/** The feedback's items and the questions page's state. */
async function readItems(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ state: EditorState; items: RawFeedbackItem[] }> {
  const state = await editorState(context, siteUrl, activityId);
  return { state, items: state.hasItems ? await exportedItems(context, siteUrl, activityId) : [] };
}

/**
 * The items of a feedback as its teacher builds them, in order: each one's id, type, position,
 * question, whether it's required, a choice's options (with a rated choice's weights) and how
 * they're shown, a numeric item's range, an information item's kind, a label's contents and the
 * item it depends on. Read from the feedback's export of its items (`export.php`), which takes
 * `mod/feedback:edititems`, as building them does; throws `SurveyError` without it.
 */
export async function feedbackItems(context: BrowserContext, siteUrl: string, activityId: number): Promise<FeedbackItemDefinition[]> {
  const { items } = await readItems(context, siteUrl, activityId);
  return items.map((raw, i) => feedbackItemOf(raw, i + 1));
}

/** What an item's form says about itself: its type, the feedback it's in, and the positions and dependencies it offers. */
interface ItemForm {
  typ: string;
  cmid: number;
  positions: string[];
  dependItems: string[];
  infoKinds: string[];
}

function readItemForm(page: Page): Promise<ItemForm | undefined> {
  return inPage(
    page,
    () => {
      interface Field {
        value: string;
        options?: ArrayLike<{ value: string }>;
      }
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { querySelector(s: string): Field | null } | null } }).document;
      const form = doc.querySelector('form.mform:has([name="typ"])');
      if (!form) return undefined;
      const options = (name: string) => Array.from(form.querySelector(`select[name="${name}"]`)?.options ?? []).map((o) => o.value);
      return {
        typ: form.querySelector('[name="typ"]')?.value ?? "",
        cmid: Number(form.querySelector('[name="cmid"]')?.value),
        positions: options("position"),
        dependItems: options("dependitem"),
        infoKinds: options("presentation"),
      } as ItemForm;
    },
    null,
  );
}

const bool = (value: boolean) => (value ? 1 : 0);

/** The form values for `input` on an item's form of `type`; checks what the type takes. */
export function itemValues(type: FeedbackItemType, input: Partial<FeedbackItemInput>, form: Pick<ItemForm, "dependItems" | "infoKinds">): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  const only = (what: string, types: readonly FeedbackItemType[], given: unknown) => {
    if (given !== undefined && !types.includes(type)) throw new SurveyError(`A ${type} item takes no ${what} (only ${types.join(" and ")} items do).`);
  };
  only("options", CHOICES, input.options);
  only("display", CHOICES, input.display);
  only("horizontal", CHOICES, input.horizontal);
  only("hideNotSelected", CHOICES, input.hideNotSelected);
  only("ignoreEmpty", CHOICES, input.ignoreEmpty);
  only("range", ["numeric"], input.range);
  only("info", ["info"], input.info);
  only("contents", ["label"], input.contents);
  if (input.question !== undefined) {
    if (type === "label") throw new SurveyError("A label has contents, not a question: give them as contents.");
    values.name = input.question;
  }
  if (input.label !== undefined) {
    if (type === "label") throw new SurveyError("A label item has no label field of its own.");
    values.label = input.label;
  }
  if (input.required !== undefined) {
    if (NEVER_REQUIRED.includes(type)) throw new SurveyError(`A ${type} item can't be required: Moodle's form for it has no "Required" setting.`);
    values.required = input.required;
  }
  if (input.display !== undefined) {
    const code = Object.entries(DISPLAYS).find(([, display]) => display === input.display)?.[0];
    if (!code || (type === "multichoicerated" && code === "c")) {
      throw new SurveyError(`A ${type} item shows its options as ${type === "multichoice" ? "radio, checkbox or dropdown" : "radio or dropdown"}, not "${String(input.display)}".`);
    }
    values.subtype = code;
  }
  if (input.horizontal !== undefined) values.horizontal = bool(input.horizontal);
  if (input.hideNotSelected !== undefined) values.hidenoselect = bool(input.hideNotSelected);
  if (input.ignoreEmpty !== undefined) values.ignoreempty = bool(input.ignoreEmpty);
  if (input.options !== undefined) {
    if (input.options.length === 0) throw new SurveyError(`A ${type} item needs an option at least.`);
    const options = input.options.map((option) => (typeof option === "string" ? { text: option } : option));
    for (const option of options) {
      if (!option.text.trim() || /[\r\n|]/.test(option.text)) throw new SurveyError(`A ${type} item's option is a line of text without "|": "${option.text}" isn't one.`);
      if (option.weight !== undefined && (type !== "multichoicerated" || !Number.isInteger(option.weight))) {
        throw new SurveyError(type === "multichoicerated" ? `A rated option's weight is a whole number: ${option.weight} isn't one.` : `Only a multichoicerated item's options have weights.`);
      }
    }
    // One option a line; a rated one as "weight/text", as its form takes them (no weight is 0).
    values.values = options.map((option) => (type === "multichoicerated" ? `${option.weight ?? 0}/${option.text}` : option.text)).join("\n");
  }
  if (input.range !== undefined) {
    values.rangefrom = input.range.from === undefined ? "" : String(input.range.from);
    values.rangeto = input.range.to === undefined ? "" : String(input.range.to);
  }
  if (input.info !== undefined) {
    const code = Object.entries(INFO_KINDS).find(([, kind]) => kind === input.info)?.[0];
    if (!code) throw new SurveyError(`An information item shows ${Object.values(INFO_KINDS).join(", ")}, not "${String(input.info)}".`);
    if (!form.infoKinds.includes(code)) throw new SurveyError(`This feedback's information items offer ${form.infoKinds.map((c) => INFO_KINDS[c]).join(", ")}: the response time only where the feedback isn't anonymous.`);
    values.presentation = code;
  }
  if (input.contents !== undefined) values["presentation_editor[text]"] = input.contents;
  if (input.dependsOn !== undefined) {
    if (input.dependsOn === null) values.dependitem = "0";
    else {
      if (!form.dependItems.includes(String(input.dependsOn.itemId)) || input.dependsOn.itemId === 0) {
        throw new SurveyError(`Item ${input.dependsOn.itemId} isn't one this item can depend on: it can depend on ${form.dependItems.filter((id) => id !== "0").join(", ") || "none"} (other items that take answers).`);
      }
      values.dependitem = String(input.dependsOn.itemId);
      values.dependvalue = input.dependsOn.value;
    }
  }
  return { ...values, ...input.fields };
}

/** Opens an item's form (new or existing), or `SurveyError` with Moodle's reason. */
async function openItemForm(context: BrowserContext, siteUrl: string, activityId: number, path: string): Promise<{ page: Page; form: ItemForm }> {
  const page = await openForm(context, siteUrl, path).catch(async (error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    const shown = await openSitePage(context, siteUrl, path).catch(() => undefined);
    const message = shown ? await moodleErrorMessage(shown) : undefined;
    await shown?.close().catch(() => undefined);
    throw new SurveyError(`The item form of feedback ${activityId} didn't open${message ? ` (Moodle says: ${message})` : ""}: it takes the capability mod/feedback:edititems.`);
  });
  const form = await readItemForm(page);
  if (!form) {
    await page.close().catch(() => undefined);
    throw new SurveyError(`The item form of feedback ${activityId} isn't one the driver knows (${path}).`);
  }
  return { page, form };
}

/** The type in the error for one the feedback's "Add question" menu doesn't offer. */
function checkOffered(activityId: number, type: string, offered: string[]): asserts type is FeedbackItemType {
  if (!(FEEDBACK_ITEM_TYPES as readonly string[]).includes(type) || !offered.includes(type)) {
    throw new SurveyError(`Feedback ${activityId} doesn't offer items of type "${type}": its "Add question" menu has ${offered.join(", ") || "none"}${type === "captcha" ? " (a CAPTCHA takes the site's reCAPTCHA keys)" : ""}.`);
  }
}

/** Puts the items in this order through the reorder service the questions page's drag and drop uses (`mod_feedback_questions_reorder`). */
async function reorder(context: BrowserContext, siteUrl: string, activityId: number, ids: number[]): Promise<void> {
  try {
    const done = await callService<boolean>(context, siteUrl, "mod_feedback_questions_reorder", { cmid: activityId, itemorder: ids.join(",") });
    if (!done) throw new SurveyError(`Moodle didn't reorder the items of feedback ${activityId}.`);
  } catch (error) {
    if (error instanceof MoodleServiceError) throw new SurveyError(`Moodle didn't reorder the items of feedback ${activityId} (${error.message}): it takes the capability mod/feedback:edititems.`);
    throw error;
  }
}

/**
 * Adds an item to a feedback through its questions page, after item `after` (0 puts it first; by
 * default it goes last): a question of any type the feedback's "Add question" menu offers, with
 * its options and settings, a label with its contents, or a page break or a CAPTCHA (which Moodle
 * adds at the end without a form, then moved; it refuses a page break first or right after another
 * one at the end, and a second CAPTCHA). Throws `SurveyError` for a
 * type the menu doesn't offer, or what the type doesn't take, before anything is saved; `FormError`
 * with Moodle's messages when it refuses the form. Returns the new item's id and the items in order.
 */
export async function addFeedbackItem(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: FeedbackItemInput & { after?: number },
): Promise<{ changed: string; itemId: number; itemIds: number[] }> {
  const { after, ...item } = input;
  const before = await readItems(context, siteUrl, activityId);
  checkOffered(activityId, item.type, [...before.state.types]);
  const ids = before.items.map((i) => i.id);
  if (after !== undefined && after !== 0 && !ids.includes(after)) throw new SurveyError(`Feedback ${activityId} has no item ${after} to put the new one after: its items are ${ids.join(", ") || "none yet"} (0 puts it first).`);
  // Where it goes, from 1, as the form's "Position" takes it.
  const position = after === undefined ? ids.length + 1 : after === 0 ? 1 : ids.indexOf(after) + 2;

  if (FORMLESS.includes(item.type)) {
    const extra = Object.keys(item).filter((key) => key !== "type");
    if (extra.length > 0) throw new SurveyError(`A ${item.type} item takes nothing but its place: ${extra.join(", ")} given.`);
    const page = await openSitePage(context, siteUrl, `mod/feedback/edit_item.php?cmid=${activityId}&typ=${item.type}&sesskey=${before.state.sesskey}`);
    await page.close().catch(() => undefined);
  } else {
    if (item.type !== "label" && !item.question?.trim()) throw new SurveyError(`A ${item.type} item needs a question.`);
    if (CHOICES.includes(item.type) && !item.options) throw new SurveyError(`A ${item.type} item needs its options.`);
    const { page, form } = await openItemForm(context, siteUrl, activityId, `mod/feedback/edit_item.php?cmid=${activityId}&typ=${item.type}`);
    try {
      const values = itemValues(item.type, item, form);
      if (!form.positions.includes(String(position))) throw new SurveyError(`Feedback ${activityId}'s item form offers positions ${form.positions.join(", ")}, not ${position}.`);
      await setFields(page, { ...values, position: String(position) });
      await submitForm(page, "save_item");
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  const now = (await readItems(context, siteUrl, activityId)).items.map((i) => i.id);
  const itemId = now.find((id) => !ids.includes(id));
  if (!itemId) {
    throw new SurveyError(
      item.type === "pagebreak"
        ? `Moodle added no page break to feedback ${activityId}: it adds none to a feedback without items, or right after another page break at the end.`
        : item.type === "captcha"
          ? `Moodle added no CAPTCHA to feedback ${activityId}: a feedback has one at most.`
          : `Moodle added no ${item.type} item to feedback ${activityId}.`,
    );
  }
  let itemIds = now;
  // A page break or a CAPTCHA goes at the end: moved where it was asked for.
  if (FORMLESS.includes(item.type) && now.indexOf(itemId) !== position - 1) {
    itemIds = now.filter((id) => id !== itemId);
    itemIds.splice(position - 1, 0, itemId);
    await reorder(context, siteUrl, activityId, itemIds);
  }
  const where = after === undefined ? "last" : after === 0 ? "first" : `after item ${after}`;
  return { changed: `Added ${item.type} item ${itemId}${item.question ? ` "${item.question}"` : ""} to feedback ${activityId}, ${where}.`, itemId, itemIds };
}

/**
 * Changes an item of a feedback through its form, with what's given: its question, label, whether
 * it's required, a choice's options (given, they replace them all) and settings, a numeric item's
 * range, an information item's kind, a label's contents, its dependency and other fields. An item
 * keeps its type and place (`moveFeedbackItem` moves it); a page break has nothing to change.
 */
export async function editFeedbackItem(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  itemId: number,
  changes: Partial<Omit<FeedbackItemInput, "type">>,
): Promise<{ changed: string; itemId: number }> {
  if (Object.keys(changes).length === 0) throw new SurveyError("Give what to change in the item: its question, label, required, options, settings, contents, dependency or fields.");
  const { items } = await readItems(context, siteUrl, activityId);
  const raw = items.find((i) => i.id === itemId);
  if (!raw) throw new SurveyError(`Feedback ${activityId} has no item ${itemId}: its items are ${items.map((i) => i.id).join(", ") || "none yet"}.`);
  if ((FORMLESS as readonly string[]).includes(raw.type)) throw new SurveyError(`Item ${itemId} is a ${raw.type}: Moodle has nothing to change in it (move it or delete it).`);
  const { page, form } = await openItemForm(context, siteUrl, activityId, `mod/feedback/edit_item.php?id=${itemId}`);
  try {
    if (form.cmid !== activityId) throw new SurveyError(`Item ${itemId} isn't one of feedback ${activityId}'s.`);
    const values = itemValues(raw.type as FeedbackItemType, changes, form);
    await setFields(page, values);
    await submitForm(page, "update_item");
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Saved item ${itemId} of feedback ${activityId}.`, itemId };
}

/** Moves an item of a feedback to `position` (from 1), as the questions page's drag and drop does; returns the items in order. */
export async function moveFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number, position: number): Promise<{ changed: string; itemId: number; itemIds: number[] }> {
  const ids = (await readItems(context, siteUrl, activityId)).items.map((i) => i.id);
  if (!ids.includes(itemId)) throw new SurveyError(`Feedback ${activityId} has no item ${itemId}: its items are ${ids.join(", ") || "none yet"}.`);
  if (!Number.isInteger(position) || position < 1 || position > ids.length) throw new SurveyError(`Feedback ${activityId} has ${ids.length} items: a position goes from 1 to ${ids.length}, not ${position}.`);
  const order = ids.filter((id) => id !== itemId);
  order.splice(position - 1, 0, itemId);
  await reorder(context, siteUrl, activityId, order);
  const itemIds = (await exportedItems(context, siteUrl, activityId)).map((i) => i.id);
  if (itemIds.indexOf(itemId) !== position - 1) throw new SurveyError(`Moodle didn't move item ${itemId} of feedback ${activityId}: its items are ${itemIds.join(", ")}.`);
  return { changed: `Moved item ${itemId} of feedback ${activityId} to position ${position}.`, itemId, itemIds };
}

/**
 * Deletes an item of a feedback, as its questions page's delete action does once confirmed; the
 * answers people gave to it go with it, as in Moodle. Returns the items left, in order.
 */
export async function deleteFeedbackItem(context: BrowserContext, siteUrl: string, activityId: number, itemId: number): Promise<{ changed: string; itemId: number; itemIds: number[] }> {
  const { state, items } = await readItems(context, siteUrl, activityId);
  if (!items.some((i) => i.id === itemId)) throw new SurveyError(`Feedback ${activityId} has no item ${itemId}: its items are ${items.map((i) => i.id).join(", ") || "none yet"}.`);
  const page = await openSitePage(context, siteUrl, `mod/feedback/edit.php?id=${activityId}&deleteitem=${itemId}&sesskey=${state.sesskey}`);
  await page.close().catch(() => undefined);
  const after = await readItems(context, siteUrl, activityId);
  const itemIds = after.items.map((i) => i.id);
  if (itemIds.includes(itemId)) throw new SurveyError(`Moodle didn't delete item ${itemId} of feedback ${activityId}.`);
  return { changed: `Deleted item ${itemId} from feedback ${activityId}.`, itemId, itemIds };
}

/** The rows of the templates page's two tables (rows `feedback_template_course_table_r<n>`, `feedback_template_public_table_r<n>`): each template's id from its links and its name cell. */
export function readFeedbackTemplates(page: Page): Promise<FeedbackTemplate[]> {
  return page.evaluate(() => {
    interface El {
      href: string;
      textContent: string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const templates: { id: number; name: string; public: boolean }[] = [];
    // The tables have no id of their own; their rows carry the table's (`<table id>_r<n>`, confirmed empirically, 5.2).
    for (const [table, isPublic] of [
      ["feedback_template_course_table", false],
      ["feedback_template_public_table", true],
    ] as const) {
      for (const row of Array.from(doc.querySelectorAll(`tr[id^="${table}_r"]:not(.emptyrow)`))) {
        const link = row.querySelector('a[href*="templateid="]');
        const id = link ? Number(new URL(link.href).searchParams.get("templateid")) : 0;
        if (!id) continue;
        templates.push({ id, name: (row.querySelector("td.template")?.textContent ?? "").replace(/\s+/g, " ").trim(), public: isPublic });
      }
    }
    return templates;
  });
}

/** The templates a feedback can use: the course's own and the site's public ones (`manage_templates.php`, which takes `mod/feedback:edititems`). */
export async function feedbackTemplates(context: BrowserContext, siteUrl: string, activityId: number): Promise<FeedbackTemplate[]> {
  const page = await openSitePage(context, siteUrl, `mod/feedback/manage_templates.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-feedback-manage_templates").count()) === 0) {
      const error = await moodleErrorMessage(page);
      throw new SurveyError(`Moodle didn't show the templates of feedback ${activityId}${error ? ` (Moodle says: ${error})` : ""}: they take a feedback's id and the capability mod/feedback:edititems.`);
    }
    return await readFeedbackTemplates(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Sends one of the feedback's dynamic forms (core_form_dynamic_form) as its modal does: rendered by
 * the service, filled in a blank tab, serialized and sent back; returns what the form's processing returned.
 */
async function submitFeedbackForm(context: BrowserContext, siteUrl: string, form: string, params: Record<string, string | number>, values: Record<string, FieldValue>): Promise<{ result?: boolean }> {
  const formdata = new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();
  const rendered = await callService<{ html: string }>(context, siteUrl, "core_form_dynamic_form", { form, formdata });
  const page = await context.newPage();
  try {
    await page.setContent(rendered.html);
    await setFields(page, values);
    const serialized = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown };
        FormData: new (form: unknown) => Iterable<[string, string]>;
        URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
      };
      return new g.URLSearchParams(new g.FormData(g.document.querySelector("form.mform"))).toString();
    });
    const answer = await callService<{ submitted: boolean; html: string; data?: string }>(context, siteUrl, "core_form_dynamic_form", { form, formdata: serialized });
    if (!answer.submitted) {
      await page.setContent(answer.html);
      const errors = await page.evaluate(() =>
        Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document.querySelectorAll('[id^="id_error_"]'))
          .map((element) => ({ field: element.id.slice("id_error_".length).replace(/_[A-Za-z0-9]{15}$/, ""), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
          .filter((error) => error.message !== ""),
      );
      throw new FormError("Moodle refused the form:", errors.length > 0 ? errors : [{ field: "form", message: "no reason given" }]);
    }
    return answer.data ? (JSON.parse(answer.data) as { result?: boolean }) : {};
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A dynamic form's service refused: the capability it takes, in the error. */
function templateError(activityId: number, what: string, capability: string) {
  return (error: unknown) => {
    if (error instanceof MoodleServiceError) throw new SurveyError(`Moodle didn't ${what} for feedback ${activityId} (${error.message}): it takes ${capability}.`);
    throw error;
  };
}

/**
 * Adds a template's items to a feedback, as its "Use this template" does: after the items it has,
 * or in their place with `replace` (Moodle's own default; here it's off, so nothing is lost
 * unasked). Returns the items afterwards, in order.
 */
export async function useFeedbackTemplate(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  templateId: number,
  { replace = false }: { replace?: boolean } = {},
): Promise<{ changed: string; itemIds: number[] }> {
  const templates = await feedbackTemplates(context, siteUrl, activityId);
  if (!templates.some((t) => t.id === templateId)) throw new SurveyError(`Feedback ${activityId} can't use template ${templateId}: its templates are ${templates.map((t) => `${t.id} "${t.name}"`).join(", ") || "none"}.`);
  const answer = await submitFeedbackForm(context, siteUrl, "mod_feedback\\form\\use_template_form", { id: activityId, templateid: templateId }, { deleteolditems: replace ? 1 : 0 }).catch(
    templateError(activityId, "use the template", "the capability mod/feedback:edititems"),
  );
  if (answer.result === false) throw new SurveyError(`Moodle didn't use template ${templateId} for feedback ${activityId}.`);
  const { items } = await readItems(context, siteUrl, activityId);
  return { changed: `${replace ? "Replaced the items of" : "Added template " + templateId + "'s items to"} feedback ${activityId}${replace ? ` with template ${templateId}'s` : ""}.`, itemIds: items.map((i) => i.id) };
}

/**
 * Saves a feedback's items as a new template, as its "Save as new template" does: the course's own,
 * or public (every course's) with `public`, which takes `mod/feedback:createpublictemplate` in the
 * whole site (managers). Returns the new template's id.
 */
export async function saveFeedbackTemplate(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  name: string,
  { public: isPublic = false }: { public?: boolean } = {},
): Promise<{ changed: string; templateId: number }> {
  if (!name.trim()) throw new SurveyError("A template needs a name.");
  const before = await feedbackTemplates(context, siteUrl, activityId);
  const { state } = await readItems(context, siteUrl, activityId);
  if (!state.hasItems) throw new SurveyError(`Feedback ${activityId} has no items to save as a template.`);
  const answer = await submitFeedbackForm(context, siteUrl, "mod_feedback\\form\\create_template_form", { id: activityId }, { templatename: name, ...(isPublic ? { ispublic: true } : {}) }).catch((error: unknown) => {
    if (error instanceof FormError && isPublic && error.fields.some((f) => f.field === "ispublic")) {
      throw new SurveyError(`Saving a public template takes the capability mod/feedback:createpublictemplate in the whole site (managers have it).`);
    }
    return templateError(activityId, "save the template", "the capability mod/feedback:createprivatetemplate (or mod/feedback:createpublictemplate)")(error);
  });
  if (answer.result === false) throw new SurveyError(`Moodle didn't save the items of feedback ${activityId} as a template.`);
  const templateId = (await feedbackTemplates(context, siteUrl, activityId)).find((t) => !before.some((b) => b.id === t.id))?.id;
  if (!templateId) throw new SurveyError(`Moodle saved no template for feedback ${activityId}.`);
  return { changed: `Saved the items of feedback ${activityId} as ${isPublic ? "public " : ""}template ${templateId} "${name}".`, templateId };
}

/**
 * Deletes a feedback template, as its templates page does once confirmed. A public one takes
 * `mod/feedback:createpublictemplate` and `mod/feedback:deletetemplate` in the whole site.
 */
export async function deleteFeedbackTemplate(context: BrowserContext, siteUrl: string, activityId: number, templateId: number): Promise<{ changed: string; templateId: number }> {
  const templates = await feedbackTemplates(context, siteUrl, activityId);
  if (!templates.some((t) => t.id === templateId)) throw new SurveyError(`Feedback ${activityId} has no template ${templateId}: its templates are ${templates.map((t) => `${t.id} "${t.name}"`).join(", ") || "none"}.`);
  const { sesskey } = await editorState(context, siteUrl, activityId);
  const page = await openSitePage(context, siteUrl, `mod/feedback/manage_templates.php?id=${activityId}&deletetemplate=${templateId}&sesskey=${sesskey}`);
  const error = await moodleErrorMessage(page);
  await page.close().catch(() => undefined);
  if ((await feedbackTemplates(context, siteUrl, activityId)).some((t) => t.id === templateId)) {
    throw new SurveyError(`Moodle didn't delete template ${templateId}${error ? ` (Moodle says: ${error})` : ""}: it takes the capability mod/feedback:deletetemplate, and for a public one mod/feedback:createpublictemplate in the whole site.`);
  }
  return { changed: `Deleted template ${templateId}.`, templateId };
}
