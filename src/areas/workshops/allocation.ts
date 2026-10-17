// A workshop's allocation, who assesses whom, as its teacher sets it on Moodle's allocation page
// (mod/workshop/allocation.php): the manual allocator's table (read, and its add and delete links),
// the random allocator's form, and the scheduled allocator's form. No AJAX service covers any of it
// (mod_workshop's services are the mobile app's only); the pages are read by their structure (the
// table's cell classes, the forms' field names, the message box's classes), so it works in any
// language (confirmed empirically, Moodle 5.2).
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { FormError, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { WorkshopError } from "./workshops.js";

/** A reviewer allocated to a submission: the assessment Moodle made for them (empty until they assess). */
export interface WorkshopReviewer {
  assessmentId: number;
  reviewerId: number;
  reviewer: string;
}

/** A submission and the people allocated to assess it. */
export interface WorkshopAllocatedSubmission {
  id: number;
  title: string;
  authorId: number;
  author: string;
  reviewers: WorkshopReviewer[];
}

/** A workshop's allocation (`workshopAllocation`). */
export interface WorkshopAllocation {
  activityId: number;
  submissions: WorkshopAllocatedSubmission[];
  /** The participants who may be allocated as reviewers (Moodle's potential reviewers: those who can assess peers in the course), by name. */
  potentialReviewers: { userId: number; fullName: string }[];
}

/** One participant's row of the manual allocator's table, as read in the page. */
interface AllocationRow {
  userId: number;
  name: string;
  submission?: { id: number; title: string };
  reviewers: WorkshopReviewer[];
  /** The options of the row's "Add reviewer" menu: who Moodle offers to review this participant's submission. */
  offered: { userId: number; fullName: string }[];
}

/** The manual allocator's table rows and the last page number of its paging bar. */
export function readAllocationTable(page: Page): Promise<{ rows: AllocationRow[]; lastPage: number }> {
  return inPage(
    page,
    () => {
      interface Node {
        nodeType: number;
        textContent: string | null;
      }
      interface El extends Node {
        value: string;
        childNodes: ArrayLike<Node>;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      // The name follows the user's picture as a bare text node.
      const ownText = (el: El) =>
        clean(
          Array.from(el.childNodes)
            .filter((n) => n.nodeType === 3)
            .map((n) => n.textContent)
            .join(" "),
        );
      const param = (href: string | null | undefined, name: string) => {
        const match = new RegExp(`[?&]${name}=(\\d+)`).exec(href ?? "");
        return match ? Number(match[1]) : undefined;
      };
      const rows: AllocationRow[] = [];
      for (const tr of Array.from(doc.querySelectorAll("table.allocations tbody tr"))) {
        const peer = tr.querySelector("td.peer");
        if (!peer) continue;
        const userId = param(peer.querySelector('a[href*="/user/view.php"]')?.getAttribute("href"), "id");
        if (userId === undefined) continue;
        const title = peer.querySelector('.submission .title a[href*="/mod/workshop/submission.php"]');
        const reviewers: WorkshopReviewer[] = [];
        for (const li of Array.from(tr.querySelectorAll("td.reviewedby li"))) {
          const reviewerId = param(li.querySelector('a[href*="/user/view.php"]')?.getAttribute("href"), "id");
          const assessmentId = param(li.querySelector('a[href*="mode=del"]')?.getAttribute("href"), "what");
          if (reviewerId !== undefined && assessmentId !== undefined) reviewers.push({ assessmentId, reviewerId, reviewer: ownText(li) });
        }
        const offered = Array.from(tr.querySelectorAll('td.reviewedby select[name="by"] option'))
          .filter((o) => o.value !== "")
          .map((o) => ({
            userId: Number(o.value),
            fullName: clean(o.textContent),
          }));
        rows.push({
          userId,
          name: ownText(peer),
          ...(title
            ? {
                submission: {
                  id: param(title.getAttribute("href"), "id") ?? 0,
                  title: clean(title.textContent),
                },
              }
            : {}),
          reviewers,
          offered,
        });
      }
      const pages = Array.from(doc.querySelectorAll('#region-main .pagination a[href*="page="]')).map((a) => param(a.getAttribute("href"), "page") ?? 0);
      return { rows, lastPage: Math.max(0, ...pages) };
    },
    undefined,
  );
}

/** Opens an allocation page, failing in Moodle's terms when the person can't allocate or the id isn't a workshop's. */
async function openAllocation(context: BrowserContext, siteUrl: string, activityId: number, query: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, `mod/workshop/allocation.php?cmid=${activityId}&${query}`);
  try {
    await checkAllocationPage(page, activityId);
    return page;
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

async function checkAllocationPage(page: Page, activityId: number): Promise<void> {
  const refused = await moodleErrorMessage(page);
  const onAllocation = (await page.locator("body#page-mod-workshop-allocation").count()) > 0;
  // Moodle sets the allocation page before checking the capability: its refusal keeps the page's body id.
  if (refused !== undefined && onAllocation) {
    throw new WorkshopError(`You can't allocate submissions in workshop ${activityId}: it takes Moodle's mod/workshop:allocate capability (a teacher's). Moodle said: ${refused}`);
  }
  if (!onAllocation) {
    throw new WorkshopError(
      `Activity ${activityId} isn't a workshop whose allocation you can open${refused ? ` (Moodle said: ${refused})` : ""}. Take the id of a workshop (module "workshop") from the course structure.`,
    );
  }
}

/** An allocator's form (random, scheduled), refused in Moodle's terms when the person can't allocate. */
async function openAllocationForm(context: BrowserContext, siteUrl: string, activityId: number, method: string): Promise<Page> {
  try {
    return await openForm(context, siteUrl, `mod/workshop/allocation.php?cmid=${activityId}&method=${method}`);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    // No form: Moodle's refusal, or another activity; the page says which.
    const page = await openAllocation(context, siteUrl, activityId, `method=${method}`);
    await page.close().catch(() => undefined);
    throw new WorkshopError(`Workshop ${activityId}'s ${method} allocation page has no form.`);
  }
}

/** The page's sesskey, which the allocator's links carry. */
function pageSesskey(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { sesskey?: string } } }).M?.cfg?.sesskey ?? "");
}

