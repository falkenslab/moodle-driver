// Whole-forum grading: the forum's own grade per person, as the forum's "Grade users" grader reads
// and stores it, through the grading panel services (core_grades_grader_gradingpanel_<point|scale>_*)
// and the gradable users service, with the ids the forum page's button carries.
import type { BrowserContext } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { GradingError } from "../assignments/grader.js";
import { NotAForumError } from "./discussions.js";

/** What the forum page's grader button says: where the forum's grade lives and how it's given. */
interface ForumGrading {
  contextId: number;
  courseId: number;
  /** "point" or "scale" for direct grading; an advanced method's component otherwise. */
  method: string;
  component: string;
  onlyActive: boolean;
}

async function forumGrading(context: BrowserContext, siteUrl: string, activityId: number): Promise<ForumGrading> {
  const page = await openSitePage(context, siteUrl, `mod/forum/view.php?id=${activityId}`);
  try {
    if ((await page.locator("body#page-mod-forum-view").count()) === 0) {
      throw new NotAForumError(`Activity ${activityId} isn't a forum you can view. Take the id of a forum (module "forum") from the course structure.`);
    }
    const button = await page.evaluate(() => {
      const node = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector(
        '[data-grade-action="launch"][data-gradable-itemtype="forum"]',
      );
      if (!node) return undefined;
      return {
        contextId: Number(node.getAttribute("data-contextid")),
        courseId: Number(node.getAttribute("data-course-id")),
        component: node.getAttribute("data-grading-component") ?? "",
        method: node.getAttribute("data-grading-component-subtype") ?? "",
        onlyActive: node.getAttribute("data-grade-only-active-users") === "1",
      };
    });
    if (!button) {
      throw new GradingError(`Forum ${activityId} isn't graded as a whole (its "Whole forum grading" is off), or you can't grade it.`);
    }
    return button;
  } finally {
    await page.close().catch(() => undefined);
  }
}

interface PanelGrade {
  hasgrade: boolean;
  grade: { grade?: number; usergrade: string; maxgrade: string; gradedby?: string; timemodified: number; options?: { value: number; title: string; selected: boolean }[] };
}

/** A person's whole-forum grade. */
export interface ForumGrade {
  userId: number;
  fullName: string;
  /** As Moodle shows it ("8.00", a scale item's name); left out when not graded. */
  grade?: string;
  /** The number stored: the points, or the scale item's value. */
  value?: number;
  gradedBy?: string;
  /** When it was last changed (ISO 8601). */
  gradedAt?: string;
}

/** A forum's whole-forum grades, as `forumGrades` reads them, with how the forum is graded. */
export interface ForumGrades {
  activityId: number;
  /** "point" (out of `maxGrade`) or "scale" (one of `scale`'s items). */
  method: "point" | "scale";
  maxGrade?: number;
  /** A scale's items, by value. */
  scale?: { value: number; name: string }[];
  grades: ForumGrade[];
}

function directMethod(activityId: number, grading: ForumGrading): "point" | "scale" {
  if (grading.component === "core_grades" && (grading.method === "point" || grading.method === "scale")) return grading.method;
  throw new GradingError(`Forum ${activityId} is graded with an advanced grading method (${grading.component}): only a grade out of points or on a scale can be given here.`);
}

function toGrade(user: { id: number; fullname: string }, method: "point" | "scale", panel: PanelGrade): ForumGrade {
  // A scale's "No grade" has no positive value; a point grade of 0 is a grade.
  const value = method === "scale" ? panel.grade.options?.find((o) => o.selected && o.value > 0)?.value : panel.grade.grade;
  return {
    userId: user.id,
    fullName: user.fullname,
    ...(panel.hasgrade && panel.grade.usergrade !== "-" && panel.grade.usergrade !== "" ? { grade: panel.grade.usergrade } : {}),
    ...(panel.hasgrade && typeof value === "number" && value >= 0 ? { value } : {}),
    ...(panel.hasgrade && panel.grade.gradedby ? { gradedBy: panel.grade.gradedby } : {}),
    ...(panel.hasgrade && panel.grade.timemodified ? { gradedAt: new Date(panel.grade.timemodified * 1000).toISOString() } : {}),
  };
}

