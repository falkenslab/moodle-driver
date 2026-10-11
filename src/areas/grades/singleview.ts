// Grading in the gradebook through the single view report (grade/report/singleview), a user's screen:
// one row per grade item with its grade, feedback, override and exclude fields, named
// `<field>_<itemId>_<userId>`. Its fields only show in editing mode, which is turned on for the
// change and back off afterwards when it was off.
import type { BrowserContext, Page } from "playwright-core";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { inPage } from "../../core/inPage.js";
import { GradebookError } from "./gradebook.js";

/** A person's grade in one grade item, as the single view report shows it after a change. */
export interface GradebookGrade {
  itemId: number;
  userId: number;
  /** As the report shows it ("80.00", or the scale's item); left out when there's none. */
  grade?: string;
  feedback?: string;
  /** Whether the grade overrides the activity's (or the category's computed one). */
  overridden: boolean;
  /** Whether it's left out of the category and course totals. */
  excluded: boolean;
}

/** What `setGrade` changes in a person's grade: only what's given. */
export interface SetGradeOptions {
  /** A number, or a scale item's name or value for a scale; `null` empties the grade. */
  grade?: number | string | null;
  /** Feedback text; an empty string removes it. */
  feedback?: string;
  /**
   * Override the activity's or category's grade. Giving a grade or feedback to an activity's or a
   * category's item overrides it unless this says `false`; `false` alone gives the grade back to the activity.
   */
  override?: boolean;
  /** Leave the grade out of the totals. */
  excluded?: boolean;
}

/** One row of the user screen: its fields by role, read in the page. */
interface RowState {
  hasRow: boolean;
  gradeKind?: "number" | "select";
  gradeDisabled: boolean;
  options: { value: string; text: string }[];
  hasOverride: boolean;
  overrideDisabled: boolean;
  grade?: string;
  feedback?: string;
  overridden: boolean;
  excluded: boolean;
  hasExclude: boolean;
}

function readRow(page: Page, itemId: number, userId: number): Promise<RowState> {
  return page.evaluate(
    ({ itemId, userId }) => {
      interface Field {
        tagName: string;
        value: string;
        checked: boolean;
        disabled: boolean;
        options?: ArrayLike<{ value: string; text: string; selected: boolean }>;
      }
      const doc = (globalThis as unknown as { document: { querySelector(s: string): Field | null } }).document;
      const suffix = `_${itemId}_${userId}`;
      const grade = doc.querySelector(`#singleview-grades [name="finalgrade${suffix}"]`);
      const feedback = doc.querySelector(`#singleview-grades [name="feedback${suffix}"]`);
      const override = doc.querySelector(`#singleview-grades input[type="checkbox"][name="override${suffix}"]`);
      const exclude = doc.querySelector(`#singleview-grades input[type="checkbox"][name="exclude${suffix}"]`);
      const options = grade?.tagName === "SELECT" ? Array.from(grade.options ?? []).map((o) => ({ value: o.value, text: o.text.replace(/\s+/g, " ").trim() })) : [];
      // A scale's "No grade" is -1.
      const shown = grade?.tagName === "SELECT" ? (grade.value === "-1" ? "" : (options.find((o) => o.value === grade.value)?.text ?? "")) : (grade?.value ?? "");
      return {
        hasRow: grade !== null || override !== null || exclude !== null,
        ...(grade ? { gradeKind: grade.tagName === "SELECT" ? ("select" as const) : ("number" as const) } : {}),
        gradeDisabled: grade?.disabled ?? true,
        options,
        hasOverride: override !== null,
        overrideDisabled: override?.disabled ?? true,
        ...(shown !== "" ? { grade: shown } : {}),
        ...(feedback && feedback.value.trim() !== "" ? { feedback: feedback.value } : {}),
        overridden: override?.checked ?? false,
        excluded: exclude?.checked ?? false,
        hasExclude: exclude !== null,
      };
    },
    { itemId, userId },
  );
}

/** Turns the person's editing mode on or off through the page's own switch (editmode.php). */
function setEditingMode(page: Page, on: boolean): Promise<boolean> {
  return page.evaluate(async (on) => {
    const g = globalThis as unknown as {
      document: { querySelector(s: string): unknown };
      FormData: new (form: unknown) => Iterable<[string, string]>;
      URLSearchParams: new (init: Iterable<[string, string]>) => { set(name: string, value: string): void };
      fetch(url: string, init: object): Promise<{ ok: boolean }>;
    };
    const form = g.document.querySelector("form.editmode-switch-form") as { action: string } | null;
    if (!form) return false;
    // Posted as the form posts itself, urlencoded.
    const data = new g.URLSearchParams(new g.FormData(form));
    data.set("setmode", on ? "1" : "0");
    return (await g.fetch(form.action, { method: "POST", body: data, credentials: "same-origin" })).ok;
  }, on);
}

