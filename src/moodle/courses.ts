import type { BrowserContext } from "playwright-core";
import { callService } from "./ajax.js";
import { decodeEntities } from "./text.js";

/** Which courses by their dates; "all" includes those the person hid from their dashboard. */
export const COURSE_CLASSIFICATIONS = ["all", "inprogress", "future", "past"] as const;
export type CourseClassification = (typeof COURSE_CLASSIFICATIONS)[number];

const MOODLE_CLASSIFICATIONS: Record<CourseClassification, string> = { all: "allincludinghidden", inprogress: "inprogress", future: "future", past: "past" };

export interface Course {
  id: number;
  shortname: string;
  fullname: string;
  category?: string;
  url: string;
  /** Whether students can see the course. */
  visible: boolean;
  startDate?: string;
  endDate?: string;
  /** The person's completion percentage, when the course tracks it. */
  progress?: number;
  /** When the person last opened the course. */
  lastAccess?: string;
}

/** A course as `core_course_get_enrolled_courses_by_timeline_classification` returns it (Moodle 5.2). */
export interface MoodleCourse {
  id: number;
  shortname: string;
  fullname: string;
  coursecategory?: string;
  viewurl: string;
  visible: boolean;
  startdate?: number;
  enddate?: number;
  progress?: number | null;
  hasprogress?: boolean;
  timeaccess?: number | null;
}

/** Unix seconds as ISO 8601; Moodle uses 0 for "none". */
export function isoDate(seconds: number | null | undefined): string | undefined {
  return seconds ? new Date(seconds * 1000).toISOString() : undefined;
}

export function toCourse(raw: MoodleCourse): Course {
  return {
    id: raw.id,
    shortname: decodeEntities(raw.shortname),
    fullname: decodeEntities(raw.fullname),
    category: raw.coursecategory ? decodeEntities(raw.coursecategory) : undefined,
    url: raw.viewurl,
    visible: raw.visible,
    startDate: isoDate(raw.startdate),
    endDate: isoDate(raw.enddate),
    progress: raw.hasprogress && typeof raw.progress === "number" ? raw.progress : undefined,
    lastAccess: isoDate(raw.timeaccess),
  };
}

/** The courses the person is enrolled in, as teacher or student. */
export async function listCourses(context: BrowserContext, siteUrl: string, classification: CourseClassification = "all"): Promise<Course[]> {
  const { courses } = await callService<{ courses: MoodleCourse[] }>(context, siteUrl, "core_course_get_enrolled_courses_by_timeline_classification", {
    classification: MOODLE_CLASSIFICATIONS[classification],
    limit: 0,
    offset: 0,
    sort: "fullname",
  });
  return courses.map(toCourse);
}
