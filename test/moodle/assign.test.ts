import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readAssignmentIds, readSubmissionContent } from "../../src/moodle/assign.js";
import { launchTestBrowser } from "../../src/testing/fakeMoodle.js";
import { PANEL } from "../../src/testing/gradingPanel.js";

const browser = await launchTestBrowser();
after(() => browser?.close());


describe("readSubmissionContent", { skip: !browser && "no system browser" }, () => {
  it("reads each plugin's full content, or its summary when there's no full one, without the comments", async () => {
    const page = await browser!.newPage();
    const content = await readSubmissionContent(page, PANEL);
    await page.close();
    assert.deepEqual(content, [
      { plugin: "onlinetext", text: "First paragraph, with x = 1.\n\nSecond\nline & more.\n\n- one\n- two", files: [] },
      { plugin: "file", text: "essay.pdf", files: [{ name: "essay.pdf", url: "http://moodle.test/pluginfile.php/17/assignsubmission_file/submission_files/8/essay.pdf?forcedownload=1" }] },
      { plugin: "onlinetext", text: "Short answer.", files: [] },
    ]);
  });
});

describe("readAssignmentIds", { skip: !browser && "no system browser" }, () => {
  it("reads the grader's assignment and context ids, or nothing on another page", async () => {
    const page = await browser!.newPage();
    await page.setContent('<div class="grader" data-region="grade-panel" data-assignmentid="12" data-contextid="345"></div>');
    assert.deepEqual(await readAssignmentIds(page), { instanceId: 12, contextId: 345 });
    await page.setContent("<div>An error page</div>");
    assert.equal(await readAssignmentIds(page), undefined);
    await page.close();
  });
});
