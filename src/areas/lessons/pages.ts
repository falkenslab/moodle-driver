// A lesson's pages as its teacher builds them in Moodle's lesson editor: the editor's view for the
// order, titles and contents (`mod/lesson/edit.php`), each page's form for its type, answers, scores
// and jumps (`editpage.php`), and the editor's move and delete links (`lesson.php`). Moodle's lesson
// services aren't open to AJAX, so it's all pages and forms.
import type { BrowserContext, Page } from "playwright-core";
import { checkEmbeds, embedFiles } from "../../core/embed.js";
import { FormError, openForm, setFields, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
import { LessonError } from "./lessons.js";

/** The kinds of lesson page: a content page (Moodle's "branch table"), each question type, and the structural pages. */
export const LESSON_PAGE_TYPES = ["content", "multichoice", "truefalse", "shortanswer", "numerical", "matching", "essay", "cluster", "end-of-cluster", "end-of-branch"] as const;
/** One of `LESSON_PAGE_TYPES`. */
export type LessonPageType = (typeof LESSON_PAGE_TYPES)[number];

// Moodle's page type codes (`LESSON_PAGE_*` in mod/lesson/pagetypes/).
const QTYPES: Record<LessonPageType, number> = { content: 20, multichoice: 3, truefalse: 2, shortanswer: 1, numerical: 8, matching: 5, essay: 10, cluster: 30, "end-of-cluster": 31, "end-of-branch": 21 };
// Pages Moodle creates without a form (their `construction_override`), edited afterwards.
const STRUCTURAL: readonly LessonPageType[] = ["cluster", "end-of-cluster", "end-of-branch"];

/** Moodle's jump codes by name (`LESSON_NEXTPAGE`, `LESSON_EOL`… in mod/lesson/locallib.php). */
export const LESSON_JUMPS = {
  "this-page": 0,
  "next-page": -1,
  "previous-page": -40,
  "end-of-lesson": -9,
  "unseen-in-branch": -50,
  "random-in-branch": -60,
  "random-branch": -70,
  "unseen-in-cluster": -80,
} as const;
/** Where an answer or button leads: a page of the lesson by its id, or one of Moodle's jumps by name (`LESSON_JUMPS`). */
export type LessonJump = number | keyof typeof LESSON_JUMPS;

/** A question page's answer, or the one row of an essay or structural page (its jump, an essay's score). */
export interface LessonAnswer {
  /** The answer (HTML for multichoice, true/false and matching). Matching: the first two rows' are the responses to a right and a wrong match, the pairs' the questions. */
  text?: string;
  /** The response shown after this answer (HTML); a matching pair's, the answer that matches its text. */
  response?: string;
  /** Its score, with the lesson's custom scoring. */
  score?: number;
  jumpTo?: LessonJump;
  /** Short answer and numerical: the row for any other answer ("All other answers"). */
  others?: boolean;
}

/** A content page's button: its label and where it leads. */
export interface LessonButton {
  label: string;
  jumpTo: LessonJump;
}

/** A page of a lesson as its teacher defines it, read from the lesson editor. */
export interface LessonPageDefinition {
  id: number;
  type: LessonPageType;
  title: string;
  /** The page's contents (HTML), as the editor's expanded view shows them. */
  contents: string;
  /** A content page's buttons. */
  buttons?: LessonButton[];
  /** Any other page's answers: a question's, or the single row of an essay or structural page. */
  answers?: LessonAnswer[];
  /** Multichoice: more than one answer can be right. */
  multipleAnswers?: boolean;
  /** Short answer: answers compared case-sensitively. */
  caseSensitive?: boolean;
}

/** A page for `addLessonPage`, or the changes for `editLessonPage` (without its type). */
export interface LessonPageInput {
  type: LessonPageType;
  title?: string;
  /** The page's contents (HTML); local files it names (`<img src="shot.png">`) go in `embed`. */
  contents?: string;
  /** Local files (absolute paths) to embed in the contents, answers or responses. */
  embed?: string[];
  /** A content page's buttons, in order (given, they replace them all). */
  buttons?: { label: string; jumpTo?: LessonJump }[];
  /** A question page's answers, in order (given, they replace them all); an essay or structural page's single row. */
  answers?: LessonAnswer[];
  multipleAnswers?: boolean;
  caseSensitive?: boolean;
  /** Any other field of the page's form, by name (`layout`, `display`…). */
  fields?: Record<string, FieldValue>;
}

/** One row of a page's form: its fields' names and values, as the form has them. */
interface RawRow {
  index: number;
  textName?: string;
  text?: string;
  responseName?: string;
  response?: string;
  jump?: string;
  jumpOptions?: string[];
  score?: string;
  scoreFrozen?: boolean;
}

/** A page's form, read: what `lessonPages` and the writes work from. */
interface RawPageForm {
  qtype: number;
  title: string;
  qoption?: boolean;
  others?: boolean;
  rows: RawRow[];
}

const jumpName = (code: number): LessonJump => (Object.entries(LESSON_JUMPS).find(([, value]) => value === code)?.[0] as keyof typeof LESSON_JUMPS | undefined) ?? code;
const jumpCode = (jump: LessonJump): number => (typeof jump === "number" ? jump : LESSON_JUMPS[jump]);
const typeOf = (qtype: number): LessonPageType | undefined => LESSON_PAGE_TYPES.find((type) => QTYPES[type] === qtype);

/** The page form on screen, by its fields' names. */
function readPageForm(page: Page): Promise<RawPageForm | undefined> {
  return inPage(
    page,
    () => {
      interface Field {
        value: string;
        type: string;
        checked: boolean;
        tagName: string;
        options?: ArrayLike<{ value: string }>;
      }
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { querySelector(s: string): Field | null } | null } }).document;
      const form = doc.querySelector('form.mform:has([name="qtype"])');
      if (!form) return undefined;
      const field = (name: string) => form.querySelector(`[name="${name}"]:not([type="hidden"])`) ?? form.querySelector(`[name="${name}"]`);
      const box = (name: string) => form.querySelector(`input[type="checkbox"][name="${name}"]`);
      const rows: RawRow[] = [];
      for (let index = 0; index < 60; index++) {
        const row: RawRow = { index };
        for (const name of [`answer_editor[${index}][text]`, `answer_editor[${index}]`]) {
          const found = field(name);
          if (found && row.textName === undefined) Object.assign(row, { textName: name, text: found.value });
        }
        for (const name of [`response_editor[${index}][text]`, `response_editor[${index}]`]) {
          const found = field(name);
          if (found && row.responseName === undefined) Object.assign(row, { responseName: name, response: found.value });
        }
        const jump = form.querySelector(`select[name="jumpto[${index}]"]`);
        if (jump) Object.assign(row, { jump: jump.value, jumpOptions: Array.from(jump.options ?? []).map((o) => o.value) });
        const score = field(`score[${index}]`);
        if (score) Object.assign(row, { score: score.value, scoreFrozen: score.type === "hidden" });
        if (row.textName !== undefined || row.responseName !== undefined || row.jump !== undefined || row.score !== undefined) rows.push(row);
      }
      const qoption = box("qoption");
      const others = box("enableotheranswers");
      return {
        qtype: Number(field("qtype")?.value),
        title: field("title")?.value ?? "",
        ...(qoption ? { qoption: qoption.checked } : {}),
        ...(others ? { others: others.checked } : {}),
        rows,
      } as RawPageForm;
    },
    null,
  );
}

