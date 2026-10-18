// Question banks against the sandbox: a shared bank (qbank) made in the scratch course (on Moodle
// 4.x, the scratch course's own bank), filled by imports (GIFT and Moodle XML files written here) and
// the types' forms, the plugin types' too, then changed and emptied.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { QuestionBankError, type BankQuestion, type Moodle, type QuestionInput } from "../../src/index.js";
import { formValue, openForm } from "../../src/internals.js";
import { COURSE, SERIES, SITE, as, cleanup, scratchCourse, type ScratchCourse } from "./harness.js";

// Moodle 4.x has no qbank activities: each course has its bank, whose id is the course's.
const COURSE_BANKS = SERIES.startsWith("4.");

/** A plain grey PNG of that size: a drag and drop question's background. */
function png(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (data: Buffer) => {
    let c = 0xffffffff;
    for (const byte of data) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8); // 8-bit greyscale
  const rows = Buffer.alloc((width + 1) * height, 0xc0);
  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

const GIFT = `::Sandbox TF:: The sandbox runs Moodle. {T}

::Sandbox MC:: Which number is even? {=4 ~3 ~5}

::Sandbox SA:: The capital of France? {=Paris}
`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<quiz>
  <question type="truefalse">
    <name><text>Sandbox XML TF</text></name>
    <questiontext format="html"><text><![CDATA[<p>Water is wet.</p>]]></text></questiontext>
    <defaultgrade>1</defaultgrade>
    <answer fraction="100" format="moodle_auto_format"><text>true</text><feedback><text></text></feedback></answer>
    <answer fraction="0" format="moodle_auto_format"><text>false</text><feedback><text></text></feedback></answer>
  </question>
</quiz>
`;

/**
 * Makes a shared bank in a course and gives its id. A qbank isn't on the course page, so
 * createActivity can't name the activity it made: the course's banks do.
 */
async function makeBank(teacher: Moodle, course: ScratchCourse, name: string): Promise<number> {
  if (COURSE_BANKS) return course.id;
  await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "qbank", name });
  const bank = (await teacher.questionBanks(course.id)).find((b) => b.type === "qbank" && b.name === name);
  assert.ok(bank, `The bank "${name}" wasn't created.`);
  return bank.id;
}

// The sandbox is shared and can be slow (a page in 20 s under load): every Moodle round trip gets time.
const SLOW = { timeout: 1_200_000 };

