// A course page's blocks (the side column: a text block, upcoming events…). Moodle has no AJAX service
// for them (core_block_get_course_blocks is for the mobile app only: servicenotavailable, confirmed
// empirically, 5.2), so they're read from the course page and changed as its editing mode does:
// `bui_*` parameters on course/view.php, and each block's configure form (`bui_editid`). Every
// `bui_*` action needs the person's editing mode on (blocklib's process_url_actions); it's a setting
// of their session (`$USER->editing`, set by editmode.php), turned on for the work and back off after.
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { checkEmbeds, editorTexts, embedFiles } from "../../core/embed.js";
import { MoodleError } from "../../core/errors.js";
import { openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { openSitePage } from "../../core/session.js";

/** A block on a course's page. */
export interface CourseBlock {
  /** The block instance's id. */
  id: number;
  /** The block type, its plugin's name without `block_`: `html` (a text block), `calendar_upcoming`… */
  type: string;
  /** Its title as the page shows it; for a text block, the title it was given ("" for none). */
  title: string;
  /** The page region it's in (`side-pre`, the only one Boost's course pages have). */
  region: string;
  /** Its weight in the region (lower comes first); read from its configure form, so only for whom can edit the blocks. */
  weight?: number;
  /** False for a block hidden from students (only whom can edit the blocks see it). */
  visible: boolean;
  /** A text block's content, HTML as the page shows it (files as pluginfile.php URLs). */
  content?: string;
}

/** A block can't be read or changed: the course page doesn't offer it, or the person can't edit its blocks. */
export class BlockError extends MoodleError {
  override name = "BlockError";
  constructor(message: string) {
    super(message, "block");
  }
}

const MANAGE = "moodle/site:manageblocks";

/** What the course page says about its blocks. */
interface BlocksPage {
  editing: boolean;
  /** The edit mode switch: whom can edit the course have it. */
  canSwitch: boolean;
  /** The "Add a block" link, in editing mode for whom has moodle/site:manageblocks. */
  canAdd: boolean;
  sesskey: string;
  contextId: number;
  pageType: string;
  pageLayout: string;
  regions: string[];
  blocks: { id: number; type: string; title: string; region: string; visible: boolean; content?: string }[];
}

function readBlocksPage(page: Page): Promise<BlocksPage> {
  return page.evaluate(() => {
    interface El {
      id: string;
      className: string;
      innerHTML: string;
      textContent: string | null;
      classList: { contains(name: string): boolean };
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      closest(s: string): El | null;
    }
    const g = globalThis as unknown as { document: { body: El; querySelector(s: string): El | null; querySelectorAll(s: string): ArrayLike<El> }; M?: { cfg?: { sesskey?: string; contextid?: number } } };
    const body = g.document.body;
    const regions = Array.from(g.document.querySelectorAll("aside[data-blockregion]"))
      .map((aside) => aside.getAttribute("data-blockregion") ?? "")
      .filter((region) => region !== "");
    const blocks = Array.from(g.document.querySelectorAll("section[data-block][data-instance-id]"))
      .filter((section) => /^\d+$/.test(section.getAttribute("data-instance-id") ?? ""))
      .map((section) => {
        const id = Number(section.getAttribute("data-instance-id"));
        const type = section.getAttribute("data-block") ?? "";
        const box = section.querySelector(".card-text.content");
        let content: string | undefined;
        if (type === "html" && box) {
          const inner = box.querySelector(".no-overflow");
          content = (inner ?? box).innerHTML.trim();
        }
        return {
          id,
          type,
          title: (section.querySelector(`#instance-${id}-header`)?.textContent ?? "").replace(/\s+/g, " ").trim(),
          region: section.closest("[data-blockregion]")?.getAttribute("data-blockregion") ?? "",
          visible: !section.classList.contains("invisibleblock"),
          ...(content !== undefined ? { content } : {}),
        };
      });
    return {
      editing: body.classList.contains("editing"),
      canSwitch: g.document.querySelector("form.editmode-switch-form") !== null,
      canAdd: g.document.querySelector('[data-key="addblock"], a[href*="bui_addblock"]') !== null,
      sesskey: g.M?.cfg?.sesskey ?? "",
      contextId: g.M?.cfg?.contextid ?? 0,
      pageType: body.id.replace(/^page-/, ""),
      pageLayout: /(?:^|\s)pagelayout-(\S+)/.exec(body.className)?.[1] ?? "course",
      regions,
      blocks,
    };
  });
}

/** Turns the person's editing mode on or off through the page's own switch (editmode.php), then reloads the page. */
async function setEditingMode(page: Page, on: boolean): Promise<void> {
  const ok = await page.evaluate(async (on) => {
    const g = globalThis as unknown as {
      document: { querySelector(s: string): unknown };
      FormData: new (form: unknown) => Iterable<[string, string]>;
      URLSearchParams: new (init: Iterable<[string, string]>) => { set(name: string, value: string): void };
      fetch(url: string, init: object): Promise<{ ok: boolean }>;
    };
    const form = g.document.querySelector("form.editmode-switch-form") as { action: string } | null;
    if (!form) return false;
    // Posted as the form posts itself, urlencoded.
    const data = new g.URLSearchParams(new g.FormData(form));
    data.set("setmode", on ? "1" : "0");
    return (await g.fetch(form.action, { method: "POST", body: data, credentials: "same-origin" })).ok;
  }, on);
  if (!ok) throw new BlockError(`Moodle didn't turn editing mode ${on ? "on" : "off"}.`);
  await page.reload({ waitUntil: "domcontentloaded" });
}

/** A GET to a page of the site from `page`, with its session: a `bui_*` action, which Moodle runs and then shows the course page. */
function getFromPage(page: Page, url: string): Promise<{ ok: boolean; html: string }> {
  return page.evaluate(async (url) => {
    const g = globalThis as unknown as { fetch(url: string, init: object): Promise<{ ok: boolean; text(): Promise<string> }> };
    const response = await g.fetch(url, { credentials: "same-origin" });
    return { ok: response.ok, html: await response.text() };
  }, url);
}

/** What a block's configure form says: its weight, region and visibility, and a title field's value. */
interface BlockForm {
  weight?: number;
  region?: string;
  visible?: boolean;
  title?: string;
}

function readBlockForm(page: Page, url: string): Promise<BlockForm | undefined> {
  // Through inPage: the helper reading a field is a named function.
  return inPage(page, async (url: string) => {
    interface Field {
      value: string;
    }
    const g = globalThis as unknown as {
      fetch(url: string, init: object): Promise<{ text(): Promise<string> }>;
      DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): Field | null } };
    };
    const html = await (await g.fetch(url, { credentials: "same-origin" })).text();
    const doc = new g.DOMParser().parseFromString(html, "text/html");
    if (!doc.querySelector("form.mform [name=blockid]")) return undefined;
    const value = (name: string) => doc.querySelector(`form.mform [name="${name}"]`)?.value;
    const weight = value("bui_weight");
    const visible = value("bui_visible");
    return {
      ...(weight !== undefined && weight !== "" ? { weight: Number(weight) } : {}),
      ...(value("bui_region") ? { region: value("bui_region") } : {}),
      ...(visible !== undefined ? { visible: visible === "1" } : {}),
      ...(value("config_title") !== undefined ? { title: value("config_title") } : {}),
    } as BlockForm;
  }, url);
}