/** A row's answer, with only the parts its form has. */
function answerOf(row: RawRow, parts: { text?: boolean; response?: boolean } = { text: true, response: true }): LessonAnswer {
  return {
    ...(parts.text && row.text !== undefined ? { text: row.text } : {}),
    ...(parts.response && row.response ? { response: row.response } : {}),
    ...(row.score !== undefined && row.score !== "" ? { score: Number(row.score) } : {}),
    ...(row.jump !== undefined ? { jumpTo: jumpName(Number(row.jump)) } : {}),
  };
}

/** A page's type, buttons or answers and options from its form, as Moodle keeps them (blank rows are no answers). */
function definitionOf(raw: RawPageForm): Omit<LessonPageDefinition, "id" | "title" | "contents"> {
  const type = typeOf(raw.qtype);
  if (!type) throw new LessonError(`A lesson page of type ${raw.qtype} isn't one the driver knows.`);
  const regular = raw.rows.filter((row) => row.textName !== undefined);
  const options = { ...(type === "multichoice" && raw.qoption !== undefined ? { multipleAnswers: raw.qoption } : {}), ...(type === "shortanswer" && raw.qoption !== undefined ? { caseSensitive: raw.qoption } : {}) };
  switch (type) {
    case "content":
      return { type, buttons: regular.filter((row) => row.text?.trim()).map((row) => ({ label: row.text!, jumpTo: jumpName(Number(row.jump ?? -1)) })) };
    case "truefalse":
      return { type, answers: regular.slice(0, 2).map((row) => answerOf(row)) };
    case "matching":
      return { type, answers: [...regular.slice(0, 2).map((row) => answerOf(row, { text: true })), ...regular.slice(2).filter((row) => row.text?.trim()).map((row) => answerOf(row))] };
    case "essay":
    case "cluster":
    case "end-of-cluster":
    case "end-of-branch":
      return { type, answers: raw.rows.slice(0, 1).map((row) => answerOf(row, {})) };
    default: {
      const answers = regular.filter((row) => row.text?.trim()).map((row) => answerOf(row));
      const others = raw.rows.find((row) => row.textName === undefined && row.responseName !== undefined);
      if (others && raw.others) answers.push({ ...answerOf(others, { response: true }), others: true });
      return { type, ...options, answers };
    }
  }
}

