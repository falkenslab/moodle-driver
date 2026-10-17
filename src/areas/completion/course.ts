// Course completion, apart from activity completion (completion.ts): the course's completion criteria
// on their form (`course/completion.php`), and each participant's course completion on the course
// completion report (`report/completion/index.php`, its page for the columns and its CSV export for
// the dates), where a role's manual completion is marked too (`course/togglecompletion.php`). The
// services that read course completion (`core_completion_get_course_completion_status`) aren't
// callable from the interface's AJAX (Moodle 5.2).
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";
import { dateSelectorDate, dateSelectorValues, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { siteFetch } from "../../core/http.js";
import { inPage } from "../../core/inPage.js";
import { pageWindow, sliceWindow, toPage, type ListPage, type PageOptions, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { fetchSitePage, moodleErrorMessage, openSitePage } from "../../core/session.js";
import { languageFormats, parseMoodleDate } from "../reports/dates.js";
import { parseCsv } from "../surveys/results.js";
import { CompletionError } from "./completion.js";

/** Whether all of a group of criteria must be met, or any one. */
export type CompletionAggregation = "all" | "any";

/** A course's completion criteria, as its "Course completion" settings form holds them; a kind of criterion not set is absent. */
export interface CourseCompletionCriteria {
  /** Whether completion is enabled on the site and in the course: Moodle keeps criteria either way, but tracks nobody's completion while it's off. */
  enabled: boolean;
  /** Whether someone has met a criterion already: Moodle then locks the criteria, until they're unlocked (deleting everyone's course completion data). */
  locked: boolean;
  /** Whether the course completes when all the criteria below are met, or any one. */
  overall: CompletionAggregation;
  /** Completing these activities (course module ids): all of them, or any one. */
  activities?: { activityIds: number[]; all: boolean };
  /** Completing these other courses first: all of them, or any one. */
  courses?: { courseIds: number[]; all: boolean };
  /** Completion on a date (ISO, the start of that day in the person's time zone). */
  date?: string;
  /** Completion after this many days enrolled. */
  enrolmentDays?: number;
  /** Completion on being unenrolled. */
  unenrolment?: true;
  /** A course grade of at least this. */
  grade?: number;
  /** The participant marks the course complete themselves. */
  self?: true;
  /** Marked complete by someone with these roles (role ids): by all of them, or any one. */
  roles?: { roleIds: number[]; all: boolean };
  /** What the form offers: the course's activities with completion tracking, and the roles that may mark a participant complete (moodle/course:markcomplete). */
  offered: { activities: { id: number; name: string }[]; roles: { id: number; name: string }[] };
}

/** What `setCourseCompletionCriteria` changes: a criterion given replaces that kind's settings, `null` (or `false`) removes it, one not given stays. */
export interface CourseCompletionChanges {
  overall?: CompletionAggregation;
  /** Completing these activities (course module ids, with completion tracking); `all` defaults to true. */
  activities?: { activityIds: number[]; all?: boolean } | null;
  /** Completing these other courses (they must track completion); `all` defaults to true. */
  courses?: { courseIds: number[]; all?: boolean } | null;
  /** Completion on this day (in the person's time zone). */
  date?: Date | null;
  /** Completion after this many days enrolled: one of Moodle's choices (1 to 30, 40 to 180 by tens, 365). */
  enrolmentDays?: number | null;
  /** Completion on being unenrolled. */
  unenrolment?: boolean;
  /** A course grade of at least this (in the course total's points). */
  grade?: number | null;
  /** The participant marks the course complete themselves. */
  self?: boolean;
  /** Marked complete by someone with these roles (only roles with moodle/course:markcomplete); `all` defaults to true. */
  roles?: { roleIds: number[]; all?: boolean } | null;
}

/** Moodle's aggregation values (COMPLETION_AGGREGATION_ALL, _ANY). */
const AGG_ALL = "1";
const AGG_ANY = "2";
const DAY = 86_400;
/** The enrolment durations the form offers, in days. */
const DURATIONS = [...Array.from({ length: 30 }, (_, i) => i + 1), ...Array.from({ length: 15 }, (_, i) => 40 + i * 10), 365];
/** The aggregation selects and the strings of their options (`completion` component), for a locked form, which shows them as text. */
const AGGREGATIONS = { overall_aggregation: "overallaggregation", activity_aggregation: "activityaggregation", course_aggregation: "courseaggregation", role_aggregation: "roleaggregation" } as const;
type AggregationField = keyof typeof AGGREGATIONS;

/** Whether completion is on for the course and the site, from the course's settings form (the site's off: a hidden field instead of the select). */
async function completionEnabled(context: BrowserContext, siteUrl: string, courseId: number): Promise<boolean> {
  const { html } = await fetchSitePage(context, siteUrl, `course/edit.php?id=${courseId}`, { follow: false });
  const select = /<select\b[^>]*\bname="enablecompletion"[^>]*>([\s\S]*?)<\/select>/.exec(html);
  if (!select) return false;
  return /<option\b[^>]*value="1"[^>]*\bselected/.test(select[1]!);
}

/** Opens the course's completion criteria form, refusing when it isn't one (no such course, or no moodle/course:update). */
async function openCriteriaForm(context: BrowserContext, siteUrl: string, courseId: number): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `course/completion.php?id=${courseId}`);
  try {
    const refused = await moodleErrorMessage(page);
    // Without moodle/course:update Moodle sends the person on to another completion page it allows.
    if (refused !== undefined || !new URL(page.url()).pathname.endsWith("/course/completion.php") || (await page.locator('body#page-course-completion form.mform input[name="_qf__course_completion_form"]').count()) === 0) {
      throw new CompletionError(`You can't set course ${courseId}'s completion criteria (it takes moodle/course:update), or the course doesn't exist${refused ? `: ${refused}` : "."}`);
    }
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/** What the criteria form holds, read by field names: the checkboxes, the selects (or their text when frozen) and the grade. */
interface FormState {
  locked: boolean;
  checked: Record<string, boolean>;
  /** Selects by name: their value, or `{ text }` when the locked form shows only the chosen option's text. */
  selects: Record<string, string | { text: string }>;
  /** The criteria_course[] options selected (an unlocked form). */
  courseIds: number[];
  /** A locked form names prerequisite courses (as text only). */
  coursesNamed: boolean;
  grade: string;
  activities: { id: number; name: string }[];
  roles: { id: number; name: string }[];
  /** A locked form's date, as its frozen parts show it: day, month name, year. */
  frozenDate?: string[];
  timeZone: string;
}

function readFormState(page: Page): Promise<FormState> {
  return inPage(page, () => {
    interface El {
      name: string;
      value: string;
      checked: boolean;
      type: string;
      textContent: string | null;
      selected: boolean;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const g = globalThis as unknown as { document: El; M?: { cfg?: { usertimezone?: string } } };
    const form = g.document.querySelector("form.mform")!;
    const text = (el: El | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const checked: Record<string, boolean> = {};
    for (const box of Array.from(form.querySelectorAll('input[type="checkbox"][name^="criteria_"]'))) checked[box.name] = box.checked;
    const selects: Record<string, string | { text: string }> = {};
    for (const name of ["overall_aggregation", "activity_aggregation", "course_aggregation", "role_aggregation", "criteria_duration_days"]) {
      const select = form.querySelector(`select[name="${name}"]`);
      if (select) selects[name] = select.value;
      else {
        // Frozen: the chosen option's text in the field's element.
        const frozen = form.querySelector(`#fitem_id_${name} .felement`);
        if (frozen) selects[name] = { text: text(frozen) };
      }
    }
    const courseIds = Array.from(form.querySelectorAll('select[name="criteria_course[]"] option'))
      .filter((option) => option.selected)
      .map((option) => Number(option.value))
      .filter((id) => id > 0);
    const label = (id: string) => text(form.querySelector(`label[for="${id}"]`));
    const ids = (prefix: string) =>
      Array.from(form.querySelectorAll(`input[type="checkbox"][name^="${prefix}["]`)).map((box) => {
        const id = Number(/\[(\d+)\]$/.exec(box.name)?.[1]);
        return { id, name: label(box.getAttribute("id") ?? "") };
      });
    const dateParts = Array.from(form.querySelectorAll('#fitem_id_criteria_date_value [data-fieldtype="select"]')).map(text);
    return {
      locked: form.querySelector('[name="settingsunlock"]') !== null,
      checked,
      selects,
      courseIds,
      coursesNamed: text(form.querySelector("#fitem_id_criteria_course .felement")) !== "",
      grade: form.querySelector('input[name="criteria_grade_value"]')?.value ?? "",
      activities: ids("criteria_activity"),
      roles: ids("criteria_role"),
      ...(form.querySelector('select[name="criteria_date_value[day]"]') === null && dateParts.length >= 3 ? { frozenDate: dateParts } : {}),
      timeZone: g.M?.cfg?.usertimezone ?? "UTC",
    };
  }, null);
}

/** A number as Moodle prints it in the person's language ("50.00000", "50,00000"). */
function toNumber(text: string): number {
  return Number(text.includes(".") ? text : text.replace(",", "."));
}

/** The aggregations of a locked form, matched against Moodle's own strings for their options (in the person's language). */
async function aggregationOf(context: BrowserContext, siteUrl: string, state: FormState): Promise<Partial<Record<AggregationField, CompletionAggregation>>> {
  const result: Partial<Record<AggregationField, CompletionAggregation>> = {};
  const frozen = (Object.keys(AGGREGATIONS) as AggregationField[]).filter((name) => typeof state.selects[name] === "object");
  for (const name of Object.keys(AGGREGATIONS) as AggregationField[]) {
    const value = state.selects[name];
    if (typeof value === "string") result[name] = value === AGG_ANY ? "any" : "all";
  }
  if (frozen.length === 0) return result;
  const strings = await callService<{ stringid: string; string: string }[]>(context, siteUrl, "core_get_strings", {
    strings: frozen.map((name) => ({ stringid: `${AGGREGATIONS[name]}_any`, component: "completion" })),
  });
  const norm = (text: string) => text.replace(/\s+/g, " ").trim();
  for (const name of frozen) {
    const any = strings.find((s) => s.stringid === `${AGGREGATIONS[name]}_any`)?.string;
    result[name] = any !== undefined && norm(any) === (state.selects[name] as { text: string }).text ? "any" : "all";
  }
  return result;
}

/** The criteria the form's state holds. */
async function criteriaFrom(context: BrowserContext, siteUrl: string, courseId: number, page: Page, state: FormState): Promise<Omit<CourseCompletionCriteria, "enabled">> {
  const agg = await aggregationOf(context, siteUrl, state);
  const criteria: Omit<CourseCompletionCriteria, "enabled"> = {
    locked: state.locked,
    overall: agg.overall_aggregation ?? "all",
    offered: { activities: state.activities, roles: state.roles },
  };
  const activityIds = state.activities.filter((a) => state.checked[`criteria_activity[${a.id}]`]).map((a) => a.id);
  if (activityIds.length > 0) criteria.activities = { activityIds, all: (agg.activity_aggregation ?? "all") === "all" };
  let courseIds = state.courseIds;
  if (state.locked && state.coursesNamed) courseIds = await prerequisiteCourses(context, siteUrl, courseId);
  if (courseIds.length > 0) criteria.courses = { courseIds, all: (agg.course_aggregation ?? "all") === "all" };
  if (state.checked.criteria_date) {
    let date: Date | undefined;
    if (state.frozenDate) {
      const { locale } = await languageFormats(context, siteUrl, []);
      date = parseMoodleDate(state.frozenDate.slice(0, 3).join(" "), { format: "%d %B %Y", locale, timeZone: state.timeZone });
    } else date = await dateSelectorDate(page, "criteria_date_value");
    if (date) criteria.date = date.toISOString();
  }
  if (state.checked.criteria_duration) {
    const value = state.selects.criteria_duration_days;
    // A locked form shows "7 days" in the person's language: its number is the days.
    const days = typeof value === "string" ? Number(value) / DAY : Number(/\d+/.exec(value?.text ?? "")?.[0]);
    if (days > 0) criteria.enrolmentDays = days;
  }
  if (state.checked.criteria_unenrol) criteria.unenrolment = true;
  if (state.checked.criteria_grade && state.grade !== "") criteria.grade = toNumber(state.grade);
  if (state.checked.criteria_self) criteria.self = true;
  const roleIds = state.roles.filter((r) => state.checked[`criteria_role[${r.id}]`]).map((r) => r.id);
  if (roleIds.length > 0) criteria.roles = { roleIds, all: (agg.role_aggregation ?? "all") === "all" };
  return criteria;
}

/** The prerequisite courses of a locked course, from its completion report's column links (the locked form shows only their names). */
async function prerequisiteCourses(context: BrowserContext, siteUrl: string, courseId: number): Promise<number[]> {
  const page = await openSitePage(context, siteUrl, `report/completion/index.php?course=${courseId}`, { follow: false });
  try {
    return (await readReportColumns(page)).filter((c) => c.type === "course").map((c) => c.courseId!);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * A course's completion criteria, from its "Course completion" settings form: the overall
 * aggregation, each kind of criterion set (activities, other courses, a date, days enrolled,
 * unenrolment, a course grade, self completion, roles that mark it), what the form offers, whether
 * completion is enabled and whether the criteria are locked (someone has met one). This is course
 * completion, not activity completion (`completionReport`). Throws `CompletionError` when the person
 * can't set the course's criteria (it takes moodle/course:update) or the course doesn't exist.
 */
export async function courseCompletionCriteria(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseCompletionCriteria> {
  const page = await openCriteriaForm(context, siteUrl, courseId);
  try {
    const criteria = await criteriaFrom(context, siteUrl, courseId, page, await readFormState(page));
    return { enabled: await completionEnabled(context, siteUrl, courseId), ...criteria };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The values to set in the open form for `changes`, refusing activities, roles or durations it doesn't offer. */
async function formValues(page: Page, courseId: number, state: FormState, changes: CourseCompletionChanges): Promise<Record<string, FieldValue>> {
  const values: Record<string, FieldValue> = {};
  const aggregation = (name: AggregationField, all: boolean) => {
    // Moodle shows an activity aggregation only with two activities or more, and a course one only with courses to choose.
    if (state.selects[name] !== undefined) values[name] = all ? AGG_ALL : AGG_ANY;
  };
  if (changes.overall !== undefined) {
    if (changes.overall !== "all" && changes.overall !== "any") throw new MoodleError(`overall is "all" or "any", not "${String(changes.overall)}".`, "invalid-input");
    values.overall_aggregation = changes.overall === "all" ? AGG_ALL : AGG_ANY;
  }
  const pick = (kind: "activities" | "roles", ids: number[] | undefined, prefix: string, why: string) => {
    if (ids === undefined) return;
    const offered = (kind === "activities" ? state.activities : state.roles).map((o) => o.id);
    const missing = ids.filter((id) => !offered.includes(id));
    if (missing.length > 0) throw new CompletionError(`Course ${courseId}'s completion can't take ${kind} ${missing.join(", ")}: ${why} (${offered.join(", ") || "none"}).`);
    for (const id of offered) values[`${prefix}[${id}]`] = ids.includes(id);
  };
  if (changes.activities !== undefined) {
    const ids = changes.activities?.activityIds ?? [];
    if (changes.activities && ids.length === 0) throw new MoodleError("Give at least one of the activities, or null to remove the criterion.", "invalid-input");
    pick("activities", ids, "criteria_activity", "Moodle offers only the course's activities with completion tracking");
    if (changes.activities) aggregation("activity_aggregation", changes.activities.all ?? true);
  }
  if (changes.roles !== undefined) {
    const ids = changes.roles?.roleIds ?? [];
    if (changes.roles && ids.length === 0) throw new MoodleError("Give at least one of the roles, or null to remove the criterion.", "invalid-input");
    pick("roles", ids, "criteria_role", "Moodle offers only roles that may mark participants complete (moodle/course:markcomplete)");
    if (changes.roles) aggregation("role_aggregation", changes.roles.all ?? true);
  }
  if (changes.courses !== undefined) {
    const ids = changes.courses?.courseIds ?? [];
    if (changes.courses && ids.length === 0) throw new MoodleError("Give at least one of the courses, or null to remove the criterion.", "invalid-input");
    if (ids.includes(courseId)) throw new CompletionError(`Course ${courseId} can't require its own completion.`);
    if ((await page.locator('form.mform select[name="criteria_course[]"]').count()) === 0) {
      if (ids.length > 0) throw new CompletionError("No other course on the site tracks completion: Moodle offers none to require.");
    } else {
      // An autocomplete: its select holds only the chosen courses; new ones are added as options.
      await page.evaluate((ids) => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { options: ArrayLike<{ value: string }>; appendChild(o: unknown): void } | null; createElement(t: string): { value: string; text: string } } }).document;
        const select = doc.querySelector('form.mform select[name="criteria_course[]"]');
        if (!select) return;
        for (const id of ids) {
          if (Array.from(select.options).some((option) => option.value === String(id))) continue;
          const option = doc.createElement("option");
          option.value = String(id);
          option.text = String(id);
          select.appendChild(option);
        }
      }, ids);
      values["criteria_course[]"] = ids.map(String);
      if (changes.courses) aggregation("course_aggregation", changes.courses.all ?? true);
    }
  }
  if (changes.date !== undefined) {
    values.criteria_date = changes.date !== null;
    if (changes.date) {
      // A date, or its ISO text (from JSON).
      const date = new Date(changes.date);
      if (Number.isNaN(date.getTime())) throw new MoodleError("date must be a valid date, or null to remove the criterion.", "invalid-input");
      // A date selector without a time: only its day, month and year.
      const parts = await dateSelectorValues(page, "criteria_date_value", date);
      for (const part of ["day", "month", "year"]) values[`criteria_date_value[${part}]`] = parts[`criteria_date_value[${part}]`]!;
    }
  }
  if (changes.enrolmentDays !== undefined) {
    values.criteria_duration = changes.enrolmentDays !== null;
    if (changes.enrolmentDays !== null) {
      if (!DURATIONS.includes(changes.enrolmentDays)) throw new MoodleError(`enrolmentDays is one of Moodle's choices (1 to 30, 40 to 180 by tens, 365), not ${changes.enrolmentDays}.`, "invalid-input");
      values.criteria_duration_days = changes.enrolmentDays * DAY;
    }
  }
  if (changes.unenrolment !== undefined) values.criteria_unenrol = changes.unenrolment;
  if (changes.grade !== undefined) {
    values.criteria_grade = changes.grade !== null;
    if (changes.grade !== null) {
      if (!Number.isFinite(changes.grade) || changes.grade <= 0) throw new MoodleError(`grade must be a number above 0, not ${changes.grade}: Moodle ignores a required grade of 0.`, "invalid-input");
      values.criteria_grade_value = String(changes.grade);
    }
  }
  if (changes.self !== undefined) values.criteria_self = changes.self;
  return values;
}

/**
 * Sets a course's completion criteria through its "Course completion" settings form, as a teacher
 * does: a criterion given replaces that kind's settings, `null` (or `false`) removes it, one not
 * given stays as it is; `overall` sets whether all criteria or any one complete the course.
 * Once someone has met a criterion, Moodle locks the criteria: `unlock` unlocks them first, which
 * deletes every participant's course completion data (not their activity completion), as the form's
 * button says. Returns the criteria afterwards. Throws `CompletionError` when the person can't set
 * them (it takes moodle/course:update), when completion is off on the site or in the course, when
 * they're locked and `unlock` isn't given, and for activities or roles the form doesn't offer
 * (naming them); `FormError` with Moodle's message when it refuses the form (a course that doesn't
 * track completion as a prerequisite).
 */
export async function setCourseCompletionCriteria(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  changes: CourseCompletionChanges,
  { unlock = false }: { unlock?: boolean } = {},
): Promise<{ changed: string; criteria: CourseCompletionCriteria }> {
  const given = (Object.keys(changes) as (keyof CourseCompletionChanges)[]).filter((key) => changes[key] !== undefined);
  if (given.length === 0) throw new MoodleError("Nothing to change: give at least one criterion, or overall.", "invalid-input");
  let page = await openCriteriaForm(context, siteUrl, courseId);
  let unlocked = false;
  try {
    if (!(await completionEnabled(context, siteUrl, courseId))) {
      throw new CompletionError(`Completion isn't enabled in course ${courseId} (or on the site): enable it in the course's settings ("Enable completion tracking") first.`);
    }
    let state = await readFormState(page);
    if (state.locked) {
      if (!unlock) throw new CompletionError(`Course ${courseId}'s completion criteria are locked: someone has met one already. Give unlock: true to unlock them, which deletes everyone's course completion data.`);
      await submitForm(page, "settingsunlock");
      await page.close().catch(() => undefined);
      page = await openCriteriaForm(context, siteUrl, courseId);
      state = await readFormState(page);
      if (state.locked) throw new CompletionError(`Moodle didn't unlock course ${courseId}'s completion criteria.`);
      unlocked = true;
    }
    await setFields(page, await formValues(page, courseId, state, changes));
    await submitForm(page, "submitbutton");
    // Saved, Moodle sends the person to the course; the form again means it wasn't.
    if ((await page.locator("body#page-course-completion form.mform").count()) > 0) throw new CompletionError(`Moodle didn't save course ${courseId}'s completion criteria.`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const criteria = await courseCompletionCriteria(context, siteUrl, courseId);
  return { changed: `Course ${courseId}'s completion criteria${unlocked ? " unlocked (course completion data deleted) and" : ""} set: ${given.join(", ")}.`, criteria };
}

/** A kind of course completion criterion, as Moodle names them. */
export type CourseCriterionType = "activity" | "course" | "date" | "duration" | "unenrolment" | "grade" | "self" | "role" | "other";

/** One criterion of a participant's course completion: what it is, and whether (and when) they met it. */
export interface CourseCriterionStatus {
  type: CourseCriterionType;
  /** An activity criterion's course module id. */
  activityId?: number;
  /** A prerequisite course's id. */
  courseId?: number;
  /** The activity's, course's or role's name, or the criterion's title, as the report shows it. */
  name: string;
  met: boolean;
  /** When it was met (ISO). */
  metAt?: string;
}

/** A participant's course completion, as the course completion report shows it. */
export interface CourseCompletionStatus {
  userId: number;
  fullName: string;
  /** Whether they've completed the course. */
  complete: boolean;
  /** When (ISO). */
  completedAt?: string;
  /** Each criterion, in the report's order (prerequisite courses, activities, then the rest). */
  criteria: CourseCriterionStatus[];
  /** Whether the person may mark them complete (`markCourseComplete`): the report links the role criterion of a role the person holds. */
  markable: boolean;
}

/** A column of the report: its criterion, read from its header icon. */
export interface ReportColumn {
  type: CourseCriterionType;
  activityId?: number;
  courseId?: number;
  name: string;
}

/**
 * The criteria columns of a course completion report page, by their header icons: activities and
 * prerequisite courses by their links, the rest by their icon (Font Awesome's names in Moodle's map,
 * or the image's file name in a theme without it). The last column, the course's own, isn't one.
 */
export function readReportColumns(page: Page): Promise<ReportColumn[]> {
  return page.evaluate(() => {
    interface El {
      className: string;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const cells = Array.from(doc.querySelectorAll("#completion-progress thead th.criteriaicon")).slice(0, -1);
    // Each criterion's icon (completion/criteria/*.php get_icon) and its Font Awesome name in Moodle's map.
    const ICONS: [string, string, string][] = [
      ["self", "fa-user-check", "i/completion_self"],
      ["date", "fa-calendar", "i/calendar"],
      ["unenrolment", "fa-user", "i/user"],
      ["duration", "fa-hourglass", "i/duration"],
      ["grade", "fa-clipboard-check", "i/grades"],
      ["role", "fa-user-tie", "i/role"],
    ];
    return cells.map((cell) => {
      const link = cell.querySelector("a[href]");
      const icon = cell.querySelector("i.icon, img");
      const name = (link?.getAttribute("title") ?? icon?.getAttribute("title") ?? icon?.getAttribute("alt") ?? "").trim();
      const href = link?.getAttribute("href") ?? "";
      const activity = /\/mod\/[a-z0-9_]+\/view\.php\?(?:.*&)?id=(\d+)/.exec(href);
      if (activity) return { type: "activity", activityId: Number(activity[1]), name };
      const course = /\/course\/view\.php\?(?:.*&)?id=(\d+)/.exec(href);
      if (course) return { type: "course", courseId: Number(course[1]), name };
      const classes = ` ${icon?.className ?? ""} `;
      const src = icon?.getAttribute("src") ?? "";
      const found = ICONS.find(([, fa, file]) => classes.includes(` ${fa} `) || src.endsWith(`/${file}`));
      return { type: found ? found[0] : "other", name };
    }) as ReportColumn[];
  });
}

/** The first page of the report: its columns, and whether (and in which column) the person may mark participants complete. */
interface ReportHead {
  columns: ReportColumn[];
  /** The role criterion the person marks (its id in the toggle links), and its column. */
  marking?: { criterionId: number; column: number };
  sesskey: string;
  timeZone: string;
}

async function readReportHead(context: BrowserContext, siteUrl: string, courseId: number, group: number | undefined): Promise<ReportHead | undefined> {
  const page = await openSitePage(context, siteUrl, `report/completion/index.php?course=${courseId}${group ? `&group=${group}` : ""}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined || (await page.locator("body#page-report-completion-index").count()) === 0) {
      const code = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a')?.getAttribute("href")?.split("/").pop());
      if (code === "nocriteriaset") throw new CompletionError(`Course ${courseId} has no course completion criteria: set them first (setCourseCompletionCriteria).`);
      throw new CompletionError(`You can't see course ${courseId}'s course completion report (it takes report/completion:view), or the course doesn't exist${refused ? `: ${refused}` : "."}`);
    }
    // No table: nobody to list (Moodle says so in the site's language).
    if ((await page.locator("#completion-progress").count()) === 0) return undefined;
    const columns = await readReportColumns(page);
    const marking = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null; closest(s: string): { cellIndex: number } | null }> } }).document;
      const link = Array.from(doc.querySelectorAll('#completion-progress tbody a[href*="/course/togglecompletion.php"]'))[0];
      if (!link) return undefined;
      const criterionId = Number(new URL(link.getAttribute("href") ?? "", "http://x/").searchParams.get("rolec"));
      return { criterionId, cellIndex: link.closest("td")?.cellIndex ?? -1 };
    });
    const config = await page.evaluate(() => {
      const cfg = (globalThis as unknown as { M?: { cfg?: { sesskey?: string; usertimezone?: string } } }).M?.cfg;
      return { sesskey: cfg?.sesskey ?? "", timeZone: cfg?.usertimezone ?? "UTC" };
    });
    // The row's cells: its name, then the identity fields, then one per criterion and the course's.
    const cellCount = await page.locator("#completion-progress tbody tr").first().locator("th, td").count();
    const column = marking ? marking.cellIndex - (cellCount - columns.length - 1) : -1;
    return { columns, ...(marking && column >= 0 ? { marking: { criterionId: marking.criterionId, column } } : {}), ...config };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Everyone's course completion from the report's CSV export, with its columns from the page. */
async function readStatuses(context: BrowserContext, siteUrl: string, courseId: number, group: number | undefined): Promise<CourseCompletionStatus[]> {
  const head = await readReportHead(context, siteUrl, courseId, group);
  if (!head) return [];
  const response = await siteFetch(context, new URL(`report/completion/index.php?course=${courseId}&format=csv${group ? `&group=${group}` : ""}`, siteUrl).href);
  const rows = parseCsv(response.body).filter((row) => row.length > 1);
  // An activity takes two columns (its state, in the site's language, and the date), the rest one (the date).
  const width = head.columns.reduce((sum, c) => sum + (c.type === "activity" ? 2 : 1), 0) + 1;
  // Its columns: the user's id and name, the identity fields, then the criteria's and the course's.
  if (response.status !== 200 || response.body.trimStart().startsWith("<") || (rows[0]?.length ?? 0) < width + 2 || rows.slice(1).some((row) => !/^\d+$/.test(row[0] ?? ""))) {
    throw new CompletionError(`Course ${courseId}'s course completion report couldn't be exported as CSV.`);
  }
  // The export writes dates as "%F %T" in the person's time zone.
  const format = { format: "%Y-%m-%d %H:%M:%S", locale: "en", timeZone: head.timeZone };
  const when = (text: string | undefined) => (text ? parseMoodleDate(text, format)?.toISOString() : undefined);
  return rows.slice(1).map((row) => {
    const cells = row.slice(row.length - width);
    let at = 0;
    const criteria = head.columns.map((column) => {
      if (column.type === "activity") at++;
      const metAt = when(cells[at++]);
      return { ...column, met: metAt !== undefined, ...(metAt ? { metAt } : {}) };
    });
    const completedAt = when(cells[at]);
    return { userId: Number(row[0]), fullName: row[1] ?? "", complete: completedAt !== undefined, ...(completedAt ? { completedAt } : {}), criteria, markable: head.marking !== undefined };
  });
}

/** What `courseCompletionStatus` takes: whose (one participant, one group), and a page of them. */
export interface CourseCompletionStatusOptions extends PageOptions {
  /** Only this participant. */
  userId?: number;
  /** Only this group's participants. */
  group?: number;
}

/**
 * Each participant's course completion, from the course completion report (`report/completion`):
 * whether they've completed the course and when, and each criterion met and when; in the report's
 * order (by last name), one participant's or one group's when given. The report (and this) is about
 * course completion; `completionReport` is the activity completion (progress) report. Moodle works
 * out course completion as participants meet criteria, some of them (a course grade, a date, days
 * enrolled) only in its scheduled tasks (cron): until they run, a criterion met may not show yet.
 * Without `limit`, every participant; with it, a page (see "Long lists" in the docs' concepts). The
 * report is read in full (its CSV export) and cut. Throws `CompletionError` when the person can't see
 * it (it takes report/completion:view), or the course has no completion criteria.
 */
export function courseCompletionStatus(context: BrowserContext, siteUrl: string, courseId: number, options: WithLimit<CourseCompletionStatusOptions>): Promise<ListPage<CourseCompletionStatus>>;
export function courseCompletionStatus(context: BrowserContext, siteUrl: string, courseId: number, options?: WithoutLimit<CourseCompletionStatusOptions>): Promise<CourseCompletionStatus[]>;
export function courseCompletionStatus(context: BrowserContext, siteUrl: string, courseId: number, options?: CourseCompletionStatusOptions): Promise<CourseCompletionStatus[] | ListPage<CourseCompletionStatus>>;
export async function courseCompletionStatus(context: BrowserContext, siteUrl: string, courseId: number, options: CourseCompletionStatusOptions = {}): Promise<CourseCompletionStatus[] | ListPage<CourseCompletionStatus>> {
  const window = pageWindow(options);
  const all = await readStatuses(context, siteUrl, courseId, options.group);
  const wanted = options.userId === undefined ? all : all.filter((status) => status.userId === options.userId);
  return toPage(sliceWindow(wanted, window), options.limit);
}

/**
 * Marks a participant's course completion by hand, as the course completion report's link does: the
 * course's "Manual completion by others" criterion for a role the person holds in the course. That
 * criterion met, Moodle completes the course when the rest of the criteria allow it (any one, or all
 * met). A participant already marked is left as is. Returns their completion afterwards. Throws
 * `CompletionError` when the person can't see the report (report/completion:view), when the course
 * has no role criterion for a role they hold (it takes moodle/course:markcomplete), when completion
 * isn't enabled, and when the user isn't a tracked participant.
 */
export async function markCourseComplete(context: BrowserContext, siteUrl: string, courseId: number, userId: number): Promise<{ changed: string; status: CourseCompletionStatus }> {
  const head = await readReportHead(context, siteUrl, courseId, undefined);
  if (!head?.marking) {
    throw new CompletionError(`You can't mark participants complete in course ${courseId}: its completion criteria have no manual completion by a role you hold (it takes moodle/course:markcomplete)${head ? "" : ", or it has no participants"}.`);
  }
  const before = (await courseCompletionStatus(context, siteUrl, courseId, { userId }))[0];
  if (!before) throw new CompletionError(`User ${userId} isn't a participant whose completion course ${courseId} tracks.`);
  if (before.criteria[head.marking.column]?.met) return { changed: `User ${userId} was already marked complete in course ${courseId}.`, status: before };
  const page = await openSitePage(context, siteUrl, `course/togglecompletion.php?user=${userId}&course=${courseId}&rolec=${head.marking.criterionId}&sesskey=${head.sesskey}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new CompletionError(`Moodle didn't mark user ${userId} complete in course ${courseId}: ${refused}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const status = (await courseCompletionStatus(context, siteUrl, courseId, { userId }))[0] ?? before;
  return { changed: `User ${userId} marked complete in course ${courseId}${status.complete ? ": the course is complete" : ""}.`, status };
}
