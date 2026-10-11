// A SCORM activity as the person sees it, and Moodle's player opened on the working tab to do it.
// Moodle's SCORM services aren't open to AJAX: everything comes from its pages. The package itself is
// the teacher's own HTML and JavaScript, done in the player; the driver never writes its tracks or a
// grade (decided by the owner, 11 October 2026).
import type { BrowserContext, Page } from "playwright-core";
import type { BrowserManager } from "../../browser/manager.js";
import { inPage } from "../../core/inPage.js";
import { NotLoggedInError, openSitePage } from "../../core/session.js";
import { siteFetch } from "../../core/http.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

/** The activity isn't a SCORM the person can open, or Moodle didn't open its player. */
export class ScormError extends MoodleError {
  override name = "ScormError";
  constructor(message: string) {
    super(message, "scorm");
  }
}

/** A SCO's status for the person, as Moodle tracks it from what the package reports. */
export type ScoStatus = "not-attempted" | "incomplete" | "completed" | "passed" | "failed" | "browsed" | "suspended";

/** A SCO (a launchable part of the package) with the person's status and score in the attempt read. */
export interface ScormSco {
  id: number;
  title: string;
  status?: ScoStatus;
  score?: number;
}

/** A SCORM activity as the person sees it (`scorm`): its attempts, grades and SCOs. */
export interface ScormActivity {
  id: number;
  name: string;
  /** The activity's description, as HTML. */
  description?: string;
  /** Attempts the person may make: none means unlimited. */
  attemptsAllowed?: number;
  attemptsMade?: number;
  /** How Moodle grades the activity, in the site's words ("Highest attempt"). */
  gradingMethod?: string;
  /** The grade reported to the gradebook, and each attempt's, as Moodle shows them ("100%"); none before the first attempt. */
  grade?: string;
  attemptGrades: { attempt: number; grade: string }[];
  /** The SCOs with the person's status in their last attempt (the first, before any). */
  scos: ScormSco[];
}

/** Where `openScorm` left the working tab: the player, at a SCO of an attempt. */
export interface OpenedScorm {
  attempt: number;
  scoId: number;
  /** The SCORM version the player speaks to the package with. */
  version?: "SCORM 1.2" | "SCORM 2004" | "AICC";
  url: string;
}

interface ViewFacts {
  scorm: boolean;
  name: string;
  description?: string;
  lines: string[];
  scoId?: number;
  org?: string;
  sesskey?: string;
}

// The activity's page, never skipped to the player (which would start an attempt).
const viewPath = (activityId: number) => `mod/scorm/view.php?id=${activityId}&preventskip=1`;

function readView(page: Page): Promise<ViewFacts> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      innerHTML: string;
      getAttribute(n: string): string | null;
      querySelector(s: string): El | null;
    }
    const g = globalThis as unknown as { document: { body: El & { id: string } }; M?: { cfg?: { sesskey?: string } } };
    const doc = g.document.body;
    const form = doc.querySelector("#scormviewform");
    const field = (name: string) => form?.querySelector(`input[name="${name}"]`)?.getAttribute("value") ?? undefined;
    // Moodle's attempt status: one paragraph, its lines separated by <br>.
    const status = doc.querySelector('[role="main"] .generalbox p');
    const intro = doc.querySelector("#intro")?.innerHTML.trim();
    return {
      scorm: doc.id === "page-mod-scorm-view",
      name: doc.querySelector("[data-activityname]")?.getAttribute("data-activityname") ?? "",
      ...(intro ? { description: intro } : {}),
      lines: (status?.innerHTML ?? "")
        .split(/<br\s*\/?>/i)
        .map((line) => line.replace(/<[^>]*>/g, "").trim())
        .filter((line) => line !== ""),
      ...(field("scoid") ? { scoId: Number(field("scoid")) } : {}),
      ...(field("currentorg") !== undefined ? { org: field("currentorg") } : {}),
      ...(g.M?.cfg?.sesskey ? { sesskey: g.M.cfg.sesskey } : {}),
    };
  }, null);
}

