// Question banks against the sandbox: a shared bank (qbank) made in the scratch course, filled by
// imports (GIFT and Moodle XML files written here) and the types' forms, then changed and emptied.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { QuestionBankError, type BankQuestion, type Moodle } from "../../src/index.js";
import { COURSE, as, cleanup, scratchCourse, type ScratchCourse } from "./harness.js";

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

  before(async () => {
    course = await scratchCourse("questions");
    teacher = await as("teacher");
    bankId = await makeBank(teacher, course, "Sandbox bank");
    dir = await mkdtemp(path.join(tmpdir(), "questions-sandbox-"));
    cleanup(() => rm(dir, { recursive: true, force: true }));
  });

  it("questionBanks: the scratch course's shared bank, and course 3's banks", SLOW, async () => {
    const banks = await teacher.questionBanks(course.id);
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

  it("questions: an activity that keeps no questions is refused", SLOW, async () => {
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
    await assert.rejects(teacher.createQuestion(bankId, { type: "match" as never, name: "x", text: "x" }), QuestionBankError);
    await assert.rejects(teacher.createQuestion(bankId, { type: "multichoice", name: "x", text: "x" }), QuestionBankError);
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
