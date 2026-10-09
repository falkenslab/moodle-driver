// A course's gradebook as a teacher sees it: the grader report (everyone's grades) and the setup
// (categories, items, weights), read from their pages by data attributes; categories and items
// changed through Moodle's own dynamic forms and the setup page's move action.
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "./ajax.js";
import { setFields, type FieldValue } from "./forms.js";
import { openSitePage } from "./session.js";

/** The gradebook can't be read or changed: not allowed, recalculating, or a value Moodle refuses. */
export class GradebookError extends Error {
  override name = "GradebookError";
}

/** Moodle's aggregations by their constant (GRADE_AGGREGATE_*). */
const AGGREGATION_CODES = {
  mean: 0,
  median: 2,
  lowest: 4,
  highest: 6,
  mode: 8,
  "weighted-mean": 10,
  "simple-weighted-mean": 11,
  "mean-with-extra-credits": 12,
  natural: 13,
} as const;
export type GradeAggregation = keyof typeof AGGREGATION_CODES;
export const GRADE_AGGREGATIONS = Object.keys(AGGREGATION_CODES) as GradeAggregation[];

export interface GradeColumn {
  itemId: number;
  name: string;
  kind: "item" | "category" | "course";
  activityId?: number;
  activityType?: string;
}

export interface GraderReport {
  columns: GradeColumn[];
  /** Grades as the report shows them ("-" left out). */
  rows: { userId: number; fullName: string; grades: { itemId: number; grade?: string }[] }[];
}

