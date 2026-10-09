import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readMedia, readTexts, readingSeconds } from "../../src/index.js";
import { SITE, launchTestBrowser } from "../../src/testing/index.js";
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

