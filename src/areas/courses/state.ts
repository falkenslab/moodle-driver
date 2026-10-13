import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { openSitePage } from "../../core/session.js";

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
    /** A subsection's own section (Moodle 5). */
    delegatesectionid?: string | number | null;
    istrackeduser?: boolean;
    completionstate?: number;
    isoverallcomplete?: boolean;
  }[];
}

/** The course page's own state: sections and activities, as a JSON string (ADR-004). */
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
 * The sections' descriptions on a course or section page, by section id: the HTML Moodle renders
 * (`.summarytext` in the section, without its `no-overflow` wrapper); sections without one left out.
 */
export function readSectionSummaries(page: Page): Promise<{ id: number; summary: string }[]> {
  return page.evaluate(() => {
    interface Element {
      getAttribute(name: string): string | null;
      closest(selector: string): Element | null;
      querySelector(selector: string): Element | null;
      querySelectorAll(selector: string): ArrayLike<Element>;
      innerHTML: string;
    }
    const doc = (globalThis as unknown as { document: Element }).document;
    const summaries: { id: number; summary: string }[] = [];
    for (const section of Array.from(doc.querySelectorAll('[data-for="section"][data-id]'))) {
      // The section's own summary, not a subsection's inside it.
      const own = Array.from(section.querySelectorAll(".summarytext")).find((s) => s.closest('[data-for="section"]') === section);
      if (!own) continue;
      const summary = (own.querySelector(":scope > .no-overflow") ?? own).innerHTML.trim();
      if (summary !== "") summaries.push({ id: Number(section.getAttribute("data-id")), summary });
    }
    return summaries;
  });
}

/**
 * What the course page shows beyond the course's state: each activity's dates and restriction, and
 * each section's description. From the course page, then from the section pages of activities it
 * doesn't show (courses with one section per page).
 */
export async function courseDetails(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  state: CourseState,
): Promise<{ activities: Map<number, ActivityDetails>; summaries: Map<number, string> }> {
  const activities = new Map<number, ActivityDetails>();
  const summaries = new Map<number, string>();
  const read = async (path: string) => {
    const page = await openSitePage(context, siteUrl, path);
    try {
      for (const item of await readActivityDetails(page)) activities.set(item.id, item);
      for (const { id, summary } of await readSectionSummaries(page)) summaries.set(id, summary);
    } finally {
      await page.close().catch(() => undefined);
    }
  };
  await read(`course/view.php?id=${courseId}`);
  const missingSections = new Set(state.cm.filter((cm) => !activities.has(Number(cm.id))).map((cm) => cm.sectionid));
  for (const sectionId of missingSections) await read(`course/section.php?id=${sectionId}`);
  return { activities, summaries };
}

/**
 * Details for the given activities: from the course page, then from the section pages of those it
 * doesn't show (courses with one section per page).
 */
export async function activityDetails(context: BrowserContext, siteUrl: string, courseId: number, state: CourseState): Promise<Map<number, ActivityDetails>> {
  return (await courseDetails(context, siteUrl, courseId, state)).activities;
}
