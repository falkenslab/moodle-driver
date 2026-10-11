// A workshop as its teacher follows it: its phase and its grading report (submissions and the
// assessments of each), switching its phase, and assessing a submission through the grading
// strategy's own form. No AJAX service covers any of it: everything goes through mod/workshop's pages,
// read by their structure (the phase list's classes, the report's cell classes, the forms' field names).
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage, readSessionFacts } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { setFields, submitForm, type FieldValue } from "../../core/forms.js";

/** The activity isn't a workshop the person can view, or Moodle refused what was asked of it. */
export class WorkshopError extends MoodleError {
  override name = "WorkshopError";
  constructor(message: string) {
    super(message, "workshop");
  }
}

/** A workshop's phases, in their order. */
export type WorkshopPhase = "setup" | "submission" | "assessment" | "evaluation" | "closed";

/** Moodle's codes for the phases (workshop::PHASE_*). */
const PHASE_CODES: Record<WorkshopPhase, number> = { setup: 10, submission: 20, assessment: 30, evaluation: 40, closed: 50 };

/** The phase names, in their order. */
export const WORKSHOP_PHASES = Object.keys(PHASE_CODES) as WorkshopPhase[];

/** A submission in the workshop's report. */
export interface WorkshopSubmission {
  id: number;
  title: string;
  authorId: number;
  author: string;
  /** The grade for the submission Moodle calculated from its assessments (out of the workshop's grade), once it has. */
  grade?: number;
  /** The teacher's override of it, when there is one. */
  gradeOverride?: number;
}

/** An assessment of a submission, by its reviewer. */
export interface WorkshopAssessment {
  id: number;
  submissionId?: number;
  /** The submission's author (the reviewee). */
  authorId?: number;
  author?: string;
  /** Left out when the person can't see reviewers' names. */
  reviewerId?: number;
  reviewer?: string;
  /** The grade it gives the submission (out of the workshop's grade); left out until it's assessed. */
  grade?: number;
  /** The grade for the assessment itself, once the evaluation phase calculated it, and the teacher's override of it. */
  gradingGrade?: number;
  gradingGradeOverride?: number;
  /** Its weight in the submission's grade. */
  weight: number;
}

export interface WorkshopInfo {
  activityId: number;
  phase: WorkshopPhase;
  /** From the workshop's report, which Moodle shows those who can see every submission (from the submission phase on); empty otherwise. */
  submissions: WorkshopSubmission[];
  assessments: WorkshopAssessment[];
}

/** The user plan's current phase, `undefined` when the page has none. */
async function currentPhase(page: Page): Promise<WorkshopPhase | undefined> {
  const code = await page.evaluate(() => {
    const dt = (globalThis as unknown as { document: { querySelector(s: string): { className: string } | null } }).document.querySelector("dl.phase dt.active");
    return /\bphase(\d+)\b/.exec(dt?.className ?? "")?.[1];
  });
  return WORKSHOP_PHASES.find((phase) => String(PHASE_CODES[phase]) === code);
}

async function openWorkshop(context: BrowserContext, siteUrl: string, activityId: number, pageNumber = 0): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/workshop/view.php?id=${activityId}${pageNumber > 0 ? `&page=${pageNumber}` : ""}`);
  if ((await page.locator("body#page-mod-workshop-view").count()) === 0) {
    await page.close().catch(() => undefined);
    throw new WorkshopError(`Activity ${activityId} isn't a workshop you can view. Take the id of a workshop (module "workshop") from the course structure.`);
  }
  return page;
}

/** One participant's rows of the report, as read in the page. */
interface ReportRow {
  userId: number;
  name: string;
  submission?: { id: number; title: string };
  grade?: string;
  gradeOverride?: string;
  received: ReportAssessment[];
  given: ReportAssessment[];
}

interface ReportAssessment {
  id: number;
  grade: string;
  gradingGrade: string;
  gradingGradeOverride?: string;
  weight?: string;
  /** The other person: the reviewer of a received one, the author of a given one. */
  userId?: number;
  name?: string;
}