/** The editor's page: a lesson the person can edit, or `LessonError`. */
async function openEditor(context: BrowserContext, siteUrl: string, activityId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/lesson/edit.php?id=${activityId}`);
  if ((await page.locator("body#page-mod-lesson-edit").count()) === 0) {
    await page.close().catch(() => undefined);
    throw new LessonError(`Activity ${activityId} isn't a lesson you can edit. Take the id of a lesson (module "lesson") from the course structure; editing it takes a teacher's role.`);
  }
  return page;
}

/** The lesson's page ids in order: each page's anchor in the editor, in either of its views. */
function idsOn(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string }> } }).document.querySelectorAll('#region-main [id^="lesson-"]'))
      .map((a) => Number(a.id.slice("lesson-".length)))
      .filter((id) => id > 0),
  );
}

/** The lesson's page ids in order, and the session's sesskey for the editor's links. */
async function editorState(context: BrowserContext, siteUrl: string, activityId: number): Promise<{ ids: number[]; sesskey: string }> {
  const page = await openEditor(context, siteUrl, activityId);
  try {
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    return { ids: await idsOn(page), sesskey };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The expanded view's pages: id, title and contents, in order. */
function readExpanded(page: Page): Promise<{ id: number; title: string; contents: string }[]> {
  return page.evaluate(() => {
    interface El {
      id: string;
      innerHTML: string;
      textContent: string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const pages: { id: number; title: string; contents: string }[] = [];
    for (const table of Array.from(doc.querySelectorAll(".edit_pages_box table"))) {
      const anchor = table.querySelector('thead th a[id^="lesson-"]');
      const heading = table.querySelector("thead th");
      if (!anchor || !heading) continue;
      const cell = table.querySelector("tbody tr td");
      const box = cell?.querySelector(".no-overflow") ?? cell;
      pages.push({ id: Number(anchor.id.slice("lesson-".length)), title: (heading.textContent ?? "").replace(/\s+/g, " ").trim(), contents: (box?.innerHTML ?? "").trim() });
    }
    return pages;
  });
}

/**
 * The pages of a lesson as its teacher has them in Moodle's lesson editor, in order: type, title,
 * contents, and a content page's buttons or a question's answers with their responses, scores and
 * jumps. Reads the editor's expanded view and each page's form; the person's choice of view
 * (collapsed or expanded, which Moodle remembers) is put back afterwards. Takes a teacher's role.
 */
export async function lessonPages(context: BrowserContext, siteUrl: string, activityId: number): Promise<LessonPageDefinition[]> {
  const page = await openEditor(context, siteUrl, activityId);
  let shown: { id: number; title: string; contents: string }[];
  try {
    if ((await idsOn(page)).length === 0) return [];
    shown = await readExpanded(page);
    if (shown.length === 0) {
      // The collapsed view: the expanded one is opened, which edit.php keeps as the person's view
      // (their lesson_view preference), so the collapsed one is asked for again after.
      await page.goto(`${siteUrl}mod/lesson/edit.php?id=${activityId}&mode=full`, { waitUntil: "domcontentloaded" });
      shown = await readExpanded(page);
      await page.goto(`${siteUrl}mod/lesson/edit.php?id=${activityId}&mode=collapsed`, { waitUntil: "domcontentloaded" });
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  const ids = shown.map((p) => p.id);
  const pages: LessonPageDefinition[] = [];
  for (const { id, title, contents } of shown) {
    const form = await openSitePage(context, siteUrl, `mod/lesson/editpage.php?id=${activityId}&pageid=${id}&edit=1`);
    try {
      const raw = await readPageForm(form);
      if (!raw) throw new LessonError(`Page ${id} of lesson ${activityId} can't be read: its form didn't open (pages ${ids.join(", ")}).`);
      pages.push({ id, title: raw.title || title, contents, ...definitionOf(raw) });
    } finally {
      await form.close().catch(() => undefined);
    }
  }
  return pages;
}

/** The form values for `input` on a page's form, and the jumps to pages the form doesn't offer yet (set afterwards). */
function pageValues(
  raw: RawPageForm,
  input: Partial<LessonPageInput>,
  { activityId, editing }: { activityId: number; editing: boolean },
): { values: Record<string, FieldValue>; later: Record<string, FieldValue> } {
  const type = typeOf(raw.qtype)!;
  const values: Record<string, FieldValue> = {};
  const later: Record<string, FieldValue> = {};
  if (input.title !== undefined) values.title = input.title;
  if (input.contents !== undefined) values["contents_editor[text]"] = input.contents;
  if (input.multipleAnswers !== undefined) {
    if (type !== "multichoice") throw new LessonError(`Only a multichoice page takes multipleAnswers; this one is ${type}.`);
    values.qoption = input.multipleAnswers;
  }
  if (input.caseSensitive !== undefined) {
    if (type !== "shortanswer") throw new LessonError(`Only a short answer page takes caseSensitive; this one is ${type}.`);
    values.qoption = input.caseSensitive;
  }
  if (input.buttons && type !== "content") throw new LessonError(`A ${type} page has answers, not buttons.`);
  if (input.answers && type === "content") throw new LessonError("A content page has buttons, not answers: give them as buttons, with their labels.");
  const jump = (row: RawRow, to: LessonJump | undefined) => {
    if (to === undefined) return;
    const code = jumpCode(to);
    if (typeof to === "string" && code === undefined) throw new LessonError(`"${to}" isn't a jump: give a page id or one of ${Object.keys(LESSON_JUMPS).join(", ")}.`);
    if (row.jump === undefined) throw new LessonError(`This ${type} page's row ${row.index + 1} has no jump.`);
    if (row.jumpOptions?.includes(String(code))) values[`jumpto[${row.index}]`] = String(code);
    else if (code > 0) later[`jumpto[${row.index}]`] = String(code);
    else {
      const offered = (row.jumpOptions ?? []).map(Number).filter((c) => c <= 0).map(jumpName);
      throw new LessonError(`A ${type} page here can't jump to "${String(jumpName(code))}": it offers ${offered.join(", ")}, or a page id.`);
    }
  };
  const score = (row: RawRow, value: number | undefined) => {
    if (value === undefined) return;
    if (row.score === undefined) throw new LessonError(`A ${type} page's row ${row.index + 1} has no score.`);
    if (row.scoreFrozen) throw new LessonError(`Lesson ${activityId} doesn't use custom scoring, so its answers' scores are Moodle's: turn on "Custom scoring" in its settings to set them.`);
    values[`score[${row.index}]`] = value;
  };
  const fill = (row: RawRow, answer: LessonAnswer | undefined, parts: { text?: boolean; response?: boolean }) => {
    if (parts.text && row.textName) values[row.textName] = answer?.text ?? "";
    else if (answer?.text !== undefined) throw new LessonError(`A ${type} page's row ${row.index + 1} takes no text.`);
    if (parts.response && row.responseName) values[row.responseName] = answer?.response ?? "";
    else if (answer?.response !== undefined) throw new LessonError(`A ${type} page's row ${row.index + 1} takes no response.`);
    score(row, answer?.score);
    jump(row, answer?.jumpTo);
  };
  const tooMany = (given: number, rows: number, what: string) => {
    if (given > rows) throw new LessonError(`Lesson ${activityId}'s pages take ${rows} ${what} at most (its "Maximum number of answers/branches" setting); ${given} given.`);
  };
  const regular = raw.rows.filter((row) => row.textName !== undefined);
  if (input.buttons) {
    tooMany(input.buttons.length, regular.length, "buttons");
    if (input.buttons.length === 0) throw new LessonError("A content page needs a button at least.");
    regular.forEach((row, i) => {
      const button = input.buttons![i];
      if (!button && !editing) return;
      values[row.textName!] = button?.label ?? "";
      jump(row, button?.jumpTo);
    });
  }
  const answers = input.answers;
  if (answers) {
    const single = ["essay", ...STRUCTURAL].includes(type);
    if (single) {
      if (answers.length > 1) throw new LessonError(`A ${type} page has a single row: its jump${type === "essay" ? " and score" : ""}.`);
      fill(raw.rows[0]!, answers[0], {});
    } else if (type === "truefalse") {
      if (answers.length !== 2) throw new LessonError("A true/false page has two answers: the true one first, then the false one.");
      regular.slice(0, 2).forEach((row, i) => fill(row, answers[i], { text: true, response: true }));
    } else if (type === "matching") {
      if (answers.length < 2) throw new LessonError("A matching page's answers start with two rows: the response to a right match and to a wrong one; the pairs follow.");
      const pairs = answers.slice(2);
      tooMany(pairs.length, regular.length - 2, "matching pairs");
      regular.forEach((row, i) => {
        if (i < 2) fill(row, answers[i], { text: true });
        else if (pairs[i - 2] || editing) fill(row, pairs[i - 2], { text: true, response: true });
      });
    } else {
      const given = answers.filter((a) => !a.others);
      const others = answers.filter((a) => a.others);
      const othersRow = raw.rows.find((row) => row.textName === undefined && row.responseName !== undefined);
      if (others.length > 1 || (others.length === 1 && !othersRow)) throw new LessonError(`A ${type} page ${othersRow ? "has one row" : "has no row"} for any other answer.`);
      tooMany(given.length, regular.length, "answers");
      if (othersRow && raw.others !== undefined && (others.length > 0 || editing)) values.enableotheranswers = others.length > 0;
      regular.forEach((row, i) => {
        if (given[i] || editing) fill(row, given[i], { text: true, response: true });
      });
      if (othersRow && others[0]) fill(othersRow, others[0], { response: true });
    }
  }
  return { values: { ...values, ...input.fields }, later };
}

