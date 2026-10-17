import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { QuizError, quizStatistics } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// Moodle's English strings (quiz_statistics) the report's labels are made of, as core_get_strings gives them.
const STRINGS: Record<string, string> = {
  firstattemptscount: "Number of complete graded first attempts",
  allattemptscount: "Total number of complete graded attempts",
  firstattemptsavg: "Average grade of first attempts",
  allattemptsavg: "Average grade of all attempts",
  lastattemptsavg: "Average grade of last attempts",
  highestattemptsavg: "Average grade of highest graded attempts",
  median: "Median grade (for {$a})",
  standarddeviation: "Standard deviation (for {$a})",
  skewness: "Score distribution skewness (for {$a})",
  kurtosis: "Score distribution kurtosis (for {$a})",
  cic: "Coefficient of internal consistency (for {$a})",
  errorratio: "Error ratio (for {$a})",
  standarderror: "Standard error (for {$a})",
  lastcalculated: "Last calculated {$a->lastcalculated} ago there have been {$a->count} attempts since then.",
  partofquestion: "Part of question",
  modelresponse: "Model response",
  actualresponse: "Actual response",
  response: "Response",
};
const getStrings = ({ strings }: Record<string, unknown>) =>
  (strings as { stringid: string; stringparams?: { name?: string; value: string }[] }[]).map(({ stringid, stringparams = [] }) => ({
    stringid,
    string: stringparams.reduce((text, { name, value }) => text.replace(name ? `{$a->${name}}` : "{$a}", value), STRINGS[stringid] ?? ""),
  }));

// The report's pages as Moodle 5.2 renders them, reduced (cmid 27): three slots, the third random.
const th = (column: string, label: string, numeric = false) => `<th class="header${numeric ? " numcol" : ""}" scope="col">${label}<div class="commands"><a data-action="hide" data-column="${column}" href="#"><i class="icon"></i></a></div></th>`;
const HEAD = `<thead><tr>${th("number", "Q#")}${th("icon", "")}${th("actions", "")}${th("name", "Question name")}${th("s", "Attempts", true)}${th("facility", "Facility index", true)}${th("sd", "Standard deviation", true)}${th("random_guess_score", "Random guess score", true)}${th("intended_weight", "Intended weight", true)}${th("effective_weight", "Effective weight", true)}${th("discrimination_index", "Discrimination index", true)}${th("discriminative_efficiency", "Discriminative efficiency", true)}</tr></thead>`;
const icon = (type: string) => `<img class="icon" src="${SITE}theme/image.php/boost/qtype_${type}/1/icon">`;
const actions = (id: number) => `<a class="preview" href="${SITE}question/bank/previewquestion/preview.php?id=${id}&amp;cmid=27"></a><a class="questioneditbutton" href="${SITE}question/bank/editquestion/question.php?cmid=27&amp;id=${id}"></a>`;
const row = (cells: string[], className = "") => `<tr class="${className}">${cells.map((c) => `<td class="cell">${c}</td>`).join("")}</tr>`;
const link = (query: string, text: string) => `<a href="${SITE}mod/quiz/report.php?id=27&amp;mode=statistics&amp;${query}">${text}</a>`;
const figures = ["66.67%", "57.74%", "50.00%", "33.33%", "40.00%", "100.00%", "100.00%"];

const MAIN = `<div id="region-main"><div role="main">
<form><select name="whichattempts" id="id_whichattempts"><option value="1">highest graded attempt</option><option value="2" selected>all attempts</option><option value="3">first attempts</option><option value="4">last attempt</option></select></form>
<h3>Quiz information</h3><div id="cachingnotice" class="box">Last calculated 3 days 5 hours ago there have been 2 attempts since then.<div class="singlebutton"><form method="post"><button type="submit">Recalculate now</button></form></div></div>
<table class="table generaltable titlesleft"><tbody>
<tr><td>Quiz name</td><td>Loops</td></tr><tr><td>Course name</td><td>Programming</td></tr>
<tr><td>Number of complete graded first attempts</td><td>2</td></tr><tr><td>Total number of complete graded attempts</td><td>3</td></tr>
<tr><td>Average grade of all attempts</td><td>33.33%</td></tr>
<tr><td>Median grade (for all attempts)</td><td>0.00%</td></tr><tr><td>Standard deviation (for all attempts)</td><td>57.74%</td></tr>
<tr><td>Coefficient of internal consistency (for all attempts)</td><td>100.00%</td></tr></tbody></table>
<table id="questionstatistics" class="flexible table generaltable">${HEAD}<tbody>
${row(["1", icon("truefalse"), actions(14), link("slot=1", "Loops are fun"), "3", ...figures])}
${row(["2", icon("multichoice"), actions(15), `<div class="dubious">${link("slot=2", "Pick the loop")}</div>`, "3", "0.00%", "0.00%", "25.00%", "33.33%", "", "", ""])}
${row(["3", icon("missingtype"), "", "Random question", "3", ...figures])}
${row([], "d-none hidden")}
${row(["", "", "", `<div>Range of values</div>${link("slot=3", "View details")}`, "1 - 2", "50.00% - 100.00%", "", "", "", "", "", ""], "quiz_statistics-summaryrow")}
</tbody></table></div></div>`;