/** The report's rows (a participant's cells span several rows, one per assessment) and the last page number of its paging bar. */
export function readReport(page: Page): Promise<{ rows: ReportRow[]; lastPage: number }> {
  return inPage(
    page,
    () => {
      interface El {
        className: string;
        textContent: string | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const text = (el: El | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const param = (href: string | null | undefined, name: string) => {
        const match = new RegExp(`[?&]${name}=(\\d+)`).exec(href ?? "");
        return match ? Number(match[1]) : undefined;
      };
      const assessment = (cell: El) => {
        const link = cell.querySelector('a.grade[href*="assessment.php"]');
        const id = param(link?.getAttribute("href"), "asid");
        if (!link || id === undefined) return undefined;
        const gradingGrade = link.querySelector(".gradinggrade");
        const over = gradingGrade?.querySelector("ins");
        const user = cell.querySelector(".user");
        return {
          id,
          grade: text(link.querySelector(".grade") ?? link),
          gradingGrade: text(gradingGrade?.querySelector("del") ?? gradingGrade).replace(/^\(|\)$/g, ""),
          ...(over ? { gradingGradeOverride: text(over) } : {}),
          ...(link.querySelector(".weight") ? { weight: text(link.querySelector(".weight")) } : {}),
          ...(user ? { userId: param(user.querySelector('a[href*="/user/view.php"]')?.getAttribute("href"), "id"), name: text(user.querySelector(".fullname")) } : {}),
        };
      };
      const rows: ReportRow[] = [];
      for (const tr of Array.from(doc.querySelectorAll("table.grading-report tbody tr"))) {
        const participant = tr.querySelector("td.participant");
        if (participant) {
          const title = tr.querySelector("td.submission a.title");
          const total = tr.querySelector("td.submissiongrade");
          const over = total?.querySelector("ins");
          rows.push({
            userId: param(participant.querySelector('a[href*="/user/view.php"]')?.getAttribute("href"), "id") ?? 0,
            name: text(participant.querySelector(":scope > span")),
            ...(title ? { submission: { id: param(title.getAttribute("href"), "id") ?? 0, title: text(title) } } : {}),
            ...(total ? { grade: text(total.querySelector("del") ?? total) } : {}),
            ...(over ? { gradeOverride: text(over) } : {}),
            received: [],
            given: [],
          });
        }
        const row = rows[rows.length - 1];
        if (!row) continue;
        const received = tr.querySelector("td.receivedgrade");
        const given = tr.querySelector("td.givengrade");
        const r = received ? assessment(received) : undefined;
        const g = given ? assessment(given) : undefined;
        if (r) row.received.push(r);
        if (g) row.given.push(g);
      }
      const pages = Array.from(doc.querySelectorAll('#region-main .pagination a[href*="page="]')).map((a) => param(a.getAttribute("href"), "page") ?? 0);
      return { rows, lastPage: Math.max(0, ...pages) };
    },
    undefined,
  );
}

/** A grade as the report shows it ("80.00", "80,00" where the site writes a decimal comma); `undefined` for Moodle's "-". */
function gradeNumber(shown: string | undefined): number | undefined {
  const match = /-?\d+(?:[.,]\d+)?/.exec(shown ?? "");
  return match ? Number(match[0].replace(",", ".")) : undefined;
}

/** The report's rows as submissions and assessments: an assessment appears as received by its author and given by its reviewer, and is merged by id. */
export function reportInfo(rows: ReportRow[]): Pick<WorkshopInfo, "submissions" | "assessments"> {
  const submissions: WorkshopSubmission[] = [];
  const assessments = new Map<number, WorkshopAssessment>();
  const submissionOf = new Map(rows.flatMap((row) => (row.submission ? [[row.userId, row.submission.id] as const] : [])));
  const merge = (seen: ReportAssessment, sides: Partial<WorkshopAssessment>) => {
    const grade = gradeNumber(seen.grade);
    const gradingGrade = gradeNumber(seen.gradingGrade);
    const gradingGradeOverride = gradeNumber(seen.gradingGradeOverride);
    const known = assessments.get(seen.id);
    assessments.set(seen.id, {
      id: seen.id,
      ...known,
      ...Object.fromEntries(Object.entries(sides).filter(([, value]) => value !== undefined && value !== "")),
      ...(grade !== undefined ? { grade } : {}),
      ...(gradingGrade !== undefined ? { gradingGrade } : {}),
      ...(gradingGradeOverride !== undefined ? { gradingGradeOverride } : {}),
      weight: gradeNumber(seen.weight) ?? 1,
    });
  };
  for (const row of rows) {
    if (row.submission) {
      const grade = gradeNumber(row.grade);
      const gradeOverride = gradeNumber(row.gradeOverride);
      submissions.push({
        id: row.submission.id,
        title: row.submission.title,
        authorId: row.userId,
        author: row.name,
        ...(grade !== undefined ? { grade } : {}),
        ...(gradeOverride !== undefined ? { gradeOverride } : {}),
      });
    }
    for (const seen of row.received) merge(seen, { submissionId: row.submission?.id, authorId: row.userId, author: row.name, reviewerId: seen.userId, reviewer: seen.name });
    for (const seen of row.given) merge(seen, { submissionId: seen.userId !== undefined ? submissionOf.get(seen.userId) : undefined, authorId: seen.userId, author: seen.name, reviewerId: row.userId, reviewer: row.name });
  }
  return { submissions, assessments: [...assessments.values()].sort((a, b) => a.id - b.id) };
}

/**
 * A workshop's phase, and its report as the workshop's page shows it to a teacher: every submission
 * (its author, title, and grade once calculated) and every assessment (reviewer, the submission's
 * author, the grade it gives, its weight, the grade for assessing once calculated), all of its pages.
 * The report is Moodle's own: it shows from the submission phase on to those who can see every
 * submission, in the course's current group; for anyone else the lists are empty. Grades are out of
 * the workshop's grade for submission, as Moodle shows them. Throws `WorkshopError` for an activity
 * that isn't a workshop the person can view.
 */
export async function workshopInfo(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopInfo> {
  const rows: ReportRow[] = [];
  let phase: WorkshopPhase | undefined;
  let lastPage = 0;
  for (let pageNumber = 0; pageNumber <= lastPage; pageNumber++) {
    const page = await openWorkshop(context, siteUrl, activityId, pageNumber);
    try {
      phase ??= await currentPhase(page);
      const report = await readReport(page);
      rows.push(...report.rows);
      lastPage = Math.max(lastPage, report.lastPage);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  if (!phase) throw new WorkshopError(`Workshop ${activityId}'s page shows no phase: it isn't what the driver expects of Moodle's workshop page.`);
  return { activityId, phase, ...reportInfo(rows) };
}

/**
 * Switches a workshop to a phase, as its page's phase links do, confirming Moodle's question (any
 * phase, forwards or back; Moodle allocates nothing and calculates no grades on its own when it
 * switches). Returns a sentence of what changed and the phase afterwards. Throws `WorkshopError` when
 * the person can't switch the workshop's phases (Moodle's `mod/workshop:switchphase`, a teacher's) or
 * the id isn't a workshop's.
 */
export async function setWorkshopPhase(context: BrowserContext, siteUrl: string, activityId: number, phase: WorkshopPhase): Promise<{ changed: string; phase: WorkshopPhase }> {
  if (!(phase in PHASE_CODES)) throw new MoodleError(`A workshop's phase is one of ${WORKSHOP_PHASES.join(", ")}; not "${phase}".`, "invalid-input");
  const page = await openSitePage(context, siteUrl, `mod/workshop/switchphase.php?cmid=${activityId}&phase=${PHASE_CODES[phase]}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new WorkshopError(`Moodle didn't let you switch workshop ${activityId}'s phase: ${refused}`);
    const confirm = page.locator('form[action*="/mod/workshop/switchphase.php"]:has(input[name="confirm"]) [type="submit"]');
    if ((await confirm.count()) === 0) throw new WorkshopError(`Activity ${activityId} isn't a workshop whose phase you can switch: Moodle asked no confirmation.`);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click({ noWaitAfter: true })]);
    const failed = await moodleErrorMessage(page);
    if (failed !== undefined) throw new WorkshopError(`Moodle didn't switch workshop ${activityId}'s phase: ${failed}`);
    const now = await currentPhase(page);
    if (now !== phase) throw new WorkshopError(`Moodle didn't switch workshop ${activityId} to the ${phase} phase${now ? `: it's in the ${now} phase` : ""}.`);
    return { changed: `Workshop ${activityId} switched to the ${phase} phase.`, phase };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** What to say about one criterion of the assessment form, in the form's order. */
export interface WorkshopCriterion {
  /**
   * Accumulative grading: the points (the menu's number) or a scale item's name. Number of errors:
   * `1` when the assertion holds, `-1` when it doesn't, or the word the teacher gave either. Rubric:
   * the level, by its position (`1` for the first) or its definition. Comments: none.
   */
  grade?: number | string;
  /** The comment on the criterion (accumulative, comments and number of errors). */
  comment?: string;
}

/** A criterion's grade control in the assessment form: a menu or radio buttons, with each option's value and text. */
interface GradeControl {
  name: string;
  rubric: boolean;
  options: { value: string; text: string }[];
}

/** The assessment form's grading strategy and its criteria's grade controls, by index. */
function readAssessmentForm(page: Page): Promise<{ strategy: string; criteria: (GradeControl | undefined)[]; feedback: boolean }> {
  return inPage(
    page,
    () => {
      interface El {
        type: string;
        name: string;
        value: string;
        id: string;
        text: string;
        textContent: string | null;
        tagName: string;
        closest(s: string): El | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const form = doc.querySelector("form.assessmentform");
      if (!form) return { strategy: "", criteria: [], feedback: false };
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const count = form.querySelectorAll('input[name^="dimensionid__idx_"]').length;
      const criteria: (GradeControl | undefined)[] = [];
      for (let i = 0; i < count; i++) {
        const select = form.querySelector(`select[name="grade__idx_${i}"]`);
        if (select) {
          // Without its "Choose..." (-1), which isn't a grade.
          const options = Array.from(select.querySelectorAll("option")).filter((o) => o.value !== "-1");
          criteria.push({ name: select.name, rubric: false, options: options.map((o) => ({ value: o.value, text: clean(o.text) })) });
          continue;
        }
        const radios = Array.from(form.querySelectorAll(`input[type="radio"][name="grade__idx_${i}"], input[type="radio"][name="chosenlevelid__idx_${i}"]`));
        if (radios.length === 0) {
          criteria.push(undefined);
          continue;
        }
        criteria.push({
          name: radios[0]!.name,
          rubric: radios[0]!.name.startsWith("chosenlevelid"),
          options: radios.map((radio) => ({ value: radio.value, text: clean((radio.closest("label") ?? form.querySelector(`label[for="${radio.id}"]`))?.textContent) })),
        });
      }
      return { strategy: form.querySelector('input[name="strategy"]')?.value ?? "", criteria, feedback: form.querySelector('[name="feedbackauthor_editor[text]"]') !== null };
    },
    undefined,
  );
}

/** The form values for the criteria given; refuses a grade the criterion doesn't take. */
function criteriaValues(submissionId: number, strategy: string, controls: (GradeControl | undefined)[], criteria: WorkshopCriterion[]): Record<string, FieldValue> {
  if (criteria.length > controls.length) throw new WorkshopError(`The workshop's assessment form has ${controls.length} criteria; ${criteria.length} were given.`);
  const values: Record<string, FieldValue> = {};
  criteria.forEach((criterion, i) => {
    if (criterion.grade !== undefined) {
      const control = controls[i];
      if (!control) throw new WorkshopError(`Criterion ${i + 1} of the assessment form (${strategy}) takes no grade, only a comment.`);
      const options = control.options;
      const wanted = String(criterion.grade);
      const option = control.rubric
        ? (typeof criterion.grade === "number" ? options[criterion.grade - 1] : undefined) ?? options.find((o) => o.text === wanted)
        : options.find((o) => o.value === wanted) ?? options.find((o) => o.text === wanted);
      if (!option) throw new WorkshopError(`Criterion ${i + 1} of submission ${submissionId}'s assessment takes ${options.map((o, n) => (control.rubric ? `${n + 1} ("${o.text}")` : `"${o.value}"${o.text && o.text !== o.value ? ` ("${o.text}")` : ""}`)).join(", ")}; not "${wanted}".`);
      values[control.name] = option.value;
    }
    if (criterion.comment !== undefined) values[`peercomment__idx_${i}`] = criterion.comment;
  });
  return values;
}

function formValueIn(page: Page, form: string, name: string): Promise<string | undefined> {
  return page.evaluate(
    ({ form, name }) => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector(`${form} [name="${name}"]`)?.value,
    { form, name },
  );
}

/** Where the person's own assessment of a submission is: its id, from the submission page (adding it, as "Assess" does, when there's none). */
async function ownAssessment(page: Page, activityId: number, submissionId: number): Promise<number> {
  const me = (await readSessionFacts(page)).userId;
  const existing = await page.evaluate((me) => {
    interface El {
      getAttribute(n: string): string | null;
      value: string;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    for (const box of Array.from(doc.querySelectorAll(".assessment-full"))) {
      const reviewer = box.querySelector('.reviewer .fullname a[href*="/user/view.php"]')?.getAttribute("href") ?? "";
      if (new RegExp(`[?&]id=${me}(&|$)`).test(reviewer)) {
        const asid = box.querySelector('.actions form[action*="/mod/workshop/assessment.php"] input[name="asid"]')?.value ?? /[?&]asid=(\d+)/.exec(box.querySelector('.actions form[action*="/mod/workshop/assessment.php"]')?.getAttribute("action") ?? "")?.[1];
        if (asid) return Number(asid);
      }
    }
    return undefined;
  }, me);
  if (existing !== undefined) return existing;
  const assess = page.locator('form[action*="/mod/workshop/submission.php"]:has(input[name="assess"]) [type="submit"]');
  if ((await assess.count()) === 0) {
    throw new WorkshopError(`Moodle offers you no assessment of submission ${submissionId} in workshop ${activityId}: assessing is only open in the assessment phase, to its reviewers and teachers.`);
  }
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), assess.first().click({ noWaitAfter: true })]);
  // Moodle redirects to the new assessment's page, whose form carries its id too.
  const asid = /[?&]asid=(\d+)/.exec(page.url())?.[1] ?? (await formValueIn(page, "form.assessmentform", "asid"));
  if (!asid) throw new WorkshopError(`Moodle didn't open an assessment of submission ${submissionId} in workshop ${activityId}.`);
  return Number(asid);
}

/** The person's assessment's grade and maximum, as its page's header shows them ("80.00 of 80.00"). */
async function assessmentGrade(page: Page): Promise<{ grade?: number; maxGrade?: number }> {
  const shown = await page.evaluate(() => {
    const box = (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }).document.querySelector(".assessment-full .header .grade:not(.nograde)");
    return box?.textContent ?? "";
  });
  const [grade, maxGrade] = (shown.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => Number(n.replace(",", ".")));
  return { ...(grade !== undefined ? { grade } : {}), ...(maxGrade !== undefined ? { maxGrade } : {}) };
}

/**
 * Assesses a submission as the person, through the workshop's assessment form (its grading
 * strategy's: accumulative, comments, number of errors or rubric), as "Assess" on the submission's
 * page and the form do: a teacher who hasn't assessed it yet gets an assessment of their own, and one
 * already made is changed. `criteria` go in the form's order; `feedback` is the overall feedback for
 * the author (HTML), where the workshop has it on; `fields` sets any other field of the form by name
 * (`weight`…). Returns a sentence of what changed, the assessment's id, and the grade it gives the
 * submission out of the workshop's grade. Throws `WorkshopError` outside the assessment phase, when a
 * criterion's grade isn't one it takes, or when the workshop has no overall feedback; `FormError` when
 * Moodle refuses the form (a criterion left without a grade).
 */
export async function assessWorkshopSubmission(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  submissionId: number,
  { criteria = [], feedback, fields = {} }: { criteria?: WorkshopCriterion[]; feedback?: string; fields?: Record<string, FieldValue> },
): Promise<{ changed: string; assessmentId: number; grade?: number; maxGrade?: number }> {
  const page = await openSitePage(context, siteUrl, `mod/workshop/submission.php?cmid=${activityId}&id=${submissionId}`);
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new WorkshopError(`You can't open submission ${submissionId} of workshop ${activityId}: ${refused}`);
    if ((await page.locator("body#page-mod-workshop-submission").count()) === 0) throw new WorkshopError(`Activity ${activityId} isn't a workshop with submission ${submissionId}.`);
    const assessmentId = await ownAssessment(page, activityId, submissionId);
    if (!/\/mod\/workshop\/assessment\.php/.test(page.url())) await page.goto(new URL(`mod/workshop/assessment.php?asid=${assessmentId}`, siteUrl).href, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    const form = await readAssessmentForm(page);
    if (!form.strategy) throw new WorkshopError(`Assessment ${assessmentId} has no form you can fill: assessing is only open in the assessment phase.`);
    if (feedback !== undefined && !form.feedback) throw new WorkshopError(`Workshop ${activityId} has no overall feedback: it's off in its settings.`);
    const values = { ...criteriaValues(submissionId, form.strategy, form.criteria, criteria), ...(feedback !== undefined ? { "feedbackauthor_editor[text]": feedback } : {}), ...fields };
    await setFields(page, values, "form.assessmentform");
    // "Save and continue" comes back to the assessment, whose header then shows the grade.
    await submitForm(page, "saveandcontinue");
    const shown = await assessmentGrade(page);
    return {
      changed: `Submission ${submissionId} of workshop ${activityId} assessed${shown.grade !== undefined ? `: ${shown.grade}${shown.maxGrade !== undefined ? ` of ${shown.maxGrade}` : ""}` : ""}.`,
      assessmentId,
      ...shown,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