function coursePath(courseId: number, params = ""): string {
  return `course/view.php?id=${courseId}${params}`;
}

async function openCoursePage(context: BrowserContext, siteUrl: string, courseId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, coursePath(courseId));
  if (!(await page.evaluate(() => (globalThis as unknown as { document: { body: { id: string } } }).document.body.id.startsWith("page-course-view")))) {
    await page.close().catch(() => undefined);
    throw new BlockError(`Course ${courseId}'s page can't be opened: the course doesn't exist, or you aren't enrolled in it.`);
  }
  return page;
}

/** The blocks as read from the page, completed with what their configure forms say when the page is in editing mode. */
async function readBlocks(page: Page, siteUrl: string, courseId: number, state: BlocksPage): Promise<CourseBlock[]> {
  const blocks: CourseBlock[] = [];
  for (const block of state.blocks) {
    const form = state.editing ? await readBlockForm(page, new URL(coursePath(courseId, `&bui_editid=${block.id}`), siteUrl).href) : undefined;
    blocks.push({
      id: block.id,
      type: block.type,
      // In editing mode a text block without a title shows a placeholder: its form has the real one.
      title: block.type === "html" && form?.title !== undefined ? form.title : block.title,
      region: block.region || form?.region || "",
      ...(form?.weight !== undefined ? { weight: form.weight } : {}),
      visible: form?.visible ?? block.visible,
      ...(block.content !== undefined ? { content: block.content } : {}),
    });
  }
  return blocks;
}

