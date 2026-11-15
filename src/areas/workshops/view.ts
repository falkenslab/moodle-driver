// A workshop as the person sees it on its page (mod/workshop/view.php), participant or teacher: the
// phase and the person's tasks in it, the instructions, their own submission and the submissions
// allocated to them to assess, with the assessment form a reviewer fills. The page has no AJAX
// service behind it; its parts are Moodle's "viewlets", read by their ids.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { openSitePage } from "../../core/session.js";
import { assessmentGrade, currentPhase, openWorkshop, readAssessmentForm, WorkshopError, type WorkshopPhase } from "./workshops.js";
import type { WorkshopStrategy } from "./form.js";

/** A task of the person's in the workshop's current phase, as its timeline lists it. */
export interface WorkshopTask {
  /** As the site shows it, in its language ("Assess peers"). */
  title: string;
  /** Moodle's mark: done, still to do, failed, or only information. */
  state: "done" | "todo" | "failed" | "info";
  /** Its details as shown ("total: 1", "pending: 1"), one line each. */
  details: string[];
}

/** A submission allocated to the person to assess, and their assessment of it. */
export interface WorkshopSubmissionToAssess {
  /** The person's assessment of it, which `assessWorkshopSubmission` fills (by the submission's id). */
  assessmentId: number;
  submissionId: number;
  title: string;
  /** The author, unless the workshop hides authors from reviewers. */
  authorId?: number;
  author?: string;
  /** Whether the person has assessed it. */
  assessed: boolean;
  /** The grade their assessment gives (out of `maxGrade`, the workshop's grade for submission), once assessed. */
  grade?: number;
  maxGrade?: number;
}

/** A criterion of the assessment form as a reviewer gets it, in the form's order (`WorkshopCriterion`'s order). */
export interface WorkshopReviewCriterion {
  /** Its description (HTML), as the teacher wrote it. */
  description: string;
  /**
   * The grades it takes, each with what to give as `WorkshopCriterion.grade` and its label as shown:
   * accumulative, the points or the scale's items; number of errors, `1` when the assertion holds and
   * `-1` when it doesn't, with the teacher's words; rubric, each level by its position (`1` for the
   * first) and its definition. None for comments.
   */
  grades: { grade: number; label: string }[];
  /** Whether it takes a comment (`WorkshopCriterion.comment`). */
  comment: boolean;
}

/** The assessment form a reviewer fills: the workshop's strategy, its criteria, and whether it has an overall feedback. */
export interface WorkshopReviewForm {
  strategy: WorkshopStrategy;
  criteria: WorkshopReviewCriterion[];
  feedback: boolean;
}

/** A workshop as its page shows it to the person (`workshopView`). */
export interface WorkshopView {
  activityId: number;
  phase: WorkshopPhase;
  /** The person's tasks in the current phase. */
  tasks: WorkshopTask[];
  /** The instructions the page shows in this phase (HTML): for authors while submitting, for reviewers while assessing. */
  instructions: { authors?: string; reviewers?: string };
  /** The person's own submission, once they have submitted; `undefined` before, or for whom the page shows none (a teacher). */
  ownSubmission?: { id: number; title: string };
  /** The submissions allocated to the person to assess, from the assessment phase on. */
  toAssess: WorkshopSubmissionToAssess[];
  /** The assessment form, from one of the person's assessments while assessing is open; `undefined` otherwise. */
  form?: WorkshopReviewForm;
}

/** What `view.php` shows, read from its viewlets. */
interface ViewRead {
  tasks: WorkshopTask[];
  instructions: { authors?: string; reviewers?: string };
  ownSubmission?: { id: number; title: string };
  toAssess: { assessmentId: number; submissionId: number; title: string; authorId?: number; author?: string; assessed: boolean }[];
}

