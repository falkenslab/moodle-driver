// Doing activities as a student, against the sandbox: a choice, a lesson, a feedback survey, a SCORM
// and an H5P activity, each made by the teacher (the H5P by the admin) on a scratch course.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { ChoiceError, LessonError, NotAnH5PActivityError, ScormError, SurveyError, type FieldValue, type Moodle } from "../../src/index.js";
import { openForm, setFields, submitForm } from "../../src/internals.js";
import { SITE, as, scratchCourse, type ScratchCourse } from "./harness.js";
import { scormPackage, siteFile } from "./packages.js";

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

  describe("feedback survey", () => {
    let feedbackId: number;

    before(async () => {
      const teacher = await as("teacher");
      feedbackId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "feedback", name: "Driver feedback", visibility: "shown" })).activityId!;
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
  });
});