/**
 * Runs `work` on the course page with the person's editing mode on, as Moodle's block actions need,
 * and puts the mode back as it was afterwards. Throws `BlockError` when the person can't edit the
 * course's blocks (moodle/site:manageblocks).
 */
async function withEditing<T>(context: BrowserContext, siteUrl: string, courseId: number, work: (page: Page, state: BlocksPage) => Promise<T>): Promise<T> {
  const page = await openCoursePage(context, siteUrl, courseId);
  let turnedOn = false;
  try {
    let state = await readBlocksPage(page);
    if (!state.editing) {
      if (!state.canSwitch) throw new BlockError(`You can't edit course ${courseId}'s blocks: it takes editing the course, and ${MANAGE}.`);
      await setEditingMode(page, true);
      turnedOn = true;
      state = await readBlocksPage(page);
      if (!state.editing) throw new BlockError(`Moodle didn't turn editing mode on in course ${courseId}.`);
    }
    if (!state.canAdd) throw new BlockError(`You can't edit course ${courseId}'s blocks: it takes ${MANAGE}.`);
    return await work(page, state);
  } finally {
    if (turnedOn) await setEditingMode(page, false).catch(() => undefined);
    await page.close().catch(() => undefined);
  }
}

/** Runs a `bui_*` action on the course page and reads the page again. */
async function blockAction(page: Page, siteUrl: string, courseId: number, params: string, state: BlocksPage): Promise<BlocksPage> {
  const url = new URL(coursePath(courseId, `${params}&sesskey=${encodeURIComponent(state.sesskey)}`), siteUrl).href;
  const { ok } = await getFromPage(page, url);
  if (!ok) throw new BlockError(`Moodle refused the block action on course ${courseId}'s page.`);
  await page.reload({ waitUntil: "domcontentloaded" });
  return readBlocksPage(page);
}

function findBlock(state: BlocksPage, courseId: number, blockId: number): BlocksPage["blocks"][number] {
  const block = state.blocks.find((b) => b.id === blockId);
  if (!block) throw new BlockError(`Course ${courseId}'s page has no block ${blockId}: its blocks are ${state.blocks.map((b) => `${b.id} (${b.type})`).join(", ") || "none"}.`);
  return block;
}

async function readOne(page: Page, siteUrl: string, courseId: number, state: BlocksPage, blockId: number): Promise<CourseBlock> {
  const block = (await readBlocks(page, siteUrl, courseId, { ...state, blocks: [findBlock(state, courseId, blockId)] }))[0];
  return block!;
}

/**
 * The blocks on a course's page: each one's id, type (`html` for a text block, `calendar_upcoming`…),
 * title, region and, for a text block, its content (HTML). Whom can edit the course's blocks get them
 * all, hidden and empty ones too, with their weight: the page is read in editing mode (turned on for
 * the read and back off after, when it was off) and each block's configure form gives its weight.
 * Others get the blocks the page shows them, without weights. Throws `BlockError` when the course
 * page can't be opened.
 */
export async function courseBlocks(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseBlock[]> {
  const page = await openCoursePage(context, siteUrl, courseId);
  let turnedOn = false;
  try {
    let state = await readBlocksPage(page);
    if (!state.editing && state.canSwitch) {
      await setEditingMode(page, true);
      turnedOn = true;
      state = await readBlocksPage(page);
    }
    // In editing mode without moodle/site:manageblocks the forms aren't open to the person: the page alone.
    if (state.editing && !state.canAdd) state = { ...state, editing: false };
    return await readBlocks(page, siteUrl, courseId, state);
  } finally {
    if (turnedOn) await setEditingMode(page, false).catch(() => undefined);
    await page.close().catch(() => undefined);
  }
}

/** A block to add to a course's page: a text block (`html`) with its title and content, or another type by its name. */
export interface NewBlock {
  /** The block type, its plugin's name without `block_`: `html` for a text block, `calendar_upcoming`, `recent_activity`… */
  type: string;
  /** The page region (`side-pre`); by default the page's default one. */
  region?: string;
  /** A text block's title (its configure form's title field). */
  title?: string;
  /** A text block's content, HTML. */
  content?: string;
  /** Local files the content names (`<img src="shot.png">`), put in it as Moodle's editor does. */
  embed?: string[];
}

/** The values of a block's configure form for a title, content and other fields. */
function configValues({ title, content, settings }: { title?: string; content?: string; settings?: Record<string, FieldValue> }): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = { ...settings };
  if (title !== undefined) values.config_title = title;
  if (content !== undefined) values["config_text[text]"] = content;
  return values;
}

