// A workshop's example submissions, which the teacher prepares and assesses (the reference
// assessment) so participants can practise assessing them: listed on the workshop's page in the
// setup phase, added, edited and deleted through mod/workshop/exsubmission.php (the submission's own
// form) and assessed through exassessment.php (the grading strategy's form, as a submission's).
// Pages read by their structure: the summaries' classes, the forms' field names, the buttons' params.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { WorkshopError, currentPhase, fillAssessmentForm, openWorkshop, type WorkshopAssessmentInput } from "./workshops.js";
import { checkSubmissionInput, errorCode, fillSubmissionForm, openSubmissionForm, readSubmissionBox, type WorkshopAttachment, type WorkshopSubmissionInput } from "./submissions.js";

/** An example submission, as the workshop's page lists it to a teacher (`workshopExamples`). */
export interface WorkshopExample {
  id: number;
  title: string;
  /** Whether its reference assessment is made: until then participants can't compare theirs with it. */
  assessed: boolean;
  /** The reference assessment's grade and its maximum, once assessed. */
  grade?: number;
  maxGrade?: number;
}

/** An example's content (`addWorkshopExample`, `editWorkshopExample`). */
export type WorkshopExampleInput = WorkshopSubmissionInput;

/** The example summaries of the workshop's page. */
export function readExamples(page: Page): Promise<WorkshopExample[] | undefined> {
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
      const region = doc.querySelector("#workshop-viewlet-allexamples");
      if (!region) return undefined;
      const examples: WorkshopExample[] = [];
      for (const box of Array.from(region.querySelectorAll(".example-summary"))) {
        const link = box.querySelector('.example-title a.title[href*="/mod/workshop/exsubmission.php"]');
        const id = Number(/[?&]id=(\d+)/.exec(link?.getAttribute("href") ?? "")?.[1]);
        if (!link || !id) continue;
        const assessed = box.className.split(/\s+/).includes("graded");
        // "Grade: 64 of 80", in the site's language: its two numbers.
        const [grade, maxGrade] = ((assessed ? box.querySelector(".example-info.grade")?.textContent : "") ?? "").match(/\d+(?:[.,]\d+)?/g)?.map((n) => Number(n.replace(",", "."))) ?? [];
        examples.push({
          id,
          title: (link.textContent ?? "").replace(/\s+/g, " ").trim(),
          assessed,
          ...(grade !== undefined ? { grade } : {}),
          ...(maxGrade !== undefined ? { maxGrade } : {}),
        });
      }
      return examples;
    },
    undefined,
  );
}

/**
 * A workshop's example submissions, as its page lists them to a teacher: each one's title, and
 * whether its reference assessment is made, with its grade. Moodle lists them in the setup phase
 * only, where the workshop uses examples ("Use examples" in its settings), to those who can manage
 * them (`mod/workshop:manageexamples`, a teacher's). Throws `WorkshopError` in another phase, when
 * the page has no examples (examples off, or the capability missing), or the id isn't a workshop's.
 */
export async function workshopExamples(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopExample[]> {
  const page = await openWorkshop(context, siteUrl, activityId);
  try {
    const phase = await currentPhase(page);
    if (phase !== "setup") throw new WorkshopError(`Workshop ${activityId} is in the ${phase ?? "unknown"} phase: Moodle lists its example submissions in the setup phase only.`);
    const examples = await readExamples(page);
    if (!examples) {
      throw new WorkshopError(`Workshop ${activityId}'s page lists no example submissions: the workshop doesn't use them ("Use examples" in its settings), or you can't manage them (Moodle's mod/workshop:manageexamples, a teacher's).`);
    }
    return examples;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The value of the page's first field matching `selector`. */
function valueOf(page: Page, selector: string): Promise<string | undefined> {
  return page.evaluate((selector) => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector(selector)?.value, selector);
}

/** An example's page, with Moodle's refusal in its terms. */
async function openExample(context: BrowserContext, siteUrl: string, activityId: number, exampleId: number, query = ""): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/workshop/exsubmission.php?cmid=${activityId}&id=${exampleId}${query}`);
  try {
    await checkExamplePage(page, activityId, exampleId);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

async function checkExamplePage(page: Page, activityId: number, exampleId: number): Promise<void> {
  const refused = await moodleErrorMessage(page);
  if (refused !== undefined) {
    const code = await errorCode(page);
    if (code === "nopermissions" || code === "required_capability") {
      throw new WorkshopError(`You can't manage workshop ${activityId}'s example submissions: it takes Moodle's mod/workshop:manageexamples capability (a teacher's). Moodle said: ${refused}`);
    }
    throw new WorkshopError(`Moodle didn't open example ${exampleId} of workshop ${activityId}: ${refused}`);
  }
  if ((await page.locator("body#page-mod-workshop-exsubmission").count()) === 0) throw new WorkshopError(`Activity ${activityId} isn't a workshop with example ${exampleId}.`);
}

