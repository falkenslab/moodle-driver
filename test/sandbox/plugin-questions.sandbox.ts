// Questions in the activity plugins with their own: a questionnaire (mod_questionnaire) built with
// a question of each type the driver adds, on two pages, then answered by the student so that it
// refuses changes. All in a scratch course, made by the teacher.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { SurveyError, type Moodle } from "../../src/index.js";
import { as, scratchCourse, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow (a page in 20 s under load): every Moodle round trip gets time.
const SLOW = { timeout: 1_200_000 };

describe("plugin questions", () => {
  let course: ScratchCourse;
  let teacher: Moodle;

  before(async () => {
    course = await scratchCourse("plugin-questions");
    teacher = await as("teacher");
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
