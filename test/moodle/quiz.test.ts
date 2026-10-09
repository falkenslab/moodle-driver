import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { readQuestions } from "../../src/index.js";
import { SITE, launchTestBrowser } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// A made-up quiz (cmid 26) shaped like Moodle 5.2's pages: attempt 9, two pages, three questions.
const Q1 = `<div id="question-9-1" class="que truefalse deferredfeedback STATE1"><div class="info"><span class="qno">1</span><div class="grade">Marked out of 1.00</div>
<input type="hidden" name="q9:1_:flagged" value="0"></div><div class="qtext">The answer is true.</div>
<div class="answer"><div><input type="radio" name="q9:1_answer" value="1" id="q9:1_answertrue" CHECKED1><label id="q9:1_answertrue_label"><span class="answernumber">a. </span>True</label></div>
<div><input type="radio" name="q9:1_answer" value="0" id="q9:1_answerfalse"><label id="q9:1_answerfalse_label"><span class="answernumber">b. </span>False</label></div></div>
<input type="hidden" name="q9:1_:sequencecheck" value="1"></div>`;
const Q2 = `<div id="question-9-2" class="que multichoice deferredfeedback notyetanswered"><div class="info"><span class="qno">2</span></div><div class="qtext">Which are odd?</div>
<div class="answer"><div><input type="hidden" name="q9:2_choice0" value="0"><input type="checkbox" name="q9:2_choice0" value="1" id="q9:2_choice0"><div id="q9:2_choice0_label"><span class="answernumber">1. </span>Three</div></div>
<div><input type="hidden" name="q9:2_choice1" value="0"><input type="checkbox" name="q9:2_choice1" value="1" id="q9:2_choice1"><div id="q9:2_choice1_label"><span class="answernumber">2. </span>Two</div></div></div></div>`;
const Q3 = `<div id="question-9-3" class="que match deferredfeedback notyetanswered"><div class="info"><span class="qno">3</span></div><div class="qtext">Classify. <span class="accesshide">Answer question 3</span><img src="${SITE}pluginfile.php/1/question/questiontext/1/frog.png"></div>
<table><tr><td class="text">frog</td><td><select name="q9:3_sub0"><option value="0">Choose...</option><option value="1">mammal</option><option value="2">amphibian</option></select></td></tr></table>
<input type="text" name="q9:3_notes" value=""></div>`;


describe("readQuestions", { skip: !browser && "no system browser" }, () => {
  it("reads slots, types, states, text and fields with their options, without screen-reader text", async () => {
    const page = await browser!.newPage();
    await page.setContent(`<body>${Q1.replace("STATE1", "notyetanswered").replace("CHECKED1", "")}${Q2}${Q3}</body>`);
    const [q1, q2, q3] = await readQuestions(page);
    assert.deepEqual([q1?.slot, q1?.type, q1?.state, q1?.text], [1, "truefalse", "notyetanswered", "The answer is true."]);
    assert.deepEqual(q1?.fields, [{ name: "q9:1_answer", kind: "choice", options: [{ value: "1", label: "True" }, { value: "0", label: "False" }] }]);
    assert.deepEqual(q2?.fields.map((f) => [f.name, f.kind, f.label, f.value]), [
      ["q9:2_choice0", "checkbox", "Three", "0"],
      ["q9:2_choice1", "checkbox", "Two", "0"],
    ]);
    assert.equal(q3?.text, "Classify.");
    assert.deepEqual(q3?.images, [`${SITE}pluginfile.php/1/question/questiontext/1/frog.png`]);
    assert.deepEqual(q3?.fields[0], { name: "q9:3_sub0", kind: "select", label: "frog", options: [{ value: "0", label: "Choose..." }, { value: "1", label: "mammal" }, { value: "2", label: "amphibian" }], value: "0" });
    assert.deepEqual(JSON.parse(JSON.stringify(q3?.fields[1])), { name: "q9:3_notes", kind: "text" });
    await page.close();
  });
});
