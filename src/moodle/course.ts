import type { BrowserContext, Page } from "playwright-core";
import { callService } from "./ajax.js";
import { openSitePage } from "./session.js";

/** `core_courseformat_get_state` as Moodle 4.0–5.2 returns it, the fields read. */
export interface CourseState {
  course?: { id: string; baseurl?: string };
  section: {
    id: string;
    number: number;
    title: string;
    visible?: boolean;
    hasrestrictions?: boolean;
    sectionurl?: string;
    component?: string | null;
    parentsectionid?: string | null;
    cmlist?: string[];
  }[];
  cm: {
    id: string;
    name: string;
    module: string;
    url?: string;
    visible: boolean;
    uservisible?: boolean;
    accessvisible?: boolean;
    hascmrestrictions?: boolean;
    sectionid: string;
    istrackeduser?: boolean;
    completionstate?: number;
    isoverallcomplete?: boolean;
  }[];
}

/** The course page's own state: sections and activities, as a JSON string (ADR-008). */
export async function courseState(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseState> {
  return JSON.parse(await callService<string>(context, siteUrl, "core_courseformat_get_state", { courseid: courseId })) as CourseState;
}

/** What the course page shows of an activity, in the site's language. */
export interface ActivityDetails {
  id: number;
  dates: { label: string; value: string }[];
  restriction?: string;
}

/** The activities on a course or section page: their dates and restriction texts. */
export function readActivityDetails(page: Page): Promise<ActivityDetails[]> {
  return page.evaluate(() => {
    interface Element {
      getAttribute(name: string): string | null;
      querySelector(selector: string): Element | null;
      querySelectorAll(selector: string): ArrayLike<Element>;
      textContent: string | null;
    }
    const doc = (globalThis as unknown as { document: Element }).document;
    // No helper functions in here: see the conventions on page.evaluate.
    return Array.from(doc.querySelectorAll('[data-for="cmitem"][data-id], li.activity[data-id]')).map((item) => {
      const dates = Array.from(item.querySelectorAll('[data-region="activity-dates"] .date-item')).map((date) => {
        const label = (date.querySelector(".date-item-label")?.textContent ?? "").replace(/\s+/g, " ").trim();
        const all = (date.textContent ?? "").replace(/\s+/g, " ").trim();
        return { label: label.replace(/:$/, ""), value: all.slice(label.length).trim() };
      });
      const restriction = (item.querySelector(".availabilityinfo")?.textContent ?? "").replace(/\s+/g, " ").trim() || undefined;
      return { id: Number(item.getAttribute("data-id")), dates, restriction };
    });
  });
}

/**
 * Details for the given activities: from the course page, then from the section pages of those it
 * doesn't show (courses with one section per page).
 */
export async function activityDetails(context: BrowserContext, siteUrl: string, courseId: number, state: CourseState): Promise<Map<number, ActivityDetails>> {
  const details = new Map<number, ActivityDetails>();
  const read = async (path: string) => {
    const page = await openSitePage(context, siteUrl, path);
    try {
      for (const item of await readActivityDetails(page)) details.set(item.id, item);
    } finally {
      await page.close().catch(() => undefined);
    }
  };
  await read(`course/view.php?id=${courseId}`);
  const missingSections = new Set(state.cm.filter((cm) => !details.has(Number(cm.id))).map((cm) => cm.sectionid));
  for (const sectionId of missingSections) await read(`course/section.php?id=${sectionId}`);
  return details;
}