/** The workshop's page as the person sees it, from its viewlets (ids `workshop-viewlet-*`). */
export function readView(page: Page): Promise<ViewRead> {
  return inPage(
    page,
    () => {
      interface El {
        className: string;
        innerHTML: string;
        textContent: string | null;
        value: string;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
        cloneNode(deep: boolean): El;
        remove(): void;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const text = (el: El | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      const param = (href: string | null | undefined, name: string) => {
        const match = new RegExp(`[?&]${name}=(\\d+)`).exec(href ?? "");
        return match ? Number(match[1]) : undefined;
      };
      // A task's title without what only screen readers get ("Task done").
      const shown = (el: El | null) => {
        if (!el) return "";
        const copy = el.cloneNode(true);
        for (const hidden of Array.from(copy.querySelectorAll(".accesshide, .visually-hidden, .sr-only"))) hidden.remove();
        return text(copy);
      };
      const tasks = Array.from(doc.querySelectorAll("dl.phase dd.active ul.tasks > li")).map((li) => {
        const classes = li.className.split(/\s+/);
        const state = classes.includes("completed") ? "done" : classes.includes("fail") ? "failed" : classes.includes("info") ? "info" : "todo";
        const details = li.querySelector(".details");
        const lines = (details?.innerHTML ?? "")
          .split(/<br\s*\/?>/i)
          .map((part) => part.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim())
          .filter(Boolean);
        return { title: shown(li.querySelector(".title")), state, details: lines } as WorkshopTask;
      });
      const instructions = (id: string) => {
        const box = doc.querySelector(`#workshop-viewlet-${id} .instructions`);
        return box ? (box.querySelector(".no-overflow") ?? box).innerHTML.trim() : undefined;
      };
      const own = doc.querySelector("#workshop-viewlet-ownsubmission .submission-summary a.title");
      const toAssess = Array.from(doc.querySelectorAll("#workshop-viewlet-assignedassessments .assessment-summary")).flatMap((box) => {
        const title = box.querySelector(".submission-summary a.title");
        const assessmentId = Number(box.querySelector('form[action*="/mod/workshop/assessment.php"] input[name="asid"]')?.value) || param(box.querySelector('a[href*="/mod/workshop/assessment.php"]')?.getAttribute("href"), "asid");
        const submissionId = param(title?.getAttribute("href"), "id");
        if (!title || !assessmentId || !submissionId) return [];
        const author = box.querySelector('.author .fullname a[href*="/user/view.php"]');
        return [
          {
            assessmentId,
            submissionId,
            title: text(title),
            ...(author ? { authorId: param(author.getAttribute("href"), "id"), author: text(author) } : {}),
            assessed: /\bgraded\b/.test(box.className) && !/\bnotgraded\b/.test(box.className),
          },
        ];
      });
      const authors = instructions("instructauthors");
      const reviewers = instructions("instructreviewers");
      return {
        tasks,
        instructions: { ...(authors ? { authors } : {}), ...(reviewers ? { reviewers } : {}) },
        ...(own ? { ownSubmission: { id: param(own.getAttribute("href"), "id") ?? 0, title: text(own) } } : {}),
        toAssess,
      };
    },
    undefined,
  );
}

/** The assessment form as `readAssessmentForm` reads it, in a reviewer's terms: what `WorkshopCriterion.grade` takes for each criterion. */
function reviewForm(read: Awaited<ReturnType<typeof readAssessmentForm>>): WorkshopReviewForm {
  return {
    strategy: read.strategy as WorkshopStrategy,
    criteria: read.descriptions.map((description, i) => {
      const control = read.criteria[i];
      return {
        description,
        grades: control ? control.options.map((option, n) => ({ grade: control.rubric ? n + 1 : Number(option.value), label: option.text })) : [],
        comment: read.comments[i] ?? false,
      };
    }),
    feedback: read.feedback,
  };
}

/**
 * A workshop as its page shows it to the person, participant or teacher: the phase and their tasks
 * in it, the instructions shown in this phase, their own submission, and the submissions allocated to
 * them to assess (with their assessment's id, whether it's assessed and the grade it gives). While
 * assessing is open, `form` is the assessment form as a reviewer gets it, read from one of the
 * person's own assessments: its criteria in order, with the grades each takes as
 * `assessWorkshopSubmission` takes them. A rubric's levels come without their points, which Moodle
 * doesn't show reviewers (confirmed empirically, 5.2).
 *
 * `workshopInfo` reads the teacher's report, empty for a participant; this reads what any participant
 * has. Opening the workshop's page logs that the person viewed it, as when they open it in Moodle; the
 * pages of their assessments it reads (for a grade given, and for the form) are only read: nothing is
 * saved, and no assessment is started. Throws `WorkshopError` for an activity that isn't a workshop
 * the person can view.
 */
export async function workshopView(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopView> {
  const page = await openWorkshop(context, siteUrl, activityId);
  let phase: WorkshopPhase | undefined;
  let read: ViewRead;
  try {
    phase = await currentPhase(page);
    read = await readView(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  if (!phase) throw new WorkshopError(`Workshop ${activityId}'s page shows no phase: it isn't what the driver expects of Moodle's workshop page.`);
  const toAssess: WorkshopSubmissionToAssess[] = [];
  let form: WorkshopReviewForm | undefined;
  for (const item of read.toAssess) {
    // An assessment's page holds the grade it gives and, while assessing is open, the form.
    if (!item.assessed && (form || phase !== "assessment")) {
      toAssess.push(item);
      continue;
    }
    const assessment = await openSitePage(context, siteUrl, `mod/workshop/assessment.php?asid=${item.assessmentId}`);
    try {
      toAssess.push({ ...item, ...(item.assessed ? await assessmentGrade(assessment) : {}) });
      if (!form && phase === "assessment") {
        const read = await readAssessmentForm(assessment);
        if (read.strategy) form = reviewForm(read);
      }
    } finally {
      await assessment.close().catch(() => undefined);
    }
  }
  return { activityId, phase, tasks: read.tasks, instructions: read.instructions, ...(read.ownSubmission ? { ownSubmission: read.ownSubmission } : {}), toAssess, ...(form ? { form } : {}) };
}