const RANDOM_SLOT = `<div id="region-main"><table id="questionstatistics" class="flexible table generaltable">${HEAD}<tbody>
${row(["3", icon("missingtype"), "", "Random question", "3", ...figures])}
${row(["3.1", icon("shortanswer"), actions(21), link("qid=21", "Capital"), "2", "100.00%", "0.00%", "0.00%", "", "", "", ""])}
${row(["3.2", icon("truefalse"), actions(22), link("qid=22", "Sky"), "1", "0.00%", "", "50.00%", "", "", "", ""])}
</tbody></table></div>`;

const analysis = (headers: [string, boolean][], rows: string[][]) =>
  `<div id="region-main"><h3>Question statistics</h3><table class="table generaltable titlesleft"><tbody><tr><td>Attempts</td><td>3</td></tr></tbody></table>
<table class="flexible table generaltable quizresponseanalysis"><thead><tr>${headers.map(([h, n]) => `<th class="header${n ? " numcol" : ""}">${h}<div class="commands"></div></th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => row(r)).join("")}${row(["&nbsp;", "", "", ""], "emptyrow")}</tbody></table></div>`;
const MODEL: [string, boolean][] = [["Model response", false], ["Partial credit", true], ["Count", false], ["Frequency", true]];
const PAGES: Record<string, string> = {
  "": MAIN,
  "slot=1": analysis(MODEL, [["True", "100.00%", "2", "66.67%"], ["False", "0.00%", "1", "33.33%"]]),
  "slot=2": analysis(MODEL, [["Three", "100.00%", "0", "0.00%"]]),
  "slot=3": RANDOM_SLOT,
  // A short answer with actual responses: the model response blank where it repeats.
  "qid=21": analysis([["Model response", false], ["Actual response", false], ["Partial credit", true], ["Count", false], ["Frequency", true]], [["Paris", "Paris", "100.00%", "1", "50.00%"], ["", "paris", "100.00%", "1", "50.00%"]]),
  "qid=22": analysis([["Response", false], ["Partial credit", true], ["Count Try 1", false], ["Count Try 2", false], ["Frequency", true]], [["True", "100.00%", "0", "1", "100.00%"]]),
};

/** The fake report: the page for the query's `slot` or `qid`, or the main one; every query asked recorded. */
async function fakeReport(asked: string[], pages = PAGES): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: { core_get_strings: getStrings } });
  await context.route(`${SITE}mod/quiz/report.php**`, (route: Route) => {
    const query = new URL(route.request().url()).searchParams;
    asked.push(query.toString());
    const key = query.has("qid") ? `qid=${query.get("qid")}` : query.has("slot") ? `slot=${query.get("slot")}` : "";
    return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-quiz-report", body: pages[key] ?? "" }) });
  });
  return context;
}

describe("quizStatistics", { skip: !browser && "no system browser" }, () => {
  it("reads the quiz's figures and each slot's, a random slot's questions from its own page", async () => {
    const asked: string[] = [];
    const context = await fakeReport(asked);
    const stats = await quizStatistics(context, SITE, 27, { attempts: "all" });
    assert.deepEqual(asked, ["id=27&mode=statistics&whichattempts=2", "id=27&mode=statistics&whichattempts=2&slot=3"]);
    assert.deepEqual(stats.quiz, { id: 27 });
    assert.equal(stats.attempts, "all");
    assert.equal(stats.calculatedNow, false);
    assert.deepEqual(stats.calculated, { ago: "3 days 5 hours", attemptsSince: 2 });
    assert.deepEqual(stats.figures, { firstAttemptsCount: 2, allAttemptsCount: 3, allAttemptsAverage: "33.33%", median: "0.00%", standardDeviation: "57.74%", internalConsistency: "100.00%" });
    const fig = { facility: "66.67%", standardDeviation: "57.74%", randomGuessScore: "50.00%", intendedWeight: "33.33%", effectiveWeight: "40.00%", discriminationIndex: "100.00%", discriminativeEfficiency: "100.00%" };
    assert.deepEqual(stats.questions, [
      { slot: 1, number: "1", name: "Loops are fun", type: "truefalse", questionId: 14, attempts: "3", ...fig },
      { slot: 2, number: "2", name: "Pick the loop", type: "multichoice", questionId: 15, attempts: "3", facility: "0.00%", standardDeviation: "0.00%", randomGuessScore: "25.00%", intendedWeight: "33.33%", dubious: true },
      {
        slot: 3,
        number: "3",
        name: "Random question",
        type: "random",
        attempts: "3",
        ...fig,
        parts: [
          { number: "3.1", name: "Capital", type: "shortanswer", questionId: 21, attempts: "2", facility: "100.00%", standardDeviation: "0.00%", randomGuessScore: "0.00%" },
          { number: "3.2", name: "Sky", type: "truefalse", questionId: 22, attempts: "1", facility: "0.00%", randomGuessScore: "50.00%" },
        ],
      },
    ]);
    await context.close();
  });

  it("with responses, each question's and part's analysis of responses; recalculating first, with the sesskey", async () => {
    const asked: string[] = [];
    const context = await fakeReport(asked);
    const stats = await quizStatistics(context, SITE, 27, { responses: true, recalculate: true });
    assert.equal(asked[0], "id=27&mode=statistics&recalculate=1&sesskey=s1");
    assert.deepEqual(asked.slice(1).map((q) => q.replace("id=27&mode=statistics", "")), ["&slot=1", "&slot=2", "&slot=3", "&qid=21", "&qid=22"]);
    assert.deepEqual(stats.questions[0]!.responses, [
      { model: "True", credit: "100.00%", count: 2, frequency: "66.67%" },
      { model: "False", credit: "0.00%", count: 1, frequency: "33.33%" },
    ]);
    assert.deepEqual(stats.questions[1]!.responses, [{ model: "Three", credit: "100.00%", count: 0, frequency: "0.00%" }]);
    assert.equal(stats.questions[2]!.responses, undefined);
    assert.deepEqual(stats.questions[2]!.parts!.map((p) => p.responses), [
      [
        { model: "Paris", response: "Paris", credit: "100.00%", count: 1, frequency: "50.00%" },
        { model: "Paris", response: "paris", credit: "100.00%", count: 1, frequency: "50.00%" },
      ],
      [{ response: "True", credit: "100.00%", count: 1, tries: [0, 1], frequency: "100.00%" }],
    ]);
    await context.close();
  });

  it("a quiz without graded attempts, one without questions, and Moodle's refusal", async () => {
    const noAttempts = MAIN.replace(/<table id="questionstatistics"[\s\S]*<\/table>/, "").replace(/<div id="cachingnotice"[\s\S]*?<\/div><\/div>/, "");
    let context = await fakeReport([], { "": noAttempts });
    await assert.rejects(quizStatistics(context, SITE, 27), (error: unknown) => error instanceof QuizError && /no finished, graded attempts/.test(error.message));
    await context.close();
    context = await fakeReport([], { "": `<div id="region-main"><p>No questions have been added yet</p></div>` });
    await assert.rejects(quizStatistics(context, SITE, 27), (error: unknown) => error instanceof QuizError && /no questions/.test(error.message));
    await context.close();
    context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/mod/quiz/report.php": `<div data-rel="fatalerror"><p class="errormessage">You cannot access this report</p></div>` } });
    await assert.rejects(quizStatistics(context, SITE, 27), (error: unknown) => error instanceof QuizError && /You cannot access this report.*quiz\/statistics:view/.test(error.message));
    await assert.rejects(quizStatistics(context, SITE, 27, { attempts: "best" as "all" }), /attempts must be one of/);
    await context.close();
  });
});