describe("question banks", () => {
  let course: ScratchCourse;
  let teacher: Moodle;
  let bankId: number;
  let dir: string;
  let defaultCategory: number;
  const byName = async (name: string): Promise<BankQuestion | undefined> => (await teacher.questions(bankId)).questions.find((q) => q.name === name);
  // The bank pages' parameter.
  const ref = () => `${COURSE_BANKS ? "courseid" : "cmid"}=${bankId}`;

  before(async () => {
    course = await scratchCourse("questions");
    teacher = await as("teacher");
    bankId = await makeBank(teacher, course, "Sandbox bank");
    dir = await mkdtemp(path.join(tmpdir(), "questions-sandbox-"));
    cleanup(() => rm(dir, { recursive: true, force: true }));
  });

  it("questionBanks: the scratch course's shared bank, and course 3's banks", SLOW, async () => {
    const banks = await teacher.questionBanks(course.id);
    if (COURSE_BANKS) {
      assert.deepEqual(banks.map((b) => [b.id, b.type, b.shared]), [[course.id, "course", true]]);
      assert.match(banks[0]!.name, /^Driver check questions/);
      return;
    }
    const bank = banks.find((b) => b.id === bankId);
    assert.deepEqual(bank, { id: bankId, name: "Sandbox bank", type: "qbank", shared: true });
    const content = await teacher.questionBanks(COURSE);
    assert.ok(content.every((b) => b.id > 0 && b.name && b.type));
  });

  it("questionBanks: a student can't see the banks", SLOW, async () => {
    await assert.rejects((await as("student")).questionBanks(course.id), QuestionBankError);
  });

  it("questions: an empty bank's Top and default categories", SLOW, async () => {
    const { categories, questions } = await teacher.questions(bankId);
    assert.ok(categories.length >= 2, JSON.stringify(categories));
    assert.equal(questions.length, 0);
    defaultCategory = categories[1]!.id;
  });

  it("questions: an activity that keeps no questions is refused (4.x: a course that isn't there)", SLOW, async () => {
    if (COURSE_BANKS) {
      await assert.rejects(teacher.questions(999_999_999), (error: unknown) => error instanceof QuestionBankError && /Course 999999999 has no question bank/.test(error.message));
      return;
    }
    const page = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Not a bank", content: "<p>No questions here.</p>" });
    await assert.rejects(teacher.questions(page.activityId!), (error: unknown) => error instanceof QuestionBankError && /is a page/.test(error.message));
  });

  it("importQuestions: a GIFT file into the default category", SLOW, async () => {
    const file = path.join(dir, "questions.gift.txt");
    await writeFile(file, GIFT, "utf8");
    const { questions } = await teacher.importQuestions(bankId, { format: "gift", file, categoryId: defaultCategory });
    assert.deepEqual(questions.map((q) => [q.name, q.type]).sort(), [
      ["Sandbox MC", "multichoice"],
      ["Sandbox SA", "shortanswer"],
      ["Sandbox TF", "truefalse"],
    ]);
    assert.ok(questions.every((q) => q.categoryId === defaultCategory));
    // Read back from the bank.
    const listed = (await teacher.questions(bankId)).questions.map((q) => q.id);
    for (const q of questions) assert.ok(listed.includes(q.id));
  });

  it("importQuestions: a Moodle XML file", SLOW, async () => {
    const file = path.join(dir, "questions.xml");
    await writeFile(file, XML, "utf8");
    const { questions } = await teacher.importQuestions(bankId, { format: "xml", file });
    assert.deepEqual(questions.map((q) => [q.name, q.type]), [["Sandbox XML TF", "truefalse"]]);
  });

  it("importQuestions: Moodle's parse errors, nothing imported", SLOW, async () => {
    const before = (await teacher.questions(bankId)).questions.length;
    await assert.rejects(teacher.importQuestions(bankId, { format: "gift", text: "this is not GIFT at all {" }), QuestionBankError);
    assert.equal((await teacher.questions(bankId)).questions.length, before);
  });

  it("createQuestion: each type its form makes", SLOW, async () => {
    const made = [
      await teacher.createQuestion(bankId, {
        type: "multichoice",
        name: "Form MC",
        text: "<p>Which loop never ends?</p>",
        answers: [
          { text: "while True: pass", fraction: 1, feedback: "Right." },
          { text: "for i in range(3): pass", fraction: -0.5 },
        ],
        defaultMark: 2,
      }),
      await teacher.createQuestion(bankId, { type: "truefalse", name: "Form TF", text: "<p>Python is a language.</p>", correct: true }),
      await teacher.createQuestion(bankId, { type: "shortanswer", name: "Form SA", text: "<p>Two plus two?</p>", answers: [{ text: "four", fraction: 1 }] }),
      await teacher.createQuestion(bankId, { type: "numerical", name: "Form NUM", text: "<p>Pi to two decimals?</p>", answers: [{ text: "3.14", fraction: 1, tolerance: 0.01 }] }),
      await teacher.createQuestion(bankId, { type: "essay", name: "Form ES", text: "<p>Explain recursion.</p>" }),
    ];
    const { questions } = await teacher.questions(bankId);
    for (const [result, type, name] of [
      [made[0], "multichoice", "Form MC"],
      [made[1], "truefalse", "Form TF"],
      [made[2], "shortanswer", "Form SA"],
      [made[3], "numerical", "Form NUM"],
      [made[4], "essay", "Form ES"],
    ] as const) {
      assert.ok(result!.questionId, result!.changed);
      const listed = questions.find((q) => q.id === result!.questionId);
      assert.deepEqual([listed?.name, listed?.type, listed?.categoryId], [name, type, defaultCategory]);
    }
  });

  it("createQuestion: a type it doesn't make, and a multichoice without answers", async () => {
    await assert.rejects(teacher.createQuestion(bankId, { type: "random" as never, name: "x", text: "x" }), (error: unknown) => error instanceof QuestionBankError && /import it as GIFT or Moodle XML/.test(error.message));
    await assert.rejects(teacher.createQuestion(bankId, { type: "multichoice", name: "x", text: "x" }), QuestionBankError);
  });

  // The other core types, by name: each made, then previewed.
  const made = new Map<string, number>();
  const preview = async (questionId: number): Promise<string> => {
    const page = await (await teacher.context()).newPage();
    try {
      await page.goto(`${SITE}question/bank/previewquestion/preview.php?id=${questionId}&${ref()}`, { waitUntil: "domcontentloaded" });
      assert.equal(await page.locator('[data-rel="fatalerror"], .errorbox').count(), 0, `question ${questionId}'s preview shows an error`);
      return (await page.locator("#responseform .que").first().getAttribute("class")) ?? "";
    } finally {
      await page.close();
    }
  };

  it("createQuestion: every other core type, each previewing", SLOW, async () => {
    const image = path.join(dir, "background.png");
    await writeFile(image, png(400, 300));
    const inputs: QuestionInput[] = [
      { type: "calculated", name: "Driver check calculated", text: "<p>What is {a} times {b}?</p>", answers: [{ text: "{a} * {b}", fraction: 1, tolerance: 0.01 }], wildcards: [{ name: "a", min: 1, max: 5, decimals: 0 }, { name: "b", min: 2, max: 3, decimals: 1 }], sets: 3 },
      { type: "calculatedsimple", name: "Driver check calculated simple", text: "<p>What is {x} plus {y}?</p>", answers: [{ text: "{x} + {y}", fraction: 1 }], wildcards: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [4, 5, 6] }] },
      { type: "calculatedmulti", name: "Driver check calculated multichoice", text: "<p>What is {a} plus {b}?</p>", answers: [{ text: "{={a} + {b}}", fraction: 1 }, { text: "{={a} - {b}}", fraction: 0 }], sets: 2 },
      { type: "match", name: "Driver check match", text: "<p>Match the sums.</p>", pairs: [{ question: "2 + 2", answer: "4" }, { question: "3 + 3", answer: "6" }, { question: "1 + 1", answer: "2" }] },
      { type: "randomsamatch", name: "Driver check random matching", text: "<p>Match them.</p>", choose: 2 },
      { type: "ddwtos", name: "Driver check ddwtos", text: "<p>The [[1]] sat on the [[2]].</p>", choices: [{ text: "cat" }, { text: "mat" }, { text: "dog" }] },
      { type: "gapselect", name: "Driver check gapselect", text: "<p>Water is [[1]] and fire is [[3]].</p>", choices: [{ text: "wet" }, { text: "dry" }, { text: "hot", group: 2 }, { text: "cold", group: 2 }] },
      { type: "ddimageortext", name: "Driver check ddimageortext", text: "<p>Put them in place.</p>", image, drags: [{ text: "North" }, { text: "South" }], drops: [{ choice: 1, left: 10, top: 10 }, { choice: 2, left: 10, top: 200 }] },
      { type: "ddmarker", name: "Driver check ddmarker", text: "<p>Mark them.</p>", image, markers: [{ text: "A" }, { text: "B", count: 1 }], drops: [{ choice: 1, shape: "circle", coords: "100,100;30" }, { choice: 2, shape: "rectangle", coords: "200,150;50,40" }] },
      { type: "multianswer", name: "Driver check cloze", text: "<p>2 + 2 = {1:NUMERICAL:=4} and Paris is in {1:MULTICHOICE:=France~Spain}.</p>" },
      { type: "ordering", name: "Driver check ordering", text: "<p>Put them in order.</p>", items: ["one", "two", "three"] },
      { type: "description", name: "Driver check description", text: "<p>Read this first.</p>" },
    ];
    for (const input of inputs) {
      const { questionId, changed } = await teacher.createQuestion(bankId, input);
      assert.ok(questionId, changed);
      made.set(input.type, questionId);
    }
    const { questions } = await teacher.questions(bankId);
    for (const input of inputs) {
      const id = made.get(input.type)!;
      assert.deepEqual([questions.find((q) => q.id === id)?.type, questions.find((q) => q.id === id)?.name], [input.type, input.name]);
      // A question previews as its type (the description too, without being a question to answer).
      assert.match(await preview(id), new RegExp(`\\b${input.type}\\b`), input.type);
    }
  });

  // The sandbox has the four plugin types createQuestion makes: each made, previewed, changed and deleted.
  const plugins = new Map<string, number>();

  it("createQuestion: the plugin types (CodeRunner, Formulas, Gap fill, drag and drop matching), each previewing", SLOW, async () => {
    const inputs: QuestionInput[] = [
      {
        type: "coderunner",
        name: "Driver check coderunner",
        text: "<p>Write a function double(n) that returns twice n.</p>",
        coderunner: { type: "python3", answer: "def double(n):\n    return 2 * n\n", testCases: [{ code: "print(double(2))", expected: "4" }, { code: "print(double(-3))", expected: "-6" }] },
      },
      { type: "formulas", name: "Driver check formulas", text: "<p>What is 2 times {a}?</p>", formulas: { randomVariables: "a = {1,2,3,4};", parts: [{ answer: "2*a", mark: 1 }] } },
      { type: "gapfill", name: "Driver check gapfill", text: "<p>The [cat] sat on the [mat].</p>" },
      { type: "ddmatch", name: "Driver check ddmatch", text: "<p>Match the capitals.</p>", pairs: [{ question: "France", answer: "Paris" }, { question: "Italy", answer: "Rome" }, { question: "Spain", answer: "Madrid" }] },
    ];
    for (const input of inputs) {
      const { questionId, changed } = await teacher.createQuestion(bankId, input);
      assert.ok(questionId, changed);
      plugins.set(input.type, questionId);
    }
    const { questions } = await teacher.questions(bankId);
    for (const input of inputs) {
      const id = plugins.get(input.type)!;
      assert.deepEqual([questions.find((q) => q.id === id)?.type, questions.find((q) => q.id === id)?.name], [input.type, input.name]);
      assert.match(await preview(id), new RegExp(`\\b${input.type}\\b`), input.type);
    }
  });

  it("createQuestion: a CodeRunner question graded through the sandbox's Jobe server", SLOW, async () => {
    // The preview's correct response (the sample answer) submitted: Jobe runs the test cases.
    const page = await (await teacher.context()).newPage();
    try {
      await page.goto(`${SITE}question/bank/previewquestion/preview.php?id=${plugins.get("coderunner")}&${ref()}`, { waitUntil: "domcontentloaded" });
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.locator('#responseform [name="fill"]').click()]);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.locator('#responseform [name="finish"]').click()]);
      assert.match((await page.locator("#responseform .que").first().getAttribute("class")) ?? "", /\bcorrect\b/);
    } finally {
      await page.close();
    }
  });

  it("updateQuestion: each plugin type, a new version with what's given; deleteQuestions: then gone", SLOW, async () => {
    const changes: [string, Parameters<Moodle["updateQuestion"]>[2], string[], (string | undefined)[]][] = [
      ["coderunner", { coderunner: { type: "python3", answer: "def double(n):\n    return n + n\n", testCases: [{ code: "print(double(5))", expected: "10" }] } }, ["testcode[0]", "expected[0]", "testcode[1]"], ["print(double(5))", "10", ""]],
      ["formulas", { formulas: { randomVariables: "a = {5,6};", parts: [{ answer: "3*a" }] }, text: "<p>What is 3 times {a}?</p>" }, ["varsrandom", "answer[0]"], ["a = {5,6};", "3*a"]],
      ["gapfill", { name: "Driver check gapfill v2", text: "<p>The [dog] chased the [cat].</p>" }, ["name"], ["Driver check gapfill v2"]],
      ["ddmatch", { pairs: [{ question: "Portugal", answer: "Lisbon" }, { question: "Greece", answer: "Athens" }] }, ["subquestions[0][text]", "subquestions[2][text]"], ["Portugal", ""]],
    ];
    for (const [type, input, names, expected] of changes) {
      const { questionId, changed } = await teacher.updateQuestion(bankId, plugins.get(type)!, input);
      assert.ok(questionId && questionId !== plugins.get(type), changed);
      plugins.set(type, questionId);
      assert.match(await preview(questionId), new RegExp(`\\b${type}\\b`), type);
      const values = await formValues(questionId, names);
      // A row dropped is blank, or gone from the form.
      assert.deepEqual(values.map((v) => (v ?? "").replace(/<\/?p>/g, "").trim()), expected, type);
    }
    const ids = [...plugins.values()];
    const result = await teacher.deleteQuestions(bankId, ids);
    assert.deepEqual(result.deleted.sort(), [...ids].sort());
  });

  it("createQuestion: an input the type doesn't take, a type's inputs missing", SLOW, async () => {
    await assert.rejects(teacher.createQuestion(bankId, { type: "match", name: "x", text: "x", answers: [{ text: "1", fraction: 1 }] }), (error: unknown) => error instanceof QuestionBankError && /doesn't take answers: it takes pairs/.test(error.message));
    await assert.rejects(teacher.createQuestion(bankId, { type: "ddmarker", name: "x", text: "x" }), (error: unknown) => error instanceof QuestionBankError && /needs image, markers, drops/.test(error.message));
  });

  /** The edit form's values of a question's latest version. */
  const formValues = async (questionId: number, names: string[]): Promise<(string | undefined)[]> => {
    const page = await openForm(await teacher.context(), SITE, `question/bank/editquestion/question.php?${ref()}&id=${questionId}`);
    try {
      return await Promise.all(names.map((name) => formValue(page, name)));
    } finally {
      await page.close();
    }
  };

  it("updateQuestion: one of each family, a new version with what's given", SLOW, async () => {
    const update = async (type: string, input: Parameters<Moodle["updateQuestion"]>[2]): Promise<number> => {
      const { questionId, changed } = await teacher.updateQuestion(bankId, made.get(type)!, input);
      assert.ok(questionId && questionId !== made.get(type), changed);
      made.set(type, questionId);
      assert.match(await preview(questionId), new RegExp(`\\b${type}\\b`), type);
      return questionId;
    };
    const match = await update("match", { pairs: [{ question: "5 + 5", answer: "10" }, { question: "4 + 4", answer: "8" }, { question: "", answer: "7" }] });
    assert.deepEqual(await formValues(match, ["subanswers[0]", "subanswers[1]", "subanswers[2]", "subquestions[2][text]"]), ["10", "8", "7", ""]);
    const gaps = await update("ddwtos", { text: "<p>The [[1]] chased the [[2]].</p>", choices: [{ text: "dog" }, { text: "cat" }] });
    assert.deepEqual(await formValues(gaps, ["choices[0][answer]", "choices[1][answer]", "choices[2][answer]"]), ["dog", "cat", undefined]);
    const drops = await update("ddimageortext", { drops: [{ choice: 2, left: 50, top: 20 }, { choice: 1, left: 50, top: 220 }] });
    assert.deepEqual(await formValues(drops, ["drops[0][choice]", "drops[0][xleft]", "drops[1][ytop]"]), ["2", "50", "220"]);
    const calculated = await update("calculated", { wildcards: [{ name: "a", values: [2, 4] }, { name: "b", values: [1.5, 2.5] }] });
    const page = await openForm(await teacher.context(), SITE, `question/bank/editquestion/question.php?${ref()}&id=${calculated}&wizardnow=datasetitems`);
    try {
      const fields = Object.fromEntries(await page.evaluate(() => Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string; value: string }> } }).document.querySelectorAll('form.mform input[name^="number["], form.mform input[name^="itemid["]')).map((f) => [f.name, f.value] as [string, string])));
      // The two sets saved (with their item ids), not the "item to add" Moodle draws: set n is items 2n-1 and 2n.
      const saved = [1, 2, 3, 4].map((k) => (Number(fields[`itemid[${k}]`]) > 0 ? Number(fields[`number[${k}]`]) : undefined));
      assert.deepEqual([saved.slice(0, 2).sort(), saved.slice(2).sort()], [[1.5, 2], [2.5, 4]], JSON.stringify(fields));
    } finally {
      await page.close();
    }
    await update("multianswer", { text: "<p>3 + 3 = {1:NUMERICAL:=6} and Rome is in {1:MULTICHOICE:=Italy~France}.</p>" });
    const ordering = await update("ordering", { items: ["first", "second", "third", "fourth"] });
    assert.deepEqual(await formValues(ordering, ["answer[0][text]", "answer[3][text]"]), ["first", "fourth"]);
  });

  it("updateQuestion: a new version with the new name and answers", SLOW, async () => {
    const old = (await byName("Form SA"))!;
    const { questionId } = await teacher.updateQuestion(bankId, old.id, { name: "Form SA v2", answers: [{ text: "4", fraction: 1 }, { text: "four", fraction: 1 }] });
    assert.ok(questionId && questionId !== old.id);
    const updated = await byName("Form SA v2");
    assert.equal(updated?.id, questionId);
    assert.equal(updated?.version, "v2");
    assert.equal(await byName("Form SA"), undefined);
  });

  it("setQuestionStatus: draft, then ready again", SLOW, async () => {
    const question = (await byName("Form TF"))!;
    assert.equal(question.status, "ready");
    await teacher.setQuestionStatus(question.id, "draft");
    assert.equal((await byName("Form TF"))?.status, "draft");
    await teacher.setQuestionStatus(question.id, "ready");
    assert.equal((await byName("Form TF"))?.status, "ready");
  });

  it("setQuestionStatus: a status that isn't one", async () => {
    await assert.rejects(teacher.setQuestionStatus(1, "hidden" as never), QuestionBankError);
  });

  it("deleteQuestions: unused questions are deleted", SLOW, async () => {
    const ids = [(await byName("Sandbox XML TF"))!.id, (await byName("Form NUM"))!.id];
    const result = await teacher.deleteQuestions(bankId, ids);
    assert.deepEqual(result.deleted.sort(), [...ids].sort());
    assert.deepEqual(result.hidden, []);
    const left = (await teacher.questions(bankId)).questions.map((q) => q.id);
    assert.ok(ids.every((id) => !left.includes(id)));
  });

  it("deleteQuestions: a question a quiz uses is hidden instead", SLOW, async () => {
    const quiz = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "quiz", name: "Uses a question" });
    const used = (await byName("Form ES"))!;
    await teacher.addQuestionsToQuiz(quiz.activityId!, { questionIds: [used.id] });
    const result = await teacher.deleteQuestions(bankId, [used.id]);
    assert.deepEqual(result, { changed: result.changed, deleted: [], hidden: [used.id] });
    assert.equal(await byName("Form ES"), undefined);
    // The quiz keeps it.
    assert.equal((await teacher.quizStructure(quiz.activityId!)).slots[0]?.name, "Form ES");
  });

  // Categories: "moved" gets questions and is exported; "imports" takes the files back.
  let moved: number;
  let imports: number;

  it("questionCategories: the default category under the Top, with its questions counted", SLOW, async () => {
    const { categories: flat, questions } = await teacher.questions(bankId);
    const tree = await teacher.questionCategories(bankId);
    const own = tree.find((c) => c.id === defaultCategory);
    assert.ok(own, JSON.stringify(tree));
    assert.equal(own.parentId, flat[0]!.id, "a top-level category's parent is the bank's Top");
    assert.equal(own.questionCount, questions.filter((q) => q.categoryId === defaultCategory).length);
    assert.ok(own.description.length > 0, "Moodle describes the default category");
  });

  it("questionCategories: a student can't manage them", SLOW, async () => {
    await assert.rejects((await as("student")).questionCategories(bankId), QuestionBankError);
  });

  it("addQuestionCategory: one inside the default category, one at the top level with a description", SLOW, async () => {
    const inside = await teacher.addQuestionCategory(bankId, { name: "Driver check moved", parentId: defaultCategory });
    assert.deepEqual([inside.category.name, inside.category.parentId, inside.category.questionCount], ["Driver check moved", defaultCategory, 0]);
    moved = inside.category.id;
    const top = await teacher.addQuestionCategory(bankId, { name: "Driver check imports", description: "<p>Read back</p>" });
    assert.equal(top.category.parentId, (await teacher.questions(bankId)).categories[0]!.id);
    assert.match(top.category.description, /Read back/);
    imports = top.category.id;
  });

  it("editQuestionCategory: renamed, described and moved, then back to the top level", SLOW, async () => {
    const topId = (await teacher.questionCategories(bankId)).find((c) => c.id === defaultCategory)!.parentId;
    const edited = await teacher.editQuestionCategory(bankId, imports, { name: "Driver check imported", description: "<p>Files read back</p>", parentId: moved });
    assert.deepEqual([edited.category.name, edited.category.parentId], ["Driver check imported", moved]);
    assert.match(edited.category.description, /Files read back/);
    const back = await teacher.editQuestionCategory(bankId, imports, { parentId: topId });
    assert.deepEqual([back.category.name, back.category.parentId], ["Driver check imported", topId]);
    // A category can't go inside its own subcategory.
    await assert.rejects(teacher.editQuestionCategory(bankId, defaultCategory, { parentId: moved }), QuestionBankError);
  });

  it("moveQuestions: two questions into the new category, and a category not in the bank", SLOW, async () => {
    const ids = [(await byName("Sandbox TF"))!.id, (await byName("Sandbox MC"))!.id];
    const result = await teacher.moveQuestions(bankId, ids, moved);
    assert.deepEqual([result.questionIds, result.categoryId], [ids, moved]);
    const { questions } = await teacher.questions(bankId);
    assert.deepEqual(questions.filter((q) => q.categoryId === moved).map((q) => q.id).sort(), [...ids].sort());
    assert.equal((await teacher.questionCategories(bankId)).find((c) => c.id === moved)?.questionCount, 2);
    await assert.rejects(teacher.moveQuestions(bankId, ids, 999_999), (error: unknown) => error instanceof QuestionBankError && /has no category 999999/.test(error.message));
  });

  it("exportQuestions: the category in GIFT and Moodle XML, each file imported into another category", SLOW, async () => {
    for (const format of ["gift", "xml"] as const) {
      const file = path.join(dir, `export.${format}`);
      const saved = await teacher.exportQuestions(bankId, { format, categoryId: moved, file });
      assert.equal(saved.path, file);
      const text = await readFile(file, "utf8");
      assert.ok(text.includes("Sandbox TF") && text.includes("Sandbox MC") && !text.includes("Form MC"), text);
      const { questions } = await teacher.importQuestions(bankId, { format, file, categoryId: imports });
      assert.deepEqual(questions.map((q) => q.name).sort(), ["Sandbox MC", "Sandbox TF"]);
      assert.ok(questions.every((q) => q.categoryId === imports));
    }
  });

  it("exportQuestions: the whole bank, and an empty category", SLOW, async () => {
    const file = path.join(dir, "bank.xml");
    await teacher.exportQuestions(bankId, { format: "xml", file });
    const text = await readFile(file, "utf8");
    assert.ok(["Sandbox TF", "Form MC", "Form SA v2"].every((name) => text.includes(name)), text);
    const empty = await teacher.addQuestionCategory(bankId, { name: "Driver check empty" });
    await assert.rejects(teacher.exportQuestions(bankId, { format: "gift", categoryId: empty.category.id, file: path.join(dir, "empty.txt") }), QuestionBankError);
    await teacher.deleteQuestionCategory(bankId, empty.category.id);
  });

  it("deleteQuestionCategory: with questions it takes moveTo, and its subcategories move up", SLOW, async () => {
    const sub = await teacher.addQuestionCategory(bankId, { name: "Driver check sub", parentId: imports });
    await assert.rejects(teacher.deleteQuestionCategory(bankId, imports), (error: unknown) => error instanceof QuestionBankError && /give moveTo/.test(error.message));
    await teacher.deleteQuestionCategory(bankId, imports, { moveTo: moved });
    let tree = await teacher.questionCategories(bankId);
    assert.equal(tree.find((c) => c.id === imports), undefined);
    assert.equal(tree.find((c) => c.id === moved)?.questionCount, 6);
    assert.equal(tree.find((c) => c.id === sub.category.id)?.parentId, tree.find((c) => c.id === defaultCategory)!.parentId, "the subcategory goes up to the deleted one's parent");
    await teacher.deleteQuestionCategory(bankId, sub.category.id);
    tree = await teacher.questionCategories(bankId);
    // Moodle keeps a bank's last top-level category, so "moved" goes up there first; then the default one goes.
    await assert.rejects(teacher.deleteQuestionCategory(bankId, defaultCategory, { moveTo: moved }), (error: unknown) => error instanceof QuestionBankError && /only top-level/.test(error.message));
    await teacher.editQuestionCategory(bankId, moved, { parentId: tree.find((c) => c.id === defaultCategory)!.parentId });
    await teacher.deleteQuestionCategory(bankId, defaultCategory, { moveTo: moved });
    tree = await teacher.questionCategories(bankId);
    assert.deepEqual(tree.map((c) => c.id), [moved]);
    // The bank's last top-level category stays.
    await assert.rejects(teacher.deleteQuestionCategory(bankId, moved), (error: unknown) => error instanceof QuestionBankError && /only top-level/.test(error.message));
  });
});
