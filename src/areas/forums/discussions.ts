import type { BrowserContext, Page } from "playwright-core";
import { MoodleServiceError, callService } from "../../core/ajax.js";
import { openSitePage } from "../../core/session.js";
import { readTexts } from "../../core/text.js";

/** The id isn't a forum's course module, or the person can't see it. */
export class NotAForumError extends Error {
  override name = "NotAForumError";
}

/** A discussion as the forum page lists it. */
export interface DiscussionRow {
  id: number;
  subject: string;
  author: string;
  started?: number;
  lastPost: { author: string; time?: number; postId?: number };
  replies: number;
  locked: boolean;
  pinned: boolean;
  /** The forum's instance id, which the forum's services take. */
  forumId?: number;
}

// The page size asked for; the forum pages until a page brings no new discussions.
const PAGE_SIZE = 100;
const MAX_PAGES = 50;

/** The discussions on a forum page, read by structure: data attributes, links, timestamps. */
export function readDiscussionRows(page: Page): Promise<DiscussionRow[]> {
  return page.evaluate(() => {
    interface Element {
      className: string;
      getAttribute(name: string): string | null;
      hasAttribute(name: string): boolean;
      querySelector(selector: string): Element | null;
      querySelectorAll(selector: string): ArrayLike<Element>;
      closest(selector: string): Element | null;
      textContent: string | null;
    }
    const doc = (globalThis as unknown as { document: Element }).document;
    return Array.from(doc.querySelectorAll('tr[data-region="discussion-list-item"][data-discussionid]')).map((row) => {
      const times = Array.from(row.querySelectorAll("time[data-timestamp]"));
      // A person's cell is their name followed by the time: the name is the text before it.
      // (An anonymous callback, not a named helper: see the conventions on page.evaluate.)
      const [startedBy, lastBy] = [times[0], times[1]].map((time) => {
        const all = (time?.closest("td")?.textContent ?? "").replace(/\s+/g, " ").trim();
        const when = (time?.textContent ?? "").replace(/\s+/g, " ").trim();
        return when && all.endsWith(when) ? all.slice(0, all.length - when.length).trim() : all;
      });
      const lastLink = times[1]?.closest("a");
      const parent = lastLink ? new URL(lastLink.getAttribute("href") ?? "", "http://x/").searchParams.get("parent") : null;
      const repliesCell = Array.from(row.querySelectorAll("td")).find((cell) => /^\d+$/.test((cell.textContent ?? "").trim()) && !cell.querySelector("a"));
      const locked = row.querySelector('[data-region="locked-label"]');
      return {
        id: Number(row.getAttribute("data-discussionid")),
        subject: (row.querySelector('a[href*="discuss.php?d="]')?.textContent ?? "").replace(/\s+/g, " ").trim(),
        author: startedBy ?? "",
        started: times[0] ? Number(times[0].getAttribute("data-timestamp")) : undefined,
        lastPost: { author: lastBy ?? "", time: times[1] ? Number(times[1].getAttribute("data-timestamp")) : undefined, postId: parent ? Number(parent) : undefined },
        replies: Number((repliesCell?.textContent ?? "0").trim()),
        locked: locked !== null && !locked.hasAttribute("hidden"),
        pinned: /\bpinned\b/.test(row.className),
        forumId: Number(row.getAttribute("data-forumid")) || undefined,
      };
    });
  });
}

/** Every discussion of a forum (its course module id), through all its pages. */
export async function listDiscussions(context: BrowserContext, siteUrl: string, forumCmid: number): Promise<DiscussionRow[]> {
  const all = new Map<number, DiscussionRow>();
  for (let p = 0; p < MAX_PAGES; p++) {
    const page = await openSitePage(context, siteUrl, `mod/forum/view.php?id=${forumCmid}&s=${PAGE_SIZE}&p=${p}`);
    try {
      // The body id names the page in any language.
      if ((await page.locator("body#page-mod-forum-view").count()) === 0) {
        throw new NotAForumError(`Activity ${forumCmid} isn't a forum you can view. Take the id of a forum (module "forum") from the course structure.`);
      }
      const rows = await readDiscussionRows(page);
      const before = all.size;
      for (const row of rows) all.set(row.id, row);
      if (rows.length < PAGE_SIZE || all.size === before) break;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return Array.from(all.values());
}

/** A post as `mod_forum_get_discussion_posts` returns it (Moodle 5.2), the fields read. */
export interface MoodlePost {
  id: number;
  subject: string;
  message: string;
  author: { id: number; fullname: string };
  parentid: number | null;
  timecreated: number;
  timemodified?: number;
  isprivatereply?: boolean;
  unread?: boolean | null;
  attachments?: { filename: string; url?: string; fileurl?: string }[];
}

export async function discussionPosts(context: BrowserContext, siteUrl: string, discussionId: number): Promise<{ posts: MoodlePost[]; forumid: number; courseid: number }> {
  try {
    return await callService(context, siteUrl, "mod_forum_get_discussion_posts", { discussionid: discussionId, sortby: "created", sortdirection: "ASC", includeinlineattachments: false });
  } catch (error) {
    // A missing discussion fails inside Moodle with a PHP error (confirmed empirically, 5.2).
    if (error instanceof MoodleServiceError && error.errorcode === "generalexceptionmessage") {
      throw new NotAForumError(`Discussion ${discussionId} doesn't exist or you can't see it. Take its id from the forum's discussions. (${error.message})`);
    }
    throw error;
  }
}

/** Plain text of Moodle-cleaned HTML fragments, parsed in a blank tab. */
export async function htmlToTexts(context: BrowserContext, fragments: string[]): Promise<string[]> {
  if (fragments.length === 0) return [];
  const page = await context.newPage();
  try {
    await page.setContent(fragments.map((html) => `<div class="driver-fragment">${html}</div>`).join(""));
    return await readTexts(page, "body > .driver-fragment");
  } finally {
    await page.close().catch(() => undefined);
  }
}


/** A forum's instance id (what `post.php?forum=` takes), from its page. */
export async function forumInstanceId(context: BrowserContext, siteUrl: string, forumCmid: number): Promise<number> {
  const page = await openSitePage(context, siteUrl, `mod/forum/view.php?id=${forumCmid}`);
  try {
    if ((await page.locator("body#page-mod-forum-view").count()) === 0) {
      throw new NotAForumError(`Activity ${forumCmid} isn't a forum you can view. Take the id of a forum (module "forum") from the course structure.`);
    }
    // The page's quick "new discussion" form carries it (also on an empty forum); discussion rows too.
    const id = await page.evaluate(() => {
      const doc = (globalThis as unknown as {
        document: { querySelector(s: string): { value: string } | null; querySelectorAll(s: string): ArrayLike<{ getAttribute(n: string): string | null }> };
      }).document;
      const fromForm = Number(doc.querySelector('form[action*="post.php"] [name="forum"]')?.value);
      if (fromForm > 0) return fromForm;
      return Array.from(doc.querySelectorAll("[data-forumid]"))
        .map((element) => Number(element.getAttribute("data-forumid")))
        .find((value) => value > 0);
    });
    if (!id) throw new NotAForumError(`Forum ${forumCmid}'s page doesn't say its id; you may not be allowed to post there.`);
    return id;
  } finally {
    await page.close().catch(() => undefined);
  }
}