/** An example's page as it shows it: its title, text and attachments. */
async function readExample(context: BrowserContext, siteUrl: string, activityId: number, exampleId: number): Promise<{ id: number; title: string; content: string; attachments: WorkshopAttachment[] }> {
  const page = await openExample(context, siteUrl, activityId, exampleId);
  try {
    const read = await readSubmissionBox(page);
    if (!read) throw new WorkshopError(`Workshop ${activityId} has no example ${exampleId}.`);
    return { id: exampleId, title: read.title, content: read.content, attachments: read.attachments };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Adds an example submission to a workshop, as "Add example submission" does, with the
 * submission's own form: a title, its text (HTML, with `embed`'s files) and attached files. Moodle
 * asks for its reference assessment next (`assessWorkshopExample`). Examples matter only where the
 * workshop uses them ("Use examples" in its settings). Returns a sentence of what changed, the
 * example's id, and the example as its page shows it. Throws `WorkshopError` when the person can't
 * manage examples (Moodle's `mod/workshop:manageexamples`, a teacher's); `FormError` when Moodle
 * refuses the form.
 */
export async function addWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  input: WorkshopExampleInput & { title: string },
): Promise<{ changed: string; exampleId: number; example: { id: number; title: string; content: string; attachments: WorkshopAttachment[] } }> {
  if (input.title === undefined) throw new MoodleError("An example submission needs a title.", "invalid-input");
  await checkSubmissionInput(input);
  const page = await openSubmissionForm(context, siteUrl, `mod/workshop/exsubmission.php?cmid=${activityId}&id=0&edit=on`, () => refusal(activityId));
  let exampleId: number;
  try {
    await fillSubmissionForm(page, activityId, input);
    // Moodle lands on the new example (exsubmission.php?cmid=<cm>&id=<example>), whose buttons carry its id too.
    exampleId = Number(new URL(page.url()).searchParams.get("id")) || Number(await valueOf(page, '.buttonsbar form input[name="id"]'));
  } finally {
    await page.close().catch(() => undefined);
  }
  if (!exampleId) throw new WorkshopError(`The example form of workshop ${activityId} was saved, but Moodle didn't show the new example.`);
  const example = await readExample(context, siteUrl, activityId, exampleId);
  return { changed: `Example submission ${exampleId} "${example.title}" added to workshop ${activityId}.`, exampleId, example };
}

/** The refusal of an example's form: Moodle shows it only to those who manage examples. */
function refusal(activityId: number): WorkshopError {
  return new WorkshopError(`Moodle shows you no example form in workshop ${activityId}: managing example submissions takes Moodle's mod/workshop:manageexamples capability (a teacher's), and the id must be a workshop's.`);
}

/**
 * Changes an example submission through its form, as "Edit example" does: only what's given
 * changes (`attachments` replace those there). Returns a sentence of what changed and the example
 * afterwards. Throws `WorkshopError` when the person can't manage examples or the example isn't the
 * workshop's.
 */
