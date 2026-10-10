import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { FormError, QuizError, answerQuizQuestions, finishQuizAttempt, quizInfo, readQuestions, quizResults, readReview, setQuizOverride, startQuizAttempt } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

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

const NAV = `<div id="mod_quiz_navblock"><a class="qnbutton" id="quiznavbutton1" data-quiz-page="0"></a><a class="qnbutton" id="quiznavbutton2" data-quiz-page="0"></a><a class="qnbutton" id="quiznavbutton3" data-quiz-page="1"></a></div>`;

/** The quiz's pages, served from a state that keeps the answers saved and whether the attempt is finished. */
function fakeQuiz() {
  const saved: URLSearchParams[] = [];
  let finished = false;
  const page = (body: string, bodyId: string) => moodlePage({ userId: 4, body, bodyId });
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/quiz/**`, (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      const go = (to: string) => html(`<script>location.replace("${SITE}${to}")</script>`);
      switch (url.pathname) {
        case "/mod/quiz/view.php":
          return html(
            page(
              `<div id="region-main"><div id="intro">Practice quiz.</div><form method="post" action="${SITE}mod/quiz/startattempt.php"><input type="hidden" name="cmid" value="26"><button type="submit">Attempt quiz</button></form>
<div class="quizinfo"><p>Attempts allowed: 3</p><p>Grading method: Highest grade</p></div>
<div class="card"><table class="quizreviewsummary"><tr><th>Status</th><td>Finished</td></tr><tr><th>Grade</th><td>5.00 out of 10.00</td></tr></table><a href="${SITE}mod/quiz/review.php?attempt=8&amp;cmid=26">Review</a></div></div>`,
              "page-mod-quiz-view",
            ),
          );
        case "/mod/quiz/startattempt.php":
          return go("mod/quiz/attempt.php?attempt=9&cmid=26");
        case "/mod/quiz/attempt.php": {
          if (finished) return html(page("<p>This attempt is finished.</p>", "page-mod-quiz-attempt"));
          const p = url.searchParams.get("page") ?? "0";
          const last = saved.find((form) => form.has("q9:1_answer"));
          const q1 = Q1.replace("STATE1", last?.get("q9:1_answer") ? "answersaved" : "notyetanswered").replace("CHECKED1", last?.get("q9:1_answer") === "1" ? "checked" : "");
          const questions = p === "0" ? q1 + Q2 : Q3;
          return html(page(`<form id="responseform" method="post" action="${SITE}mod/quiz/processattempt.php?cmid=26"><input type="hidden" name="attempt" value="9">${questions}<input type="submit" name="next" value="Next page"></form>${NAV}`, "page-mod-quiz-attempt"));
        }
        case "/mod/quiz/processattempt.php": {
          const form = new URLSearchParams(request.postData() ?? "");
          if (form.get("finishattempt") === "1") {
            finished = true;
            return go("mod/quiz/review.php?attempt=9&cmid=26");
          }
          saved.push(form);
          return go("mod/quiz/attempt.php?attempt=9&cmid=26&page=1");
        }
        case "/mod/quiz/summary.php":
          if (finished) return html(page("<p>This attempt is finished.</p>", "page-mod-quiz-summary"));
          return html(page(`<form method="post" action="${SITE}mod/quiz/processattempt.php"><input type="hidden" name="attempt" value="9"><input type="hidden" name="finishattempt" value="1"><button type="submit">Submit all and finish</button></form>`, "page-mod-quiz-summary"));
        case "/mod/quiz/review.php":
          // Moodle sends an unfinished attempt's review back to the attempt.
          if (!finished) return html(page("<p>Attempt in progress.</p>", "page-mod-quiz-attempt"));
          return html(
            page(
              `<table class="quizreviewsummary"><tr><th>Status</th><td>Finished</td></tr><tr><th>Marks</th><td>3.00/3.00</td></tr></table>${Q1.replace("STATE1", "correct").replace("CHECKED1", "checked").replace('_:sequencecheck" value="1"></div>', `_:sequencecheck" value="1"><div class="rightanswer">The correct answer is 'True'.</div></div>`)}`,
              "page-mod-quiz-review",
            ),
          );
        default:
          return route.continue();
      }
    });
  };
  return { saved, routes };
}

describe("quiz attempts", { skip: !browser && "no system browser" }, () => {
  async function site() {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const quiz = fakeQuiz();
    await quiz.routes(context);
    return { context, saved: quiz.saved };
  }
  const fast = { trail: "fast" } as const;

  it("reads the quiz's info and attempts", async () => {
    const { context } = await site();
    const info = await quizInfo(context, SITE, 26);
    assert.equal(info.intro, "Practice quiz.");
    assert.deepEqual(info.info, ["Attempts allowed: 3", "Grading method: Highest grade"]);
    assert.deepEqual(info.attempts, [{ id: 8, inProgress: false, details: [{ label: "Status", value: "Finished" }, { label: "Grade", value: "5.00 out of 10.00" }] }]);
    assert.equal(info.canStart, true);
    await context.close();
  });

  it("refuses an activity that isn't a quiz", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    // Another module's page has another body id.
    await context.route(`${SITE}mod/quiz/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-page-view" }) }));
    await assert.rejects(quizInfo(context, SITE, 5), (error: unknown) => error instanceof QuizError && /isn't a quiz/.test(error.message));
    await assert.rejects(startQuizAttempt(context, SITE, 5), QuizError);
    await context.close();
  });

  it("starts, answers page by page, finishes and reviews", async () => {
    const { context, saved } = await site();
    const started = await startQuizAttempt(context, SITE, 26);
    assert.equal(started.attemptId, 9);
    assert.deepEqual(started.questions.map((q) => [q.slot, q.page]), [[1, 0], [2, 0], [3, 1]]);
    const answers: { slot: number; responses: Record<string, string> }[] = [
      { slot: 1, responses: { "q9:1_answer": "1" } },
      { slot: 2, responses: { "q9:2_choice0": "1", "q9:2_choice1": "0" } },
      { slot: 3, responses: { "q9:3_sub0": "2" } },
    ];
    const answered = await answerQuizQuestions(context, SITE, 9, answers, fast);
    assert.equal(saved.length, 2);
    assert.equal(saved[0]?.get("q9:1_answer"), "1");
    assert.deepEqual(saved[0]?.getAll("q9:2_choice0"), ["0", "1"]);
    assert.equal(saved[1]?.get("q9:3_sub0"), "2");
    assert.equal(answered.questions[0]?.state, "answersaved");
    assert.equal(answered.questions[0]?.fields[0]?.value, "1");
    const done = await finishQuizAttempt(context, SITE, 9);
    assert.deepEqual([done.attemptId, done.finished], [9, true]);
    assert.deepEqual(done.review?.summary, [{ label: "Status", value: "Finished" }, { label: "Marks", value: "3.00/3.00" }]);
    assert.equal(done.review?.questions[0]?.state, "correct");
    assert.equal(done.review?.questions[0]?.rightAnswer, "The correct answer is 'True'.");
    assert.deepEqual(await readReview(context, SITE, 9), done.review);
    await assert.rejects(finishQuizAttempt(context, SITE, 9), (error: unknown) => error instanceof QuizError && /can't be finished/.test(error.message));
    await assert.rejects(answerQuizQuestions(context, SITE, 9, [{ slot: 1, responses: { "q9:1_answer": "0" } }], fast), /isn't open/);
    await context.close();
  });

  it("takes a reader's time before saving with the realistic trail", async () => {
    const { context, saved } = await site();
    const progress: [number, number][] = [];
    await answerQuizQuestions(context, SITE, 9, [{ slot: 3, responses: { "q9:3_sub0": "1" } }], { onProgress: (elapsed, total) => progress.push([elapsed, total]) });
    assert.equal(saved.length, 1);
    assert.deepEqual(progress, [[3, 3]]);
    await context.close();
  });

  it("refuses an answer to a field or slot the attempt doesn't have, saving nothing", async () => {
    const { context, saved } = await site();
    await assert.rejects(answerQuizQuestions(context, SITE, 9, [{ slot: 1, responses: { "q9:1_nonexistent": "1" } }], fast), (error: unknown) => error instanceof FormError && /no such field: q9:1_nonexistent/.test(error.message));
    await assert.rejects(answerQuizQuestions(context, SITE, 9, [{ slot: 7, responses: { "q9:7_answer": "1" } }], fast), /no question in slot 7/);
    assert.equal(saved.length, 0);
    await context.close();
  });

  it("refuses the review of an attempt in progress", async () => {
    const { context } = await site();
    await assert.rejects(readReview(context, SITE, 9), (error: unknown) => error instanceof QuizError && /review isn't available/.test(error.message));
    await context.close();
  });
});

describe("setQuizOverride", { skip: !browser && "no system browser" }, () => {
  /** The user override form as Moodle 5.2's, reduced and made up: only users without an override are offered. */
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `<option value="${from + i}">${from + i}</option>`).join("");
  const date = (name: string) =>
    `<input type="hidden" name="${name}[enabled]" value="0"><input type="checkbox" name="${name}[enabled]" value="1"><select name="${name}[day]">${range(1, 31)}</select><select name="${name}[month]">${range(1, 12)}</select><select name="${name}[year]">${range(2026, 2027)}</select><select name="${name}[hour]">${range(0, 23)}</select><select name="${name}[minute]">${range(0, 59)}</select>`;
  const FORM = `<form class="mform" method="post" action="${SITE}mod/quiz/overrideedit.php"><select name="userid"><option value="">No selection</option><option value="4">Ana Student</option></select>
${date("timeopen")}${date("timeclose")}<input type="hidden" name="timelimit[enabled]" value="0"><input type="checkbox" name="timelimit[enabled]" value="1"><input name="timelimit[number]" value="0"><select name="timelimit[timeunit]"><option value="3600">hours</option><option value="60">minutes</option></select>
<select name="attempts">${range(0, 10)}</select><input type="submit" name="submitbutton" value="Save"></form>`;

  it("fills the override form, the close date in the person's time zone, and refuses a user it doesn't offer", async () => {
    const posted: URLSearchParams[] = [];
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
    await context.route(`${SITE}mod/quiz/overrideedit.php**`, (route: Route) => {
      if (route.request().method() === "POST") {
        posted.push(new URLSearchParams(route.request().postData() ?? ""));
        return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-overrides" }) });
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-overrideedit", body: FORM }) });
    });
    const result = await setQuizOverride(context, SITE, 27, 4, { close: new Date("2026-11-30T18:00:00Z"), timeLimitMinutes: 20, attempts: 5 });
    assert.match(result.changed, /closes 2026-11-30T18:00:00.000Z, 20 minutes, 5 attempts/);
    const form = posted[0]!;
    assert.deepEqual(
      [form.get("userid"), form.getAll("timeclose[enabled]").at(-1), form.get("timeclose[day]"), form.get("timeclose[hour]"), form.get("timelimit[number]"), form.get("timelimit[timeunit]"), form.get("attempts"), form.getAll("timeopen[enabled]").at(-1)],
      ["4", "1", "30", "19", "20", "60", "5", "0"],
    );
    await assert.rejects(setQuizOverride(context, SITE, 27, 9, { attempts: 2 }), (error: Error) => error instanceof QuizError && /User 9 can't get an override/.test(error.message));
    await context.close();
  });
});

