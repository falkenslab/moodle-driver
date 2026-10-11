// An H5P activity's content type and the person's attempts. Playing it happens in its iframes, on
// the browser's working tab (ADR-007): the driver only reads what it is and how the person did.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { openSitePage } from "../../core/session.js";
import { decodeEntities } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

/** The activity isn't an H5P activity the person can open. */
export class NotAnH5PActivityError extends MoodleError {
  override name = "NotAnH5PActivityError";
  constructor(message: string) {
    super(message, "not-an-h5p-activity");
  }
}

/** One of the person's attempts at an H5P activity, with its score where Moodle tracks it. */
export interface H5PAttempt {
  /** Moodle's id for the attempt (its report's), and its number for the person. */
  id?: number;
  number: number;
  score?: number;
  maxScore?: number;
  completed?: boolean;
  passed?: boolean;
}

/** An H5P activity as the person sees it (`h5pActivity`). */
export interface H5PActivity {
  id: number;
  name: string;
  /** The H5P library ("H5P.MultiChoice") and its version, from the content's player. */
  contentType?: { library: string; version: string };
  /** Whether Moodle records attempts and scores (the activity's tracking setting). */
  tracked: boolean;
  /** The person's own attempts, oldest first: a teacher's report lists participants instead, so none. */
  attempts: H5PAttempt[];
}

/** The rows of the person's "all attempts" table: positions fixed by Moodle's template, icons by class. */
export function readH5PAttempts(page: Page): Promise<H5PAttempt[]> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      className: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El>;
      childNodes: ArrayLike<{ nodeType: number; textContent: string | null }>;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    // The page shows the scored attempt's table first and every attempt's last.
    const tables = Array.from(doc.querySelectorAll("#region-main table")).filter((table) => table.querySelector('a[href*="attemptid="]'));
    const all = tables[tables.length - 1];
    if (!all) return [];
    // An attempt row starts with its number; a teacher's participants table has names there.
    const rows = Array.from(all.querySelectorAll("tbody tr")).filter((row) => /^\d+$/.test((row.querySelector("th")?.textContent ?? "").trim()) && row.querySelectorAll("td").length >= 6);
    return rows.map((row) => {
      const cells = Array.from(row.querySelectorAll("td"));
      // The score cell starts with the raw score; a hidden " / max" follows for small screens.
      const raw = Array.from(cells[1]?.childNodes ?? [])
        .filter((node) => node.nodeType === 3)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      const max = (cells[2]?.textContent ?? "").trim();
      const completion = cells[4]?.querySelector("img, i");
      const success = cells[5]?.querySelector("i, img");
      const mark = (icon: El | null | undefined) => {
        if (!icon) return undefined;
        const look = `${icon.className} ${icon.getAttribute("src") ?? ""}`;
        return /check|-y\b|completion-[a-z]+-y/.test(look) ? true : /circle|-n\b/.test(look) ? false : undefined;
      };
      const link = row.querySelector('a[href*="attemptid="]')?.getAttribute("href") ?? "";
      return {
        ...(/attemptid=(\d+)/.test(link) ? { id: Number(/attemptid=(\d+)/.exec(link)![1]) } : {}),
        number: Number((row.querySelector("th")?.textContent ?? "").trim()),
        ...(raw !== "" && !Number.isNaN(Number(raw)) ? { score: Number(raw) } : {}),
        ...(max !== "" && !Number.isNaN(Number(max)) ? { maxScore: Number(max) } : {}),
        ...(mark(completion) !== undefined ? { completed: mark(completion) } : {}),
        ...(mark(success) !== undefined ? { passed: mark(success) } : {}),
      } as H5PAttempt;
    });
  }, null);
}

/** An H5P activity: its content type, whether attempts are tracked, and the person's attempts with their scores. */
export async function h5pActivity(context: BrowserContext, siteUrl: string, activityId: number): Promise<H5PActivity> {
  const page = await openSitePage(context, siteUrl, `mod/h5pactivity/view.php?id=${activityId}`);
  let facts: { name: string; player?: string; tracked: boolean };
  try {
    if ((await page.locator("body#page-mod-h5pactivity-view").count()) === 0) {
      throw new NotAnH5PActivityError(`Activity ${activityId} isn't an H5P activity you can open. Take the id of an H5P activity (module "h5pactivity") from the course structure.`);
    }
    facts = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document;
      return {
        name: doc.querySelector("[data-activityname]")?.getAttribute("data-activityname") ?? "",
        player: doc.querySelector("iframe.h5p-player")?.getAttribute("src") ?? undefined,
        // The attempts report is linked only where Moodle tracks attempts.
        tracked: doc.querySelector('a[href*="/mod/h5pactivity/report.php"]') !== null,
      };
    });
  } finally {
    await page.close().catch(() => undefined);
  }

  const activity: H5PActivity = { id: activityId, name: decodeEntities(facts.name), tracked: facts.tracked, attempts: [] };
  if (facts.player) {
    // The player page names the content's main library in its H5P settings, before any script runs.
    const player = await context.newPage();
    let html = "";
    try {
      await player.goto(new URL(facts.player, siteUrl).href, { waitUntil: "domcontentloaded" });
      html = await player.content();
    } catch {
      // No player to read: the content type stays unknown.
    } finally {
      await player.close().catch(() => undefined);
    }
    const library = /"library":"([^"\s]+) (\d+\.\d+)"/.exec(html);
    if (library) activity.contentType = { library: library[1]!, version: library[2]! };
  }
  if (facts.tracked) {
    const report = await openSitePage(context, siteUrl, `mod/h5pactivity/report.php?id=${activityId}`);
    try {
      activity.attempts = (await readH5PAttempts(report)).sort((a, b) => a.number - b.number);
    } finally {
      await report.close().catch(() => undefined);
    }
  }
  return activity;
}