export async function editWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  exampleId: number,
  input: WorkshopExampleInput,
): Promise<{ changed: string; example: { id: number; title: string; content: string; attachments: WorkshopAttachment[] } }> {
  if (input.title === undefined && input.content === undefined && input.attachments === undefined) throw new MoodleError("Give the example's title, content or attachments.", "invalid-input");
  await checkSubmissionInput(input);
  // The example's page first, so Moodle's refusal is said in its terms.
  await (await openExample(context, siteUrl, activityId, exampleId)).close();
  const page = await openSubmissionForm(context, siteUrl, `mod/workshop/exsubmission.php?cmid=${activityId}&id=${exampleId}&edit=on`, () => refusal(activityId));
  try {
    await fillSubmissionForm(page, activityId, input);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Example submission ${exampleId} of workshop ${activityId} changed.`, example: await readExample(context, siteUrl, activityId, exampleId) };
}

/**
 * Deletes an example submission, as "Delete example" and its confirmation do: Moodle deletes its
 * assessments with it (the reference one and the participants'). Returns a sentence of what
 * changed. Throws `WorkshopError` when the person can't manage examples or the example isn't the
 * workshop's.
 */
export async function deleteWorkshopExample(context: BrowserContext, siteUrl: string, activityId: number, exampleId: number): Promise<{ changed: string }> {
  const page = await openExample(context, siteUrl, activityId, exampleId, "&delete=1");
  try {
    // The confirmation's "Continue" carries delete=1, confirm=1 and the sesskey.
    const confirm = page.locator('form[action*="/mod/workshop/exsubmission.php"]:has(input[name="confirm"][value="1"]) [type="submit"]');
    if ((await confirm.count()) === 0) throw refusal(activityId);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click({ noWaitAfter: true })]);
    const failed = await moodleErrorMessage(page);
    if (failed !== undefined) throw new WorkshopError(`Moodle didn't delete example ${exampleId} of workshop ${activityId}: ${failed}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  return { changed: `Example submission ${exampleId} deleted from workshop ${activityId}.` };
}

/**
 * Assesses an example submission through the workshop's assessment form (its grading strategy's,
 * filled as `assessWorkshopSubmission` fills a submission's), as "Assess" on the example does: for
 * a teacher who manages examples, its reference assessment, which participants' assessments of it
 * are compared with; for a participant, their own practice assessment, where the workshop lets them
 * assess examples now (its examples mode and phase). Returns a sentence of what changed, the
 * assessment's id, and the grade it gives out of the workshop's grade. Throws `WorkshopError` when
 * Moodle offers no assessment of it or a criterion's grade isn't one it takes; `FormError` when
 * Moodle refuses the form.
 */
export async function assessWorkshopExample(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  exampleId: number,
  input: WorkshopAssessmentInput,
): Promise<{ changed: string; assessmentId: number; grade?: number; maxGrade?: number }> {
  const page = await openExample(context, siteUrl, activityId, exampleId);
  try {
    const assess = page.locator('form[action*="/mod/workshop/exsubmission.php"]:has(input[name="assess"]) [type="submit"]');
    if ((await assess.count()) === 0) throw new WorkshopError(`Moodle offers you no assessment of example ${exampleId} in workshop ${activityId}: participants assess examples only where and when the workshop asks them to.`);
    // Moodle adds the assessment when there's none, and redirects to it.
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), assess.first().click({ noWaitAfter: true })]);
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined) throw new WorkshopError(`Moodle didn't open an assessment of example ${exampleId} in workshop ${activityId}: ${refused}`);
    // Its URL has the assessment's id, and so has its form.
    const asid = Number(/[?&]asid=(\d+)/.exec(page.url())?.[1]) || Number(await valueOf(page, 'form.assessmentform input[name="asid"]'));
    if (!asid) throw new WorkshopError(`Moodle didn't open an assessment of example ${exampleId} in workshop ${activityId}.`);
    const shown = await fillAssessmentForm(page, activityId, exampleId, input, `Moodle doesn't let you change assessment ${asid} of example ${exampleId} now.`);
    return {
      changed: `Example ${exampleId} of workshop ${activityId} assessed${shown.grade !== undefined ? `: ${shown.grade}${shown.maxGrade !== undefined ? ` of ${shown.maxGrade}` : ""}` : ""}.`,
      assessmentId: asid,
      ...shown,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
