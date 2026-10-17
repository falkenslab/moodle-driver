// A glossary's categories: listed from its category view's menu, or from the entry form's categories
// when the display format has no category view; added through the categories page
// (editcategories.php), whose form Moodle writes by hand (no Moodle form), posted as its button posts it.
import type { BrowserContext, Page } from "playwright-core";
import { MoodleError } from "../../core/errors.js";
import { openForm } from "../../core/forms.js";
import { readCategoryMenu } from "./entries.js";
import { GlossaryError, openGlossaryPage, pageSesskey } from "./glossary.js";

/** A category of a glossary's entries. */
export interface GlossaryCategory {
  id: number;
  name: string;
}

/** What adding a category did, its id, and the glossary's categories afterwards. */
export interface GlossaryCategoryChange {
  changed: string;
  categoryId: number;
  categories: GlossaryCategory[];
}

/** The categories the entry form offers to choose from (`categories[]`, its 0 is "Not categorised"); undefined when the person can't open it. */
async function formCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<GlossaryCategory[] | undefined> {
  let page: Page;
  try {
    page = await openForm(context, siteUrl, `mod/glossary/edit.php?cmid=${activityId}`);
  } catch (error) {
    if (error instanceof MoodleError && error.code === "form") return undefined;
    throw error;
  }
  try {
    return await page.evaluate(() =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string; textContent: string | null }> } }).document.querySelectorAll('form.mform select[name="categories[]"] option'))
        .filter((option) => Number(option.value) > 0)
        .map((option) => ({ id: Number(option.value), name: (option.textContent ?? "").trim() })),
    );
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * A glossary's categories, by id and name, in Moodle's order (by name): from the glossary's category
 * view, or, when its display format has none ("Simple, dictionary style"), from the entry form. Throws
 * `NotAGlossaryError` when the activity isn't a glossary the person can open, `GlossaryError` when
 * the display format shows no categories and the person can't add entries either.
 */
export async function glossaryCategories(context: BrowserContext, siteUrl: string, activityId: number): Promise<GlossaryCategory[]> {
  const page = await openGlossaryPage(context, siteUrl, activityId, `view.php?id=${activityId}&mode=cat&hook=-1`, `You can't see glossary ${activityId}`, "");
  let menu: GlossaryCategory[] | undefined;
  try {
    menu = await readCategoryMenu(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  if (menu) return menu;
  const offered = await formCategories(context, siteUrl, activityId);
  if (!offered) throw new GlossaryError(`Glossary ${activityId} shows no categories: its display format has no category view, and you can't add entries to it, whose form lists them.`);
  return offered;
}

/** The categories on the categories page (editcategories.php): each row's edit link names its id, its bold text is its name. */
function readCategoriesPage(page: Page): Promise<GlossaryCategory[]> {
  return page.evaluate(() => {
    interface El {
      textContent: string | null;
      getAttribute(name: string): string | null;
      closest(s: string): El | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const categories: { id: number; name: string }[] = [];
    for (const link of Array.from(doc.querySelectorAll('a[href*="editcategories.php"][href*="action=edit"]'))) {
      const id = Number(/[?&]hook=(\d+)/.exec(link.getAttribute("href") ?? "")?.[1] ?? 0);
      const name = (link.closest("tr")?.querySelector(".bold")?.textContent ?? "").trim();
      if (id > 0) categories.push({ id, name });
    }
    return categories;
  });
}

/**
 * Adds a category to a glossary, as its categories page does; with `autoLink`, Moodle links the
 * category's name wherever it appears in the course, as it does entries. Gives the category's id and
 * the glossary's categories afterwards. Throws `GlossaryError` when the person can't manage the
 * glossary's categories (mod/glossary:managecategories, which teachers have) or one has that name
 * already (Moodle compares names ignoring case).
 */
export async function addGlossaryCategory(context: BrowserContext, siteUrl: string, activityId: number, { name, autoLink = false }: { name: string; autoLink?: boolean }): Promise<GlossaryCategoryChange> {
  if (typeof name !== "string" || name.trim() === "") throw new MoodleError("A category needs a name.", "invalid-input");
  const refused = `You can't manage glossary ${activityId}'s categories`;
  const capability = "it takes Moodle's capability mod/glossary:managecategories, which teachers have";
  const page = await openGlossaryPage(context, siteUrl, activityId, `editcategories.php?id=${activityId}`, refused, capability);
  try {
    const before = await readCategoriesPage(page);
    const same = before.find((category) => category.name.toLowerCase() === name.trim().toLowerCase());
    if (same) throw new GlossaryError(`Glossary ${activityId} has a category "${same.name}" already (${same.id}): Moodle takes no two of the same name.`);
    const body = { sesskey: await pageSesskey(page), id: String(activityId), action: "add", confirm: "1", name: name.trim(), usedynalink: autoLink ? "1" : "0", mode: "cat", hook: "" };
    await page.evaluate(
      async ({ url, body }) => {
        const g = globalThis as unknown as { fetch(url: string, init: object): Promise<unknown>; URLSearchParams: new (init: Record<string, string>) => unknown };
        await g.fetch(url, { method: "POST", body: new g.URLSearchParams(body), credentials: "same-origin" });
      },
      { url: new URL("mod/glossary/editcategories.php", siteUrl).href, body },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const categories = await readCategoriesPage(page);
    const added = categories.find((category) => !before.some((old) => old.id === category.id));
    if (!added) throw new GlossaryError(`The category "${name.trim()}" was sent, but it doesn't appear in glossary ${activityId}.`);
    return { changed: `Added category ${added.id} "${added.name}" to glossary ${activityId}${autoLink ? ", linked automatically" : ""}.`, categoryId: added.id, categories };
  } finally {
    await page.close().catch(() => undefined);
  }
}
