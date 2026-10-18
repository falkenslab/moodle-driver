// Quizzes against the sandbox: course 3's quizzes read; in the scratch course a shared bank filled
// from GIFT (on Moodle 4.x the course's own bank), one quiz built and rearranged by the teacher, and another the student attempts with the
// driver and the teacher grades (an essay by hand).
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { FormError, QuizError, type BankQuestion, type Moodle, type Question, type QuizStatistics } from "../../src/index.js";
import { COURSE, SERIES, as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

const GIFT = `::Quiz TF:: The sandbox runs Moodle. {T}

::Quiz MC:: Which number is even? {=4 ~3 ~5}

::Quiz SA:: The capital of France? {=Paris}

::Quiz ES:: Explain what a loop is. {}
`;

// The sandbox is shared and can be slow (a page in 20 s under load): every Moodle round trip gets time.
const SLOW = { timeout: 1_200_000 };

describe("quizzes", () => {
  let course: ScratchCourse;
  let teacher: Moodle;
  let student: Moodle;
  let bank: BankQuestion[];
  let categoryId: number;
  const id = (name: string) => bank.find((q) => q.name === name)!.id;

  before(async () => {
    course = await scratchCourse("quizzes");
    teacher = await as("teacher");
    student = await as("student");
    // A qbank isn't on the course page, so createActivity can't name it: the course's banks do.
    // Moodle 4.x has no qbank activities: the course's own bank, whose id is the course's.
    let bankId = course.id;
    if (!SERIES.startsWith("4.")) {
      await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "qbank", name: "Quiz bank" });
      bankId = (await teacher.questionBanks(course.id)).find((b) => b.type === "qbank" && b.name === "Quiz bank")!.id;
    }
    const { categories } = await teacher.questions(bankId);
    categoryId = categories[1]!.id;
    bank = (await teacher.importQuestions(bankId, { format: "gift", text: GIFT, categoryId })).questions;
    assert.equal(bank.length, 4);
  });

  describe("course 3's quizzes, read", () => {
    let quizId: number | undefined;
    before(async () => {
      const sections = await teacher.courseStructure(COURSE);
      quizId = sections.flatMap((s) => s.activities).find((a) => a.type === "quiz" && a.visible)?.id;
    });

    it("quizInfo: a quiz of the content course, as the student", SLOW, async (t) => {
      if (!quizId) return t.skip("course 3 has no visible quiz");
      const info = await student.quizInfo(quizId);
      assert.ok(info.info.length > 0 || info.dates.length > 0 || info.intro !== undefined);
      for (const attempt of info.attempts) assert.ok(attempt.id > 0 && attempt.details.length > 0);
    });

    it("quizStructure: a quiz of the content course, as the teacher", SLOW, async (t) => {
      if (!quizId) return t.skip("course 3 has no visible quiz");
      const { slots, sections } = await teacher.quizStructure(quizId);
      assert.ok(slots.length > 0);
      assert.deepEqual(slots.map((s) => s.slot), slots.map((_, i) => i + 1));
      assert.equal(sections[0]?.firstSlot, 1);
    });

    it("quizResults: a quiz of the content course, as the teacher", SLOW, async (t) => {
      if (!quizId) return t.skip("course 3 has no visible quiz");
      const { attempts } = await teacher.quizResults(quizId);
      for (const attempt of attempts) assert.ok(attempt.id > 0 && attempt.userId > 0 && attempt.fullName);
    });

    it("quizStatistics: a quiz of the content course with attempts, all and first, as the teacher", SLOW, async (t) => {
      // Read only: what Moodle stored is read, or calculated and stored as the report does when opened; never recalculated here.
      const quizzes = (await teacher.courseStructure(COURSE)).flatMap((s) => s.activities).filter((a) => a.type === "quiz");
      let all: QuizStatistics | undefined;
      let quiz: number | undefined;
      for (const { id: candidate } of quizzes) {
        all = await teacher.quizStatistics(candidate, { attempts: "all" }).catch(() => undefined);
        if (all) {
          quiz = candidate;
          break;
        }
      }
      if (!all || !quiz) return t.skip("course 3 has no quiz with graded attempts");
      assert.equal(all.attempts, "all");
      assert.ok(all.figures.allAttemptsCount! >= all.figures.firstAttemptsCount! && all.figures.firstAttemptsCount! >= 1, JSON.stringify(all.figures));
      const { slots } = await teacher.quizStructure(quiz);
      assert.deepEqual(all.questions.map((q) => q.slot), slots.filter((s) => s.type !== "description").map((s) => s.slot));
      assert.ok(all.questions.every((q) => q.name && q.attempts), JSON.stringify(all.questions));
      const first = await teacher.quizStatistics(quiz, { attempts: "first" });
      assert.equal(first.attempts, "first");
      assert.equal(first.figures.firstAttemptsCount, all.figures.firstAttemptsCount);
      for (const q of first.questions.filter((q) => !q.parts)) assert.equal(Number(q.attempts), first.figures.firstAttemptsCount, JSON.stringify(q));
    });

    it("quizResults: a student can't read them", SLOW, async (t) => {
      if (!quizId) return t.skip("course 3 has no visible quiz");
      await assert.rejects(student.quizResults(quizId), QuizError);
    });
  });

  describe("a quiz built and rearranged", () => {
    let quizId: number;
    before(async () => {
      quizId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "quiz", name: "Built quiz" })).activityId!;
    });

    it("addQuestionsToQuiz: bank questions by id, then a random one", SLOW, async () => {
      const chosen = await teacher.addQuestionsToQuiz(quizId, { questionIds: [id("Quiz TF"), id("Quiz MC"), id("Quiz SA")] });
      assert.deepEqual(chosen.slots.map((s) => [s.slot, s.questionId, s.type]), [
        [1, id("Quiz TF"), "truefalse"],
        [2, id("Quiz MC"), "multichoice"],
        [3, id("Quiz SA"), "shortanswer"],
      ]);
      const random = await teacher.addQuestionsToQuiz(quizId, { random: { categoryId, count: 1 } });
      assert.equal(random.slots.length, 4);
      assert.equal(random.slots[3]?.type, "random");
    });

    it("addQuestionsToQuiz: nothing to add", async () => {
      await assert.rejects(teacher.addQuestionsToQuiz(quizId, {}), QuizError);
    });

    it("quizStructure: the slots added, read back", SLOW, async () => {
      const { slots, sections } = await teacher.quizStructure(quizId);
      assert.deepEqual(slots.map((s) => s.name).slice(0, 3), ["Quiz TF", "Quiz MC", "Quiz SA"]);
      assert.equal(sections.length, 1);
      assert.equal(sections[0]!.heading, "");
    });

    it("quizStructure: a student can't edit it", SLOW, async () => {
      await assert.rejects(student.quizStructure(quizId), QuizError);
    });

    it("editQuizSlot: a slot's mark, then moved first", SLOW, async () => {
      const marked = await teacher.editQuizSlot(quizId, 2, { maxMark: 2 });
      assert.match(marked.slots[1]!.mark ?? "", /^2[.,]00$/);
      const moved = await teacher.editQuizSlot(quizId, 3, { moveAfter: 0 });
      assert.deepEqual(moved.slots.map((s) => s.name).slice(0, 3), ["Quiz SA", "Quiz TF", "Quiz MC"]);
      const read = await teacher.quizStructure(quizId);
      assert.deepEqual(read.slots.map((s) => s.name).slice(0, 3), ["Quiz SA", "Quiz TF", "Quiz MC"]);
      assert.match(read.slots[2]!.mark ?? "", /^2[.,]00$/);
    });

    it("editQuizSlot: a slot the quiz doesn't have", SLOW, async () => {
      await assert.rejects(teacher.editQuizSlot(quizId, 99, { maxMark: 1 }), QuizError);
    });

    it("setQuizPages: one question a page, then breaks after slot 2 only", SLOW, async () => {
      const each = await teacher.setQuizPages(quizId, { perPage: 1 });
      assert.deepEqual(each.slots.map((s) => s.page), [1, 2, 3, 4]);
      const two = await teacher.setQuizPages(quizId, { breaksAfter: [2] });
      assert.deepEqual(two.slots.map((s) => s.page), [1, 1, 2, 2]);
      assert.deepEqual((await teacher.quizStructure(quizId)).slots.map((s) => s.page), [1, 1, 2, 2]);
    });

    it("addQuizSection: a shuffled section from slot 3", SLOW, async () => {
      await assert.rejects(teacher.addQuizSection(quizId, { firstSlot: 2, heading: "Mid-page" }), QuizError);
      const { sectionId } = await teacher.addQuizSection(quizId, { firstSlot: 3, heading: "Part two", shuffle: true });
      const { sections } = await teacher.quizStructure(quizId);
      assert.deepEqual(sections.find((s) => s.id === sectionId), { id: sectionId, heading: "Part two", firstSlot: 3, shuffle: true });
    });

    it("removeQuizSlot: the random slot removed, its question kept in the bank", SLOW, async () => {
      const { slots } = await teacher.removeQuizSlot(quizId, 4);
      assert.equal(slots.length, 3);
      assert.ok(slots.every((s) => s.type !== "random"));
      assert.equal((await teacher.quizStructure(quizId)).slots.length, 3);
    });
  });

  describe("a quiz attempted by the student and graded by the teacher", () => {
    let quizId: number;
    let attemptId: number;
    let questions: Question[];
    const field = (slot: number, kind: string) => questions.find((q) => q.slot === slot)!.fields.find((f) => f.kind === kind)!;

    before(async () => {
      quizId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "quiz", name: "Attempted quiz", visibility: "shown" })).activityId!;
      await teacher.addQuestionsToQuiz(quizId, { questionIds: [id("Quiz TF"), id("Quiz MC"), id("Quiz ES")] });
    });

    it("quizInfo: the student can start, with no attempts yet", SLOW, async () => {
      const info = await student.quizInfo(quizId);
      assert.equal(info.canStart, true);
      assert.deepEqual(info.attempts, []);
    });

    it("quizInfo: an activity that isn't a quiz", SLOW, async () => {
      // Any activity of the course but a quiz (Moodle 4.x has no question bank activity to use here).
      const other = (await teacher.courseStructure(course.id)).flatMap((s) => s.activities).find((a) => a.type !== "quiz");
      assert.ok(other, "the course has an activity that isn't a quiz");
      await assert.rejects(teacher.quizInfo(other.id), QuizError);
    });

    it("startQuizAttempt: an attempt with the quiz's three questions", SLOW, async () => {
      const started = await student.startQuizAttempt(quizId);
      attemptId = started.attemptId;
      questions = started.questions;
      assert.ok(attemptId > 0);
      assert.deepEqual(questions.map((q) => [q.slot, q.type]), [
        [1, "truefalse"],
        [2, "multichoice"],
        [3, "essay"],
      ]);
      assert.ok(questions.every((q) => q.state === "notyetanswered"), JSON.stringify(questions.map((q) => q.state)));
    });

    it("readAttempt: the open attempt's questions, page by page", SLOW, async () => {
      const read = await student.readAttempt(attemptId);
      assert.deepEqual(read.map((q) => q.slot), [1, 2, 3]);
      assert.ok(read.every((q) => q.page !== undefined));
      assert.ok(read[0]!.text.includes("The sandbox runs Moodle."));
      assert.ok(field(2, "choice").options!.some((o) => o.label === "4"), JSON.stringify(field(2, "choice")));
    });

    it("readAttempt: the teacher can't read the student's open attempt", SLOW, async () => {
      await assert.rejects(teacher.readAttempt(attemptId), QuizError);
    });

    it("answerQuizQuestions: the three answers saved", SLOW, async () => {
      const tf = field(1, "choice");
      const mc = field(2, "choice");
      const essay = questions.find((q) => q.slot === 3)!.fields.find((f) => f.kind === "text" && /_answer$/.test(f.name))!;
      assert.ok(essay, JSON.stringify(questions[2]!.fields));
      const answered = await student.answerQuizQuestions(
        attemptId,
        [
          { slot: 1, responses: { [tf.name]: tf.options!.find((o) => o.label === "True")!.value } },
          { slot: 2, responses: { [mc.name]: mc.options!.find((o) => o.label === "4")!.value } },
          { slot: 3, responses: { [essay.name]: "A loop repeats a block while a condition holds." } },
        ],
        { trail: "fast" },
      );
      assert.ok(answered.questions.every((q) => q.state === "answersaved"), JSON.stringify(answered.questions.map((q) => q.state)));
      const read = await student.readAttempt(attemptId);
      assert.equal(read[0]!.fields[0]!.value, tf.options!.find((o) => o.label === "True")!.value);
      assert.match(read[2]!.fields.find((f) => f.name === essay.name)?.value ?? "", /A loop repeats a block/);
    });

    it("answerQuizQuestions: a slot the attempt doesn't have", SLOW, async () => {
      await assert.rejects(student.answerQuizQuestions(attemptId, [{ slot: 9, responses: { x: "1" } }], { trail: "fast" }), QuizError);
    });

    it("finishQuizAttempt: submitted, with its review", SLOW, async () => {
      const done = await student.finishQuizAttempt(attemptId);
      assert.equal(done.finished, true);
      assert.ok(done.review, "the default review options show the review right after");
      assert.deepEqual(done.review.questions.map((q) => q.state).slice(0, 2), ["correct", "correct"]);
      await assert.rejects(student.finishQuizAttempt(attemptId), QuizError);
    });

    it("readReview: the student's finished attempt", SLOW, async () => {
      const review = await student.readReview(attemptId);
      assert.ok(review.summary.length > 0);
      assert.deepEqual(review.questions.map((q) => q.slot), [1, 2, 3]);
      assert.notEqual(review.questions[2]!.state, "correct");
    });

    it("quizInfo: the finished attempt listed", SLOW, async () => {
      const info = await student.quizInfo(quizId);
      assert.deepEqual(info.attempts.map((a) => [a.id, a.inProgress]), [[attemptId, false]]);
    });

    it("quizResults: the student's attempt, with its responses", SLOW, async () => {
      const { attempts } = await teacher.quizResults(quizId, { responses: true });
      const attempt = attempts.find((a) => a.id === attemptId);
      assert.ok(attempt, JSON.stringify(attempts));
      assert.equal(attempt.userId, await userId("student"));
      assert.deepEqual(attempt.questions.map((q) => q.slot), [1, 2, 3]);
      assert.equal(attempt.questions[0]!.result, "correct");
      assert.equal(attempt.questions[2]!.result, "requiresgrading");
      assert.equal(attempt.questions[0]!.response, "True");
      assert.match(attempt.questions[1]!.response ?? "", /4/);
    });

    it("questionsToGrade: the essay waiting, with the student's attempt", SLOW, async () => {
      const { questions: waiting } = await teacher.questionsToGrade(quizId);
      const essay = waiting.find((q) => q.slot === 3);
      assert.ok(essay, JSON.stringify(waiting));
      assert.equal(essay.type, "essay");
      assert.equal(essay.toGrade, 1);
      assert.deepEqual(essay.attempts.map((a) => a.id), [attemptId]);
    });

    it("questionsToGrade: a student can't grade", SLOW, async () => {
      await assert.rejects(student.questionsToGrade(quizId), QuizError);
    });

    it("gradeQuizQuestion: the essay graded with a comment the student reads", SLOW, async () => {
      await assert.rejects(teacher.gradeQuizQuestion(attemptId, 3, { mark: 50 }), FormError);
      await assert.rejects(student.gradeQuizQuestion(attemptId, 3, { mark: 1 }), QuizError);
      const graded = await teacher.gradeQuizQuestion(attemptId, 3, { mark: 0.5, comment: "<p>A good start.</p>" });
      assert.equal(graded.maxMark, 1);
      assert.ok(graded.grade, graded.changed);
      const essay = (await teacher.questionsToGrade(quizId)).questions.find((q) => q.slot === 3)!;
      assert.deepEqual([essay.toGrade, essay.graded, essay.attempts], [0, 1, []]);
      const review = await student.readReview(attemptId);
      assert.equal(review.questions[2]!.comment, "A good start.");
    });

    it("addQuestionsToQuiz: refused once the quiz has attempts", SLOW, async () => {
      await assert.rejects(teacher.addQuestionsToQuiz(quizId, { questionIds: [id("Quiz SA")] }), QuizError);
    });

    it("setQuizOverride: the student limited to one attempt, so can't start another", SLOW, async () => {
      assert.equal((await student.quizInfo(quizId)).canStart, true);
      await teacher.setQuizOverride(quizId, await userId("student"), { attempts: 1 });
      const info = await student.quizInfo(quizId);
      assert.equal(info.canStart, false);
      await assert.rejects(student.startQuizAttempt(quizId), QuizError);
      // A second override for the same user is refused.
      await assert.rejects(teacher.setQuizOverride(quizId, await userId("student"), { attempts: 2 }), QuizError);
    });
  });

  describe("a quiz's statistics (#78)", () => {
    let quizId: number;
    let bankIds: number[];
    // The student's answers, right for each of the bank's questions (the random slot may draw any).
    const answers = (questions: Question[]) =>
      questions.map((q) => {
        const choice = q.fields.find((f) => f.kind === "choice");
        const text = q.fields.find((f) => f.kind === "text" && /_answer$/.test(f.name));
        const pick = (label: string) => ({ [choice!.name]: choice!.options!.find((o) => o.label === label)!.value });
        if (q.type === "truefalse") return { slot: q.slot, responses: pick("True") };
        if (q.type === "multichoice") return { slot: q.slot, responses: pick("4") };
        return { slot: q.slot, responses: { [text!.name]: q.type === "shortanswer" ? "Paris" : "A loop repeats a block." } };
      });
    // An attempt by the student, answered and finished; an essay drawn by the random slot graded, so the attempt counts.
    const attempt = async () => {
      const { attemptId, questions } = await student.startQuizAttempt(quizId);
      await student.answerQuizQuestions(attemptId, answers(questions), { trail: "fast" });
      await student.finishQuizAttempt(attemptId);
      for (const q of questions.filter((q) => q.type === "essay")) await teacher.gradeQuizQuestion(attemptId, q.slot, { mark: 1 });
    };

    before(async () => {
      quizId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "quiz", name: "Driver check statistics", visibility: "shown" })).activityId!;
      bankIds = bank.map((q) => q.id);
      await teacher.addQuestionsToQuiz(quizId, { questionIds: [id("Quiz TF"), id("Quiz MC"), id("Quiz SA")] });
      await teacher.addQuestionsToQuiz(quizId, { random: { categoryId, count: 1 } });
    });

    it("quizStatistics: a quiz without attempts, and a student, refused", SLOW, async () => {
      await assert.rejects(teacher.quizStatistics(quizId), (error: unknown) => error instanceof QuizError && /no finished, graded attempts/.test(error.message));
      await assert.rejects(student.quizStatistics(quizId), (error: unknown) => error instanceof QuizError && /quiz\/statistics:view/.test(error.message));
    });

    it("quizStatistics: the student's attempt, its figures, each question and its responses", SLOW, async () => {
      await attempt();
      const stats = await teacher.quizStatistics(quizId, { attempts: "all", responses: true });
      assert.equal(stats.attempts, "all");
      assert.deepEqual([stats.figures.firstAttemptsCount, stats.figures.allAttemptsCount], [1, 1]);
      assert.match(stats.figures.allAttemptsAverage ?? "", /^100[.,]00\s?%$/);
      assert.match(stats.figures.median ?? "", /%$/);
      assert.equal(stats.calculatedNow, true);
      assert.deepEqual(stats.questions.map((q) => [q.slot, q.type, q.attempts]), [
        [1, "truefalse", "1"],
        [2, "multichoice", "1"],
        [3, "shortanswer", "1"],
        [4, "random", "1"],
      ]);
      assert.equal(stats.questions[0]!.questionId, id("Quiz TF"));
      assert.match(stats.questions[0]!.randomGuessScore ?? "", /^50[.,]00\s?%$/);
      const tf = stats.questions[0]!.responses!;
      assert.equal(tf.find((r) => r.count === 1)?.model, "True", JSON.stringify(tf));
      assert.deepEqual(tf.map((r) => r.count).reduce((a, b) => a + b, 0), 1);
      const sa = stats.questions[2]!.responses!;
      assert.ok(sa.some((r) => r.model === "Paris" && r.count === 1), JSON.stringify(sa));
      // The random slot: the question it drew, with its own figures and responses.
      const parts = stats.questions[3]!.parts!;
      assert.equal(parts.length, 1, JSON.stringify(stats.questions[3]));
      assert.ok(bankIds.includes(parts[0]!.questionId!), JSON.stringify(parts));
      assert.equal(parts[0]!.attempts, "1");
      if (parts[0]!.type !== "essay") assert.ok(parts[0]!.responses?.some((r) => r.count === 1), JSON.stringify(parts));
    });

    it("quizStatistics: first attempts, stored until recalculated", SLOW, async () => {
      await attempt();
      const stored = await teacher.quizStatistics(quizId, { attempts: "all" });
      assert.deepEqual([stored.figures.allAttemptsCount, stored.calculatedNow, stored.calculated?.attemptsSince], [1, false, 1]);
      const fresh = await teacher.quizStatistics(quizId, { attempts: "all", recalculate: true });
      assert.deepEqual([fresh.figures.allAttemptsCount, fresh.calculatedNow], [2, true]);
      assert.ok(fresh.questions.every((q) => q.attempts === "2"), JSON.stringify(fresh.questions));
      const first = await teacher.quizStatistics(quizId, { attempts: "first", recalculate: true });
      assert.equal(first.attempts, "first");
      assert.deepEqual([first.figures.firstAttemptsCount, first.figures.allAttemptsCount], [1, 2]);
      assert.ok(first.questions.every((q) => q.attempts === "1"), JSON.stringify(first.questions));
    });
  });

  describe("a quiz that asks before an attempt (#56)", () => {
    const quiz = async (name: string, settings: Record<string, string | number | boolean>) => {
      const quizId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "quiz", name, visibility: "shown", settings })).activityId!;
      await teacher.addQuestionsToQuiz(quizId, { questionIds: [id("Quiz TF")] });
      return quizId;
    };

    it("startQuizAttempt: a quiz with a time limit, its confirmation dialog accepted, then finished", SLOW, async () => {
      const quizId = await quiz("Timed quiz", { "timelimit[enabled]": true, "timelimit[number]": 20, "timelimit[timeunit]": 60 });
      const started = await student.startQuizAttempt(quizId);
      assert.ok(started.attemptId > 0);
      assert.deepEqual(started.questions.map((q) => q.type), ["truefalse"]);
      assert.equal((await student.finishQuizAttempt(started.attemptId)).finished, true);
      assert.deepEqual((await student.quizInfo(quizId)).attempts.map((a) => [a.id, a.inProgress]), [[started.attemptId, false]]);
    });

    it("startQuizAttempt: a quiz with a password refused, no attempt made", SLOW, async () => {
      const quizId = await quiz("Password quiz", { quizpassword: "driver-check" });
      await assert.rejects(student.startQuizAttempt(quizId), (error: unknown) => error instanceof QuizError && /password/.test(error.message));
      assert.deepEqual((await student.quizInfo(quizId)).attempts, []);
    });
  });
});
