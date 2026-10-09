import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileNameFor } from "../../src/index.js";

describe("fileNameFor", () => {
  it("takes Content-Disposition's name, else the URL's, never a path", () => {
    assert.equal(fileNameFor(new URL("http://x/pluginfile.php/1/a/b/c.pdf"), "attachment; filename*=UTF-8''informe%20final.pdf"), "informe final.pdf");
    assert.equal(fileNameFor(new URL("http://x/pluginfile.php/1/a/b/c.pdf"), 'attachment; filename="notas.docx"'), "notas.docx");
    assert.equal(fileNameFor(new URL("http://x/pluginfile.php/1/a/b/c%20d.pdf?forcedownload=1"), undefined), "c d.pdf");
    assert.equal(fileNameFor(new URL("http://x/f"), 'attachment; filename="../../evil.sh"'), "evil.sh");
    assert.equal(fileNameFor(new URL("http://x/f"), 'attachment; filename=".."'), "download");
  });
});