/** Every page of the manual allocator's table, and the sesskey of the first. */
async function readAllocation(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
): Promise<{
  allocation: WorkshopAllocation;
  rows: AllocationRow[];
  sesskey: string;
}> {
  const rows: AllocationRow[] = [];
  let sesskey = "";
  let lastPage = 0;
  for (let pageNumber = 0; pageNumber <= lastPage; pageNumber++) {
    const page = await openAllocation(context, siteUrl, activityId, `method=manual${pageNumber > 0 ? `&page=${pageNumber}` : ""}`);
    try {
      if (!sesskey) sesskey = await pageSesskey(page);
      const table = await readAllocationTable(page);
      rows.push(...table.rows);
      lastPage = Math.max(lastPage, table.lastPage);
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return { allocation: allocationOf(activityId, rows), rows, sesskey };
}

/** The table's rows as the allocation: one entry per submission, and every reviewer any row offers. */
export function allocationOf(activityId: number, rows: AllocationRow[]): WorkshopAllocation {
  const submissions = rows.flatMap((row) =>
    row.submission
      ? [
          {
            id: row.submission.id,
            title: row.submission.title,
            authorId: row.userId,
            author: row.name,
            reviewers: row.reviewers,
          },
        ]
      : [],
  );
  const potential = new Map<number, string>();
  for (const row of rows) for (const offered of row.offered) potential.set(offered.userId, offered.fullName);
  return {
    activityId,
    submissions,
    potentialReviewers: [...potential].map(([userId, fullName]) => ({
      userId,
      fullName,
    })),
  };
}

/**
 * A workshop's allocation, as Moodle's manual allocation page shows it to a teacher (every page of
 * it, in the course's current group): each submission with its author and the reviewers allocated
 * to it (with the id of the assessment Moodle made for each, assessed or not), and the participants
 * who may be allocated as reviewers. A teacher's own assessments count as allocations too. Throws
 * `WorkshopError` when the person can't allocate (Moodle's `mod/workshop:allocate`, a teacher's) or
 * the id isn't a workshop's.
 */
export async function workshopAllocation(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopAllocation> {
  return (await readAllocation(context, siteUrl, activityId)).allocation;
}

/** A submission of the allocation, by its id or its author's (one of the two). */
interface WorkshopSubmissionRef {
  submissionId?: number;
  authorId?: number;
}

/** A reviewer for a submission, given by its id (`submissionId`) or its author's (`authorId`). */
export interface WorkshopReviewerChoice {
  /** The submission's id (give this or `authorId`). */
  submissionId?: number;
  /** The submission's author's user id. */
  authorId?: number;
  /** The reviewer's user id. */
  reviewerId: number;
}

/** A reviewer to remove from a submission; `evenIfAssessed` deletes an assessment they already graded. */
export interface WorkshopReviewerRemoval extends WorkshopReviewerChoice {
  /** Remove it even when the reviewer already assessed the submission (the assessment and its grade are deleted). */
  evenIfAssessed?: boolean;
}

function findSubmission(allocation: WorkshopAllocation, { submissionId, authorId }: WorkshopSubmissionRef): WorkshopAllocatedSubmission {
  if ((submissionId === undefined) === (authorId === undefined)) throw new MoodleError("Give the submission by its id (submissionId) or its author's (authorId), one of the two.", "invalid-input");
  const submission = allocation.submissions.find((s) => (submissionId !== undefined ? s.id === submissionId : s.authorId === authorId));
  if (!submission) {
    throw new WorkshopError(
      submissionId !== undefined
        ? `Workshop ${allocation.activityId} has no submission ${submissionId} on its allocation page (in the course's current group).`
        : `User ${authorId} has no submission in workshop ${allocation.activityId}: Moodle allocates reviewers to submissions only.`,
    );
  }
  return submission;
}

/**
 * The manual allocator's message after an action: its kind by class (`ok`, `info`, `error`), and
 * whether it asks to confirm (its "I'm sure" button carries `confirm=1`). Moodle redirects each
 * action to the allocation page with a message code, which the page shows in this box.
 */
async function allocatorAction(context: BrowserContext, siteUrl: string, activityId: number, query: string): Promise<{ type: string; confirm: boolean } | undefined> {
  const page = await openAllocation(context, siteUrl, activityId, `method=manual&${query}`);
  try {
    return await page.evaluate(() => {
      interface El {
        className: string;
        querySelector(s: string): El | null;
      }
      const box = (globalThis as unknown as { document: El }).document.querySelector(".allocator-ui .message");
      if (!box) return undefined;
      const classes = box.className.split(/\s+/);
      return {
        type: ["ok", "error"].find((c) => classes.includes(c)) ?? "info",
        confirm: box.querySelector('form input[name="confirm"][value="1"]') !== null,
      };
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Allocates a reviewer to a submission, as the "Add reviewer" menu of Moodle's manual allocation
 * page does, in any phase. The submission is given by its id or by its author's (`authorId`); the
 * reviewer must be one Moodle offers for it: a participant who can assess peers in the course
 * (enrolled as a student), and not the author unless the workshop allows self-assessment. Returns a
 * sentence of what changed, the assessment Moodle made (or the one the reviewer already had: `added`
 * is false then), and the submission's reviewers afterwards. Throws `WorkshopError` when the reviewer
 * isn't one Moodle offers, the submission isn't there, or the person can't allocate
 * (`mod/workshop:allocate`).
 */
export async function allocateReviewer(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { submissionId, authorId, reviewerId }: WorkshopReviewerChoice,
): Promise<{
  changed: string;
  added: boolean;
  assessmentId: number;
  submission: WorkshopAllocatedSubmission;
}> {
  const { allocation, rows, sesskey } = await readAllocation(context, siteUrl, activityId);
  const submission = findSubmission(allocation, { submissionId, authorId });
  const row = rows.find((r) => r.userId === submission.authorId)!;
  if (!row.offered.some((o) => o.userId === reviewerId)) {
    // Moodle itself would add any user id it's given (workshop::add_allocation checks nothing, 5.2);
    // its menu offers only the potential reviewers.
    throw new WorkshopError(
      reviewerId === submission.authorId
        ? `Workshop ${activityId} doesn't allow self-assessment: user ${reviewerId} can't review their own submission (it's on in the workshop's settings, "Use self-assessment").`
        : `User ${reviewerId} can't review submission ${submission.id} in workshop ${activityId}: Moodle offers only participants who can assess peers in the course (enrolled as students, in the current group); ${row.offered.length > 0 ? `it offers ${row.offered.map((o) => o.userId).join(", ")}` : "it offers no one"}.`,
    );
  }
  const added = !submission.reviewers.some((r) => r.reviewerId === reviewerId);
  if (added) {
    // Moodle answers "ok" (added), "info" (already there) or "error" (the author has no submission).
    const message = await allocatorAction(context, siteUrl, activityId, `mode=new&of=${submission.authorId}&by=${reviewerId}&sesskey=${sesskey}`);
    if (message?.type === "error") throw new WorkshopError(`Moodle didn't allocate user ${reviewerId} to submission ${submission.id} in workshop ${activityId}: it found no submission by its author.`);
  }
  const after = findSubmission((await readAllocation(context, siteUrl, activityId)).allocation, { submissionId: submission.id });
  const assessment = after.reviewers.find((r) => r.reviewerId === reviewerId);
  if (!assessment) throw new WorkshopError(`Moodle didn't allocate user ${reviewerId} to submission ${submission.id} in workshop ${activityId}: the allocation page doesn't show them.`);
  return {
    changed: added
      ? `User ${reviewerId} allocated to review submission ${submission.id} of workshop ${activityId}.`
      : `User ${reviewerId} was already allocated to review submission ${submission.id} of workshop ${activityId}; nothing changed.`,
    added,
    assessmentId: assessment.assessmentId,
    submission: after,
  };
}

/**
 * Removes a reviewer's allocation to a submission, as the delete icon of Moodle's manual allocation
 * page does: Moodle deletes the reviewer's assessment of it. An assessment the reviewer already
 * graded is only deleted with `evenIfAssessed` (Moodle warns about it and the grade is lost). The
 * submission is given by its id or its author's. Returns a sentence of what changed, the assessment
 * removed, and the submission's reviewers afterwards. Throws `WorkshopError` when the reviewer isn't
 * allocated to it, when the assessment is graded and `evenIfAssessed` isn't set, or when the person
 * can't allocate (`mod/workshop:allocate`).
 */
export async function removeReviewer(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { submissionId, authorId, reviewerId, evenIfAssessed = false }: WorkshopReviewerRemoval,
): Promise<{
  changed: string;
  assessmentId: number;
  submission: WorkshopAllocatedSubmission;
}> {
  const { allocation, sesskey } = await readAllocation(context, siteUrl, activityId);
  const submission = findSubmission(allocation, { submissionId, authorId });
  const assessment = submission.reviewers.find((r) => r.reviewerId === reviewerId);
  if (!assessment)
    throw new WorkshopError(
      `User ${reviewerId} isn't allocated to review submission ${submission.id} in workshop ${activityId}; its reviewers are ${submission.reviewers.map((r) => r.reviewerId).join(", ") || "none"}.`,
    );
  // First as the icon does, without confirming: Moodle asks, as a warning ("error") when the
  // assessment already has a grade and as a question ("info") otherwise.
  const question = await allocatorAction(context, siteUrl, activityId, `mode=del&what=${assessment.assessmentId}&sesskey=${sesskey}`);
  if (!question?.confirm) throw new WorkshopError(`Moodle didn't offer to remove assessment ${assessment.assessmentId} in workshop ${activityId}.`);
  if (question.type === "error" && !evenIfAssessed) {
    throw new WorkshopError(
      `User ${reviewerId} already assessed submission ${submission.id} in workshop ${activityId}: removing the allocation deletes that assessment and its grade. Pass evenIfAssessed to remove it anyway.`,
    );
  }
  // "ok" when deleted, "error" when Moodle couldn't.
  const done = await allocatorAction(context, siteUrl, activityId, `mode=del&what=${assessment.assessmentId}&confirm=1&sesskey=${sesskey}`);
  if (done?.type === "error") throw new WorkshopError(`Moodle didn't remove assessment ${assessment.assessmentId} in workshop ${activityId}.`);
  const after = findSubmission((await readAllocation(context, siteUrl, activityId)).allocation, { submissionId: submission.id });
  if (after.reviewers.some((r) => r.assessmentId === assessment.assessmentId))
    throw new WorkshopError(`Moodle didn't remove assessment ${assessment.assessmentId} in workshop ${activityId}: the allocation page still shows it.`);
  return {
    changed: `User ${reviewerId} no longer reviews submission ${submission.id} of workshop ${activityId} (assessment ${assessment.assessmentId} deleted).`,
    assessmentId: assessment.assessmentId,
    submission: after,
  };
}

/** The random allocator's settings, as its form has them. */
export interface RandomAllocationSettings {
  /** Reviews each submission gets (Moodle's "Number of reviews … per submission"); give this or `perReviewer`. */
  perSubmission?: number;
  /** Reviews each reviewer does ("… per reviewer"). */
  perReviewer?: number;
  /** Keep the allocations there are (default) or remove them first ("Remove current allocations"; Moodle never removes graded ones). */
  keepCurrent?: boolean;
  /** Reviewers without a submission of their own too ("Participants can assess without having submitted anything"); off by default. */
  withoutSubmission?: boolean;
  /** Add each author's self-assessment ("Add self-assessments"), where the workshop allows it; off by default. */
  selfAssessment?: boolean;
  /** Prevent reviews by peers of the same group ("Prevent reviews by peers from the same group"), only in visible groups mode; off by default. */
  excludeSameGroup?: boolean;
}

/** The form's fields for the settings given; refuses those the form doesn't have (self-assessment off, no visible groups). */
async function randomFields(page: Page, activityId: number, settings: RandomAllocationSettings, requireNumber: boolean): Promise<Record<string, FieldValue>> {
  const { perSubmission, perReviewer, keepCurrent, withoutSubmission, selfAssessment, excludeSameGroup } = settings;
  if (perSubmission !== undefined && perReviewer !== undefined)
    throw new MoodleError("Give the number of reviews per submission (perSubmission) or per reviewer (perReviewer), not both.", "invalid-input");
  if (requireNumber && perSubmission === undefined && perReviewer === undefined)
    throw new MoodleError("Give the number of reviews per submission (perSubmission) or per reviewer (perReviewer).", "invalid-input");
  const reviews = perSubmission ?? perReviewer;
  if (reviews !== undefined && (!Number.isInteger(reviews) || reviews < 0)) throw new MoodleError(`The number of reviews is a whole number, 0 or more; not ${reviews}.`, "invalid-input");
  const checkbox = (name: string) => page.locator(`form.mform input[type="checkbox"][name="${name}"]`).count();
  if (selfAssessment !== undefined && (await checkbox("addselfassessment")) === 0) {
    if (selfAssessment) throw new WorkshopError(`Workshop ${activityId} doesn't allow self-assessment: it's off in its settings ("Use self-assessment").`);
  }
  if (excludeSameGroup !== undefined && (await checkbox("excludesamegroup")) === 0) {
    if (excludeSameGroup)
      throw new WorkshopError(`Workshop ${activityId} isn't in visible groups mode: Moodle only prevents reviews within a group there (in separate groups, it allocates within each group).`);
  }
  return {
    ...(reviews !== undefined
      ? {
          numofreviews: reviews,
          numper: perSubmission !== undefined ? "1" : "2",
        }
      : {}),
    ...(keepCurrent !== undefined ? { removecurrent: !keepCurrent } : requireNumber ? { removecurrent: false } : {}),
    ...(withoutSubmission !== undefined ? { assesswosubmission: withoutSubmission } : requireNumber ? { assesswosubmission: false } : {}),
    ...(selfAssessment !== undefined && (await checkbox("addselfassessment")) > 0 ? { addselfassessment: selfAssessment } : {}),
    ...(excludeSameGroup !== undefined && (await checkbox("excludesamegroup")) > 0 ? { excludesamegroup: excludeSameGroup } : {}),
  };
}

/** What Moodle reports after allocating: its lines, the problems among them (`li.error`), by class. */
function readResults(page: Page): Promise<{
  lines: { type: string; text: string }[];
  message?: { type: string; text: string };
}> {
  return inPage(
    page,
    () => {
      interface El {
        className: string;
        textContent: string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const clean = (s: string | null) => (s ?? "").replace(/\s+/g, " ").trim();
      const box = doc.querySelector(".allocator-init-results");
      const message = box?.querySelector(".message");
      const kind = (el: El) => ["ok", "info", "error", "debug"].find((c) => el.className.split(/\s+/).includes(c)) ?? "info";
      return {
        lines: Array.from(box?.querySelectorAll("ul.allocation-init-results li") ?? []).map((li) => ({ type: kind(li), text: clean(li.textContent) })),
        ...(message
          ? {
              message: {
                type: kind(message),
                text: clean(message.textContent),
              },
            }
          : {}),
      };
    },
    undefined,
  );
}

/**
 * Allocates submissions to reviewers at random, as Moodle's random allocation form does: `perSubmission`
 * reviews for each submission, or `perReviewer` for each reviewer, keeping the current allocations
 * unless `keepCurrent` is false (Moodle never removes an assessment already graded), among reviewers
 * with a submission of their own unless `withoutSubmission`, with self-assessments when
 * `selfAssessment` (and the workshop allows them), and without peers of the same group when
 * `excludeSameGroup` (visible groups mode only). Returns a sentence of what changed, how many
 * allocations were added and removed, Moodle's report of what it did (its lines, in the site's
 * language) and the problems among them (not enough reviewers, graded assessments kept), and the
 * allocation afterwards. Throws `WorkshopError` for a setting the workshop doesn't have or when the
 * person can't allocate (`mod/workshop:allocate`); `FormError` when Moodle refuses the form.
 */
export async function allocateRandomly(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  settings: RandomAllocationSettings,
): Promise<{
  changed: string;
  added: number;
  removed: number;
  report: string[];
  problems: string[];
  allocation: WorkshopAllocation;
}> {
  const before = (await readAllocation(context, siteUrl, activityId)).allocation;
  const page = await openAllocationForm(context, siteUrl, activityId, "random");
  let results: Awaited<ReturnType<typeof readResults>>;
  try {
    await setFields(page, await randomFields(page, activityId, settings, true));
    await submitForm(page, "submitbutton");
    results = await readResults(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  if (!results.message) throw new WorkshopError(`Moodle didn't report a random allocation in workshop ${activityId}.`);
  const allocation = (await readAllocation(context, siteUrl, activityId)).allocation;
  const ids = (a: WorkshopAllocation) => new Set(a.submissions.flatMap((s) => s.reviewers.map((r) => r.assessmentId)));
  const was = ids(before);
  const now = ids(allocation);
  const added = [...now].filter((id) => !was.has(id)).length;
  const removed = [...was].filter((id) => !now.has(id)).length;
  return {
    changed: `Workshop ${activityId} allocated at random: ${added} allocation(s) added, ${removed} removed.`,
    added,
    removed,
    report: [results.message.text, ...results.lines.filter((l) => l.type !== "debug").map((l) => l.text)],
    problems: results.lines.filter((l) => l.type === "error").map((l) => l.text),
    allocation,
  };
}

/** The scheduled allocation turned on or off, with the random allocation's settings it runs with. */
export interface ScheduledAllocationSettings extends RandomAllocationSettings {
  /** On: Moodle allocates at random by itself at the end of the submission phase; off: it doesn't. */
  enabled: boolean;
}

/** The scheduled allocation's settings and status, as its form shows them. */
export interface ScheduledAllocation {
  enabled: boolean;
  perSubmission?: number;
  perReviewer?: number;
  keepCurrent: boolean;
  withoutSubmission: boolean;
  selfAssessment: boolean;
  /** Moodle's status of it, in the site's language ("Workshop does not have the submissions deadline defined"…). */
  status: string;
}

function readScheduled(page: Page): Promise<ScheduledAllocation> {
  return inPage(
    page,
    () => {
      interface El {
        value: string;
        checked: boolean;
        textContent: string | null;
        querySelector(s: string): El | null;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const form = doc.querySelector("form.mform");
      const checked = (name: string) => form?.querySelector(`input[type="checkbox"][name="${name}"]`)?.checked ?? false;
      const reviews = Number(form?.querySelector('[name="numofreviews"]')?.value ?? "0");
      const perSubmission = form?.querySelector('[name="numper"]')?.value !== "2";
      return {
        enabled: checked("enablescheduled"),
        ...(perSubmission ? { perSubmission: reviews } : { perReviewer: reviews }),
        keepCurrent: !checked("removecurrent"),
        withoutSubmission: checked("assesswosubmission"),
        selfAssessment: checked("addselfassessment"),
        status: (form?.querySelector('[data-name="infostatus"]')?.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    },
    undefined,
  );
}

/**
 * Turns the scheduled allocation on or off, as Moodle's scheduled allocation form does: when on,
 * Moodle runs the random allocation by itself at the end of the submission phase (once the
 * workshop's submissions deadline passes, by its cron), with the settings given here (those of
 * `allocateRandomly`; the ones left out keep what the form has). Returns a sentence of what changed
 * and the scheduled allocation afterwards, with Moodle's status of it (a workshop without a
 * submissions deadline is never allocated). Throws `WorkshopError` for a setting the workshop doesn't
 * have or when the person can't allocate (`mod/workshop:allocate`); `FormError` when Moodle refuses
 * the form.
 */
export async function scheduleAllocation(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  { enabled, ...settings }: ScheduledAllocationSettings,
): Promise<{ changed: string } & ScheduledAllocation> {
  const page = await openAllocationForm(context, siteUrl, activityId, "scheduled");
  try {
    await setFields(page, {
      enablescheduled: enabled,
      ...(await randomFields(page, activityId, settings, false)),
    });
    await submitForm(page, "submitbutton");
    const results = await readResults(page);
    if (!results.message) throw new WorkshopError(`Moodle didn't save the scheduled allocation of workshop ${activityId}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await openAllocationForm(context, siteUrl, activityId, "scheduled");
  try {
    const scheduled = await readScheduled(after);
    if (scheduled.enabled !== enabled) throw new WorkshopError(`Moodle didn't turn workshop ${activityId}'s scheduled allocation ${enabled ? "on" : "off"}.`);
    return {
      changed: `Workshop ${activityId}'s scheduled allocation turned ${enabled ? "on" : "off"}.`,
      ...scheduled,
    };
  } finally {
    await after.close().catch(() => undefined);
  }
}
