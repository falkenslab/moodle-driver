import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { FormError, QuizError, gradeQuizQuestion, questionsToGrade } from "../../../src/index.js";
import { readQuestions } from "../../../src/areas/quizzes/attempts.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/**
 * A quiz (cmid 47) with an essay in slot 1 (question 28, out of 5) and attempt 9 by Ana waiting for
 * its grade, shaped like Moodle 5.2's manual grading report, results report and comment form, reduced.
 */
function fakeGrading() {
  const posted: URLSearchParams[] = [];
  let mark: string | undefined;
  const index = () =>
    `<div role="main"><table class="generaltable" id="questionstograde"><thead><tr><th>Q #</th><th>T</th><th>Question name</th><th>To grade</th><th>Already graded</th><th>Total</th></tr></thead>
<tbody><tr><td class="cell c0">1</td><td class="cell c1"><img class="icon" src="${SITE}theme/image.php/boost/qtype_essay/1/icon"></td><td class="cell c2">Essay on loops</td>
<td class="cell c3">${mark ? "0" : `1 <a class="gradetheselink" href="${SITE}mod/quiz/report.php?id=47&amp;mode=grading&amp;slot=1&amp;qid=28&amp;grade=needsgrading">Grade</a>`}</td>
<td class="cell c4">${mark ? "1" : "0"}</td><td class="cell c5 lastcol">1 <a class="gradetheselink" href="${SITE}mod/quiz/report.php?id=47&amp;mode=grading&amp;slot=1&amp;qid=28&amp;grade=all">grade all</a></td></tr></tbody></table></div>`;
  const overview = () => {
    const essay = mark ? `<span class="correct">${mark}</span>` : `<span class="requiresgrading">Requires grading</span>`;
    return `<div id="region-main"><table id="attempts"><thead><tr><th class="header c0">Select</th><th class="header c1 picture"></th><th class="header c2 bold sticky-column">Name</th><th>Status</th><th>Started</th><th>Completed</th><th>Duration</th><th class="header bold">Grade/10.00</th><th>Q. 1</th><th>Q. 2</th></tr></thead>
<tbody><tr><td><input name="attemptid[]" type="checkbox" value="9"></td><td class="cell picture"></td><td class="cell bold sticky-column"><a href="${SITE}user/view.php?id=4&amp;course=3">Ana Student</a></td><td>Finished</td><td>9 Oct</td><td>9 Oct</td><td>1 min</td>
<td class="cell bold">${mark ? "8.33" : "Not yet graded"}</td>
<td class="cell"><a href="${SITE}mod/quiz/reviewquestion.php?attempt=9&amp;slot=1"><span class="que">${essay}</span></a></td>
<td class="cell"><a href="${SITE}mod/quiz/reviewquestion.php?attempt=9&amp;slot=2"><span class="que"><span class="correct">1.00</span></span></a></td></tr></tbody></table></div>`;
  };
  const form = (error = "") =>
    `<form method="post" class="mform" id="manualgradingform" action="${SITE}mod/quiz/comment.php"><div id="question-9-1" class="que essay manualgraded complete"><div class="qtext">Explain a for loop.</div>
<div class="comment clearfix"><textarea id="q9:1_-comment_id" name="q9:1_-comment"></textarea><input type="hidden" name="q9:1_-commentformat" value="1">
<div class="felement ftext${error ? " error alert-danger" : ""}">${error ? `<span class="error">${error}</span><br>` : ""}<input type="text" name="q9:1_-mark" value=""> out of 5.00<input type="hidden" name="q9:1_-maxmark" value="5"></div></div>
<input type="hidden" name="q9:1_:sequencecheck" value="3"></div><input type="hidden" name="attempt" value="9"><input type="hidden" name="slot" value="1"><input type="hidden" name="slots" value="1"><input type="hidden" name="sesskey" value="s1">
<input id="id_submitbutton" type="submit" name="submit" value="Save"></form>`;
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/quiz/report.php**`, (route: Route) => {
      const mode = new URL(route.request().url()).searchParams.get("mode");
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-report", body: mode === "grading" ? index() : overview() }) });
    });
    await context.route(`${SITE}mod/quiz/comment.php**`, (route: Route) => {
      const page = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-comment", bodyClass: "pagelayout-popup cmid-47", body }) });
      if (new URL(route.request().url()).searchParams.get("slot") === "9") {
        return page(`<div data-rel="fatalerror"><p class="errormessage">There is no question_attempt number 9 in this attempt.</p></div>`);
      }
      if (route.request().method() !== "POST") return page(form());
      const data = new URLSearchParams(route.request().postData() ?? "");
      posted.push(data);
      if (Number(data.get("q9:1_-mark")) > 5) return page(`<div class="alert alert-danger">Could not save</div>${form("This grade is outside the valid range.")}`);
      mark = Number(data.get("q9:1_-mark")).toFixed(2);
      return page(`<div class="alert alert-success">Changes saved</div>`);
    });
  };
  return { routes, posted };
}

async function open(fake: ReturnType<typeof fakeGrading>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  await fake.routes(context);
  return context;
}

describe("manual grading", { skip: !browser && "no system browser" }, () => {
  it("lists the questions waiting for grading, with their attempts", async () => {
    const context = await open(fakeGrading());
    assert.deepEqual(await questionsToGrade(context, SITE, 47), {
      quiz: { id: 47 },
      questions: [{ slot: 1, questionId: 28, name: "Essay on loops", type: "essay", toGrade: 1, graded: 0, total: 1, attempts: [{ id: 9, userId: 4, fullName: "Ana Student" }] }],
    });
    await context.close();
  });

  it("grades a question through the comment form, and gives the attempt's new grade", async () => {
    const fake = fakeGrading();
    const context = await open(fake);
    const result = await gradeQuizQuestion(context, SITE, 9, 1, { mark: 4, comment: "<p>Give an example.</p>" });
    assert.deepEqual(result, {
      changed: "Graded question 1 of attempt 9: 4 out of 5, with a comment; the attempt's grade is now 8.33.",
      attemptId: 9,
      slot: 1,
      mark: 4,
      maxMark: 5,
      grade: "8.33",
    });
    const sent = fake.posted[0]!;
    assert.deepEqual([sent.get("q9:1_-mark"), sent.get("q9:1_-comment"), sent.get("q9:1_:sequencecheck"), sent.get("submit"), sent.get("sesskey")], ["4", "<p>Give an example.</p>", "3", "1", "s1"]);
    assert.deepEqual((await questionsToGrade(context, SITE, 47)).questions[0]?.attempts, []);
    await context.close();
  });

  it("passes Moodle's error on the mark, and its refusal of a slot", async () => {
    const context = await open(fakeGrading());
    await assert.rejects(gradeQuizQuestion(context, SITE, 9, 1, { mark: 6 }), (error: Error) => error instanceof FormError && /mark: This grade is outside the valid range\.$/.test(error.message));
    await assert.rejects(gradeQuizQuestion(context, SITE, 9, 9, { mark: 1 }), (error: Error) => error instanceof QuizError && /no question_attempt number 9 in this attempt\.$/.test(error.message));
    await context.close();
  });

  it("reads a teacher's comment in a review, without its label", async () => {
    const page = await browser!.newPage();
    const que = (comment: string) =>
      `<div id="question-9-1" class="que essay manualgraded complete"><div class="info"><div class="grade">Mark 4.00 out of 5.00</div></div><div class="qtext">Explain.</div><div class="comment clearfix"><h4 class="accesshide">Comments</h4>${comment}</div></div>`;
    await page.setContent(`<body>${que("Comment: <p>Give an example.</p>")}</body>`);
    assert.deepEqual((await readQuestions(page)).map((q) => [q.mark, q.comment]), [["Mark 4.00 out of 5.00", "Give an example."]]);
    await page.close();
  });
});
