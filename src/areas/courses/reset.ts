// Resetting a course for a new year through Moodle's reset form (course/reset.php): only what's asked,
// everything else unticked first, since the form opens with Moodle's own defaults ticked.
import type { BrowserContext, Page } from "playwright-core";
import { dateSelectorValues, openForm, setFields, type FieldValue } from "../../core/forms.js";
import { NotLoggedInError, moodleErrorMessage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { CourseError } from "./list.js";

/** What `resetCourse` can delete, each one the reset form's fields for it, in every module the course has. */
export interface ResetDeletions {
  /** Assignments' submissions. */
  submissions?: boolean;
  /** Attempts at quizzes, lessons, SCORM and H5P activities. */
  attempts?: boolean;
  /** Every forum post. */
  posts?: boolean;
  /** Every grade in the gradebook (its items stay). */
  grades?: boolean;
  /** Assignments', quizzes' and lessons' user and group overrides. */
  overrides?: boolean;
  /** Choice answers. */
  choices?: boolean;
  /** The course's calendar events. */
  events?: boolean;
  /** Groups and groupings (with them, their members). */
  groups?: boolean;
  /** Activity and course completion data. */
  completion?: boolean;
  notes?: boolean;
  comments?: boolean;
}

// The reset form's fields for each deletion, by their names in Moodle 5.2's form (course/reset_form.php and each module's).
const FIELDS: Record<keyof ResetDeletions, string[]> = {
  submissions: ["reset_assign_submissions"],
  attempts: ["reset_quiz_attempts", "reset_lesson", "reset_scorm", "reset_h5pactivity"],
  posts: ["reset_forum_all"],
  grades: ["reset_gradebook_grades"],
  overrides: ["reset_assign_user_overrides", "reset_assign_group_overrides", "reset_quiz_user_overrides", "reset_quiz_group_overrides", "reset_lesson_user_overrides", "reset_lesson_group_overrides"],
  choices: ["reset_choice"],
  events: ["reset_events"],
  groups: ["reset_groups_remove", "reset_groupings_remove"],
  completion: ["reset_completion"],
  notes: ["reset_notes"],
  comments: ["reset_comments"],
};

/** One line of the report Moodle shows after resetting: the component, what it did, and its error when it failed. */
export interface ResetStatus {
  component: string;
  item: string;
  done: boolean;
  error?: string;
}

/** Unticks everything the reset form ticks by default: its checkboxes, the roles to unenrol, the new dates. */
function clearForm(page: Page): Promise<void> {
  return page.evaluate(() => {
    interface Field {
      type: string;
      name: string;
      checked: boolean;
      multiple?: boolean;
      options?: ArrayLike<{ selected: boolean }>;
      dispatchEvent(event: unknown): void;
    }
    const g = globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<Field> }; Event: new (type: string, init: { bubbles: boolean }) => unknown };
    for (const field of Array.from(g.document.querySelectorAll("form.mform input[type='checkbox'], form.mform select[multiple]"))) {
      if (field.type === "checkbox") field.checked = false;
      else for (const option of Array.from(field.options ?? [])) option.selected = false;
      field.dispatchEvent(new g.Event("change", { bubbles: true }));
    }
  });
}