function fetchPanel(context: BrowserContext, siteUrl: string, method: "point" | "scale", contextId: number, userId: number): Promise<PanelGrade> {
  return callService<PanelGrade>(context, siteUrl, `core_grades_grader_gradingpanel_${method}_fetch`, { component: "mod_forum", contextid: contextId, itemname: "forum", gradeduserid: userId });
}

/**
 * Everyone's whole-forum grade in a forum graded as a whole, as its grader shows them: one per
 * person it can grade (only the active ones when the forum says so), with how it's graded. One
 * service call per person. Throws `NotAForumError` for another activity, and `GradingError` when
 * the forum isn't graded as a whole or uses an advanced grading method.
 */
export async function forumGrades(context: BrowserContext, siteUrl: string, activityId: number, { groupId }: { groupId?: number } = {}): Promise<ForumGrades> {
  const grading = await forumGrading(context, siteUrl, activityId);
  const method = directMethod(activityId, grading);
  const { users } = await callService<{ users: { id: number; fullname: string }[] }>(context, siteUrl, "core_grades_get_gradable_users", {
    courseid: grading.courseId,
    groupid: groupId ?? 0,
    onlyactive: grading.onlyActive,
  });
  const result: ForumGrades = { activityId, method, grades: [] };
  for (const user of users) {
    const panel = await fetchPanel(context, siteUrl, method, grading.contextId, user.id);
    if (method === "point" && result.maxGrade === undefined && Number(panel.grade.maxgrade)) result.maxGrade = Number(panel.grade.maxgrade);
    if (method === "scale" && !result.scale && panel.grade.options) result.scale = panel.grade.options.filter((o) => o.value > 0).map((o) => ({ value: o.value, name: o.title }));
    result.grades.push(toGrade(user, method, panel));
  }
  return result;
}

/**
 * Gives a person their whole-forum grade, as the forum's grader does: points (out of the forum's
 * maximum), or a scale item by name or value; `null` takes the grade away. Moodle's forum grader
 * has no feedback text. `notify` sends the person Moodle's notification, as the grader's checkbox
 * does. Returns a sentence of what changed and the grade afterwards. Throws `GradingError` when the
 * forum isn't graded as a whole, the grade is out of range or not on the scale, or Moodle refuses it.
 */
export async function gradeForumUser(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  userId: number,
  { grade, notify = false }: { grade: number | string | null; notify?: boolean },
): Promise<{ changed: string; grade: Omit<ForumGrade, "fullName"> }> {
  const grading = await forumGrading(context, siteUrl, activityId);
  const method = directMethod(activityId, grading);
  const before = await fetchPanel(context, siteUrl, method, grading.contextId, userId);
  let value: number;
  // A scale's "No grade" is -1, as in the panel's menu.
  if (grade === null) value = -1;
  else if (method === "scale") {
    const options = (before.grade.options ?? []).filter((o) => o.value > 0);
    const option = options.find((o) => o.value === Number(grade) || o.title === String(grade));
    if (!option) throw new GradingError(`Forum ${activityId} is graded on a scale; give one of its items: ${options.map((o) => `"${o.title}"`).join(", ")}.`);
    value = option.value;
  } else {
    value = Number(grade);
    const max = Number(before.grade.maxgrade);
    if (!Number.isFinite(value) || value < 0 || (max > 0 && value > max)) throw new GradingError(`Forum ${activityId} takes grades from 0 to ${max || "its maximum"}, not ${grade}.`);
  }
  if (!Number.isFinite(value)) throw new MoodleError(`The grade must be a number: ${grade}.`, "invalid-input");
  // An emptied point grade is sent empty, as the panel's emptied field is.
  const formdata = new URLSearchParams({ grade: grade === null && method === "point" ? "" : String(value) }).toString();
  const after = await callService<PanelGrade>(context, siteUrl, `core_grades_grader_gradingpanel_${method}_store`, {
    component: "mod_forum",
    contextid: grading.contextId,
    itemname: "forum",
    gradeduserid: userId,
    notifyuser: notify,
    formdata,
  });
  const result: Omit<ForumGrade, "fullName"> & { fullName?: string } = toGrade({ id: userId, fullname: "" }, method, after);
  delete result.fullName;
  return {
    changed: grade === null ? `User ${userId}'s grade in forum ${activityId} taken away.` : `User ${userId} graded ${result.grade ?? grade} in forum ${activityId}${notify ? ", notified" : ""}.`,
    grade: result,
  };
}