/** The SCOs of a table of contents (`prereqs.php`'s), status by icon and score by its "(label: value)": no wording read. */
function readScos(page: Page, html: string): Promise<ScormSco[]> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(
    page,
    (toc: string) => {
      interface El {
        textContent: string | null;
        className: string;
        getAttribute(n: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, t: string): El } };
      const doc = new g.DOMParser().parseFromString(toc, "text/html");
      // Font Awesome 6's icons (Moodle 4.4+), then 4's, then the images older themes use.
      const ICONS: [RegExp, string][] = [
        [/\bfa-square-check\b|\bfa-check-square-o\b/, "completed"],
        [/\bfa-pen-to-square\b|\bfa-pencil-square-o\b/, "incomplete"],
        [/\bfa-square\b|\bfa-square-o\b/, "not-attempted"],
        [/\bfa-xmark\b|\bfa-times\b/, "failed"],
        [/\bfa-check\b/, "passed"],
        [/\bfa-eye\b/, "browsed"],
        [/\bfa-pause\b/, "suspended"],
      ];
      const IMAGES: [RegExp, string][] = [
        [/notattempted/, "not-attempted"],
        [/incomplete/, "incomplete"],
        [/completed/, "completed"],
        [/passed/, "passed"],
        [/failed/, "failed"],
        [/browsed/, "browsed"],
        [/suspend/, "suspended"],
      ];
      const statusOf = (link: El) => {
        const icon = link.querySelector("i.icon, i[class*='fa-']");
        if (icon) return ICONS.find(([pattern]) => pattern.test(icon.className))?.[1];
        const src = link.querySelector("img")?.getAttribute("src") ?? "";
        return IMAGES.find(([pattern]) => pattern.test(src))?.[1];
      };
      return Array.from(doc.querySelectorAll("a[data-scoid]")).map((link) => {
        const text = (link.textContent ?? "").replace(/\s+/g, " ").trim();
        const score = /\(\s*[^():]+:\s*(-?\d+(?:[.,]\d+)?)\s*\)\s*$/.exec(text);
        const status = statusOf(link);
        return {
          id: Number(link.getAttribute("data-scoid")),
          title: (score ? text.slice(0, score.index) : text).trim(),
          ...(status ? { status } : {}),
          ...(score ? { score: Number(score[1]!.replace(",", ".")) } : {}),
        } as ScormSco;
      });
    },
    html,
  );
}

const count = (value: string | undefined) => (value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined);
// What follows a status line's label ("Number of attempts you have made: 2").
const valueOf = (line: string | undefined) => (line === undefined ? undefined : decodeEntities(line.slice(line.lastIndexOf(":") + 1)).trim());

/**
 * A SCORM activity as the person sees it: its attempts (allowed and made), the grading method, the
 * grade reported and each attempt's, and its SCOs with the person's status and score in the last
 * attempt. Moodle doesn't show a SCORM's version on its page: `openScorm` tells it.
 */
