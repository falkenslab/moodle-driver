// Questions in the activity plugins with their own: an offline quiz (mod_offlinequiz) filled from a
// shared bank, group by group, and its forms created; a questionnaire (mod_questionnaire) built with
// a question of each type the driver adds, on two pages, then answered by the student so that it
// refuses changes. All in a scratch course, made by the teacher.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { QuizError, SurveyError, type Moodle } from "../../src/index.js";
import { SERIES, as, scratchCourse, type ScratchCourse } from "./harness.js";

const GIFT = `::Paper MC1:: Which number is even? {=4 ~3 ~5}

::Paper MC2:: Which colour is a primary one? {=Red ~Green ~Purple}

::Paper MC3:: Which is a planet? {=Mars ~The Moon ~The Sun}
`;

// The sandbox is shared and can be slow (a page in 20 s under load): every Moodle round trip gets time.
const SLOW = { timeout: 1_200_000 };

describe("plugin questions", () => {
  let course: ScratchCourse;
  let teacher: Moodle;

  before(async () => {
    course = await scratchCourse("plugin-questions");
    teacher = await as("teacher");
  });

  describe("offline quiz", () => {
    let offlineQuizId: number;
    let ids: number[];

    before(async () => {
      // A shared bank (Moodle 5's qbank activity), as for a quiz; on 4.x the course's own bank.
      let bankId = course.id;
      if (!SERIES.startsWith("4.")) {
        await teacher.createActivity({
          courseId: course.id,
          sectionId: course.sectionId,
          type: "qbank",
          name: "Paper bank",
        });
        bankId = (await teacher.questionBanks(course.id)).find(
          (b) => b.type === "qbank" && b.name === "Paper bank",
        )!.id;
      }
      const { categories } = await teacher.questions(bankId);
      const bank = (
        await teacher.importQuestions(bankId, {
          format: "gift",
          text: GIFT,
          categoryId: categories[1]!.id,
        })
      ).questions;
      ids = ["Paper MC1", "Paper MC2", "Paper MC3"].map(
        (name) => bank.find((q) => q.name === name)!.id,
      );
      offlineQuizId = (
        await teacher.createActivity({
          courseId: course.id,
          sectionId: course.sectionId,
          type: "offlinequiz",
          name: "Paper quiz",
          settings: { numgroups: "2" },
        })
      ).activityId!;
    }, SLOW);

    it(
      "offlineQuizGroups: a new offline quiz's two groups, empty and editable",
      SLOW,
      async () => {
        const groups = await teacher.offlineQuizGroups(offlineQuizId);
        assert.equal(groups.formsCreated, false);
        assert.equal(groups.editable, true);
        assert.deepEqual(
          groups.groups.map((g) => [g.number, g.letter, g.slots.length]),
          [
            [1, "A", 0],
            [2, "B", 0],
          ],
        );
      },
    );

    it(
      "addQuestionsToOfflineQuiz: bank questions to group A, then group B in another order",
      SLOW,
      async () => {
        const a = await teacher.addQuestionsToOfflineQuiz(offlineQuizId, {
          questionIds: [ids[0]!, ids[1]!],
        });
        assert.match(a.changed, /Added 2 questions to group A/);
        assert.deepEqual(
          a.group.slots.map((s) => [s.questionId, s.name, s.type, s.page]),
          [
            [ids[0], "Paper MC1", "multichoice", 1],
            [ids[1], "Paper MC2", "multichoice", 1],
          ],
        );
        await teacher.addQuestionsToOfflineQuiz(offlineQuizId, {
          group: 2,
          questionIds: [ids[2]!],
        });
        const b = await teacher.addQuestionsToOfflineQuiz(offlineQuizId, {
          group: 2,
          questionIds: [ids[0]!],
        });
        assert.deepEqual(
          b.group.slots.map((s) => s.questionId),
          [ids[2], ids[0]],
        );
        const groups = await teacher.offlineQuizGroups(offlineQuizId);
        assert.deepEqual(
          groups.groups.map((g) => g.slots.map((s) => s.name)),
          [
            ["Paper MC1", "Paper MC2"],
            ["Paper MC3", "Paper MC1"],
          ],
        );
        assert.equal(groups.groups[0]!.totalMarks, "2.00");
        await assert.rejects(
          teacher.addQuestionsToOfflineQuiz(offlineQuizId, {
            group: 3,
            questionIds: [ids[0]!],
          }),
          QuizError,
        );
      },
    );

    it(
      "createOfflineQuizForms: every group's question, answer and correction forms; then the questions are fixed",
      SLOW,
      async () => {
        const { forms, changed } =
          await teacher.createOfflineQuizForms(offlineQuizId);
        assert.match(changed, /Created the forms/);
        assert.deepEqual(
          forms.map((f) => f.group),
          ["A", "B"],
        );
        for (const form of forms) {
          assert.match(
            form.questionForm ?? "",
            /\/pluginfile\.php\/\d+\/mod_offlinequiz\/pdfs\/0\/question_form_[AB]_/,
          );
          assert.match(form.answerForm ?? "", /answer_form_[AB]_/);
          assert.match(form.correctionForm ?? "", /correction_form_[AB]_/);
        }
        const file = await teacher.downloadFile(
          forms[0]!.questionForm!,
          mkdtempSync(path.join(tmpdir(), "offline-forms-")),
        );
        assert.match(file.name, /\.pdf$/);
        const groups = await teacher.offlineQuizGroups(offlineQuizId);
        assert.equal(groups.formsCreated, true);
        assert.equal(groups.editable, false);
        await assert.rejects(
          teacher.addQuestionsToOfflineQuiz(offlineQuizId, {
            questionIds: [ids[2]!],
          }),
          (error: Error) =>
            error instanceof QuizError &&
            /can't change its questions/.test(error.message),
        );
        assert.match(
          (await teacher.createOfflineQuizForms(offlineQuizId)).changed,
          /had its forms already/,
        );
      },
    );
  });

  describe("questionnaire", () => {
    let questionnaireId: number;

    before(async () => {
      questionnaireId = (
        await teacher.createActivity({
          courseId: course.id,
          sectionId: course.sectionId,
          type: "questionnaire",
          name: "Built questionnaire",
          visibility: "shown",
        })
      ).activityId!;
    }, SLOW);

    it(
      "addQuestionnaireQuestions: a question of each type the driver adds, on two pages, read back in order",
      SLOW,
      async () => {
        assert.deepEqual(
          await teacher.questionnaireQuestions(questionnaireId),
          [],
        );
        // A page break first, or at the end, is refused before anything is saved.
        await assert.rejects(
          teacher.addQuestionnaireQuestions(questionnaireId, [
            { type: "pagebreak" },
            { type: "yesno", question: "Late?" },
          ]),
          SurveyError,
        );
        await assert.rejects(
          teacher.addQuestionnaireQuestions(questionnaireId, [
            { type: "yesno", question: "Late?" },
            { type: "pagebreak" },
          ]),
          SurveyError,
        );
        const { questionIds, questions } =
          await teacher.addQuestionnaireQuestions(questionnaireId, [
            { type: "label", question: "<p>About you</p>" },
            {
              type: "yesno",
              question: "<p>Is it your first course?</p>",
              name: "first",
              required: true,
            },
            {
              type: "text",
              question: "<p>Your town</p>",
              name: "town",
              width: 30,
              maxLength: 60,
            },
            {
              type: "essay",
              question: "<p>What do you expect?</p>",
              name: "expect",
              lines: 10,
              editor: false,
            },
            { type: "pagebreak" },
            {
              type: "radio",
              question: "<p>Level</p>",
              name: "level",
              choices: ["Low", "Right", "High"],
              horizontal: true,
            },
            {
              type: "check",
              question: "<p>Resources used</p>",
              name: "resources",
              choices: ["Videos", "Notes", "!other=Other:"],
              minChecked: 1,
              maxChecked: 2,
            },
            {
              type: "drop",
              question: "<p>Age</p>",
              name: "age",
              choices: ["Under 30", "30 or over"],
            },
            {
              type: "rate",
              question: "<p>Rate them</p>",
              name: "rating",
              choices: ["Contents", "Activities"],
              scale: 4,
              rateKind: "na-column",
              namedDegrees: [
                { value: 1, text: "Bad" },
                { value: 4, text: "Great" },
              ],
            },
            {
              type: "date",
              question: "<p>When did you start?</p>",
              name: "start",
            },
            {
              type: "numeric",
              question: "<p>Hours a week</p>",
              name: "hours",
              maxDigits: 3,
              decimals: 1,
            },
          ]);
        assert.equal(questionIds.length, 11);
        assert.deepEqual(
          questions.map((q) => q.id),
          questionIds,
        );
        assert.deepEqual(
          questions.map((q) => `${q.position}:${q.type}@${q.page}`),
          [
            "1:label@1",
            "2:yesno@1",
            "3:text@1",
            "4:essay@1",
            "5:pagebreak@2",
            "6:radio@2",
            "7:check@2",
            "8:drop@2",
            "9:rate@2",
            "10:date@2",
            "11:numeric@2",
          ],
        );
        const byName = (name: string) =>
          questions.find((q) => q.name === name)!;
        assert.equal(questions[0]!.question, "<p>About you</p>");
        assert.equal(byName("first").required, true);
        assert.equal(byName("town").required, false);
        assert.deepEqual(
          [byName("town").width, byName("town").maxLength],
          [30, 60],
        );
        assert.deepEqual(
          [byName("expect").lines, byName("expect").editor],
          [10, false],
        );
        assert.deepEqual(
          [byName("level").choices, byName("level").horizontal],
          [["Low", "Right", "High"], true],
        );
        assert.deepEqual(
          [
            byName("resources").choices,
            byName("resources").minChecked,
            byName("resources").maxChecked,
          ],
          [["Videos", "Notes", "!other=Other:"], 1, 2],
        );
        assert.deepEqual(byName("age").choices, ["Under 30", "30 or over"]);
        const rating = byName("rating");
        assert.deepEqual(
          [rating.choices, rating.scale, rating.rateKind, rating.namedDegrees],
          [
            ["Contents", "Activities"],
            4,
            "na-column",
            [
              { value: 1, text: "Bad" },
              { value: 4, text: "Great" },
            ],
          ],
        );
        assert.deepEqual(
          [byName("hours").maxDigits, byName("hours").decimals],
          [3, 1],
        );
        assert.deepEqual(
          await teacher.questionnaireQuestions(questionnaireId),
          questions,
        );
      },
    );

    it(
      "addQuestionnaireQuestions: more questions after the others, then refused once the student answered",
      SLOW,
      async () => {
        const more = await teacher.addQuestionnaireQuestions(questionnaireId, [
          { type: "pagebreak" },
          { type: "text", question: "<p>Anything else?</p>", name: "else" },
        ]);
        assert.deepEqual(
          more.questions
            .slice(-2)
            .map((q) => `${q.position}:${q.type}@${q.page}`),
          ["12:pagebreak@3", "13:text@3"],
        );
        const student = await as("student");
        const { questions } = await student.getSurvey(questionnaireId);
        const first = questions.find((q) => /first course/.test(q.text))!
          .fields[0]!;
        await student.submitSurvey(questionnaireId, {
          [first.name]:
            first.options!.find((o) => o.value === "y")?.value ??
            first.options![0]!.value,
        });
        await assert.rejects(
          teacher.addQuestionnaireQuestions(questionnaireId, [
            { type: "yesno", question: "<p>One more?</p>" },
          ]),
          (error: Error) =>
            error instanceof SurveyError &&
            /has responses already/.test(error.message),
        );
        const forced = await teacher.addQuestionnaireQuestions(
          questionnaireId,
          [{ type: "yesno", question: "<p>One more?</p>" }],
          { evenWithResponses: true },
        );
        assert.equal(forced.questions.length, 14);
      },
    );

    it("questionnaireQuestions: not a questionnaire", SLOW, async () => {
      await assert.rejects(
        teacher.questionnaireQuestions(course.sectionId),
        SurveyError,
      );
    });
  });
});