async function submitBlockForm(context: BrowserContext, siteUrl: string, courseId: number, blockId: number, values: Record<string, FieldValue>, embed: string[] | undefined): Promise<void> {
  const form = await openForm(context, siteUrl, coursePath(courseId, `&bui_editid=${blockId}`));
  try {
    if (embed) await embedFiles(form, values, embed);
    await setFields(form, values);
    await submitForm(form, "submitbutton");
  } finally {
    await form.close().catch(() => undefined);
  }
}

/**
 * Adds a block to a course's page, as its "Add a block" does in editing mode (turned on for the work and
 * back off after, when it was off): a text block (`html`) with its title and content (local images in
 * `embed`), or another block by its type. Returns the block. Throws `BlockError` when the person can't
 * edit the course's blocks (moodle/site:manageblocks), when the page doesn't offer the type (not
 * installed or disabled, already there and allowed once, or the person lacks block/<type>:addinstance),
 * or for a region the page doesn't have; `FormError` when the type's form has no title or content field.
 */
export async function addBlock(context: BrowserContext, siteUrl: string, courseId: number, block: NewBlock): Promise<{ changed: string; block: CourseBlock }> {
  const type = block.type.trim().replace(/^block_/, "");
  if (!/^[a-z][a-z0-9_]*$/.test(type)) throw new MoodleError(`"${block.type}" isn't a block type: give its plugin's name, such as html or calendar_upcoming.`, "invalid-input");
  const values = configValues(block);
  if (block.embed) await checkEmbeds(editorTexts(values), block.embed);
  const added = await withEditing(context, siteUrl, courseId, async (page, state) => {
    const addable = await callService<{ name: string }[]>(context, siteUrl, "core_block_fetch_addable_blocks", { pagecontextid: state.contextId, pagetype: state.pageType, pagelayout: state.pageLayout });
    if (!addable.some((b) => b.name === type)) {
      throw new BlockError(
        `Course ${courseId}'s page doesn't offer the block "${type}": it isn't installed or enabled, it's there already and allowed once, or you lack block/${type}:addinstance. It offers: ${addable.map((b) => b.name).join(", ") || "none"}.`,
      );
    }
    if (block.region !== undefined && !state.regions.includes(block.region)) {
      throw new BlockError(`Course ${courseId}'s page has no region "${block.region}": its regions are ${state.regions.join(", ") || "none"}.`);
    }
    const before = new Set(state.blocks.map((b) => b.id));
    const after = await blockAction(page, siteUrl, courseId, `&bui_addblock=${type}${block.region ? `&bui_blockregion=${encodeURIComponent(block.region)}` : ""}`, state);
    const created = after.blocks.find((b) => !before.has(b.id) && b.type === type);
    if (!created) throw new BlockError(`Moodle didn't add the block "${type}" to course ${courseId}'s page.`);
    if (Object.keys(values).length === 0) return readOne(page, siteUrl, courseId, after, created.id);
    try {
      await submitBlockForm(context, siteUrl, courseId, created.id, values, block.embed);
    } catch (error) {
      // Not left half made: a block whose form refused the title or content is taken off again.
      await blockAction(page, siteUrl, courseId, `&bui_deleteid=${created.id}&bui_confirm=1`, after).catch(() => undefined);
      throw error;
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    return readOne(page, siteUrl, courseId, await readBlocksPage(page), created.id);
  });
  return { changed: `Block ${added.id} (${type}) added to course ${courseId}'s page.`, block: added };
}

/** What to change in a block's configuration. */
export interface BlockChanges {
  /** A text block's title (its configure form's `config_title`). */
  title?: string;
  /** A text block's content, HTML (its form's `config_text`). */
  content?: string;
  /** Local files the content names (`<img src="shot.png">`), put in it as Moodle's editor does. */
  embed?: string[];
  /** Any other field of the block's configure form, by its name, as `setFields` takes them (`bui_visible`, `config_…`). */
  settings?: Record<string, FieldValue>;
}

/**
 * Changes a block's configuration through its configure form, in editing mode (turned on for the work
 * and back off after, when it was off): a text block's title and content, or any field of the form by
 * its name. Returns the block afterwards. Throws `BlockError` when the page has no such block or the
 * person can't edit its blocks, `FormError` naming a field the form doesn't have or Moodle refused.
 */
export async function configureBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number, changes: BlockChanges): Promise<{ changed: string; block: CourseBlock }> {
  const values = configValues(changes);
  if (Object.keys(values).length === 0) throw new MoodleError("Give a title, content or settings to change.", "invalid-input");
  if (changes.embed) await checkEmbeds(editorTexts(values), changes.embed);
  const block = await withEditing(context, siteUrl, courseId, async (page, state) => {
    findBlock(state, courseId, blockId);
    await submitBlockForm(context, siteUrl, courseId, blockId, values, changes.embed);
    await page.reload({ waitUntil: "domcontentloaded" });
    return readOne(page, siteUrl, courseId, await readBlocksPage(page), blockId);
  });
  return { changed: `Block ${blockId} on course ${courseId}'s page configured (${Object.keys(values).join(", ")}).`, block };
}