describe("quizResults", { skip: !browser && "no system browser" }, () => {
  /** The overview and responses reports as Moodle 5.2 renders them, reduced; one attempt, made up. */
  const question = (slot: number, value: string, result: string) =>
    `<td class="cell"><a href="${SITE}mod/quiz/reviewquestion.php?attempt=9&amp;slot=${slot}"><span class="que"><i class="icon"></i><span class="${result}">${value}</span></span></a></td>`;
  const report = (mode: "overview" | "responses") => {
    const times = mode === "overview" ? `<td>9 Oct 1:30 PM</td><td>9 Oct 1:31 PM</td><td>50 secs</td>` : "";
    const heads = mode === "overview" ? `<th>Started</th><th>Completed</th><th>Duration</th>` : "";
    const answers = mode === "overview" ? question(1, "1.00", "correct") + question(2, "-", "notanswered") : question(1, "True", "correct") + question(2, "-", "notanswered");
    return `<div id="region-main"><table id="attempts"><thead><tr><th class="header c0">Select</th><th class="header c1 picture"></th><th class="header c2 bold sticky-column">Name</th><th class="header c3">Email</th><th>Status</th>${heads}<th class="header bold">Grade/10.00</th><th>Q. 1</th><th>Q. 2</th></tr></thead>
<tbody><tr class="gradedattempt"><td><input name="attemptid[]" type="checkbox" value="9"></td><td class="cell picture"><a href="${SITE}user/view.php?id=4&amp;course=3"><span class="userinitials">AS</span></a></td>
<td class="cell bold sticky-column"><a href="${SITE}user/view.php?id=4&amp;course=3">Ana Student</a><br><a class="reviewlink" href="${SITE}mod/quiz/review.php?attempt=9">Review attempt</a></td><td>ana@example.org</td><td>Finished</td>${times}
<td class="cell bold"><a href="${SITE}mod/quiz/review.php?attempt=9">5.00</a></td>${answers}</tr></tbody></table></div>`;
  };

  it("reads each attempt's person, state, dates, grade and marks, and the responses when asked", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
    await context.route(`${SITE}mod/quiz/report.php**`, (route: Route) => {
      const mode = new URL(route.request().url()).searchParams.get("mode") as "overview" | "responses";
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-report", body: report(mode) }) });
    });
    assert.deepEqual(await quizResults(context, SITE, 27, { responses: true }), {
      quiz: { id: 27 },
      attempts: [
        {
          id: 9,
          userId: 4,
          fullName: "Ana Student",
          state: "Finished",
          started: "9 Oct 1:30 PM",
          completed: "9 Oct 1:31 PM",
          duration: "50 secs",
          grade: "5.00",
          questions: [
            { slot: 1, mark: "1.00", result: "correct", response: "True" },
            { slot: 2, result: "notanswered" },
          ],
        },
      ],
    });
    await context.close();
  });

  it("passes Moodle's refusal", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/mod/quiz/report.php": `<div data-rel="fatalerror"><p class="errormessage">You cannot access this report</p></div>` } });
    await assert.rejects(quizResults(context, SITE, 27), /You cannot access this report/);
    await context.close();
  });
});