function sameGrade(row: RowState, grade: number | string | null): boolean {
  if (grade === null) return row.grade === undefined;
  if (row.gradeKind === "select") return row.options.some((o) => (o.value === String(grade) || o.text === String(grade)) && o.text === row.grade);
  return row.grade !== undefined && Number(row.grade) === Number(grade);
}

/**
 * Sets a person's grade in a grade item through the gradebook's single view report, as a teacher
 * does there: a manual item takes the grade; an activity's or a category's is overridden (Moodle
 * keeps the override until it's taken off with `override: false`). Feedback and excluding from
 * the totals go the same way. Returns a sentence of what changed and the grade afterwards.
 * Throws `GradebookError` when the item or the person isn't in the course's gradebook, the grade
 * is locked, or Moodle refuses the value (out of range, a scale item it doesn't have).
 */
export async function setGrade(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  itemId: number,
  userId: number,
  { grade, feedback, override, excluded }: SetGradeOptions,
): Promise<{ changed: string; grade: GradebookGrade }> {
  if (grade === undefined && feedback === undefined && override === undefined && excluded === undefined) {
    throw new MoodleError("Give a grade, feedback, override or excluded to change.", "invalid-input");
  }
  if (typeof grade === "number" && !Number.isFinite(grade)) throw new MoodleError(`The grade must be a number: ${grade}.`, "invalid-input");
  const path = `grade/report/singleview/index.php?id=${courseId}&item=user&itemid=${userId}`;
  const page = await openSitePage(context, siteUrl, path);
  let turnedOn = false;
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined || (await page.locator("body#page-grade-report-singleview-index").count()) === 0) {
      throw new GradebookError(`You can't grade in course ${courseId}'s gradebook: ${refused ?? "the course doesn't exist, or you aren't allowed"}`);
    }
    if ((await page.locator("#singleview-grades").count()) === 0) {
      throw new GradebookError(`User ${userId} isn't graded in course ${courseId}, or Moodle is recalculating its grades: check the participants, or try again in a moment.`);
    }
    // Read-only outside editing mode: no fields at all.
    if ((await page.locator('#singleview-grades [name^="oldfinalgrade_"]').count()) === 0) {
      if (!(await setEditingMode(page, true))) throw new GradebookError("The single view report has no editing mode switch: the grades can't be edited here.");
      turnedOn = true;
      await page.reload({ waitUntil: "domcontentloaded" });
    }
    const before = await readRow(page, itemId, userId);
    if (!before.hasRow) throw new GradebookError(`Course ${courseId}'s gradebook has no grade item ${itemId} for user ${userId}: check the id in gradebookSetup or graderReport.`);
    const overridable = before.hasOverride;
    if (override !== undefined && !overridable) throw new GradebookError(`Grade item ${itemId} is a manual item: its grades are set directly, never overridden.`);
    // A grade or feedback for an activity's or category's item overrides it, as the report requires.
    const wantOverride = overridable ? (override ?? (grade !== undefined || feedback !== undefined ? true : before.overridden)) : false;
    if (overridable && !wantOverride && (grade !== undefined || feedback !== undefined)) {
      throw new GradebookError(`Grade item ${itemId}'s grades come from its activity or category: a grade or feedback here overrides it, so it can't be given with override: false.`);
    }
    if (overridable && before.overrideDisabled) throw new GradebookError(`User ${userId}'s grade in item ${itemId} is locked: unlock it in the gradebook first.`);
    if (!overridable && before.gradeDisabled && (grade !== undefined || feedback !== undefined)) {
      throw new GradebookError(`User ${userId}'s grade in item ${itemId} is locked: unlock it in the gradebook first.`);
    }
    if (excluded !== undefined && !before.hasExclude) throw new GradebookError(`User ${userId}'s grade in item ${itemId} can't be excluded here.`);
    if (grade !== undefined && grade !== null && before.gradeKind === "select" && !before.options.some((o) => o.value === String(grade) || o.text === String(grade))) {
      throw new GradebookError(`Grade item ${itemId} uses a scale; give one of its items: ${before.options.filter((o) => o.value !== "-1").map((o) => `"${o.text}"`).join(", ")}.`);
    }
    if (grade !== undefined && grade !== null && before.gradeKind === "number" && !Number.isFinite(Number(grade))) {
      throw new GradebookError(`Grade item ${itemId} takes a number, not "${grade}".`);
    }

    const changes = [
      overridable && wantOverride !== before.overridden && (wantOverride ? "overridden" : "override taken off"),
      grade !== undefined && !sameGrade(before, grade) && (grade === null ? "grade emptied" : `graded ${grade}`),
      feedback !== undefined && feedback.trim() !== (before.feedback ?? "").trim() && (feedback.trim() === "" ? "feedback removed" : "feedback set"),
      excluded !== undefined && excluded !== before.excluded && (excluded ? "excluded from the totals" : "included in the totals"),
    ].filter((c): c is string => typeof c === "string");
    if (changes.length === 0) {
      return { changed: "Nothing to change.", grade: toGrade(itemId, userId, before) };
    }

    // Through inPage: the page code names a helper.
    await inPage(
      page,
      ({ itemId, userId, overridable, wantOverride, grade, feedback, excluded }: { itemId: number; userId: number; overridable: boolean; wantOverride: boolean; grade?: number | string | null; feedback?: string; excluded?: boolean }) => {
        interface Field {
          tagName: string;
          value: string;
          checked: boolean;
          disabled: boolean;
          options?: ArrayLike<{ value: string; text: string }>;
        }
        const doc = (globalThis as unknown as { document: { querySelector(s: string): Field | null } }).document;
        const suffix = `_${itemId}_${userId}`;
        const field = (name: string) => doc.querySelector(`#singleview-grades [name="${name}${suffix}"]:not([type="hidden"])`);
        if (overridable) {
          field("override")!.checked = wantOverride;
          // As the report's own script does: an override enables the grade and feedback.
          for (const name of ["finalgrade", "feedback"]) {
            const input = field(name);
            if (input) input.disabled = !wantOverride;
          }
        }
        const gradeField = field("finalgrade");
        if (grade !== undefined && gradeField) {
          if (gradeField.tagName === "SELECT") {
            const options = Array.from(gradeField.options ?? []);
            gradeField.value = grade === null ? "-1" : (options.find((o) => o.value === String(grade)) ?? options.find((o) => o.text.replace(/\s+/g, " ").trim() === String(grade)))!.value;
          } else gradeField.value = grade === null ? "" : String(grade);
        }
        const feedbackField = field("feedback");
        if (feedback !== undefined && feedbackField) feedbackField.value = feedback;
        const excludeField = field("exclude");
        if (excluded !== undefined && excludeField) excludeField.checked = excluded;
      },
      { itemId, userId, overridable, wantOverride, grade, feedback, excluded },
    );
    // The grade's input carries the item's range (min, max): the browser wouldn't send it out of range.
    const invalid = await page.evaluate((name) => {
      const input = (globalThis as unknown as { document: { querySelector(s: string): { checkValidity(): boolean; min: string; max: string } | null } }).document.querySelector(
        `#singleview-grades input[name="${name}"]`,
      );
      return input && !input.checkValidity() ? { min: input.min, max: input.max } : undefined;
    }, `finalgrade_${itemId}_${userId}`);
    if (invalid) throw new GradebookError(`Grade item ${itemId} takes grades from ${invalid.min || "any"} to ${invalid.max || "any"}, not ${grade}.`);
    const standing = new Set(await alerts(page));
    const save = page.locator('form:has(#singleview-grades) [type="submit"]').first();
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), save.click({ noWaitAfter: true })]);
    // Moodle's refusals (a grade out of range) come as warnings beside its success message; the
    // page's standing ones (an activity being deleted) were there before saving.
    const warnings = (await alerts(page)).filter((text) => !standing.has(text));
    if (warnings.length > 0) throw new GradebookError(`Moodle didn't save user ${userId}'s grade in item ${itemId}: ${warnings.join(" ")}`);
    const after = await readRow(page, itemId, userId);
    return { changed: `User ${userId}'s grade in item ${itemId}: ${changes.join(", ")}.`, grade: toGrade(itemId, userId, after) };
  } finally {
    if (turnedOn) await setEditingMode(page, false).catch(() => false);
    await page.close().catch(() => undefined);
  }
}

/** The page's warning and error notifications, as texts. */
function alerts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null }> } }).document.querySelectorAll('.alert-warning[role="alert"], .alert-danger[role="alert"], .alert-error[role="alert"]'))
      .map((alert) => (alert.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((text) => text !== ""),
  );
}

function toGrade(itemId: number, userId: number, row: RowState): GradebookGrade {
  return {
    itemId,
    userId,
    ...(row.grade !== undefined ? { grade: row.grade } : {}),
    ...(row.feedback !== undefined ? { feedback: row.feedback } : {}),
    overridden: row.overridden,
    excluded: row.excluded,
  };
}
