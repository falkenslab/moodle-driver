import type { Page } from "playwright-core";
import { inPage } from "./inPage.js";

/** Moodle formats names for HTML (`format_string`): plain text for the client. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[lower] ?? entity;
  });
}

/**
 * The text of the elements matching `selector` in `page`, one string each: paragraphs, line breaks
 * and list items kept, scripts and styles left out. Runs in the page with no named functions inside
 * (see the conventions on page.evaluate).
 */
export function readTexts(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    interface Node {
      nodeType: number;
      nodeName: string;
      textContent: string | null;
      childNodes: ArrayLike<Node>;
    }
    const doc = globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<Node> } };
    const BLOCKS = new Set(["P", "DIV", "LI", "UL", "OL", "TR", "TABLE", "PRE", "BLOCKQUOTE", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6"]);
    return Array.from(doc.document.querySelectorAll(selector)).map((root) => {
      let raw = "";
      const stack: (Node | string)[] = [root];
      while (stack.length > 0) {
        const item = stack.pop()!;
        if (typeof item === "string") raw += item;
        else if (item.nodeType === 3) raw += (item.textContent ?? "").replace(/\s+/g, " ");
        else if (item.nodeType !== 1 || item.nodeName === "SCRIPT" || item.nodeName === "STYLE") continue;
        else if (item.nodeName === "BR") raw += "\n";
        else if (item.nodeName === "PRE") raw += `\n${item.textContent ?? ""}\n`;
        else {
          const isBlock = BLOCKS.has(item.nodeName);
          raw += item.nodeName === "LI" ? "\n- " : isBlock ? "\n" : "";
          // A list item ends where the next one starts: no blank line between items.
          stack.push(isBlock && item.nodeName !== "LI" ? "\n" : "", ...Array.from(item.childNodes).reverse());
        }
      }
      return raw
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/\n- +/g, "\n- ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    });
  }, selector);
}

/** A video, audio or player found in a page's content. */
export interface MediaItem {
  kind: "video" | "audio" | "youtube" | "vimeo" | "embed";
  url: string;
  title?: string;
}

/**
 * The media in the elements matching `selector`: `<video>`/`<audio>` and their sources, players in
 * iframes, video.js's `data-setup` sources (Moodle's media filter turns a YouTube link into one), and
 * plain links to media. YouTube URLs come back as `watch?v=` links. Read in the page.
 */
export function readMedia(page: Page, selector: string): Promise<MediaItem[]> {
  return inPage(
    page,
    (selector: string) => {
      interface El {
        tagName: string;
        title: string;
        getAttribute(name: string): string | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const roots = Array.from((globalThis as unknown as { document: El }).document.querySelectorAll(selector));
      const found = new Map<string, MediaItem>();
      const add = (raw: string | null | undefined, tag: string, title?: string | null) => {
        if (!raw || raw.startsWith("blob:") || raw.startsWith("data:")) return;
        let url: URL;
        try {
          url = new URL(raw, (globalThis as unknown as { location: { href: string } }).location.href);
        } catch {
          return;
        }
        const youtube = /(?:youtube(?:-nocookie)?\.com\/(?:embed\/|watch\?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url.href)?.[1];
        let kind: MediaItem["kind"];
        let href = url.href;
        if (youtube) {
          kind = "youtube";
          href = `https://www.youtube.com/watch?v=${youtube}`;
        } else if (/vimeo\.com\//.test(url.href)) kind = "vimeo";
        else if (tag === "AUDIO" || /\.(mp3|ogg|oga|wav|m4a|aac)(\?|$)/i.test(url.pathname)) kind = "audio";
        else if (tag === "VIDEO" || /\.(mp4|webm|m4v|mov|ogv|m3u8)(\?|$)/i.test(url.pathname)) kind = "video";
        else if (tag === "IFRAME") kind = "embed";
        else return;
        if (!found.has(href)) found.set(href, { kind, url: href, ...(title ? { title } : {}) });
      };
      for (const root of roots) {
        for (const el of Array.from(root.querySelectorAll("video, audio, source, iframe, a[href]"))) {
          const media = el.tagName === "SOURCE" ? "VIDEO" : el.tagName;
          add(el.getAttribute("src") ?? el.getAttribute("href"), media, el.getAttribute("title"));
          for (const attribute of ["data-setup-lazy", "data-setup"]) {
            const setup = el.getAttribute(attribute);
            if (!setup) continue;
            try {
              for (const source of (JSON.parse(setup) as { sources?: { src?: string }[] }).sources ?? []) add(source.src, "VIDEO", el.getAttribute("title"));
            } catch {
              // Not JSON: nothing to read.
            }
          }
        }
      }
      return Array.from(found.values());
    },
    selector,
  );
}
