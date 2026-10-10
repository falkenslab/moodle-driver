import type { BrowserContext } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { NotLoggedInError } from "../../core/session.js";
import { decodeEntities } from "../../core/text.js";

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

/** A course that isn't there, or the person can't change. */
export class CourseError extends Error {
  override name = "CourseError";
}

/**
 * Changes a course's full name, short name, summary (HTML) or any other setting by its form field
 * name, through the course's settings form; returns the course as `listCourses` gives it. Moodle's
 * refusals (a short name already taken) come back as `FormError` by field.
 */
export async function updateCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  { fullName, shortName, summary, settings }: { fullName?: string; shortName?: string; summary?: string; settings?: Record<string, FieldValue> },
): Promise<{ changed: string; course?: Course }> {
  const values: Record<string, FieldValue> = { ...settings };
  if (fullName !== undefined) values.fullname = fullName;
  if (shortName !== undefined) values.shortname = shortName;
  if (summary !== undefined) values["summary_editor[text]"] = summary;
  if (Object.keys(values).length === 0) return { changed: "Nothing to change.", course: (await listCourses(context, siteUrl)).find((c) => c.id === courseId) };
  const page = await openForm(context, siteUrl, `course/edit.php?id=${courseId}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new CourseError(`You can't change course ${courseId}'s settings: it doesn't exist, or you aren't allowed.`);
  });
  try {
    await setFields(page, values);
    await submitForm(page, "saveanddisplay");
  } finally {
    await page.close().catch(() => undefined);
  }
  const course = (await listCourses(context, siteUrl)).find((c) => c.id === courseId);
  return { changed: `Course ${courseId} updated (${Object.keys(values).join(", ")}).`, course };
}