/**
 * Saves the page form with its "Save page" button and waits for the editor. Moodle's own check in
 * the page (a required title or answer) keeps the form there without a request: told apart by its
 * messages, so it fails at once instead of waiting for a page that never comes.
 */
async function savePageForm(page: Page): Promise<void> {
  const errors = () =>
    page.evaluate(() =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document.querySelectorAll('form.mform [id^="id_error_"]'))
        .map((element) => ({ field: element.id.slice("id_error_".length), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
        .filter((error) => error.message !== ""),
    );
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded" }).then(() => "saved" as const);
  navigation.catch(() => undefined);
  await page.click('form.mform [name="submitbutton"]', { noWaitAfter: true });
  const refused = page
    .waitForFunction(
      () => Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> } }).document.querySelectorAll('form.mform [id^="id_error_"]')).some((e) => (e.textContent ?? "").trim() !== ""),
      null,
      { polling: 250, timeout: 0 },
    )
    .then(() => "refused" as const);
  refused.catch(() => undefined);
  await Promise.race([navigation, refused]);
  const found = await errors().catch(() => []);
  if (found.length > 0) throw new FormError("Moodle refused the page:", found);
  await navigation;
}

/** Fills and saves a page form opened at `path`; returns the jumps it couldn't set yet (to pages the form didn't offer). */
async function fillAndSave(context: BrowserContext, siteUrl: string, activityId: number, path: string, input: Partial<LessonPageInput>, editing: boolean): Promise<Record<string, FieldValue>> {
  const page = await openForm(context, siteUrl, path).catch((error: unknown) => {
    if (error instanceof NotLoggedInError || error instanceof LessonError) throw error;
    throw new LessonError(`Lesson ${activityId}'s page form didn't open (${path}).`);
  });
  try {
    const raw = await readPageForm(page);
    if (!raw || !typeOf(raw.qtype)) throw new LessonError(`Lesson ${activityId}'s page form isn't one the driver knows (${path}).`);
    const { values, later } = pageValues(raw, input, { activityId, editing });
    if (input.embed) await embedFiles(page, values, input.embed);
    await setFields(page, values);
    await savePageForm(page);
    return later;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Checks the jumps to pages against the lesson's, and the files to embed, before anything is saved. */
async function checkInput(activityId: number, input: Partial<LessonPageInput>, ids: number[]): Promise<void> {
  const jumps = [...(input.buttons ?? []).map((b) => b.jumpTo), ...(input.answers ?? []).map((a) => a.jumpTo)];
  for (const to of jumps) {
    if (to === undefined) continue;
    if (typeof to === "string" && !(to in LESSON_JUMPS)) throw new LessonError(`"${to}" isn't a jump: give a page id or one of ${Object.keys(LESSON_JUMPS).join(", ")}.`);
    if (typeof to === "number" && to > 0 && !ids.includes(to)) throw new LessonError(`Lesson ${activityId} has no page ${to} to jump to: its pages are ${ids.join(", ") || "none yet"}.`);
    if (typeof to === "number" && to <= 0 && !Object.values(LESSON_JUMPS).includes(to as never)) throw new LessonError(`${to} isn't one of Moodle's jumps: give a page id or one of ${Object.keys(LESSON_JUMPS).join(", ")}.`);
  }
  if (input.embed) await checkEmbeds([input.contents, ...(input.answers ?? []).flatMap((a) => [a.text, a.response])], input.embed);
}

/**
 * Adds a page to a lesson through Moodle's lesson editor, after page `after` (0 puts it first; by
 * default it goes last): a content page with its buttons, a question page with its answers (their
 * responses, scores and jumps), an essay, or a cluster, end of cluster or end of branch (which Moodle
 * makes at once, then edited when more is given). A jump to a page the lesson doesn't have is an
 * error before anything is saved. Returns the new page's id and the lesson's pages in order.
 */
export async function addLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: LessonPageInput,
  { after }: { after?: number } = {},
): Promise<{ changed: string; pageId: number; pageIds: number[] }> {
  if (!LESSON_PAGE_TYPES.includes(input.type)) throw new LessonError(`A lesson page is one of ${LESSON_PAGE_TYPES.join(", ")}, not "${String(input.type)}".`);
  const structural = STRUCTURAL.includes(input.type);
  if (!structural && !input.title?.trim()) throw new LessonError(`A ${input.type} page needs a title.`);
  const { ids, sesskey } = await editorState(context, siteUrl, activityId);
  const previous = after ?? ids.at(-1) ?? 0;
  if (previous !== 0 && !ids.includes(previous)) throw new LessonError(`Lesson ${activityId} has no page ${previous} to put the new one after: its pages are ${ids.join(", ") || "none yet"} (0 puts it first).`);
  await checkInput(activityId, input, ids);
  const qtype = QTYPES[input.type];
  let later: Record<string, FieldValue> = {};
  if (structural) {
    const page = await openSitePage(context, siteUrl, `mod/lesson/editpage.php?id=${activityId}&pageid=${previous}&qtype=${qtype}&sesskey=${sesskey}`);
    await page.close().catch(() => undefined);
  } else {
    // Moodle's own first page link says firstpage: a content page's jumps then list no pages, which don't exist yet.
    const path = `mod/lesson/editpage.php?id=${activityId}&pageid=${previous}&qtype=${qtype}${ids.length === 0 ? "&firstpage=1" : ""}`;
    later = await fillAndSave(context, siteUrl, activityId, path, input, false);
  }
  const now = await editorState(context, siteUrl, activityId);
  const pageId = now.ids.find((id) => !ids.includes(id));
  if (!pageId) {
    throw new LessonError(
      input.type === "end-of-branch" ? `Moodle added no end of branch after page ${previous}: one goes after the pages of a content page's branch.` : `Moodle added no ${input.type} page to lesson ${activityId}.`,
    );
  }
  if (structural && (input.title !== undefined || input.contents !== undefined || input.answers || input.fields)) {
    later = await fillAndSave(context, siteUrl, activityId, `mod/lesson/editpage.php?id=${activityId}&pageid=${pageId}&edit=1`, input, false);
  }
  // A page put first offers no pages to jump to in its form: those jumps are set on the saved page
  // (confirmed empirically, 5.2: a true/false page put first, its wrong answer jumping to a page).
  if (Object.keys(later).length > 0) await fillAndSave(context, siteUrl, activityId, `mod/lesson/editpage.php?id=${activityId}&pageid=${pageId}&edit=1`, { fields: later }, false);
  const where = previous === 0 ? "first" : `after page ${previous}`;
  return { changed: `Added ${input.type} page ${pageId}${input.title ? ` "${input.title}"` : ""} to lesson ${activityId}, ${where}.`, pageId, pageIds: now.ids };
}

/**
 * Changes a page of a lesson through its form in the lesson editor, with what's given: its title,
 * contents, buttons or answers (given, they replace them all: the form's other rows are blanked, and
 * Moodle drops blank ones), options and other fields. A page keeps its type. A jump to a page the
 * lesson doesn't have is an error before anything is saved.
 */
export async function editLessonPage(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  pageId: number,
  changes: Partial<Omit<LessonPageInput, "type">>,
): Promise<{ changed: string; pageId: number }> {
  if (Object.keys(changes).length === 0) throw new LessonError("Give what to change in the page: its title, contents, buttons, answers, options or fields.");
  const { ids } = await editorState(context, siteUrl, activityId);
  await checkInput(activityId, changes, ids);
  if (!ids.includes(pageId)) throw new LessonError(`Lesson ${activityId} has no page ${pageId}: its pages are ${ids.join(", ") || "none yet"}.`);
  const later = await fillAndSave(context, siteUrl, activityId, `mod/lesson/editpage.php?id=${activityId}&pageid=${pageId}&edit=1`, changes, true);
  if (Object.keys(later).length > 0) await fillAndSave(context, siteUrl, activityId, `mod/lesson/editpage.php?id=${activityId}&pageid=${pageId}&edit=1`, { fields: later }, false);
  return { changed: `Saved page ${pageId} of lesson ${activityId}.`, pageId };
}

/** Moves a page of a lesson after page `after` (0 puts it first), as the editor's move link does; returns the pages in order. */
export async function moveLessonPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number, after: number): Promise<{ changed: string; pageIds: number[] }> {
  const { ids, sesskey } = await editorState(context, siteUrl, activityId);
  if (!ids.includes(pageId)) throw new LessonError(`Lesson ${activityId} has no page ${pageId}: its pages are ${ids.join(", ") || "none yet"}.`);
  if (after === pageId || (after !== 0 && !ids.includes(after))) throw new LessonError(`Page ${pageId} can go after another page of lesson ${activityId} (${ids.filter((id) => id !== pageId).join(", ") || "none"}) or first (0), not after ${after}.`);
  const page = await openSitePage(context, siteUrl, `mod/lesson/lesson.php?id=${activityId}&sesskey=${sesskey}&action=moveit&pageid=${pageId}&after=${after}`);
  await page.close().catch(() => undefined);
  const { ids: pageIds } = await editorState(context, siteUrl, activityId);
  const at = pageIds.indexOf(pageId);
  if (at !== (after === 0 ? 0 : pageIds.indexOf(after) + 1)) throw new LessonError(`Moodle didn't move page ${pageId} of lesson ${activityId}: its pages are ${pageIds.join(", ")}.`);
  return { changed: `Moved page ${pageId} of lesson ${activityId} ${after === 0 ? "first" : `after page ${after}`}.`, pageIds };
}

/**
 * Deletes a page of a lesson, as the editor's delete link does once confirmed. Answers of other
 * pages that jumped to it are left as Moodle leaves them. Returns the pages left, in order.
 */
export async function deleteLessonPage(context: BrowserContext, siteUrl: string, activityId: number, pageId: number): Promise<{ changed: string; pageIds: number[] }> {
  const { ids, sesskey } = await editorState(context, siteUrl, activityId);
  if (!ids.includes(pageId)) throw new LessonError(`Lesson ${activityId} has no page ${pageId}: its pages are ${ids.join(", ") || "none yet"}.`);
  const page = await openSitePage(context, siteUrl, `mod/lesson/lesson.php?id=${activityId}&sesskey=${sesskey}&action=delete&pageid=${pageId}`);
  await page.close().catch(() => undefined);
  const { ids: pageIds } = await editorState(context, siteUrl, activityId);
  if (pageIds.includes(pageId)) throw new LessonError(`Moodle didn't delete page ${pageId} of lesson ${activityId}.`);
  return { changed: `Deleted page ${pageId} from lesson ${activityId}.`, pageIds };
}
