import type { BrowserContext } from "playwright-core";
import { MoodleServiceError, callService, readPageConfig } from "../../core/ajax.js";
import { courseState } from "../courses/state.js";
import { isoDate } from "../courses/list.js";
import { openSitePage } from "../../core/session.js";

/** A user as `core_user_get_users_by_field` returns it (Moodle 5.2), the fields read. */
export interface MoodleUser {
  id: number;
  username?: string;
  fullname: string;
  email?: string;
  firstaccess?: number;
  lastaccess?: number;
}

export async function userById(context: BrowserContext, siteUrl: string, userId: number): Promise<MoodleUser | undefined> {
  const users = await callService<MoodleUser[]>(context, siteUrl, "core_user_get_users_by_field", { field: "id", values: [String(userId)] });
  return users[0];
}

/** The site's name, from its public settings; `undefined` where the mobile app support is off. */
export async function siteName(context: BrowserContext, siteUrl: string): Promise<string | undefined> {
  try {
    return (await callService<{ sitename?: string }>(context, siteUrl, "tool_mobile_get_public_config", {})).sitename;
  } catch {
    return undefined;
  }
}

/** A user's roles in a course, from their profile there: role links carry the role id in any language. */
export async function courseRoles(context: BrowserContext, siteUrl: string, userId: number, courseId: number): Promise<{ id: number; name: string }[]> {
  const page = await openSitePage(context, siteUrl, `user/view.php?id=${userId}&course=${courseId}`);
  try {
    return await page.evaluate(() => {
      const links = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ href: string; textContent: string | null }> } }).document.querySelectorAll(
        '#region-main a[href*="/user/index.php"][href*="roleid="]',
      );
      const roles = new Map<number, string>();
      for (const link of Array.from(links)) {
        const id = Number(new URL(link.href).searchParams.get("roleid"));
        if (id > 0) roles.set(id, (link.textContent ?? "").trim());
      }
      return Array.from(roles, ([id, name]) => ({ id, name }));
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * What the person can do in a course, asked of read-only services that need the capability: the
 * activity types they can add (none without `moodle/course:manageactivities`) and the grader
 * report's users (`nopermissions` without `gradereport/grader:view`). Nothing is changed.
 */
export async function courseAbilities(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<{ canEdit: boolean; canGrade: boolean }> {
  const items = await callService<{ content_items: unknown[] }>(context, siteUrl, "core_courseformat_get_section_content_items", { courseid: courseId, sectionid: sectionId });
  let canGrade = true;
  try {
    await callService(context, siteUrl, "gradereport_grader_get_users_in_report", { courseid: courseId });
  } catch (error) {
    if (!(error instanceof MoodleServiceError && error.errorcode === "nopermissions")) throw error;
    canGrade = false;
  }
  return { canEdit: items.content_items.length > 0, canGrade };
}

export interface Me {
  userId: number;
  username?: string;
  fullName: string;
  email?: string;
  /** The interface language in use. */
  language: string;
  timeZone: string;
  firstAccess?: string;
  lastAccess?: string;
  site: { name?: string; url: string };
  /** With a course: the person's roles there and what they can do. */
  course?: { id: number; roles: { id: number; name: string }[]; canEdit: boolean; canGrade: boolean };
}

/** Who the logged-in person is; with `courseId`, also their roles and abilities in that course. */
export async function whoAmI(context: BrowserContext, siteUrl: string, courseId?: number): Promise<Me> {
  const cfg = await readPageConfig(context, siteUrl);
  const user = await userById(context, siteUrl, cfg.userId);
  const me: Me = {
    userId: cfg.userId,
    username: user?.username,
    fullName: user?.fullname ?? "",
    email: user?.email,
    language: cfg.language,
    timeZone: cfg.timeZone,
    firstAccess: isoDate(user?.firstaccess),
    lastAccess: isoDate(user?.lastaccess),
    site: { name: await siteName(context, siteUrl), url: siteUrl },
  };
  if (courseId !== undefined) {
    // The course's state checks that it exists and the person can see it, and gives a section.
    const state = await courseState(context, siteUrl, courseId);
    const abilities = await courseAbilities(context, siteUrl, courseId, Number(state.section[0]?.id ?? 0));
    me.course = { id: courseId, roles: await courseRoles(context, siteUrl, cfg.userId, courseId), ...abilities };
  }
  return me;
}