/** One page of the grader report, by data attributes and links, in any language. */
export function readGraderReport(page: Page): Promise<GraderReport> {
  return page.evaluate(() => {
    interface El {
      className: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
      cloneNode(deep: boolean): El;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const columns = Array.from(doc.querySelectorAll("table#user-grades tr.heading th[data-itemid]")).map((th) => {
      const header = th.querySelector(".gradeitemheader");
      const copy = header?.cloneNode(true);
      for (const extra of Array.from(copy?.querySelectorAll("img, .visually-hidden") ?? [])) extra.remove();
      const match = /\/mod\/([a-z0-9_]+)\/view\.php\?(?:.*&)?id=(\d+)/.exec(header?.getAttribute("href") ?? "");
      const kind = /\bcourseitem\b/.test(th.className) ? "course" : /\bcategoryitem\b/.test(th.className) ? "category" : "item";
      return {
        itemId: Number(th.getAttribute("data-itemid")),
        name: (copy?.textContent ?? "").replace(/\s+/g, " ").trim(),
        kind,
        ...(match ? { activityId: Number(match[2]), activityType: match[1] } : {}),
      };
    });
    const rows = Array.from(doc.querySelectorAll("table#user-grades tr.userrow[data-uid]")).map((row) => {
      const link = row.querySelector("a.username")?.cloneNode(true);
      for (const extra of Array.from(link?.querySelectorAll(".userinitials, img, .visually-hidden") ?? [])) extra.remove();
      const grades = Array.from(row.querySelectorAll("td.gradecell[data-itemid]")).map((cell) => {
        const value = (cell.querySelector(".gradevalue")?.textContent ?? "").replace(/\s+/g, " ").trim();
        return { itemId: Number(cell.getAttribute("data-itemid")), ...(value && value !== "-" ? { grade: value } : {}) };
      });
      return { userId: Number(row.getAttribute("data-uid")), fullName: (link?.textContent ?? "").replace(/\s+/g, " ").trim(), grades };
    });
    return { columns, rows } as GraderReport;
  });
}

const MAX_PAGES = 100;

/** Moodle's message on an error page (its fatal error box), which keeps the page's body id. */
async function fatalError(page: Page): Promise<string | undefined> {
  const box = page.locator('[data-rel="fatalerror"] .errormessage');
  return (await box.count()) > 0 ? ((await box.first().textContent()) ?? "").replace(/\s+/g, " ").trim() : undefined;
}

/**
 * Everyone's grades in a course as the grader report shows them, page by page, in one group when
 * given. People come as user id and full name only.
 */
export async function graderReport(context: BrowserContext, siteUrl: string, courseId: number, { group }: { group?: number } = {}): Promise<GraderReport> {
  const report: GraderReport = { columns: [], rows: [] };
  const seen = new Set<number>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await openSitePage(context, siteUrl, `grade/report/grader/index.php?id=${courseId}&page=${p}${group ? `&group=${group}` : ""}`);
    try {
      const refused = await fatalError(page);
      if (refused !== undefined || (await page.locator("body#page-grade-report-grader-index").count()) === 0) {
        throw new GradebookError(`You can't see course ${courseId}'s grader report: ${refused ?? "the course doesn't exist, or you aren't allowed"}`);
      }
      // Moodle shows a progress bar instead while it recalculates grades (deleted activities, changed weights).
      if ((await page.locator("table#user-grades").count()) === 0) {
        throw new GradebookError(`Course ${courseId}'s grader report isn't available now: Moodle may be recalculating its grades. Try again in a moment.`);
      }
      const read = await readGraderReport(page);
      if (p === 0) report.columns = read.columns;
      const fresh = read.rows.filter((row) => !seen.has(row.userId));
      if (fresh.length === 0) break;
      for (const row of fresh) seen.add(row.userId);
      report.rows.push(...fresh);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return report;
}

export interface GradebookCategory {
  id: number;
  /** The category's own grade item (its total). */
  itemId: number;
  name: string;
  parentId?: number;
  aggregation?: GradeAggregation;
  maxGrade?: number;
  /** Its weight in its parent, in percent, where the parent aggregates with weights. */
  weight?: number;
}

export interface GradebookItem {
  id: number;
  name: string;
  categoryId?: number;
  /** The module ("assign", "quiz"…) for an activity's item, "manual" for one made in the gradebook. */
  type: string;
  maxGrade?: number;
  /** In percent, where the category aggregates with weights. */
  weight?: number;
  weightOverridden: boolean;
}

/** The gradebook setup page's rows, by data attributes and field names. */
export function readGradebookSetup(page: Page): Promise<{ categories: GradebookCategory[]; items: GradebookItem[] }> {
  return page.evaluate((codes) => {
    interface El {
      className: string;
      textContent: string | null;
      value: string;
      checked: boolean;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const names = Object.fromEntries(Object.entries(codes).map(([name, code]) => [String(code), name]));
    const categories: GradebookCategory[] = [];
    const items: GradebookItem[] = [];
    for (const row of Array.from(doc.querySelectorAll("#grade_edit_tree_table tr[data-itemid]"))) {
      const itemId = Number(row.getAttribute("data-itemid"));
      const name = (row.querySelector(".rowtitle")?.textContent ?? "").replace(/\s+/g, " ").trim();
      const parent = Number((row.getAttribute("data-parent-category") ?? "").replace(/^cg/, "")) || undefined;
      const max = Number(row.getAttribute("data-grademax"));
      const weightField = row.querySelector(`input[type="text"][name="weight_${itemId}"]`);
      const weight = weightField && weightField.value !== "" ? Number(weightField.value) : undefined;
      const category = row.getAttribute("data-category");
      if (category) {
        const aggregation = names[row.getAttribute("data-aggregation") ?? ""];
        categories.push({
          id: Number(category.replace(/^cg/, "")),
          itemId,
          name,
          ...(parent ? { parentId: parent } : {}),
          ...(aggregation ? { aggregation: aggregation as GradeAggregation } : {}),
          ...(max > 0 ? { maxGrade: max } : {}),
          ...(weight !== undefined ? { weight } : {}),
        });
      } else {
        // The item's icon comes from its module's theme folder, or core's for a manual item.
        const icon = /image\.php\/[^/]+\/([a-z0-9_]+)\//.exec(row.querySelector("img.itemicon")?.getAttribute("src") ?? "")?.[1];
        items.push({
          id: itemId,
          name,
          ...(parent ? { categoryId: parent } : {}),
          type: !icon || icon === "core" ? "manual" : icon,
          ...(max > 0 ? { maxGrade: max } : {}),
          ...(weight !== undefined ? { weight } : {}),
          weightOverridden: row.querySelector(`input[type="checkbox"][name="weightoverride_${itemId}"]`)?.checked ?? false,
        });
      }
    }
    return { categories, items };
  }, AGGREGATION_CODES);
}

/** A course's gradebook setup: its categories (aggregation, weights) and grade items (category, maximum, weight). */
export async function gradebookSetup(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ categories: GradebookCategory[]; items: GradebookItem[] }> {
  const page = await openSitePage(context, siteUrl, `grade/edit/tree/index.php?id=${courseId}`);
  try {
    if ((await page.locator("body#page-grade-edit-tree-index #grade_edit_tree_table").count()) === 0) {
      throw new GradebookError(`You can't see course ${courseId}'s gradebook setup: ${(await fatalError(page)) ?? "the course doesn't exist, or you aren't allowed to manage its grades"}`);
    }
    const setup = await readGradebookSetup(page);
    // Category and course totals are their categories' own items, not items of their own.
    const totals = new Set(setup.categories.map((c) => c.itemId));
    return { categories: setup.categories, items: setup.items.filter((item) => !totals.has(item.id)) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Fills one of Moodle's dynamic forms (core_form_dynamic_form) as its modal does: rendered by the
 * service, filled in a blank tab, serialized and sent back. Throws `GradebookError` with Moodle's
 * messages when it comes back unsubmitted; `prepare` can check the form before it's filled.
 */
async function submitDynamicForm(
  context: BrowserContext,
  siteUrl: string,
  form: string,
  params: Record<string, string | number>,
  values: Record<string, FieldValue>,
  prepare?: (page: Page) => Promise<void>,
): Promise<void> {
  const formdata = new URLSearchParams(Object.entries(params).map(([key, value]): [string, string] => [key, String(value)])).toString();
  const rendered = await callService<{ html: string }>(context, siteUrl, "core_form_dynamic_form", { form, formdata });
  const page = await context.newPage();
  try {
    await page.setContent(rendered.html);
    await prepare?.(page);
    await setFields(page, values);
    const serialized = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown };
        FormData: new (form: unknown) => Iterable<[string, string]>;
        URLSearchParams: new (init: Iterable<[string, string]>) => { toString(): string };
      };
      return new g.URLSearchParams(new g.FormData(g.document.querySelector("form.mform"))).toString();
    });
    const answer = await callService<{ submitted: boolean; html: string }>(context, siteUrl, "core_form_dynamic_form", { form, formdata: serialized });
    if (answer.submitted) return;
    // Back unsubmitted: the form again, with its errors (ids carry a random suffix).
    await page.setContent(answer.html);
    const errors = await page.evaluate(() =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document.querySelectorAll('[id^="id_error_"]'))
        .map((element) => ({ field: element.id.slice("id_error_".length).replace(/_[A-Za-z0-9]{15}$/, ""), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
        .filter((error) => error.message !== ""),
    );
    throw new GradebookError(`Moodle refused the form: ${errors.map((e) => `${e.field}: ${e.message}`).join("; ") || "no reason given"}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Moves a grade item (`ig<id>`) or category (`cg<id>`) to the start of a category, as the setup page's "Move" does. */
async function moveIntoCategory(context: BrowserContext, siteUrl: string, courseId: number, element: string, categoryId: number): Promise<void> {
  const page = await openSitePage(context, siteUrl, `grade/edit/tree/index.php?id=${courseId}`);
  try {
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    const move = `grade/edit/tree/index.php?id=${courseId}&action=move&eid=${element}&moveafter=cg${categoryId}&first=1&sesskey=${sesskey}`;
    await page.goto(new URL(move, siteUrl).href, { waitUntil: "domcontentloaded" });
    if ((await page.locator("#grade_edit_tree_table").count()) === 0) {
      throw new GradebookError(`Moodle didn't move ${element.startsWith("cg") ? "category" : "item"} ${element.slice(2)} into category ${categoryId}: check both ids in the gradebook setup.`);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Changes a grade item: moves it into a category, sets its weight (percent, overriding Natural's
 * automatic one), or its maximum grade (a manual item's; an activity's is set in the activity).
 * Returns the item afterwards.
 */
export async function updateGradeItem(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  itemId: number,
  { category, weight, maxGrade }: { category?: number; weight?: number; maxGrade?: number },
): Promise<{ changed: string; item?: GradebookItem }> {
  if (category !== undefined) await moveIntoCategory(context, siteUrl, courseId, `ig${itemId}`, category);
  if (weight !== undefined || maxGrade !== undefined) {
    const values: Record<string, FieldValue> = {};
    if (weight !== undefined) Object.assign(values, { weightoverride: 1, aggregationcoef2: weight });
    if (maxGrade !== undefined) values.grademax = maxGrade;
    await submitDynamicForm(context, siteUrl, "core_grades\\form\\add_item", { courseid: courseId, itemid: itemId }, values, async (page) => {
      const fields = await page.evaluate(() => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { disabled: boolean } | null } }).document;
        const max = doc.querySelector('[name="grademax"]');
        return { maxEditable: max !== null && !max.disabled, weight: doc.querySelector('[name="aggregationcoef2"]') !== null };
      });
      if (maxGrade !== undefined && !fields.maxEditable) {
        throw new GradebookError(`Item ${itemId} belongs to an activity: its maximum grade is set in the activity's settings, not in the gradebook.`);
      }
      if (weight !== undefined && !fields.weight) throw new GradebookError(`Item ${itemId}'s category doesn't aggregate with weights that can be set (Natural): change its aggregation first.`);
    });
  }
  const done = [category !== undefined && `moved into category ${category}`, weight !== undefined && `weighted ${weight}%`, maxGrade !== undefined && `out of ${maxGrade}`].filter(Boolean);
  const item = (await gradebookSetup(context, siteUrl, courseId)).items.find((i) => i.id === itemId);
  return { changed: done.length > 0 ? `Grade item ${itemId} ${done.join(", ")}.` : "Nothing to change.", item };
}

/** Adds a grade category (at the course's top level, or inside `parentId`); returns it as the setup shows it. */
export async function addGradeCategory(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  { name, aggregation, parentId }: { name: string; aggregation?: GradeAggregation; parentId?: number },
): Promise<{ changed: string; category?: GradebookCategory }> {
  const before = new Set((await gradebookSetup(context, siteUrl, courseId)).categories.map((c) => c.id));
  const values: Record<string, FieldValue> = { fullname: name };
  if (aggregation !== undefined) values.aggregation = AGGREGATION_CODES[aggregation];
  await submitDynamicForm(context, siteUrl, "core_grades\\form\\add_category", { courseid: courseId }, values, async (page) => {
    if (aggregation === undefined) return;
    const offered = await page.evaluate(() =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll('[name="aggregation"] option')).map((o) => o.value),
    );
    if (!offered.includes(String(AGGREGATION_CODES[aggregation]))) {
      const available = GRADE_AGGREGATIONS.filter((a) => offered.includes(String(AGGREGATION_CODES[a])));
      throw new GradebookError(`The site doesn't offer the ${aggregation} aggregation; it offers: ${available.join(", ")}.`);
    }
  });
  let created = (await gradebookSetup(context, siteUrl, courseId)).categories.find((c) => !before.has(c.id));
  if (created && parentId !== undefined) {
    await moveIntoCategory(context, siteUrl, courseId, `cg${created.id}`, parentId);
    created = (await gradebookSetup(context, siteUrl, courseId)).categories.find((c) => c.id === created!.id);
  }
  return { changed: `Grade category ${created?.id ?? "?"} "${name}" added${parentId !== undefined ? ` in category ${parentId}` : ""}.`, category: created };
}
