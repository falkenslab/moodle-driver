import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { NotViewableError, activityContent } from "../../../src/index.js";
import { readMedia, readTexts } from "../../../src/core/text.js";
import { readingSeconds } from "../../../src/core/pace.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

// Made-up pages shaped like Moodle 5.2's, one per content type (ids: page 5, book 6, url 7, label 8, file 9, folder 10).
/** The book's chapter pages, chained by "next" links, keyed by chapter id (none for the first). */
describe("readTexts", { skip: !browser && "no system browser" }, () => {
  it("keeps paragraphs, line breaks, lists and code, and leaves scripts out", async () => {
    const page = await browser!.newPage();
    await page.setContent(`<div class="x"><p>One <b>two</b></p><p>Three<br>four</p><ul><li>a</li><li>b</li></ul><pre>x = 1\n  y = 2</pre><script>bad()</script></div><div class="x">Second</div>`);
    assert.deepEqual(await readTexts(page, ".x"), ["One two\n\nThree\nfour\n\n- a\n- b\n\nx = 1\ny = 2", "Second"]);
    await page.close();
  });
});

describe("readMedia", { skip: !browser && "no system browser" }, () => {
  it("finds videos, audio, players and video.js sources, YouTube as watch links, once each", async () => {
    const page = await browser!.newPage();
    await page.setContent(`<div class="c"><video src="${SITE}pluginfile.php/5/mod_page/content/1/intro.mp4"></video>
<video><source src="https://cdn.example.org/a.webm" type="video/webm"></video><audio src="https://cdn.example.org/podcast.mp3"></audio>
<a href="https://youtu.be/dQw4w9WgXcQ">Lesson 2</a><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0" title="Lesson 2"></iframe>
<video data-setup-lazy='{"sources":[{"type":"video/youtube","src":"https://www.youtube.com/watch?v=abcdefghijk"}]}'></video>
<iframe src="https://player.vimeo.com/video/76979871" title="Lesson 3"></iframe><iframe src="https://h5p.example.org/embed/1"></iframe>
<a href="https://example.org/notes.pdf">Notes</a></div><div class="other"><video src="https://example.org/skip.mp4"></video></div>`);
    assert.deepEqual(
      (await readMedia(page, ".c")).map((m) => [m.kind, m.url]),
      [
        ["video", `${SITE}pluginfile.php/5/mod_page/content/1/intro.mp4`],
        ["video", "https://cdn.example.org/a.webm"],
        ["audio", "https://cdn.example.org/podcast.mp3"],
        ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
        ["youtube", "https://www.youtube.com/watch?v=abcdefghijk"],
        ["vimeo", "https://player.vimeo.com/video/76979871"],
        ["embed", "https://h5p.example.org/embed/1"],
      ],
    );
    await page.close();
  });
});

describe("readingSeconds", () => {
  it("is about 240 words a minute, between 3 and 90 seconds", () => {
    assert.equal(readingSeconds("word ".repeat(120)), 30);
    assert.equal(readingSeconds("short"), 3);
    assert.equal(readingSeconds("word ".repeat(10_000)), 90);
  });
});


