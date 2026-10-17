// Assignments, the student's side and the teacher's, against the sandbox: reads on course 3's
// assignment, submissions, grading, extensions, a rubric and the marking workflow on a scratch course.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { GradingError, NotAnAssignmentError, SubmissionError, type Moodle } from "../../src/index.js";
import { openForm, setFields, submitForm } from "../../src/internals.js";
import { SITE, as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

/** Course 3's assignment, graded by rubric, as the sandbox seeds it (read only). */
const ASSIGNMENT = 35;
/** Course 3's page "Apuntes: bucles": not an assignment. */
const PAGE = 5;
const SLOW = { timeout: 300_000 };

/** Creates an assignment in the scratch course, shown to students, with its form's settings by name. */
async function createAssignment(course: ScratchCourse, name: string, settings: Record<string, string | number | boolean>): Promise<number> {
  const teacher = await as("teacher");
  const made = await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "assign", name, visibility: "shown", settings });
  assert.ok(made.activityId, made.changed);
  return made.activityId;
}

/**
 * Defines a rubric of two criteria for an assignment graded by rubric, through Moodle's rubric
 * editor (its "Define new grading form from scratch"), and makes it ready for use.
 */
async function defineRubric(teacher: Moodle, activityId: number): Promise<void> {
  const context = await teacher.context();
  const page = await context.newPage();
  let editor: string | undefined;
  try {
    page.setDefaultTimeout(60_000);
    await page.goto(`${SITE}mod/assign/view.php?id=${activityId}`, { waitUntil: "domcontentloaded" });
    const manage = await page.locator('a[href*="grade/grading/manage.php"]').first().getAttribute("href");
    assert.ok(manage, "the assignment links its advanced grading");
    await page.goto(new URL(manage, SITE).href, { waitUntil: "domcontentloaded" });
    editor = (await page.locator('a[href*="form/rubric/edit.php"]').first().getAttribute("href")) ?? undefined;
  } finally {
    await page.close();
  }
  assert.ok(editor, "the advanced grading page offers a new rubric");
  const form = await openForm(context, SITE, new URL(editor, SITE).pathname.replace(/^\//, "") + new URL(editor, SITE).search);
  try {
    // A new rubric's editor has one criterion (NEWID1) with three levels; the second one is added by its button.
    const levels = (criterion: string, names: string[]) =>
      Object.fromEntries(
        names.flatMap((definition, index) => [
          [`rubric[criteria][${criterion}][levels][NEWID${index}][definition]`, definition],
          [`rubric[criteria][${criterion}][levels][NEWID${index}][score]`, index * 5],
        ]),
      );
    await setFields(form, { name: "Suite rubric", "rubric[criteria][NEWID1][description]": "Content", ...levels("NEWID1", ["Poor", "Fair", "Good"]) });
    await submitForm(form, "saverubric");
  } finally {
    await form.close();
  }
}

describe("assignments", () => {
  let studentId: number;
  let teacherId: number;
  let folder: string;
  let file: string;

  before(async () => {
    studentId = await userId("student");
    teacherId = await userId("teacher");
    folder = await mkdtemp(path.join(tmpdir(), "suite-assign-"));
    file = path.join(folder, "suite-answer.txt");
    await writeFile(file, "The suite's submission.\n");
    await writeFile(path.join(folder, "suite-feedback.txt"), "The suite's feedback.\n");
  });

  after(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  describe("reading course 3", () => {
    it("studentAssignment: the seeded assignment as the student sees it, graded", SLOW, async () => {
      const student = await as("student");
      const assignment = await student.studentAssignment(ASSIGNMENT);
      assert.ok(assignment.description);
      assert.ok(assignment.dates.length > 0);
      assert.equal(assignment.graded, true);
      assert.ok(assignment.feedback.some((row) => /\d/.test(row.value)), "the feedback shows the grade");
      await assert.rejects(student.studentAssignment(PAGE), SubmissionError);
    });

    it("rubric: the seeded assignment's rubric, its criteria and levels", SLOW, async () => {
      const teacher = await as("teacher");
      const definition = await teacher.rubric(ASSIGNMENT);
      assert.equal(definition.method, "rubric");
      assert.ok(definition.criteria.length >= 1);
      for (const criterion of definition.criteria) {
        assert.ok(criterion.id > 0 && criterion.description);
        assert.ok((criterion.levels ?? []).length >= 2);
        assert.ok(criterion.levels!.every((level) => level.id > 0 && Number.isFinite(level.score)));
      }
      await assert.rejects(teacher.rubric(PAGE), NotAnAssignmentError);
    });

    it("assignmentSubmissions: every participant of the seeded assignment, without content", SLOW, async () => {
      const teacher = await as("teacher");
      const submissions = await teacher.assignmentSubmissions(ASSIGNMENT, { includeContent: false });
      const mine = submissions.find((s) => s.userId === studentId);
      assert.ok(mine, "the student is a participant");
      assert.ok(mine.fullName);
      assert.equal(mine.content, undefined);
      assert.ok(mine.dueDate);
      await assert.rejects((await as("student")).assignmentSubmissions(ASSIGNMENT));
    });

    it("assignmentSubmissions: the seeded assignment's participants a page at a time, and chosen ones", SLOW, async () => {
      const teacher = await as("teacher");
      const all = await teacher.assignmentSubmissions(ASSIGNMENT, { includeContent: false });
      assert.ok(all.length >= 3, `expected three participants at least, got ${all.length}`);
      const ids = (list: { userId: number }[]) => list.map((s) => s.userId);
      const first = await teacher.assignmentSubmissions(ASSIGNMENT, { includeContent: false, limit: 2 });
      assert.deepEqual([ids(first.items), first.more], [ids(all.slice(0, 2)), true]);
      assert.deepEqual(first.items, all.slice(0, 2));
      const next = await teacher.assignmentSubmissions(ASSIGNMENT, { includeContent: false, limit: 2, offset: 2 });
      assert.deepEqual([ids(next.items), next.more], [ids(all.slice(2, 4)), all.length > 4]);
      assert.deepEqual(ids(await teacher.assignmentSubmissions(ASSIGNMENT, { includeContent: false, userIds: [studentId] })), [studentId]);
    });
  });

  describe("on a scratch course", () => {
    let course: ScratchCourse;
    let simple: number;

    before(async () => {
      course = await scratchCourse("assignments");
      simple = await createAssignment(course, "Suite submissions", {
        assignsubmission_onlinetext_enabled: true,
        assignsubmission_file_enabled: true,
        assignfeedback_comments_enabled: true,
        assignfeedback_file_enabled: true,
        submissiondrafts: 1,
      });
    });

    it("saveSubmission: online text and a file, saved as a draft", SLOW, async () => {
      const student = await as("student");
      const saved = await student.saveSubmission(simple, { onlineText: "<p>The suite's answer</p>", files: [file] });
      assert.equal(saved.assignment.submissionState, "draft");
      assert.ok(saved.assignment.submittedFiles.some((f) => f.name === "suite-answer.txt"));
      assert.equal(saved.assignment.canSubmit, true);
      await assert.rejects(student.saveSubmission(simple, {}), SubmissionError);
    });

    it("submitForGrading: the draft submitted", SLOW, async () => {
      const student = await as("student");
      const submitted = await student.submitForGrading(simple);
      assert.equal(submitted.assignment.submissionState, "submitted");
      assert.equal(submitted.assignment.canSubmit, false);
      // Nothing left to submit.
      await assert.rejects(student.submitForGrading(simple), SubmissionError);
    });

    it("assignmentSubmissions: the student's submission with its content", SLOW, async () => {
      const teacher = await as("teacher");
      const submissions = await teacher.assignmentSubmissions(simple);
      const mine = submissions.find((s) => s.userId === studentId);
      assert.equal(mine?.status, "submitted");
      assert.equal(mine?.submitted, true);
      assert.equal(mine?.needsGrading, true);
      const text = mine?.content?.find((c) => c.plugin === "onlinetext");
      assert.match(text?.text ?? "", /The suite's answer/);
      assert.ok(mine?.content?.some((c) => c.files.some((f) => f.name === "suite-answer.txt")));
      // The same through a page of one and through the student's id: their content read as well.
      const page = await teacher.assignmentSubmissions(simple, { userIds: [studentId], limit: 1 });
      assert.deepEqual([page.items.map((s) => s.userId), page.more], [[studentId], false]);
      assert.deepEqual(page.items[0]?.content, mine?.content);
    });

    it("assignmentSubmissions: reading with content leaves a participant who never submitted without a submission", SLOW, async () => {
      const teacher = await as("teacher");
      const untouched = await createAssignment(course, "Suite never submitted", { assignsubmission_onlinetext_enabled: true });
      // Twice: Moodle's grading panel would create an empty ("new") submission the second read would see.
      for (let read = 1; read <= 2; read++) {
        const row = (await teacher.assignmentSubmissions(untouched)).find((s) => s.userId === studentId);
        assert.equal(row?.status, "none", `read ${read}`);
        assert.equal(row?.content, undefined);
      }
    });

    it("gradeSubmission: a grade with feedback and a feedback file, seen by the student", SLOW, async () => {
      const teacher = await as("teacher");
      const graded = await teacher.gradeSubmission(simple, studentId, { grade: 80, feedback: "<p>Suite feedback</p>", feedbackFiles: [path.join(folder, "suite-feedback.txt")], notify: false });
      assert.equal(Number(graded.grade), 80);
      assert.ok(graded.feedbackFiles?.some((f) => f.name === "suite-feedback.txt"));
      const seen = await (await as("student")).studentAssignment(simple);
      assert.equal(seen.graded, true);
      assert.ok(seen.feedback.some((row) => /80/.test(row.value)));
      assert.ok(seen.feedback.some((row) => /Suite feedback/.test(row.value)));
      assert.ok(seen.feedbackFiles.some((f) => f.name === "suite-feedback.txt"));
      const row = (await teacher.assignmentSubmissions(simple)).find((s) => s.userId === studentId);
      assert.equal(row?.needsGrading, false);
      assert.ok(row?.feedbackFiles?.some((f) => f.name === "suite-feedback.txt"));
      await assert.rejects((await as("student")).gradeSubmission(simple, studentId, { grade: 100 }));
    });

    it("grantExtension: the student's extension, read back from the submissions", SLOW, async () => {
      const teacher = await as("teacher");
      const until = new Date(Date.now() + 30 * 86_400_000);
      until.setUTCSeconds(0, 0);
      await teacher.grantExtension(simple, [studentId], until);
      const row = (await teacher.assignmentSubmissions(simple, { includeContent: false })).find((s) => s.userId === studentId);
      assert.equal(row?.extensionGranted, true);
      assert.ok(row?.extensionDueDate);
      assert.ok(Math.abs(new Date(row.extensionDueDate).getTime() - until.getTime()) < 120_000, `${row.extensionDueDate} is ${until.toISOString()}`);
      await assert.rejects((await as("student")).grantExtension(simple, [studentId], until), NotAnAssignmentError);
    });

    it("rubric: a rubric defined on a scratch assignment, then graded by its levels", SLOW, async () => {
      const teacher = await as("teacher");
      const graded = await createAssignment(course, "Suite rubric", { assignsubmission_onlinetext_enabled: true, advancedgradingmethod_submissions: "rubric" });
      await defineRubric(teacher, graded);
      const definition = await teacher.rubric(graded);
      assert.equal(definition.method, "rubric");
      assert.equal(definition.criteria.length, 1);
      const [criterion] = definition.criteria;
      assert.equal(criterion?.description, "Content");
      assert.deepEqual(
        criterion?.levels?.map((l) => [l.definition, l.score]),
        [
          ["Poor", 0],
          ["Fair", 5],
          ["Good", 10],
        ],
      );
      const good = criterion!.levels![2]!;
      const result = await teacher.gradeSubmission(graded, studentId, { rubric: { [criterion!.id]: good.id }, remarks: { [criterion!.id]: "Suite remark" }, notify: false });
      // A rubric out of 10 points, on a grade out of 100.
      assert.match(result.gradebookGrade ?? "", /100/);
      const seen = await (await as("student")).studentAssignment(graded);
      assert.equal(seen.graded, true);
    });

    it("setGradingDefinition: a rubric defined, read back and replaced; a marking guide defined, used, then refused", SLOW, async () => {
      const teacher = await as("teacher");
      const assignment = await createAssignment(course, "Driver check definitions", { assignsubmission_onlinetext_enabled: true });
      const rubric = await teacher.setGradingDefinition(assignment, {
        method: "rubric",
        name: "Driver check rubric",
        description: "<p>How it's graded</p>",
        criteria: [
          {
            description: "Content",
            levels: [
              { definition: "Poor", score: 0 },
              { definition: "Good", score: 5 },
              { definition: "Great", score: 10 },
            ],
          },
          {
            description: "Style",
            levels: [
              { definition: "Plain", score: 0 },
              { definition: "Clear", score: 2.5 },
            ],
          },
        ],
      });
      assert.deepEqual(
        rubric.criteria.map((c) => [c.description, c.levels?.map((l) => [l.definition, l.score])]),
        [
          [
            "Content",
            [
              ["Poor", 0],
              ["Good", 5],
              ["Great", 10],
            ],
          ],
          [
            "Style",
            [
              ["Plain", 0],
              ["Clear", 2.5],
            ],
          ],
        ],
      );
      const { changed, ...definition } = rubric;
      assert.match(changed, /set its grading method to rubric/);
      assert.deepEqual(await teacher.rubric(assignment), definition);
      const replaced = await teacher.setGradingDefinition(assignment, { method: "rubric", name: "Driver check rubric", criteria: [{ description: "Only", levels: [{ definition: "No", score: 0 }, { definition: "Yes", score: 1 }] }] });
      assert.match(replaced.changed, /^Replaced/);
      assert.deepEqual(replaced.criteria.map((c) => c.description), ["Only"]);
      assert.deepEqual((await teacher.rubric(assignment)).criteria, replaced.criteria);

      const guide = await teacher.setGradingDefinition(assignment, {
        method: "guide",
        name: "Driver check guide",
        criteria: [
          { shortName: "Clarity", description: "Is it clear", markers: "Look at the intro", maxScore: 4 },
          { shortName: "Depth", maxScore: 6 },
        ],
        comments: ["Well done"],
      });
      assert.deepEqual(
        guide.criteria.map((c) => ({ ...c, id: 0 })),
        [
          { id: 0, description: "Clarity", details: "Is it clear", markers: "Look at the intro", maxScore: 4 },
          { id: 0, description: "Depth", maxScore: 6 },
        ],
      );
      const guideDefinition = { assignment: guide.assignment, method: guide.method, criteria: guide.criteria };
      assert.deepEqual(await teacher.rubric(assignment), guideDefinition);
      // Graded with it: changing it would make Moodle ask to regrade, so it's refused and stays.
      const [clarity, depth] = guide.criteria;
      await teacher.gradeSubmission(assignment, studentId, { guide: { [clarity!.id]: 3, [depth!.id]: 5 }, notify: false });
      const another = { method: "rubric" as const, name: "Driver check refused", criteria: [{ description: "X", levels: [{ definition: "A", score: 0 }, { definition: "B", score: 1 }] }] };
      await assert.rejects(teacher.setGradingDefinition(assignment, { method: "guide", name: "Driver check refused", criteria: [{ shortName: "X", maxScore: 1 }] }), /already been used for grading/);
      assert.deepEqual(await teacher.rubric(assignment), guideDefinition);
      // The student can't manage grading forms.
      await assert.rejects((await as("student")).setGradingDefinition(assignment, another), GradingError);
    });

    it("gradeSubmission: a workflow state refused without the marking workflow", SLOW, async () => {
      const teacher = await as("teacher");
      await assert.rejects(teacher.gradeSubmission(simple, studentId, { workflowState: "inmarking" }), GradingError);
    });

    describe("the marking workflow", () => {
      let workflow: number;

      before(async () => {
        workflow = await createAssignment(course, "Suite workflow", { assignsubmission_onlinetext_enabled: true, markingworkflow: 1, markingallocation: 1 });
      });

      it("allocateMarker: the teacher allocated to the student's submission", SLOW, async () => {
        const teacher = await as("teacher");
        await teacher.allocateMarker(workflow, [studentId], teacherId);
        const row = (await teacher.assignmentSubmissions(workflow)).find((s) => s.userId === studentId);
        assert.deepEqual(
          row?.markers?.map((m) => m.id),
          [teacherId],
        );
        await assert.rejects(teacher.allocateMarker(workflow, [studentId], studentId), GradingError);
        await assert.rejects(teacher.allocateMarker(simple, [studentId], teacherId), GradingError);
      });

      it("setWorkflowState: in marking, then released with the grade the student sees", SLOW, async () => {
        const teacher = await as("teacher");
        await teacher.setWorkflowState(workflow, [studentId], "inmarking");
        let row = (await teacher.assignmentSubmissions(workflow)).find((s) => s.userId === studentId);
        assert.equal(row?.workflowState, "inmarking");
        await teacher.gradeSubmission(workflow, studentId, { grade: 55, notify: false });
        assert.equal((await (await as("student")).studentAssignment(workflow)).graded, false, "not released yet");
        await teacher.setWorkflowState(workflow, [studentId], "released");
        row = (await teacher.assignmentSubmissions(workflow)).find((s) => s.userId === studentId);
        assert.equal(row?.workflowState, "released");
        const seen = await (await as("student")).studentAssignment(workflow);
        assert.equal(seen.graded, true);
        assert.ok(seen.feedback.some((r) => /55/.test(r.value)));
        await assert.rejects(teacher.setWorkflowState(simple, [studentId], "inmarking"), GradingError);
        await assert.rejects(teacher.setWorkflowState(workflow, [studentId], "inmarking", { notify: true }), GradingError);
      });
    });
  });
});
