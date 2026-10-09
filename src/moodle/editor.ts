import type { BrowserContext } from "playwright-core";
import { callService } from "./ajax.js";
import { openSitePage } from "./session.js";

/** The course editor's actions this server uses (`core_courseformat\stateactions`, Moodle 4.0–5.2). */
export type EditorAction =
  | "cm_show"
  | "cm_hide"
  | "cm_stealth"
  | "cm_move"
  | "cm_duplicate"
  | "cm_delete"
  | "section_add"
  | "section_show"
  | "section_hide"
  | "section_move_after"
  | "section_delete";

/**
 * Runs one of the course editor's actions through its own service (ADR-008), as the editor does:
 * ids of activities or sections, and a target section (`cm_move`: at its end; `section_add`,
 * `section_move_after`: after it) or a target activity (`cm_move`: before it).
 */
export async function editCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  action: EditorAction,
  ids: number[],
  target: { sectionId?: number; activityId?: number } = {},
): Promise<void> {
  await callService<string>(context, siteUrl, "core_courseformat_update_course", {
    action,
    courseid: courseId,
    ids,
    ...(target.sectionId ? { targetsectionid: target.sectionId } : {}),
    ...(target.activityId ? { targetcmid: target.activityId } : {}),
  });
}

// A course's format doesn't change while the server runs.
const formats = new Map<string, string>();

/** The course format (topics, weeks…), a class of the course page's body: no service tells teachers. */
export async function courseFormat(context: BrowserContext, siteUrl: string, courseId: number): Promise<string> {
  const key = `${siteUrl}|${courseId}`;
  const cached = formats.get(key);
  if (cached) return cached;
  const page = await openSitePage(context, siteUrl, `course/view.php?id=${courseId}`);
  try {
    const classes = await page.evaluate(() => (globalThis as unknown as { document: { body: { className: string } } }).document.body.className);
    const format = classes
      .split(" ")
      .find((name) => name.startsWith("format-"))
      ?.slice("format-".length);
    if (!format) throw new Error(`Course ${courseId}'s format isn't on its page.`);
    formats.set(key, format);
    return format;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Renames an activity, as the course page's in-place editor does. */
export async function renameActivity(context: BrowserContext, siteUrl: string, activityId: number, name: string): Promise<void> {
  await callService(context, siteUrl, "core_update_inplace_editable", { component: "core_course", itemtype: "activityname", itemid: activityId, value: name });
}

/** Renames a section through its course format's in-place editor. */
export async function renameSection(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number, name: string): Promise<void> {
  const format = await courseFormat(context, siteUrl, courseId);
  await callService(context, siteUrl, "core_update_inplace_editable", { component: `format_${format}`, itemtype: "sectionname", itemid: sectionId, value: name });
}
