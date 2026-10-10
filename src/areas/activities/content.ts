// A content activity read as a person would, so Moodle logs the view (ADR-005 for the trail).
import type { BrowserContext, Page } from "playwright-core";
import type { Trail } from "../../options.js";
import { pause, readingSeconds } from "../../core/pace.js";
import { openSitePage } from "../../core/session.js";
import { readMedia, readTexts, type MediaItem } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

export const CONTENT_TYPES = ["page", "book", "label", "url", "resource", "folder"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

// A book has a reasonable number of chapters; the bound stops a loop on a broken "next" link.
const MAX_CHAPTERS = 200;

/** The activity isn't of the given type, or the person can't view it. */
export class NotViewableError extends MoodleError {
  override name = "NotViewableError";
  constructor(message: string) {
    super(message, "not-viewable");
  }
}

export interface ActivityContent {
  activity: { id: number; type: ContentType };
  /** Page and label content, as plain text with paragraphs and lists kept. */
  text?: string;
  /** A book's chapters, in order. */
  chapters?: { title: string; text: string }[];
  /** Videos, audio and players in a page's, label's or book's content. */
  media?: MediaItem[];
  /** A URL resource's target. */
  url?: string;
  /** A file resource's or a folder's files. */
  files?: { name: string; url: string }[];
  trail: Trail;
  /** With the realistic trail, the time spent reading. */
  readingSeconds?: number;
}

async function links(page: Page, selector: string): Promise<{ name: string; url: string }[]> {
  return page.evaluate((selector) => {
    const anchors = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null; href: string }> } }).document.querySelectorAll(
      selector,
    );
    return Array.from(anchors).map((a) => ({ name: (a.textContent ?? "").replace(/\s+/g, " ").trim(), url: a.href }));
  }, selector);
}

/** A book chapter's title and text, the title taken off the text's start. */
function chapter(title: string, body: string): { title: string; text: string } {
  return { title, text: body.startsWith(title) ? body.slice(title.length).trim() : body };
}

/**
 * Reads a page's or label's text, a book's chapters, a URL resource's target, or a file resource's
 * or folder's files. With the realistic trail, page by page at a reader's pace, calling `onProgress`
 * with the seconds read so far while it pauses. Takes an activity as the course structure gives it
 * (`{ id, type }`), or its id and module.
 */
export function activityContent(context: BrowserContext, siteUrl: string, activity: { id: number; type: string }, options?: ContentOptions): Promise<ActivityContent>;
export function activityContent(context: BrowserContext, siteUrl: string, activityId: number, type: ContentType, options?: ContentOptions): Promise<ActivityContent>;
export async function activityContent(
  context: BrowserContext,
  siteUrl: string,
  activityOrId: { id: number; type: string } | number,
  typeOrOptions?: ContentType | ContentOptions,
  options?: ContentOptions,
): Promise<ActivityContent> {
  if (typeof activityOrId === "number") return readContent(context, siteUrl, activityOrId, typeOrOptions as ContentType, options);
  const { id, type } = activityOrId;
  if (!(CONTENT_TYPES as readonly string[]).includes(type)) {
    throw new NotViewableError(`Activity ${id} is a ${type}: activityContent reads ${CONTENT_TYPES.join(", ")}.`);
  }
  return readContent(context, siteUrl, id, type as ContentType, typeOrOptions as ContentOptions | undefined);
}

/** How `activityContent` reads: at a person's pace (`realistic`, the default) or at once. */
export interface ContentOptions {
  trail?: Trail;
  /** While pausing on the realistic trail, the seconds read so far. */
  onProgress?: (secondsRead: number) => void;
}

async function readContent(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  type: ContentType,
  { trail = "realistic", onProgress }: ContentOptions = {},
): Promise<ActivityContent> {
  const realistic = trail === "realistic";
  const output: ActivityContent = { activity: { id: activityId, type }, trail };
  let secondsRead = 0;
  const readAsAPerson = async (text: string) => {
    if (!realistic) return;
    const seconds = readingSeconds(text);
    await pause(seconds, (elapsed) => onProgress?.(secondsRead + elapsed));
    secondsRead += seconds;
  };

  // Opens the activity's page and checks it shows what this type should.
  const view = async (path: string, ready: string): Promise<Page> => {
    const page = await openSitePage(context, siteUrl, path);
    if ((await page.locator(ready).count()) === 0) {
      await page.close().catch(() => undefined);
      throw new NotViewableError(`Activity ${activityId} isn't a ${type} you can view. Take its id and module from the course structure.`);
    }
    return page;
  };

  if (type === "page" || type === "label") {
    const path = type === "page" ? `mod/page/view.php?id=${activityId}` : `mod/label/view.php?id=${activityId}`;
    const selector = type === "page" ? "#region-main .generalbox" : `[data-for="cmitem"][data-id="${activityId}"] .activity-altcontent`;
    const page = await view(path, selector);
    output.text = (await readTexts(page, selector))[0] ?? "";
    output.media = await readMedia(page, selector);
    await page.close();
    await readAsAPerson(output.text);
  } else if (type === "book") {
    output.chapters = [];
    const media: MediaItem[] = [];
    if (realistic) {
      // Chapter by chapter, following "next", as a reader does.
      const page = await view(`mod/book/view.php?id=${activityId}`, "#region-main .book_content");
      try {
        for (let i = 0; i < MAX_CHAPTERS; i++) {
          const title = (await readTexts(page, "#region-main .book_content h3, #region-main .book_content h2"))[0] ?? "";
          const read = chapter(title, (await readTexts(page, "#region-main .book_content"))[0] ?? "");
          output.chapters.push(read);
          media.push(...(await readMedia(page, "#region-main .book_content")));
          await readAsAPerson(read.text);
          const next = page.locator("#region-main a.btn-next").first();
          if ((await next.count()) === 0) break;
          await page.goto((await next.getAttribute("href"))!, { waitUntil: "domcontentloaded" });
        }
      } finally {
        await page.close().catch(() => undefined);
      }
    } else {
      const page = await view(`mod/book/tool/print/index.php?id=${activityId}`, ".book_chapter");
      const titles = await readTexts(page, ".book_chapter h2, .book_chapter h3");
      const bodies = await readTexts(page, ".book_chapter");
      output.chapters = bodies.map((body, i) => chapter(titles[i] ?? "", body));
      media.push(...(await readMedia(page, ".book_chapter")));
      await page.close();
    }
    // The same video can appear in several chapters: once each.
    output.media = [...new Map(media.map((item) => [item.url, item])).values()];
  } else if (type === "url") {
    // forceview logs the view and shows the link instead of leaving the site.
    const page = await view(`mod/url/view.php?id=${activityId}&forceview=1`, ".urlworkaround a");
    output.url = (await links(page, ".urlworkaround a"))[0]?.url;
    await page.close();
  } else {
    const [path, selector] =
      type === "resource" ? [`mod/resource/view.php?id=${activityId}&forceview=1`, ".resourceworkaround a"] : [`mod/folder/view.php?id=${activityId}`, '.foldertree a[href*="pluginfile.php"]'];
    const page = await view(path, selector);
    output.files = await links(page, selector);
    await page.close();
  }

  if (secondsRead > 0) output.readingSeconds = secondsRead;
  return output;
}
