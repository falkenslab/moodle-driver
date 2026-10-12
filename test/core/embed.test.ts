import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { checkEmbeds, localNames } from "../../src/core/embed.js";

let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-embed-"));
  await writeFile(path.join(dir, "shot.png"), "PNG");
  await writeFile(path.join(dir, "my notes.pdf"), "PDF");
  await mkdir(path.join(dir, "other"));
  await writeFile(path.join(dir, "other", "shot.png"), "PNG");
});
after(() => rm(dir, { recursive: true, force: true }));

describe("localNames", () => {
  it("takes the src and href that name a file, not URLs, the site's paths, anchors or Moodle's own", () => {
    const html = `<img src="shot.png"><a href='my%20notes.pdf'>notes</a><a href="https://moodle.org/x.png">x</a><a href="/mod/page/view.php">p</a><a href="#top">top</a><a href="mailto:a@b.c">m</a><img src="@@PLUGINFILE@@/old.png"><a href="a&amp;b.txt">ab</a>`;
    assert.deepEqual(localNames(html), ["shot.png", "my notes.pdf", "a&b.txt"]);
  });
});

describe("checkEmbeds", () => {
  it("accepts files the texts name, in any of them", async () => {
    await checkEmbeds(['<img src="shot.png">', undefined, '<a href="my notes.pdf">notes</a>'], [path.join(dir, "shot.png"), path.join(dir, "my notes.pdf")]);
  });

  it("refuses a file no text names, a name with no file, two files of one name, and relative paths", async () => {
    const shot = path.join(dir, "shot.png");
    await assert.rejects(checkEmbeds(["<p>None</p>"], [shot]), { code: "invalid-input", message: /No text uses "shot\.png"/ });
    await assert.rejects(checkEmbeds([undefined], [shot]), { code: "invalid-input" });
    await assert.rejects(checkEmbeds(['<img src="shot.png"><img src="dot.png">'], [shot]), { code: "invalid-input", message: /uses "dot\.png"/ });
    await assert.rejects(checkEmbeds(['<img src="shot.png">'], [shot, path.join(dir, "other", "shot.png")]), { code: "invalid-input", message: /same name: shot\.png/ });
    await assert.rejects(checkEmbeds(['<img src="shot.png">'], ["shot.png"]), /absolute paths/);
  });
});