describe("activityContent", { skip: !browser && "no system browser" }, () => {
  // Made-up pages shaped like Moodle 5.2's, one per content type (ids: page 5, book 6, url 7, label 8, file 9, folder 10).
  const BODIES: Record<string, string> = {
    "/mod/page/view.php": `<div id="region-main"><div class="box generalbox"><h3>Loops</h3><p>A loop repeats.</p><ul><li>for</li><li>while</li></ul></div></div>`,
    "/mod/url/view.php": `<div id="region-main"><div class="urlworkaround">Click on <a href="https://docs.example.org/tutorial">Docs</a> to open the resource.</div></div>`,
    "/mod/resource/view.php": `<div id="region-main"><div class="resourceworkaround">Click <a href="${SITE}pluginfile.php/35/mod_resource/content/0/brief.txt">brief.txt</a> link.</div></div>`,
    "/mod/folder/view.php": `<div id="region-main"><div class="foldertree"><a href="${SITE}pluginfile.php/36/mod_folder/content/0/a.py?forcedownload=1">a.py</a><a href="${SITE}pluginfile.php/36/mod_folder/content/0/b.py?forcedownload=1">b.py</a></div></div>`,
    "/mod/label/view.php": `<ul><li data-for="cmitem" data-id="8"><div class="activity-altcontent"><p><strong>Note:</strong> due Friday.</p></div></li></ul>`,
    "/mod/book/tool/print/index.php": `<div class="book_chapter" id="ch2"><h2>1. Parameters</h2><p>They take values.</p></div><div class="book_chapter" id="ch1"><h2>2. Defining</h2><p>Use def.</p></div>`,
  };

  /** The book's chapter pages, chained by "next" links, keyed by chapter id (none for the first). */
  function bookPage(chapterId: string | null): string {
    const chapters: Record<string, { title: string; text: string; next?: string }> = {
      first: { title: "1. Parameters", text: "They take values.", next: "2" },
      "2": { title: "2. Defining", text: "Use def." },
    };
    const chapter = chapters[chapterId ?? "first"]!;
    const next = chapter.next ? `<a class="btn btn-link btn-next" href="${SITE}mod/book/view.php?id=6&chapterid=${chapter.next}">Next</a>` : "";
    return `<div id="region-main"><div class="box generalbox book_content"><h3>${chapter.title}</h3><p>${chapter.text}</p></div>${next}</div>`;
  }

  async function site(bodies = BODIES): Promise<BrowserContext> {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "S" }, bodies });
    // The book's view page depends on its chapter id, which the fake's per-path bodies can't express.
    await context.route(`${SITE}mod/book/view.php**`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body: bookPage(new URL(route.request().url()).searchParams.get("chapterid")) }) }),
    );
    return context;
  }
  const fast = { trail: "fast" } as const;

  it("reads every content type fast, the book from its print page", async () => {
    const context = await site();
    const page = await activityContent(context, SITE, 5, "page", fast);
    assert.deepEqual([page.text, page.trail, page.readingSeconds], ["Loops\n\nA loop repeats.\n\n- for\n- while", "fast", undefined]);
    assert.deepEqual((await activityContent(context, SITE, 6, "book", fast)).chapters, [
      { title: "1. Parameters", text: "They take values." },
      { title: "2. Defining", text: "Use def." },
    ]);
    assert.equal((await activityContent(context, SITE, 7, "url", fast)).url, "https://docs.example.org/tutorial");
    assert.equal((await activityContent(context, SITE, 8, "label", fast)).text, "Note: due Friday.");
    assert.deepEqual((await activityContent(context, SITE, 9, "resource", fast)).files, [{ name: "brief.txt", url: `${SITE}pluginfile.php/35/mod_resource/content/0/brief.txt` }]);
    assert.deepEqual((await activityContent(context, SITE, 10, "folder", fast)).files?.map((f) => f.name), ["a.py", "b.py"]);
    await context.close();
  });

  it("reads a book chapter by chapter with the realistic trail, pausing to read", async () => {
    const context = await site();
    const progress: number[] = [];
    const book = await activityContent(context, SITE, 6, "book", { onProgress: (seconds) => progress.push(seconds) });
    assert.deepEqual(book.chapters, [
      { title: "1. Parameters", text: "They take values." },
      { title: "2. Defining", text: "Use def." },
    ]);
    assert.deepEqual([book.trail, book.readingSeconds, progress.at(-1)], ["realistic", 6, 6]);
    await context.close();
  });

  it("refuses an activity of another type", async () => {
    // Moodle answers a module of another type with an error page, without the folder's tree.
    const context = await site({ ...BODIES, "/mod/folder/view.php": `<div id="region-main"><p>Invalid course module ID</p></div>` });
    await assert.rejects(activityContent(context, SITE, 5, "folder", fast), (error: unknown) => error instanceof NotViewableError && /isn't a folder you can view/.test(error.message));
    await context.close();
  });
});
