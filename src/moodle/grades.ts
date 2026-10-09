import type { BrowserContext, Page } from "playwright-core";
import { openSitePage } from "./session.js";

/** A row of the user grade report, values as Moodle shows them ("-" left out). */
export interface GradeRow {
  kind: "item" | "category" | "courseTotal";
  name: string;
  activityId?: number;
  activityType?: string;
  grade?: string;
  range?: string;
  percentage?: string;
  weight?: string;
  letter?: string;
  feedback?: string;
  contribution?: string;
}

/** The person can't see the grade report of that course. */
export class NoGradeReportError extends Error {
  override name = "NoGradeReportError";
}

/** The rows of `table.user-grade`, by cell classes, never by header texts (ADR-006). */
export function readGradeRows(page: Page): Promise<GradeRow[]> {
  return page.evaluate(() => {
    interface Element {
      className: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(selector: string): Element | null;
      querySelectorAll(selector: string): ArrayLike<Element>;
      cloneNode(deep: boolean): Element;
      remove(): void;
    }
    const doc = (globalThis as unknown as { document: Element }).document;
    const rows = Array.from(doc.querySelectorAll("table.user-grade tr"));
    const result: GradeRow[] = [];
    for (const row of rows) {
      const nameCell = row.querySelector(".column-itemname");
      if (!nameCell || row.querySelector("th.column-itemname[scope='col'], thead")) continue;
      const classes = nameCell.className;
      const kind = /\bbaggt\b/.test(classes) ? "courseTotal" : /\bcategory\b/.test(classes) ? "category" : /\bitem\b/.test(classes) ? "item" : undefined;
      if (!kind) continue;
      const values: Record<string, string | undefined> = {};
      for (const column of ["grade", "range", "percentage", "weight", "lettergrade", "feedback", "contributiontocoursetotal"]) {
        const cell = row.querySelector(`.column-${column}`);
        if (!cell) continue;
        // The grade cell also holds an action menu whose text is in the site's language.
        const copy = cell.cloneNode(true);
        for (const menu of Array.from(copy.querySelectorAll(".action-menu, .dropdown, .visually-hidden"))) menu.remove();
        const text = (copy.textContent ?? "").replace(/\s+/g, " ").trim();
        values[column] = text === "" || text === "-" ? undefined : text;
      }
      const link = nameCell.querySelector('a[href*="/mod/"][href*="view.php"]');
      const href = link?.getAttribute("href") ?? "";
      const match = /\/mod\/([a-z0-9_]+)\/view\.php\?(?:.*&)?id=(\d+)/.exec(href);
      result.push({
        kind,
        name: ((nameCell.querySelector(".rowtitle") ?? nameCell).textContent ?? "").replace(/\s+/g, " ").trim(),
        activityId: match ? Number(match[2]) : undefined,
        activityType: match ? match[1] : undefined,
        grade: values.grade,
        range: values.range,
        percentage: values.percentage,
        weight: values.weight,
        letter: values.lettergrade,
        feedback: values.feedback,
        contribution: values.contributiontocoursetotal,
      });
    }
    return result;
  });
}

/** The person's own grade report for a course. */
export async function myGrades(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeRow[]> {
  const page = await openSitePage(context, siteUrl, `grade/report/user/index.php?id=${courseId}`);
  try {
    if ((await page.locator("body#page-grade-report-user-index table.user-grade").count()) === 0) {
      throw new NoGradeReportError(`There's no grade report of yours to read in course ${courseId}: the course doesn't exist, you aren't graded there, or grades are hidden.`);
    }
    return await readGradeRows(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}
