// Doing activities as a student, against the sandbox: a choice, a lesson, a feedback survey, a
// questionnaire, a SCORM and an H5P activity, each made by the teacher (the H5P by the admin) on a
// scratch course; the choice's and surveys' results read back as the teacher.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { ActivitySettingsError, ChoiceError, ContentBankError, LessonError, MoodleError, NotAnH5PActivityError, ScormError, SurveyError, type FieldValue, type Moodle } from "../../src/index.js";
import { openForm, setFields, submitForm } from "../../src/internals.js";
import { COURSE, SITE, as, cleanup, quietly, scratchCourse, userId, type ScratchCourse } from "./harness.js";
import { notAScormPackage, revisedScormPackage, scormPackage, siteFile } from "./packages.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

/** Saves one of Moodle's forms (a lesson page's, a feedback question's) as the person: what the driver has no function for. */
async function saveForm(moodle: Moodle, pathAndQuery: string, values: Record<string, FieldValue>, button: string): Promise<void> {
  const page = await openForm(await moodle.context(), SITE, pathAndQuery);
  try {
    await setFields(page, values);
    await submitForm(page, button);
  } finally {
    await page.close();
  }
}

describe("doing activities", () => {
  let course: ScratchCourse;
  let pageId: number;

  before(async () => {
    course = await scratchCourse("activities");
    const teacher = await as("teacher");
    // An activity of another module, for the "not a …" errors.
    pageId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Not that", content: "<p>x</p>", visibility: "shown" })).activityId!;
  }, SETUP);

  describe("choice", () => {
    let choiceId: number;

    before(async () => {
      const made = await (await as("teacher")).createActivity({
        courseId: course.id,
        sectionId: course.sectionId,
        type: "choice",
        name: "Driver choice",
        description: "<p>Pick a colour</p>",
        visibility: "shown",
        settings: { "option[0]": "Red", "option[1]": "Blue", allowupdate: 1 },
      });
      choiceId = made.activityId!;
    }, SETUP);

    it("getChoice: its options, open to the student, nothing chosen yet", SLOW, async () => {
      const choice = await (await as("student")).getChoice(choiceId);
      assert.equal(choice.id, choiceId);
      assert.equal(choice.name, "Driver choice");
      assert.match(choice.intro, /Pick a colour/);
      assert.deepEqual(choice.options.map((o) => o.text), ["Red", "Blue"]);
      assert.equal(choice.multiple, false);
      assert.equal(choice.canAnswer, true);
      assert.deepEqual(choice.answer, []);
      await assert.rejects((await as("student")).getChoice(pageId), ChoiceError);
    });

    it("answerChoice: answered, then changed, the answer read back", SLOW, async () => {
      const student = await as("student");
      const { options } = await student.getChoice(choiceId);
      const [red, blue] = options;
      await assert.rejects(student.answerChoice(choiceId, [999_999]), ChoiceError);
      await assert.rejects(student.answerChoice(choiceId, [red!.id, blue!.id]), ChoiceError);
      const answered = await student.answerChoice(choiceId, [red!.id]);
      assert.deepEqual(answered.choice.answer, ["Red"]);
      assert.equal(answered.choice.canChange, true);
      const changed = await student.answerChoice(choiceId, [blue!.id]);
      assert.deepEqual(changed.choice.answer, ["Blue"]);
      assert.deepEqual((await student.getChoice(choiceId)).answer, ["Blue"]);
    });

    it("choiceResults: the student's answer, counted and named, read as the teacher", SLOW, async () => {
      const results = await (await as("teacher")).choiceResults(choiceId);
      const { options } = await (await as("student")).getChoice(choiceId);
      assert.deepEqual(
        results.options.map((o) => [o.id, o.text, o.count]),
        options.map((o) => [o.id, o.text, o.text === "Blue" ? 1 : 0]),
      );
      const me = await (await as("student")).whoAmI();
      assert.deepEqual(results.options.find((o) => o.text === "Blue")!.users, [{ userId: me.userId, fullName: me.fullName }]);
      assert.equal(results.notAnswered, undefined);
      // The student can't read the report; a page isn't a choice.
      await assert.rejects((await as("student")).choiceResults(choiceId), ChoiceError);
      await assert.rejects((await as("teacher")).choiceResults(pageId), ChoiceError);
    });
  });

  describe("lesson", () => {
    let lessonId: number;

    before(async () => {
      const teacher = await as("teacher");
      // Three tries per question: with the site's default of one, a wrong answer moves on instead of asking again.
      lessonId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "lesson", name: "Driver lesson", visibility: "shown", settings: { maxattempts: 3 } })).activityId!;
      // A question page, then a content page before it (pageid 0 puts a page first).
      await saveForm(
        teacher,
        `mod/lesson/editpage.php?id=${lessonId}&pageid=0&qtype=3`,
        {
          title: "The question",
          "contents_editor[text]": "<p>Is the sky blue?</p>",
          "answer_editor[0][text]": "Yes",
          "response_editor[0][text]": "<p>Right.</p>",
          "answer_editor[1][text]": "No",
          "response_editor[1][text]": "<p>Look again.</p>",
        },
        "submitbutton",
      );
      await saveForm(
        teacher,
        `mod/lesson/editpage.php?id=${lessonId}&pageid=0&qtype=20&firstpage=1`,
        { title: "Welcome", "contents_editor[text]": "<p>Read this first.</p>", "answer_editor[0]": "Go to the question", "jumpto[0]": "-1" },
        "submitbutton",
      );
    }, SETUP);

    it("lessonPage: the first page, content with its button", SLOW, async () => {
      const page = await (await as("student")).lessonPage(lessonId);
      assert.equal(page.kind, "content");
      assert.equal(page.title, "Welcome");
      assert.match(page.text, /Read this first/);
      assert.deepEqual(page.buttons, [{ label: "Go to the question", jumpTo: -1 }]);
      await assert.rejects((await as("student")).lessonPage(pageId), LessonError);
    });

    it("answerLessonPage: the button, a wrong answer with its feedback, the right one to the end", SLOW, async () => {
      const student = await as("student");
      await assert.rejects(student.answerLessonPage(lessonId, { button: "No such button" }), LessonError);
      const question = await student.answerLessonPage(lessonId, { button: "Go to the question" });
      assert.equal(question.page.kind, "question");
      // Moodle shows a question page's text, not its title (only content pages have a heading).
      assert.match(question.page.text, /Is the sky blue\?/);
      const field = question.page.fields![0]!;
      // Moodle shuffles a multichoice page's answers.
      assert.deepEqual(field.options?.map((o) => o.label).sort(), ["No", "Yes"]);
      // Where it is now, read again.
      assert.equal((await student.lessonPage(lessonId)).kind, "question");
      await assert.rejects(student.answerLessonPage(lessonId, { button: 0 }), LessonError);
      const value = (label: string) => field.options!.find((o) => o.label === label)!.value;
      const wrong = await student.answerLessonPage(lessonId, { responses: { [field.name]: value("No") } });
      assert.equal(wrong.feedback?.kind, "feedback");
      assert.equal(wrong.feedback?.feedback?.correct, false);
      assert.match(wrong.feedback?.feedback?.response ?? "", /Look again/);
      assert.equal(wrong.page.kind, "question");
      const right = await student.answerLessonPage(lessonId, { responses: { [field.name]: value("Yes") } });
      assert.equal(right.feedback?.feedback?.correct, true);
      assert.match(right.feedback?.feedback?.response ?? "", /Right/);
      assert.equal(right.page.kind, "end");
    });
  });

  describe("lesson pages", () => {
    let lessonId: number;
    const ids: Record<string, number> = {};

    before(async () => {
      const made = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "lesson", name: "Driver check lesson pages", visibility: "shown" });
      lessonId = made.activityId!;
    }, SETUP);

    it("addLessonPage: a branching lesson built from nothing, a jump to no page refused first", SLOW, async () => {
      const teacher = await as("teacher");
      assert.deepEqual(await teacher.lessonPages(lessonId), []);
      const start = await teacher.addLessonPage(lessonId, {
        type: "content",
        title: "Start",
        contents: "<p>Choose a way.</p>",
        buttons: [
          { label: "Take the question", jumpTo: "next-page" },
          { label: "Leave", jumpTo: "end-of-lesson" },
        ],
      });
      ids.start = start.pageId;
      assert.deepEqual(start.pageIds, [ids.start]);
      ids.right = (await teacher.addLessonPage(lessonId, { type: "content", title: "Right", contents: "<p>Well done.</p>", buttons: [{ label: "Finish", jumpTo: "end-of-lesson" }] })).pageId;
      ids.wrong = (await teacher.addLessonPage(lessonId, { type: "content", title: "Wrong", contents: "<p>Not that one.</p>", buttons: [{ label: "Back to the start", jumpTo: ids.start }] })).pageId;
      ids.end = (await teacher.addLessonPage(lessonId, { type: "end-of-branch", answers: [{ jumpTo: ids.start }] })).pageId;
      await assert.rejects(teacher.addLessonPage(lessonId, { type: "content", title: "Nowhere", contents: "<p>x</p>", buttons: [{ label: "Go", jumpTo: 999_999 }] }), (error: Error) => error instanceof LessonError && /no page 999999/.test(error.message));
      // The question goes last, then is moved after the start.
      const question = await teacher.addLessonPage(lessonId, {
        type: "multichoice",
        title: "The question",
        contents: "<p>Is the sky blue?</p>",
        answers: [
          { text: "Yes", response: "<p>Right.</p>", score: 1, jumpTo: ids.right },
          { text: "No", response: "<p>Look again.</p>", score: 0, jumpTo: ids.wrong },
        ],
      });
      ids.question = question.pageId;
      assert.deepEqual(question.pageIds, [ids.start, ids.right, ids.wrong, ids.end, ids.question]);
    });

    it("moveLessonPage: the question after the start", SLOW, async () => {
      const teacher = await as("teacher");
      const moved = await teacher.moveLessonPage(lessonId, ids.question!, ids.start!);
      assert.deepEqual(moved.pageIds, [ids.start, ids.question, ids.right, ids.wrong, ids.end]);
      await assert.rejects(teacher.moveLessonPage(lessonId, ids.question!, ids.question!), LessonError);
    });

    it("editLessonPage: the question renamed, the rest kept", SLOW, async () => {
      const teacher = await as("teacher");
      assert.equal((await teacher.editLessonPage(lessonId, ids.question!, { title: "Sky colour" })).pageId, ids.question);
    });

    it("deleteLessonPage: a page added first, then deleted", SLOW, async () => {
      const teacher = await as("teacher");
      const extra = await teacher.addLessonPage(lessonId, { type: "essay", title: "Driver check extra", contents: "<p>Write.</p>" }, { after: 0 });
      assert.equal(extra.pageIds[0], extra.pageId);
      const deleted = await teacher.deleteLessonPage(lessonId, extra.pageId);
      assert.deepEqual(deleted.pageIds, [ids.start, ids.question, ids.right, ids.wrong, ids.end]);
      await assert.rejects(teacher.deleteLessonPage(lessonId, extra.pageId), LessonError);
    });

    it("lessonPages: the pages read back as set", SLOW, async () => {
      const pages = await (await as("teacher")).lessonPages(lessonId);
      assert.deepEqual(pages.map((p) => [p.id, p.type, p.title]), [
        [ids.start, "content", "Start"],
        [ids.question, "multichoice", "Sky colour"],
        [ids.right, "content", "Right"],
        [ids.wrong, "content", "Wrong"],
        [ids.end, "end-of-branch", pages[4]!.title],
      ]);
      const [start, question, , wrong, end] = pages;
      assert.match(start!.contents, /Choose a way\./);
      assert.deepEqual(start!.buttons, [
        { label: "Take the question", jumpTo: "next-page" },
        { label: "Leave", jumpTo: "end-of-lesson" },
      ]);
      assert.deepEqual(wrong!.buttons, [{ label: "Back to the start", jumpTo: ids.start }]);
      assert.deepEqual(end!.answers, [{ jumpTo: ids.start }]);
      assert.match(question!.contents, /Is the sky blue\?/);
      assert.equal(question!.multipleAnswers, false);
      assert.deepEqual(
        question!.answers!.map((a) => [a.text?.replace(/<[^>]+>/g, ""), a.response?.replace(/<[^>]+>/g, ""), a.score, a.jumpTo]),
        [
          ["Yes", "Right.", 1, ids.right],
          ["No", "Look again.", 0, ids.wrong],
        ],
      );
      await assert.rejects((await as("student")).lessonPages(lessonId), LessonError);
    });

    it("answerLessonPage: the built lesson played through as the student, the right answer leading to its page", SLOW, async () => {
      const student = await as("student");
      const first = await student.lessonPage(lessonId);
      assert.deepEqual([first.kind, first.title, first.buttons?.map((b) => b.label)], ["content", "Start", ["Take the question", "Leave"]]);
      const question = await student.answerLessonPage(lessonId, { button: "Take the question" });
      assert.equal(question.page.kind, "question");
      const field = question.page.fields![0]!;
      const yes = field.options!.find((o) => o.label === "Yes")!.value;
      const answered = await student.answerLessonPage(lessonId, { responses: { [field.name]: yes } });
      assert.deepEqual([answered.page.kind, answered.page.title], ["content", "Right"]);
      const done = await student.answerLessonPage(lessonId, { button: "Finish" });
      assert.equal(done.page.kind, "end");
    });
  });

  describe("feedback survey", () => {
    let feedbackId: number;

    before(async () => {
      const teacher = await as("teacher");
      // Not anonymous (2): the teacher's report names who answered.
      feedbackId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "feedback", name: "Driver feedback", visibility: "shown", settings: { anonymous: 2 } })).activityId!;
      await saveForm(teacher, `mod/feedback/edit_item.php?cmid=${feedbackId}&typ=multichoice`, { name: "Did it help?", label: "help", subtype: "r", values: "Yes\nNo", required: true }, "save_item");
      await saveForm(teacher, `mod/feedback/edit_item.php?cmid=${feedbackId}&typ=textfield`, { name: "What would you change?", label: "change" }, "save_item");
    }, SETUP);

    it("getSurvey: a feedback's questions and their fields, open to the student", SLOW, async () => {
      const survey = await (await as("student")).getSurvey(feedbackId);
      assert.equal(survey.canAnswer, true);
      assert.deepEqual(survey.questions.map((q) => q.text), ["Did it help?", "What would you change?"]);
      assert.equal(survey.questions[0]!.required, true);
      assert.equal(survey.questions[0]!.fields[0]!.kind, "choice");
      assert.ok(survey.questions[0]!.fields[0]!.options!.some((o) => o.label === "Yes"));
      assert.equal(survey.questions[1]!.fields[0]!.kind, "text");
      await assert.rejects((await as("student")).getSurvey(pageId), SurveyError);
    });

    it("submitSurvey: answered and submitted, then closed to the student", SLOW, async () => {
      const student = await as("student");
      const { questions } = await student.getSurvey(feedbackId, "feedback");
      const choice = questions[0]!.fields[0]!;
      const text = questions[1]!.fields[0]!;
      const yes = choice.options!.find((o) => o.label === "Yes")!.value;
      await assert.rejects(student.submitSurvey(feedbackId, { nosuchfield: "x" }), SurveyError);
      const done = await student.submitSurvey(feedbackId, { [choice.name]: yes, [text.name]: "Nothing" });
      assert.match(done.changed, /Submitted feedback/);
      // Answered once: the form isn't offered again.
      const after = await student.getSurvey(feedbackId);
      assert.equal(after.canAnswer, false);
      await assert.rejects(student.submitSurvey(feedbackId, { [text.name]: "Again" }, { type: "feedback" }), SurveyError);
    });

    it("surveyResults: the student's feedback, named, its counts and answers read as the teacher", SLOW, async () => {
      const results = await (await as("teacher")).surveyResults(feedbackId);
      assert.equal(results.type, "feedback");
      assert.equal(results.responses.length, 1);
      const response = results.responses[0]!;
      assert.equal(response.anonymous, false);
      assert.equal(response.userId, await userId("student"));
      assert.equal(response.fullName, (await (await as("student")).whoAmI()).fullName);
      assert.deepEqual(
        results.questions.map((q) => [q.text, q.type]),
        [
          ["Did it help?", "multichoice"],
          ["What would you change?", "textfield"],
        ],
      );
      assert.deepEqual(results.questions[0]!.counts, [
        { option: "Yes", count: 1 },
        { option: "No", count: 0 },
      ]);
      assert.deepEqual(results.questions[0]!.answers, [{ responseId: response.id, values: ["Yes"] }]);
      assert.deepEqual(results.questions[1]!.answers, [{ responseId: response.id, values: ["Nothing"] }]);
      await assert.rejects((await as("student")).surveyResults(feedbackId, { type: "feedback" }), SurveyError);
    });

    it("surveyResults: the content course's anonymous feedback, several options in one answer", SLOW, async () => {
      // Course 3 is only read: its feedback (anonymous, seeded with answers) shows what the scratch one doesn't.
      const teacher = await as("teacher");
      const feedback = (await teacher.courseStructure(COURSE)).flatMap((s) => s.activities).find((a) => a.type === "feedback");
      assert.ok(feedback, "course 3 has a feedback");
      const results = await teacher.surveyResults(feedback.id);
      assert.ok(results.responses.length > 0);
      for (const response of results.responses) {
        assert.deepEqual([response.anonymous, response.userId, response.fullName], [true, undefined, undefined]);
        assert.ok(response.number! > 0);
      }
      assert.ok(results.questions.length > 0 && !results.questions.some((q) => q.type === "pagebreak"));
      for (const question of results.questions) {
        for (const answer of question.answers) assert.ok(results.responses.some((r) => r.id === answer.responseId));
        // The counts add up to the options chosen.
        if (question.counts) assert.equal(question.counts.reduce((n, c) => n + c.count, 0), question.answers.reduce((n, a) => n + a.values.length, 0), question.text);
      }
      const numeric = results.questions.find((q) => q.type === "numeric" && q.answers.length > 0);
      if (numeric) assert.equal(typeof numeric.average, "number");
    });
  });

  describe("feedback items", () => {
    let feedbackId: number;
    const ids: Record<string, number> = {};

    before(async () => {
      // Not anonymous (2): its information items can show the response time.
      feedbackId = (await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "feedback", name: "Driver check items", visibility: "shown", settings: { anonymous: 2 } })).activityId!;
    }, SETUP);

    it("addFeedbackItem: one item of each type, a page break put after the second", SLOW, async () => {
      const teacher = await as("teacher");
      ids.choice = (await teacher.addFeedbackItem(feedbackId, { type: "multichoice", question: "Did it help?", label: "help", required: true, options: ["Yes", "No"] })).itemId;
      ids.rated = (await teacher.addFeedbackItem(feedbackId, { type: "multichoicerated", question: "The pace", options: [{ text: "Slow", weight: 1 }, { text: "Right", weight: 3 }], display: "dropdown" })).itemId;
      ids.short = (await teacher.addFeedbackItem(feedbackId, { type: "textfield", question: "One word" })).itemId;
      ids.long = (await teacher.addFeedbackItem(feedbackId, { type: "textarea", question: "Tell us more" })).itemId;
      ids.numeric = (await teacher.addFeedbackItem(feedbackId, { type: "numeric", question: "Hours a week", range: { from: 0, to: 10 } })).itemId;
      ids.info = (await teacher.addFeedbackItem(feedbackId, { type: "info", question: "Answered on", info: "response-time" })).itemId;
      ids.label = (await teacher.addFeedbackItem(feedbackId, { type: "label", contents: "<p>Thanks for answering.</p>" })).itemId;
      const pagebreak = await teacher.addFeedbackItem(feedbackId, { type: "pagebreak", after: ids.rated });
      ids.pagebreak = pagebreak.itemId;
      assert.deepEqual(pagebreak.itemIds, [ids.choice, ids.rated, ids.pagebreak, ids.short, ids.long, ids.numeric, ids.info, ids.label]);
      await assert.rejects(teacher.addFeedbackItem(feedbackId, { type: "essay" as never, question: "x" }), (error: unknown) => error instanceof SurveyError && /doesn't offer items of type "essay"/.test(error.message));
      await assert.rejects(teacher.addFeedbackItem(pageId, { type: "textfield", question: "x" }), SurveyError);
      await assert.rejects((await as("student")).addFeedbackItem(feedbackId, { type: "textfield", question: "x" }), (error: unknown) => error instanceof SurveyError && /mod\/feedback:edititems/.test(error.message));
    });

    it("editFeedbackItem and moveFeedbackItem: a question changed, a dependency set and removed, the label put first", SLOW, async () => {
      const teacher = await as("teacher");
      await teacher.editFeedbackItem(feedbackId, ids.short!, { question: "One word, please", required: true });
      await teacher.editFeedbackItem(feedbackId, ids.long!, { dependsOn: { itemId: ids.choice!, value: "Yes" } });
      assert.deepEqual((await teacher.feedbackItems(feedbackId)).find((i) => i.id === ids.long)?.dependsOn, { itemId: ids.choice, value: "Yes" });
      await teacher.editFeedbackItem(feedbackId, ids.long!, { dependsOn: null });
      await assert.rejects(teacher.editFeedbackItem(feedbackId, ids.pagebreak!, { question: "x" }), SurveyError);
      const moved = await teacher.moveFeedbackItem(feedbackId, ids.label!, 1);
      assert.deepEqual(moved.itemIds, [ids.label, ids.choice, ids.rated, ids.pagebreak, ids.short, ids.long, ids.numeric, ids.info]);
    });

    it("feedbackItems: read back as built, then answered by the student with submitSurvey", SLOW, async () => {
      const items = await (await as("teacher")).feedbackItems(feedbackId);
      assert.deepEqual(items, [
        { id: ids.label, type: "label", position: 1, question: "", required: false, contents: "<p>Thanks for answering.</p>" },
        { id: ids.choice, type: "multichoice", position: 2, question: "Did it help?", label: "help", required: true, options: [{ text: "Yes" }, { text: "No" }], display: "radio", horizontal: false, hideNotSelected: false, ignoreEmpty: false },
        // A drop-down's rated choice: Moodle saves it with "hide the Not selected option" on.
        { id: ids.rated, type: "multichoicerated", position: 3, question: "The pace", required: false, options: [{ text: "Slow", weight: 1 }, { text: "Right", weight: 3 }], display: "dropdown", horizontal: false, hideNotSelected: true, ignoreEmpty: false },
        { id: ids.pagebreak, type: "pagebreak", position: 4, question: "", required: false },
        { id: ids.short, type: "textfield", position: 5, question: "One word, please", required: true },
        { id: ids.long, type: "textarea", position: 6, question: "Tell us more", required: false },
        { id: ids.numeric, type: "numeric", position: 7, question: "Hours a week", required: false, range: { from: 0, to: 10 } },
        { id: ids.info, type: "info", position: 8, question: "Answered on", required: false, info: "response-time" },
      ]);
      await assert.rejects((await as("student")).feedbackItems(feedbackId), SurveyError);

      const student = await as("student");
      const survey = await student.getSurvey(feedbackId);
      const field = (text: string) => survey.questions.find((q) => q.text.includes(text))?.fields[0];
      const choice = field("Did it help?")!;
      const pace = field("The pace")!;
      assert.deepEqual(new Set(survey.questions.map((q) => q.page)), new Set([0, 1]));
      const done = await student.submitSurvey(feedbackId, {
        [choice.name]: choice.options!.find((o) => o.label === "Yes")!.value,
        [pace.name]: pace.options!.find((o) => o.label.includes("Right"))!.value,
        [field("One word")!.name]: "Clear",
        [field("Tell us more")!.name]: "Nothing else",
        [field("Hours a week")!.name]: "4",
      });
      assert.match(done.changed, /Submitted feedback/);
    });

    it("saveFeedbackTemplate, feedbackTemplates, useFeedbackTemplate and deleteFeedbackTemplate: the items saved, used in another feedback, deleted", SLOW, async () => {
      const teacher = await as("teacher");
      const name = `Driver check template ${Date.now()}`;
      const { templateId } = await teacher.saveFeedbackTemplate(feedbackId, name);
      cleanup(() => teacher.deleteFeedbackTemplate(feedbackId, templateId).catch(() => undefined));
      assert.deepEqual((await teacher.feedbackTemplates(feedbackId)).find((t) => t.id === templateId), { id: templateId, name, public: false });
      const otherId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "feedback", name: "Driver check from template", visibility: "shown" })).activityId!;
      await teacher.addFeedbackItem(otherId, { type: "textfield", question: "Already here" });
      const used = await teacher.useFeedbackTemplate(otherId, templateId);
      assert.equal(used.itemIds.length, 9);
      const types = (await teacher.feedbackItems(otherId)).map((i) => i.type);
      assert.deepEqual(types, ["textfield", "label", "multichoice", "multichoicerated", "pagebreak", "textfield", "textarea", "numeric", "info"]);
      const replaced = await teacher.useFeedbackTemplate(otherId, templateId, { replace: true });
      assert.equal(replaced.itemIds.length, 8);
      assert.equal(replaced.itemIds.some((id) => used.itemIds.includes(id)), false);
      const deleted = await teacher.deleteFeedbackItem(otherId, replaced.itemIds.at(-1)!);
      assert.equal(deleted.itemIds.length, 7);
      await teacher.deleteFeedbackTemplate(feedbackId, templateId);
      assert.equal((await teacher.feedbackTemplates(feedbackId)).some((t) => t.id === templateId), false);
    });

    it("feedbackItems: the content course's feedback, read only", SLOW, async () => {
      const teacher = await as("teacher");
      const feedback = (await teacher.courseStructure(COURSE)).flatMap((s) => s.activities).find((a) => a.type === "feedback");
      assert.ok(feedback, "course 3 has a feedback");
      const items = await teacher.feedbackItems(feedback.id);
      assert.ok(items.length > 0);
      assert.deepEqual(
        items.map((i) => i.position),
        items.map((_, i) => i + 1),
      );
      // Every question its results show is one of its items, of the same type.
      for (const question of (await teacher.surveyResults(feedback.id)).questions) assert.equal(items.find((i) => i.id === question.id)?.type, question.type);
    });
  });

  describe("questionnaire survey", () => {
    let questionnaireId: number;

    before(async () => {
      const teacher = await as("teacher");
      questionnaireId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "questionnaire", name: "Driver questionnaire", visibility: "shown" })).activityId!;
      // Its questions through the question form (questions.php, action=question): radio buttons (4), a text box (2), a number (10).
      const question = (typeId: number, values: Record<string, FieldValue>) =>
        saveForm(teacher, `mod/questionnaire/questions.php?id=${questionnaireId}&action=question&type_id=${typeId}`, { required: "n", ...values }, "submitbutton");
      await question(4, { name: "level", "content[text]": "<p>The level was</p>", allchoices: "Low\nRight\nHigh" });
      await question(2, { name: "best", "content[text]": "<p>The best part</p>" });
      await question(10, { name: "hours", "content[text]": "<p>Hours a week</p>" });
    }, SETUP);

    it("surveyResults: the student's questionnaire, named, its counts and answers read as the teacher", SLOW, async () => {
      // Unanswered, its page doesn't link to the report yet.
      await assert.rejects((await as("teacher")).surveyResults(questionnaireId), SurveyError);
      const student = await as("student");
      const { questions } = await student.getSurvey(questionnaireId);
      const [level, best, hours] = questions.map((q) => q.fields[0]!);
      const right = level!.options!.find((o) => o.label === "Right")!.value;
      await student.submitSurvey(questionnaireId, { [level!.name]: right, [best!.name]: "The examples", [hours!.name]: "5" });

      const results = await (await as("teacher")).surveyResults(questionnaireId);
      assert.equal(results.type, "questionnaire");
      assert.equal(results.responses.length, 1);
      const response = results.responses[0]!;
      assert.deepEqual([response.anonymous, response.fullName], [false, (await student.whoAmI()).fullName]);
      assert.deepEqual(
        results.questions.map((q) => [q.text, q.type]),
        [
          ["The level was", "radio"],
          ["The best part", "text"],
          ["Hours a week", "numeric"],
        ],
      );
      assert.deepEqual(results.questions[0]!.counts, [
        { option: "Low", count: 0 },
        { option: "Right", count: 1 },
        { option: "High", count: 0 },
      ]);
      assert.deepEqual(results.questions[1]!.answers, [{ responseId: response.id, values: ["The examples"] }]);
      assert.equal(results.questions[2]!.average, 5);
      // Students have mod/questionnaire:readallresponses too: a questionnaire's "Students can view ALL
      // responses" setting decides, and this one lets the student read them after answering.
      assert.equal((await student.surveyResults(questionnaireId, { type: "questionnaire" })).responses.length, 1);
      await assert.rejects((await as("teacher")).surveyResults(pageId, { type: "questionnaire" }), SurveyError);
    });

    it("surveyResults: the content course's questionnaire, every kind of question", SLOW, async () => {
      // Course 3 is only read: its questionnaire (seeded) has check boxes, a dropdown, yes/no and a rate question.
      const teacher = await as("teacher");
      const questionnaire = (await teacher.courseStructure(COURSE)).flatMap((s) => s.activities).find((a) => a.type === "questionnaire");
      assert.ok(questionnaire, "course 3 has a questionnaire");
      const results = await teacher.surveyResults(questionnaire.id);
      assert.ok(results.responses.length > 0);
      for (const question of results.questions) {
        assert.ok(question.id > 0 && question.text, JSON.stringify(question));
        for (const answer of question.answers) assert.ok(results.responses.some((r) => r.id === answer.responseId));
      }
      const rate = results.questions.find((q) => q.type === "rate");
      assert.ok(rate && rate.rows!.length > 0, "a rate question with rows");
      for (const row of rate.rows!) assert.equal(row.counts.reduce((n, c) => n + c.count, 0), rate.answers.filter((a) => a.values.some((v) => v.startsWith(`${row.row}: `))).length);
      for (const type of ["check", "drop", "yesno"]) {
        const question = results.questions.find((q) => q.type === type);
        assert.ok(question?.counts, `a ${type} question with counts`);
        assert.equal(question.counts.reduce((n, c) => n + c.count, 0), question.answers.reduce((n, a) => n + a.values.length, 0), type);
      }
    });
  });

  describe("SCORM", () => {
    let scormId: number;

    before(async () => {
      scormId = (await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "scorm", name: "Driver SCORM", files: [scormPackage()], visibility: "shown" })).activityId!;
    }, SETUP);

    it("scorm: its SCO, not attempted yet", SLOW, async () => {
      const activity = await (await as("student")).scorm(scormId);
      assert.equal(activity.id, scormId);
      assert.equal(activity.name, "Driver SCORM");
      assert.equal(activity.attemptsMade, 0);
      assert.deepEqual(activity.attemptGrades, []);
      assert.equal(activity.scos.length, 1);
      assert.equal(activity.scos[0]!.title, "Only lesson");
      assert.equal(activity.scos[0]!.status, "not-attempted");
      await assert.rejects((await as("student")).scorm(pageId), ScormError);
    });

    it("openScorm: the player at the SCO, which reports itself completed", SLOW, async () => {
      const student = await as("student");
      const opened = await student.openScorm(scormId);
      assert.equal(opened.attempt, 1);
      assert.equal(opened.version, "SCORM 1.2");
      assert.match(opened.url, /mod\/scorm\/player\.php/);
      // The package reports through Moodle's API in the player; what Moodle tracked, read from its pages.
      let activity = await student.scorm(scormId);
      for (let i = 0; i < 20 && activity.scos[0]?.status !== "completed"; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        activity = await student.scorm(scormId);
      }
      assert.equal(activity.scos[0]!.id, opened.scoId);
      assert.equal(activity.scos[0]!.status, "completed");
      assert.equal(activity.scos[0]!.score, 80);
      assert.equal(activity.attemptsMade, 1);
      await (await student.tab()).goto("about:blank");
      await assert.rejects(student.openScorm(pageId), ScormError);
    });

    it("updateActivity: a SCORM's new package, in place, its SCO kept with the student's track", SLOW, async () => {
      const teacher = await as("teacher");
      const gradeItems = async () => (await teacher.gradebookSetup(course.id)).items.filter((item) => item.type === "scorm").map((item) => item.id);
      const items = await gradeItems();
      assert.equal(items.length, 1);
      const before = (await (await as("student")).scorm(scormId)).scos;
      const done = await teacher.updateActivity(scormId, { package: revisedScormPackage() });
      assert.match(done.changed, /package replaced by driver-check-scorm-v2\.zip/);
      assert.deepEqual(done.files?.map((f) => f.name), ["driver-check-scorm-v2.zip"]);
      assert.equal(done.scorm?.id, scormId);
      assert.deepEqual(done.scorm?.scos.map((s) => s.title), ["First lesson", "Second lesson"]);
      assert.equal(done.sections.flatMap((s) => s.activities).filter((a) => a.type === "scorm").length, 1);
      assert.deepEqual(await gradeItems(), items);
      // The SCO with the same identifier keeps its id and the student's track; the new one starts not attempted.
      const activity = await (await as("student")).scorm(scormId);
      assert.equal(activity.attemptsMade, 1);
      assert.deepEqual(activity.scos.map((s) => [s.title, s.status]), [["First lesson", "completed"], ["Second lesson", "not-attempted"]]);
      assert.equal(activity.scos[0]!.id, before[0]!.id);
    });

    it("updateActivity: a zip that isn't a SCORM package, refused with nothing changed", SLOW, async () => {
      const teacher = await as("teacher");
      await assert.rejects(teacher.updateActivity(scormId, { package: notAScormPackage() }), ActivitySettingsError);
      assert.deepEqual((await teacher.activitySettings(scormId)).files?.map((f) => f.name), ["driver-check-scorm-v2.zip"]);
      assert.deepEqual((await (await as("student")).scorm(scormId)).scos.map((s) => s.title), ["First lesson", "Second lesson"]);
      await assert.rejects(teacher.updateActivity(pageId, { package: revisedScormPackage() }), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
    });
  });

  describe("H5P", () => {
    let h5pId: number | undefined;
    let missing: string | undefined;

    before(async () => {
      // Moodle's own test package, served by the sandbox; it carries its libraries, which only the admin may install.
      const file = await siteFile(`${SITE}h5p/tests/fixtures/multiple-choice-2-6.h5p`, "multiple-choice.h5p");
      if (!file) {
        missing = "the sandbox doesn't serve an H5P package to upload";
        return;
      }
      const admin = await as("admin");
      h5pId = (await admin.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "h5pactivity", name: "Driver H5P", files: [file], visibility: "shown" })).activityId;
      // The admin's first view deploys the package (its libraries installed).
      await admin.h5pActivity(h5pId!);
    }, SETUP);

    it("h5pActivity: its content type, tracked, and the student's attempts (none)", SLOW, async (t) => {
      if (missing) return t.skip(missing);
      const activity = await (await as("student")).h5pActivity(h5pId!);
      assert.equal(activity.id, h5pId);
      assert.equal(activity.name, "Driver H5P");
      assert.equal(activity.contentType?.library, "H5P.MultiChoice");
      assert.match(activity.contentType?.version ?? "", /^\d+\.\d+$/);
      assert.equal(activity.tracked, true);
      assert.deepEqual(activity.attempts, []);
      await assert.rejects((await as("student")).h5pActivity(pageId), NotAnH5PActivityError);
    });

    describe("content bank", () => {
      // The same package, uploaded by the teacher: its libraries are the site's since the admin's view above.
      let contentId: number | undefined;
      let file: string | undefined;

      before(async () => {
        file = await siteFile(`${SITE}h5p/tests/fixtures/multiple-choice-2-6.h5p`, "driver-check-bank.h5p");
      }, SETUP);

      it("uploadToContentBank: an .h5p package into the course's bank, listed by contentBank with its file", SLOW, async (t) => {
        if (missing || !file) return t.skip(missing ?? "the sandbox doesn't serve an H5P package to upload");
        const teacher = await as("teacher");
        assert.deepEqual(await teacher.contentBank(course.id), []);
        const uploaded = await teacher.uploadToContentBank(course.id, file);
        contentId = uploaded.content.id;
        cleanup(() => quietly(() => teacher.deleteContent(contentId!)));
        assert.match(uploaded.changed, /driver-check-bank\.h5p/);
        const bank = await teacher.contentBank(course.id);
        assert.equal(bank.length, 1);
        const [content] = bank;
        assert.deepEqual({ ...content, modified: undefined }, { ...uploaded.content, modified: undefined });
        assert.equal(content!.id, contentId);
        assert.equal(content!.name, "driver-check-bank.h5p");
        assert.equal(content!.type, "h5p");
        assert.equal(content!.uses, 0);
        assert.equal(content!.unlisted, false);
        assert.ok(content!.size > 1000);
        assert.ok(content!.authorName.length > 0);
        assert.match(content!.modified ?? "", /^\d{4}-\d\d-\d\dT/);
        assert.match(content!.fileUrl ?? "", new RegExp(`/pluginfile\\.php/\\d+/contentbank/public/${contentId}/driver-check-bank\\.h5p$`));
        assert.equal(content!.contentType?.library, "H5P.MultiChoice");
      });

      it("renameContent: a new name, its file's kept", SLOW, async (t) => {
        if (!contentId) return t.skip("nothing was uploaded");
        const teacher = await as("teacher");
        const renamed = await teacher.renameContent(contentId, "Driver check quiz");
        assert.equal(renamed.name, "Driver check quiz");
        const [content] = await teacher.contentBank(course.id);
        assert.equal(content!.name, "Driver check quiz");
        assert.match(content!.fileUrl ?? "", /driver-check-bank\.h5p$/);
        await assert.rejects(teacher.renameContent(contentId, "  "), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
      });

      it("downloadContent: the package saved, as big as the bank says", SLOW, async (t) => {
        if (!contentId) return t.skip("nothing was uploaded");
        const teacher = await as("teacher");
        const dir = mkdtempSync(path.join(tmpdir(), "driver-bank-"));
        try {
          const saved = await teacher.downloadContent(contentId, dir);
          assert.equal(saved.name, "driver-check-bank.h5p");
          assert.equal(saved.size, statSync(file!).size);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      });

      it("contentBank: refused to a student, and a file the bank doesn't take refused", SLOW, async (t) => {
        if (!contentId) return t.skip("nothing was uploaded");
        await assert.rejects((await as("student")).contentBank(course.id), (error: unknown) => error instanceof ContentBankError && /moodle\/contentbank:access/.test(error.message));
        await assert.rejects((await as("student")).deleteContent(contentId), (error: unknown) => error instanceof ContentBankError && /deleteowncontent/.test(error.message));
        await assert.rejects((await as("teacher")).uploadToContentBank(course.id, notAScormPackage()), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
      });

      it("deleteContent: gone from the bank, and a second time refused", SLOW, async (t) => {
        if (!contentId) return t.skip("nothing was uploaded");
        const teacher = await as("teacher");
        assert.match((await teacher.deleteContent(contentId)).changed, new RegExp(`${contentId}`));
        assert.deepEqual(await teacher.contentBank(course.id), []);
        await assert.rejects(teacher.deleteContent(contentId), ContentBankError);
        await assert.rejects(teacher.downloadContent(contentId, tmpdir()), ContentBankError);
      });
    });
  });
});