/**
 * Moves a block to a region of the course's page and a weight in it (lower comes first; without one,
 * after the region's blocks), as the block's move action does; Moodle shifts the blocks around it to
 * make room. Returns the block afterwards. Throws `BlockError` when the page has no such block or
 * region, or the person can't edit its blocks.
 */
export async function moveBlock(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  blockId: number,
  { region, weight }: { region?: string; weight?: number },
): Promise<{ changed: string; block: CourseBlock }> {
  if (weight !== undefined && !Number.isInteger(weight)) throw new MoodleError(`A block's weight is a whole number: ${weight}.`, "invalid-input");
  const block = await withEditing(context, siteUrl, courseId, async (page, state) => {
    const current = findBlock(state, courseId, blockId);
    const target = region ?? current.region;
    if (!state.regions.includes(target)) throw new BlockError(`Course ${courseId}'s page has no region "${target}": its regions are ${state.regions.join(", ") || "none"}.`);
    let newWeight = weight;
    if (newWeight === undefined) {
      const others = await readBlocks(page, siteUrl, courseId, { ...state, blocks: state.blocks.filter((b) => b.region === target && b.id !== blockId) });
      newWeight = others.length === 0 ? 0 : Math.max(...others.map((b) => b.weight ?? 0)) + 1;
    }
    const after = await blockAction(page, siteUrl, courseId, `&bui_moveid=${blockId}&bui_newregion=${encodeURIComponent(target)}&bui_newweight=${newWeight}`, state);
    return readOne(page, siteUrl, courseId, after, blockId);
  });
  return { changed: `Block ${blockId} moved to ${block.region}${block.weight !== undefined ? `, weight ${block.weight}` : ""}, on course ${courseId}'s page.`, block };
}

/**
 * Deletes a block from the course's page, as its delete action does once confirmed. Throws
 * `BlockError` when the page has no such block, or the person can't delete it (moodle/site:manageblocks,
 * and block/<type>:addinstance for most types).
 */
export async function deleteBlock(context: BrowserContext, siteUrl: string, courseId: number, blockId: number): Promise<{ changed: string }> {
  const type = await withEditing(context, siteUrl, courseId, async (page, state) => {
    const block = findBlock(state, courseId, blockId);
    const after = await blockAction(page, siteUrl, courseId, `&bui_deleteid=${blockId}&bui_confirm=1`, state);
    if (after.blocks.some((b) => b.id === blockId)) throw new BlockError(`Moodle didn't delete block ${blockId} from course ${courseId}'s page: deleting a ${block.type} block takes ${MANAGE} and block/${block.type}:addinstance.`);
    return block.type;
  });
  return { changed: `Block ${blockId} (${type}) deleted from course ${courseId}'s page.` };
}