export async function scorm(context: BrowserContext, siteUrl: string, activityId: number): Promise<ScormActivity> {
  const page = await openSitePage(context, siteUrl, viewPath(activityId));
  try {
    const facts = await readView(page);
    if (!facts.scorm) throw new ScormError(`Activity ${activityId} isn't a SCORM you can open. Take the id of a SCORM activity (module "scorm") from the course structure.`);
    // Moodle's attempt status, by position: allowed, made, one grade per attempt, method, reported.
    const made = count(valueOf(facts.lines[1]));
    const grades = facts.lines.slice(2, 2 + (made ?? 0));
    const tail = facts.lines.slice(2 + (made ?? 0));
    const reported = made ? valueOf(tail[1]) : undefined;
    const activity: ScormActivity = {
      id: activityId,
      name: decodeEntities(facts.name),
      ...(facts.description ? { description: facts.description } : {}),
      ...(count(valueOf(facts.lines[0])) !== undefined ? { attemptsAllowed: count(valueOf(facts.lines[0])) } : {}),
      ...(made !== undefined ? { attemptsMade: made } : {}),
      ...(tail[0] ? { gradingMethod: valueOf(tail[0]) } : {}),
      ...(reported ? { grade: reported } : {}),
      attemptGrades: grades.map((line, i) => ({ attempt: i + 1, grade: valueOf(line) ?? "" })),
      scos: [],
    };
    // The table of contents the player shows, without opening it (which would start an attempt).
    if (facts.scoId !== undefined && facts.sesskey) {
      const query = new URLSearchParams({ id: String(activityId), scoid: String(facts.scoId), attempt: String(made || 1), mode: "normal", currentorg: facts.org ?? "", sesskey: facts.sesskey });
      const toc = await siteFetch(context, new URL(`mod/scorm/prereqs.php?${query}`, siteUrl).href);
      if (new URL(toc.url).pathname.endsWith("/login/index.php")) throw new NotLoggedInError();
      if (toc.status === 200) activity.scos = await readScos(page, toc.body);
    }
    return activity;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Opens a SCORM in Moodle's player, in normal mode, on the browser's working tab (ADR-007), for the
 * person (or a program driving the tab) to do it there: the last attempt continues unless `newAttempt`,
 * at the activity's first SCO unless `scoId`. Resolves once the SCO's frame has loaded. Opening the
 * player is what starts an attempt in Moodle.
 */
export async function openScorm(browser: BrowserManager, siteUrl: string, activityId: number, options: { scoId?: number; newAttempt?: boolean } = {}): Promise<OpenedScorm> {
  const context = await browser.context();
  const view = await openSitePage(context, siteUrl, viewPath(activityId), { follow: false });
  let facts: ViewFacts;
  try {
    facts = await readView(view);
  } finally {
    await view.close().catch(() => undefined);
  }
  if (!facts.scorm) throw new ScormError(`Activity ${activityId} isn't a SCORM you can open. Take the id of a SCORM activity (module "scorm") from the course structure.`);
  const scoId = options.scoId ?? facts.scoId;
  if (scoId === undefined) throw new ScormError(`SCORM ${activityId} can't be entered: Moodle offers no "Enter" on its page (closed, or no attempts left).`);

  const query = new URLSearchParams({ cm: String(activityId), scoid: String(scoId), currentorg: facts.org ?? "", mode: "normal", newattempt: options.newAttempt ? "on" : "off" });
  const tab = await browser.tab();
  await tab.goto(new URL(`mod/scorm/player.php?${query}`, siteUrl).href, { waitUntil: "domcontentloaded" });
  const html = await tab.content();
  // M.scorm_api.init(…, sesskey, scoid, attempt, mode, …): what the player opened.
  const init = /M\.scorm_api\.init\([\s\S]*?"[^"]*",\s*"?(\d+)"?,\s*"?(\d+)"?,\s*"(normal|browse|review)"/.exec(html);
  if (!init) {
    if (new URL(tab.url()).pathname.endsWith("/login/index.php")) throw new NotLoggedInError();
    throw new ScormError(`Moodle didn't open SCORM ${activityId}'s player (no attempts left, or the SCO isn't available yet).`);
  }
  const frame = await tab.waitForSelector("#scorm_object", { timeout: 30_000 }).catch(() => null);
  if (!frame) throw new ScormError(`SCORM ${activityId}'s player opened, but no SCO loaded in it.`);
  // The frame opens Moodle's loadSCO.php ("loading, please wait"), which then goes to the SCO itself.
  const sco = await frame.contentFrame();
  await sco?.waitForURL((url) => !url.pathname.endsWith("/mod/scorm/loadSCO.php"), { timeout: 30_000, waitUntil: "load" }).catch(() => undefined);
  const model = /mod\/scorm\/datamodels\/(scorm_12|scorm_13|aicc)\.js/.exec(html)?.[1];
  const version = model === "scorm_12" ? "SCORM 1.2" : model === "scorm_13" ? "SCORM 2004" : model === "aicc" ? "AICC" : undefined;
  return { attempt: Number(init[2]), scoId: Number(init[1]), ...(version ? { version } : {}), url: tab.url() };
}