/** The table Moodle shows after resetting: per component, each task and its status (an error icon and message when it failed). */
export function readResetReport(page: Page): Promise<ResetStatus[] | undefined> {
  return page.evaluate(() => {
    interface El {
      textContent: string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const table = doc.querySelector('[role="main"] table.generaltable') ?? doc.querySelector("table.generaltable");
    if (!table) return undefined;
    return Array.from(table.querySelectorAll("tbody tr")).flatMap((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      if (cells.length < 3) return [];
      const [component, item, status] = cells.map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
      // A failed task has Moodle's "invalid" icon before its message; a done one only the word.
      const failed = cells[2]!.querySelector(".icon, img") !== null;
      return [{ component: component!, item: item!, done: !failed, ...(failed ? { error: status! } : {}) }];
    });
  });
}

/**
 * Resets a course for a new year, as Moodle's reset form does: deletes only what's named in `delete`
 * (in every module of the course that has it), unenrols the people with `unenrolRoles` (role ids),
 * moves the course's start date to `start` (and its activities' dates with it), and sets any other of
 * the form's fields by name (`fields`). Nothing is deleted unless asked: the form's own defaults are
 * unticked first. It can't be undone. Returns Moodle's report: per component, what it did and its
 * errors. Needs `moodle/course:reset`.
 */
export async function resetCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  { delete: deletions = {}, unenrolRoles = [], start, fields = {} }: { delete?: ResetDeletions; unenrolRoles?: number[]; start?: Date; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; report: ResetStatus[] }> {
  const unknown = Object.keys(deletions).filter((key) => !(key in FIELDS));
  if (unknown.length > 0) throw new MoodleError(`Unknown things to delete: ${unknown.join(", ")}. Use ${Object.keys(FIELDS).join(", ")}, or name a reset field in fields.`, "invalid-input");
  const asked = (Object.keys(FIELDS) as (keyof ResetDeletions)[]).filter((key) => deletions[key]);
  if (asked.length === 0 && unenrolRoles.length === 0 && !start && Object.keys(fields).length === 0) {
    throw new MoodleError("Say what to reset: nothing is deleted unless named (delete, unenrolRoles, start or fields).", "invalid-input");
  }
  const page = await openForm(context, siteUrl, `course/reset.php?id=${courseId}`).catch((error: unknown) => {
    if (error instanceof NotLoggedInError) throw error;
    throw new CourseError(`You can't reset course ${courseId}: it doesn't exist, or you aren't allowed (moodle/course:reset).`);
  });
  try {
    if ((await page.locator('form.mform [name="_qf__course_reset_form"]').count()) === 0) {
      const moodle = await moodleErrorMessage(page);
      throw new CourseError(`You can't reset course ${courseId}${moodle ? `: ${moodle}` : ": you aren't allowed (moodle/course:reset)."}`);
    }
    await clearForm(page);
    const present = async (name: string) => (await page.locator(`form.mform [name="${name}"]:not([type="hidden"])`).count()) > 0;
    const values: Record<string, FieldValue> = {};
    const nothingFor: string[] = [];
    for (const key of asked) {
      const names = [];
      for (const name of FIELDS[key]) if (await present(name)) names.push(name);
      if (names.length === 0) nothingFor.push(key);
      for (const name of names) values[name] = true;
    }
    if (unenrolRoles.length > 0) {
      const offered = await page.locator('form.mform select[name="unenrol_users[]"] option').evaluateAll((options) => options.map((option) => Number(option.getAttribute("value"))));
      const missing = unenrolRoles.filter((role) => !offered.includes(role));
      if (missing.length > 0) throw new CourseError(`Course ${courseId} has nobody with role ${missing.join(", ")} to unenrol: the roles offered are ${offered.join(", ") || "none"}.`);
      values["unenrol_users[]"] = unenrolRoles.map(String);
    }
    if (start) Object.assign(values, { "reset_start_date[enabled]": true }, await dateSelectorValues(page, "reset_start_date", start));
    Object.assign(values, fields);
    await setFields(page, values);
    // Moodle's reset button asks to confirm in a dialog, then submits the form itself: the same, without the dialog.
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 5 * 60_000 }),
      page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { submit(): void } } }).document.querySelector("form.mform").submit()),
    ]);
    const report = await readResetReport(page);
    if (!report) {
      const moodle = await moodleErrorMessage(page);
      if (moodle) throw new CourseError(`Moodle didn't reset course ${courseId}: ${moodle}`);
      // A site with asynchronous resets queues it for its scheduled tasks and shows the form again.
      return { changed: `Course ${courseId}'s reset was queued: Moodle makes it in its scheduled tasks (cron).`, report: [] };
    }
    const failed = report.filter((line) => !line.done).length;
    const skipped = nothingFor.length > 0 ? ` Nothing to reset for ${nothingFor.join(", ")}: the course has no such activity.` : "";
    return { changed: `Course ${courseId} reset: ${report.length - failed} tasks done${failed ? `, ${failed} failed` : ""}.${skipped}`, report };
  } finally {
    await page.close().catch(() => undefined);
  }
}
