import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NotLoggedInError, downloadFile, fileNameFor } from "../../src/index.js";
import { launchTestBrowser } from "../../src/testing/index.js";

describe("fileNameFor", () => {
  it("takes Content-Disposition's name, else the URL's, never a path", () => {
    assert.equal(fileNameFor(new URL("http://x/pluginfile.php/1/a/b/c.pdf"), "attachment; filename*=UTF-8''informe%20final.pdf"), "informe final.pdf");
    assert.equal(fileNameFor(new URL("http://x/pluginfile.php/1/a/b/c.pdf"), 'attachment; filename="notas.docx"'), "notas.docx");
    assert.equal(fileNameFor(new URL("http://x/pluginfile.php/1/a/b/c%20d.pdf?forcedownload=1"), undefined), "c d.pdf");
    assert.equal(fileNameFor(new URL("http://x/f"), 'attachment; filename="../../evil.sh"'), "evil.sh");
    assert.equal(fileNameFor(new URL("http://x/f"), 'attachment; filename=".."'), "download");
  });
});

const browser = await launchTestBrowser();
let site: Server;
let origin: string;
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-download-"));
  // A made-up site: a file with a Content-Disposition, one without, a protected one, a missing one.
  site = createServer((request, response) => {
    if (request.url === "/pluginfile.php/1/mod_resource/content/0/brief.txt") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": "inline; filename*=UTF-8''enunciado%20final.txt" });
      return response.end("Write a program.\n");
    }
    if (request.url === "/media/lesson.mp4") {
      response.writeHead(200, { "Content-Type": "video/mp4" });
      return response.end("mp4");
    }
    if (request.url === "/pluginfile.php/2/mod_folder/content/0/a.py?forcedownload=1") {
      response.writeHead(200, { "Content-Type": "text/x-python" });
      return response.end("print('a')\n");
    }
    if (request.url?.startsWith("/pluginfile.php/3/")) {
      response.writeHead(303, { Location: "/login/index.php" });
      return response.end();
    }
    if (request.url === "/login/index.php") {
      response.writeHead(200, { "Content-Type": "text/html" });
      return response.end("<html>Log in</html>");
    }
    response.writeHead(404, { "Content-Type": "text/html" });
    response.end("Not found");
  });
  await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}/`;
});
after(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

describe("downloadFile", { skip: !browser && "no system browser" }, () => {
  it("saves the site's files without overwriting, its media outside Moodle's path included", async () => {
    const context = await browser!.newContext();
    const brief = `${origin}pluginfile.php/1/mod_resource/content/0/brief.txt`;
    const first = await downloadFile(context, origin, brief, dir);
    assert.deepEqual([first.name, first.size, first.contentType], ["enunciado final.txt", 17, "text/plain"]);
    assert.equal(first.path, path.join(dir, "enunciado final.txt"));
    assert.equal(await readFile(first.path, "utf8"), "Write a program.\n");
    assert.equal((await downloadFile(context, origin, brief, dir)).name, "enunciado final (2).txt");
    assert.equal((await downloadFile(context, origin, `${origin}pluginfile.php/2/mod_folder/content/0/a.py?forcedownload=1`, dir)).name, "a.py");
    assert.equal((await downloadFile(context, origin, `${origin}media/lesson.mp4`, dir)).name, "lesson.mp4");
    await context.close();
  });

  it("refuses other sites and relative folders, and explains what it can't fetch", async () => {
    const context = await browser!.newContext();
    await assert.rejects(downloadFile(context, origin, "https://example.org/x.pdf", dir), /isn't the site/);
    await assert.rejects(downloadFile(context, origin, `${origin}media/lesson.mp4`, "downloads"), /absolute path/);
    await assert.rejects(downloadFile(context, origin, `${origin}pluginfile.php/3/private.pdf`, dir), NotLoggedInError);
    await assert.rejects(downloadFile(context, origin, `${origin}pluginfile.php/9/missing.txt`, dir), /answered 404/);
    await context.close();
  });
});
