// A workshop's grades as its teacher settles them in the evaluation phase: calculating them with
// the grading evaluation settings form of the workshop's page (it posts to mod/workshop/aggregate.php),
// and overriding a submission's grade (submission.php's feedback form) or the grade for an assessment
// (assessment.php's assessment settings form). No service covers it (mod_workshop's are the mobile
// app's only); the forms are found by their hidden `_qf__` marker and filled by their field names.
import type { BrowserContext, Page } from "playwright-core";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { FormError, setFields } from "../../core/forms.js";
import { WorkshopError, currentPhase, openWorkshop, workshopInfo, type WorkshopAssessment, type WorkshopInfo, type WorkshopPhase, type WorkshopSubmission } from "./workshops.js";

/** How strictly the "Comparison with the best assessment" evaluation compares assessments with the best one (Moodle's "Comparison of assessments"). */
export type WorkshopComparison = "very strict" | "strict" | "fair" | "lax" | "very lax";

/** Moodle's values for the comparison levels (workshopeval_best's `comparisonlevel<N>`). */
const COMPARISON_LEVELS: Record<WorkshopComparison, string> = { "very strict": "1", strict: "3", fair: "5", lax: "7", "very lax": "9" };

const EVALUATION_FORM = "form.evalsettingsform";

/** The page's phase, read from the workshop's own page. */
async function phaseOf(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopPhase | undefined> {
  const page = await openWorkshop(context, siteUrl, activityId);
  try {
    return await currentPhase(page);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Saves the form `selector` of the page with its button `button`, and fails with Moodle's errors by field or its error page. */
async function saveForm(page: Page, selector: string, button: string, what: string): Promise<void> {
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click(`${selector} [name="${button}"]`, { noWaitAfter: true })]);
  const refused = await moodleErrorMessage(page);
  if (refused !== undefined) throw new WorkshopError(`Moodle didn't save ${what}: ${refused}`);
  const errors = await page.evaluate((selector) => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document;
    return Array.from(doc.querySelectorAll(`${selector} [id^="id_error_"]`))
      .map((element) => ({ field: element.id.slice("id_error_".length), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
      .filter((error) => error.message !== "");
  }, selector);
  if (errors.length > 0) throw new FormError("Moodle refused the form:", errors);
}

/**
 * Calculates a workshop's grades, as "Re-calculate grades" in the evaluation phase does: Moodle
 * calculates each submission's grade from its assessments (weighted), and each assessment's grade
 * for assessing by the workshop's grading evaluation method ("Comparison with the best assessment"
 * by default), with `comparison` as its strictness when given (the form keeps the last one used:
 * "fair" at first). Overridden grades stay. Returns a sentence of what changed, the comparison used,
 * and the workshop's submissions and assessments with their grades afterwards (as `workshopInfo`).
 * Throws `WorkshopError` outside the evaluation phase, or when the person can't override grades
 * (Moodle's `mod/workshop:overridegrades`, a teacher's).
 */
export async function calculateWorkshopGrades(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { comparison }: { comparison?: WorkshopComparison } = {},
): Promise<{ changed: string; comparison?: WorkshopComparison } & WorkshopInfo> {
  if (comparison !== undefined && !(comparison in COMPARISON_LEVELS)) {
    throw new MoodleError(`The comparison of assessments is one of ${Object.keys(COMPARISON_LEVELS).join(", ")}; not "${comparison}".`, "invalid-input");
  }
  const page = await openWorkshop(context, siteUrl, activityId);
  let used: WorkshopComparison | undefined;
  try {
    const phase = await currentPhase(page);
    if (phase !== "evaluation") throw new WorkshopError(`Workshop ${activityId} is in the ${phase ?? "unknown"} phase: Moodle calculates grades in the evaluation phase (switch to it with setWorkshopPhase).`);
    if ((await page.locator(EVALUATION_FORM).count()) === 0) {
      throw new WorkshopError(`Workshop ${activityId}'s page offers you no grade calculation: it takes Moodle's mod/workshop:overridegrades capability (a teacher's), and participants in the course.`);
    }
    if (comparison !== undefined) {
      if ((await page.locator(`${EVALUATION_FORM} select[name="comparison"]`).count()) === 0) {
        throw new WorkshopError(`Workshop ${activityId}'s grading evaluation method has no comparison of assessments: it's another method than "Comparison with the best assessment".`);
      }
      await setFields(page, { comparison: COMPARISON_LEVELS[comparison] }, EVALUATION_FORM);
    }
    // aggregate.php calculates and redirects to the workshop's page, with the form again.
    await saveForm(page, EVALUATION_FORM, "submit", `workshop ${activityId}'s grade calculation`);
    const value = await page.evaluate((selector) => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector(selector)?.value, `${EVALUATION_FORM} select[name="comparison"]`);
    used = (Object.keys(COMPARISON_LEVELS) as WorkshopComparison[]).find((level) => COMPARISON_LEVELS[level] === value);
  } finally {
    await page.close().catch(() => undefined);
  }
  const info = await workshopInfo(context, siteUrl, activityId);
  const graded = info.submissions.filter((s) => s.grade !== undefined).length;
  return {
    changed: `Workshop ${activityId}'s grades calculated${used ? ` (comparison: ${used})` : ""}: ${graded} of ${info.submissions.length} submission(s) graded.`,
    ...(used ? { comparison: used } : {}),
    ...info,
  };
}

/** A grade override: a submission's grade or an assessment's grade for assessing (give one of the two ids). */
export interface WorkshopGradeOverride {
  /** The submission whose grade to override (Moodle's "Override grade for submission"). */
  submissionId?: number;
  /** The assessment whose grade for assessing to override ("Override grade for assessment"). */
  assessmentId?: number;
  /** The grade, a whole number from 0 to the workshop's grade for submission (or for assessment); `null` removes the override. */
  grade: number | null;
  /** Feedback for the author (a submission's) or the reviewer (an assessment's), HTML; left out keeps what's there. */
  feedback?: string;
}

/** The override select's options, but "Not overridden" (''). */
function overrideOptions(page: Page, selector: string, name: string): Promise<string[]> {
  return page.evaluate(
    ({ selector, name }) =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document.querySelectorAll(`${selector} select[name="${name}"] option`))
        .map((o) => o.value)
        .filter((v) => v !== ""),
    { selector, name },
  );
}

/**
 * Overrides a grade Moodle calculated in a workshop, as its forms do: a submission's grade (the
 * "Feedback for the author" form of the submission's page, in the evaluation phase), or an
 * assessment's grade for assessing (the "Assessment settings" form of the assessment's page, for
 * an assessment the person can't change themselves), with feedback when given. `grade: null`
 * removes the override, so the calculated grade counts again. Returns a sentence of what changed and
 * the submission or assessment afterwards, as `workshopInfo` reads it. Throws `WorkshopError` when
 * Moodle shows no override (the phase, or the person lacks `mod/workshop:overridegrades`, a
 * teacher's), the grade isn't one the form takes, or the submission or assessment isn't the
 * workshop's.
 */
export async function overrideWorkshopGrade(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { submissionId, assessmentId, grade, feedback }: WorkshopGradeOverride,
): Promise<{ changed: string; submission?: WorkshopSubmission; assessment?: WorkshopAssessment }> {
  if ((submissionId === undefined) === (assessmentId === undefined)) throw new MoodleError("Give the submission (submissionId) or the assessment (assessmentId) whose grade to override, one of the two.", "invalid-input");
  if (grade !== null && !Number.isInteger(grade)) throw new MoodleError(`A workshop grade override is a whole number; not ${grade}.`, "invalid-input");
  const onSubmission = submissionId !== undefined;
  const id = (submissionId ?? assessmentId)!;
  const what = onSubmission ? `submission ${id}` : `assessment ${id}`;
  const form = `form:has(input[name="${onSubmission ? "_qf__workshop_feedbackauthor_form" : "_qf__workshop_feedbackreviewer_form"}"])`;
  const field = onSubmission ? "gradeover" : "gradinggradeover";
  const page = await openSitePage(context, siteUrl, onSubmission ? `mod/workshop/submission.php?cmid=${activityId}&id=${id}` : `mod/workshop/assessment.php?asid=${id}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new WorkshopError(`Moodle didn't open ${what} of workshop ${activityId}: ${refused}`);
    const cmid = await page.evaluate(() => /\bcmid-(\d+)\b/.exec((globalThis as unknown as { document: { body: { className: string } } }).document.body.className)?.[1]);
    if (cmid !== String(activityId)) throw new WorkshopError(`Workshop ${activityId} has no ${what}${cmid ? ` (it's activity ${cmid}'s)` : ""}.`);
    if ((await page.locator(`${form} select[name="${field}"]`).count()) === 0) {
      const phase = onSubmission ? await phaseOf(context, siteUrl, activityId) : undefined;
      if (onSubmission && phase !== "evaluation") throw new WorkshopError(`Workshop ${activityId} is in the ${phase ?? "unknown"} phase: Moodle overrides submission grades in the evaluation phase only.`);
      throw new WorkshopError(
        onSubmission
          ? `Moodle shows you no grade override for ${what} of workshop ${activityId}: it takes Moodle's mod/workshop:overridegrades capability (a teacher's).`
          : `Moodle shows you no grade override for ${what} of workshop ${activityId}: it takes Moodle's mod/workshop:overridegrades capability (a teacher's), and isn't offered for your own assessment while you can still change it.`,
      );
    }
    const options = await overrideOptions(page, form, field);
    if (grade !== null && !options.includes(String(grade))) {
      throw new WorkshopError(`The grade for ${what} of workshop ${activityId} is a whole number from ${options[options.length - 1] ?? 0} to ${options[0] ?? 0}; not ${grade}.`);
    }
    await setFields(page, { [field]: grade === null ? "" : String(grade), ...(feedback !== undefined ? { [onSubmission ? "feedbackauthor_editor[text]" : "feedbackreviewer_editor[text]"]: feedback } : {}) }, form);
    // Moodle saves and goes back to the workshop's page.
    await saveForm(page, form, "save", `the grade override of ${what}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const info = await workshopInfo(context, siteUrl, activityId);
  const submission = onSubmission ? info.submissions.find((s) => s.id === id) : undefined;
  const assessment = onSubmission ? undefined : info.assessments.find((a) => a.id === id);
  return {
    changed: grade === null ? `The grade override of ${what} of workshop ${activityId} removed.` : `The grade for ${what} of workshop ${activityId} overridden: ${grade}.`,
    ...(submission ? { submission } : {}),
    ...(assessment ? { assessment } : {}),
  };
}
