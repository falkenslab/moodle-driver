// A course as sections and activities, and what follows from it: its assignments, what the person
// still has to do.
import type { BrowserContext } from "playwright-core";
import { activityDetails, courseState, type ActivityDetails, type CourseState } from "./course.js";
import { myGrades } from "./grades.js";
import { decodeEntities } from "./text.js";

/** Moodle's completion states (COMPLETION_INCOMPLETE … COMPLETION_COMPLETE_FAIL), by their value. */
export const COMPLETION_STATES = ["incomplete", "complete", "complete-pass", "complete-fail"] as const;
export type CompletionState = (typeof COMPLETION_STATES)[number];

export interface CourseActivity {
  /** The course module id, which every activity function takes. */
  id: number;
  name: string;
  /** The module: "page", "assign", "quiz", "forum", "resource"… */
  type: string;
  url?: string;
  /** Shown to students. */
  visible: boolean;
  /** The person can open it now. */
  availableToMe: boolean;
  restricted: boolean;
  /** The person's completion, when the activity tracks it for them. */
  completion?: { state: CompletionState; complete: boolean };
  /** With details: as the course page shows them, in the site's language. */
  dates?: { label: string; value: string }[];
  /** With details: the restriction as the course page shows it. */
  restriction?: string;
}

export interface CourseSection {
  id: number;
  number: number;
  title: string;
  visible: boolean;
  restricted: boolean;
  url?: string;
  /** For a subsection, the section that holds it. */
  parentSectionId?: number;
  activities: CourseActivity[];
}

/** The state as sections with their activities, in the course's order; details merged when given. */
export function structureOf(state: CourseState, details?: Map<number, ActivityDetails>): CourseSection[] {
  const cms = new Map(state.cm.map((cm) => [cm.id, cm]));
  return state.section.map((s) => {
    const ids = s.cmlist ?? state.cm.filter((cm) => cm.sectionid === s.id).map((cm) => cm.id);
    const activities = ids.flatMap((id) => {
      const cm = cms.get(id);
      if (!cm) return [];
      const extra = details?.get(Number(cm.id));
      const state = cm.istrackeduser && cm.completionstate !== undefined ? COMPLETION_STATES[cm.completionstate] : undefined;
      return [
        {
          id: Number(cm.id),
          name: decodeEntities(cm.name),
          type: cm.module,
          url: cm.url,
          visible: cm.visible,
          availableToMe: (cm.uservisible ?? true) && (cm.accessvisible ?? true),
          restricted: cm.hascmrestrictions ?? false,
          completion: state ? { state, complete: cm.isoverallcomplete ?? state !== "incomplete" } : undefined,
          dates: extra && extra.dates.length > 0 ? extra.dates : undefined,
          restriction: extra?.restriction,
        },
      ];
    });
    return {
      id: Number(s.id),
      number: s.number,
      title: decodeEntities(s.title),
      visible: s.visible ?? true,
      restricted: s.hasrestrictions ?? false,
      url: s.sectionurl,
      parentSectionId: s.parentsectionid ? Number(s.parentsectionid) : undefined,
      activities,
    };
  });
}

/** A course's sections and activities; with `details`, each activity's dates and restriction from the course page (slower). */
export async function courseStructure(context: BrowserContext, siteUrl: string, courseId: number, { details = false } = {}) {
  const state = await courseState(context, siteUrl, courseId);
  const extra = details ? await activityDetails(context, siteUrl, courseId, state) : undefined;
  return { course: { id: courseId, url: state.course?.baseurl }, sections: structureOf(state, extra) };
}

export interface CourseAssignment {
  /** The assignment's course module id. */
  id: number;
  name: string;
  url: string;
  visible: boolean;
  section: { number: number; title: string };
}

/** The course's assignments, in the course's order. */
export function assignmentsOf(state: CourseState): CourseAssignment[] {
  const sections = new Map(state.section.map((section) => [section.id, section]));
  return state.cm
    .filter((cm) => cm.module === "assign")
    .map((cm) => {
      const section = sections.get(cm.sectionid);
      return {
        id: Number(cm.id),
        name: decodeEntities(cm.name),
        url: cm.url ?? "",
        visible: cm.visible,
        section: { number: section?.number ?? 0, title: decodeEntities(section?.title ?? "") },
      };
    });
}

export async function listAssignments(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseAssignment[]> {
  return assignmentsOf(await courseState(context, siteUrl, courseId));
}

export interface PendingActivity {
  activityId: number;
  name: string;
  type: string;
  url?: string;
  section: { number: number; title: string };
  /** Tracked and not complete, or (completion not tracked) graded and not graded yet. */
  reason: "incomplete" | "not-graded";
  completion?: string;
  availableToMe: boolean;
  dates?: { label: string; value: string }[];
  restriction?: string;
}

/**
 * What the person still has to do in a course: activities whose completion is tracked and not
 * complete or, where completion isn't tracked, graded activities without a grade yet.
 */
export async function pendingActivities(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ completionTracked: boolean; pending: PendingActivity[] }> {
  const state = await courseState(context, siteUrl, courseId);
  const sections = structureOf(state, await activityDetails(context, siteUrl, courseId, state));
  const ungraded = new Set(
    (await myGrades(context, siteUrl, courseId).catch(() => [])).filter((row) => row.kind === "item" && row.activityId && !row.grade).map((row) => row.activityId),
  );
  const completionTracked = state.cm.some((cm) => cm.istrackeduser && cm.completionstate !== undefined);
  const pending: PendingActivity[] = [];
  for (const section of sections) {
    for (const activity of section.activities) {
      if (!activity.visible && !activity.availableToMe) continue;
      const tracked = activity.completion !== undefined;
      const reason = tracked ? (activity.completion!.complete ? undefined : "incomplete") : ungraded.has(activity.id) ? "not-graded" : undefined;
      if (!reason) continue;
      pending.push({
        activityId: activity.id,
        name: activity.name,
        type: activity.type,
        url: activity.url,
        section: { number: section.number, title: section.title },
        reason,
        completion: activity.completion?.state,
        availableToMe: activity.availableToMe,
        dates: activity.dates,
        restriction: activity.restriction,
      });
    }
  }
  return { completionTracked, pending };
}
