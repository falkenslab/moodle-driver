// Workshops' assessment forms against the sandbox: a workshop per grading strategy made on the
// scratch course, its form set by the teacher and read back; the student can't read it; once the
// teacher assessed a submission with it, a change is refused unless asked.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MoodleError, WorkshopError, type WorkshopForm, type WorkshopFormInput, type WorkshopStrategy } from "../../src/index.js";
import { as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

/** Creates a workshop with a grading strategy on the scratch course as the teacher; its id. */
async function newWorkshop(course: ScratchCourse, strategy: WorkshopStrategy): Promise<number> {
  const created = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "workshop", name: `Driver check suite ${strategy} form`, visibility: "shown", settings: { strategy } });
  assert.ok(created.activityId, `the workshop wasn't created: ${created.changed}`);
  return created.activityId;
}

/** The form read, without the ids Moodle gave, to compare with what was set. */
function withoutIds(form: WorkshopForm): unknown {
  return JSON.parse(JSON.stringify(form, (key, value: unknown) => (key === "id" || key === "activityId" ? undefined : value)));
}

describe("workshop assessment forms on the scratch course", () => {
  let course: ScratchCourse;
  const ids = {} as Record<WorkshopStrategy, number>;

  before(async () => {
    course = await scratchCourse("workshopform");
    for (const strategy of ["accumulative", "comments", "numerrors", "rubric"] as const) ids[strategy] = await newWorkshop(course, strategy);
  });

  it("setWorkshopForm: an accumulative form, points and a scale, read back the same", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const input: WorkshopFormInput = {
      strategy: "accumulative",
      criteria: [
        { description: "<p>Is it clear?</p>", maxGrade: 20, weight: 2 },
        { description: "<p>Is it tidy?</p>", scaleId: 2 },
        { description: "<p>Is it complete?</p>" },
        { description: "<p>Is it original?</p>", weight: 0 },
      ],
    };
    const set = await teacher.setWorkshopForm(ids.accumulative, input);
    assert.match(set.changed, /^Set workshop \d+'s assessment form \(Accumulative grading\): 4 aspects\.$/);
    const read = await teacher.workshopForm(ids.accumulative);
    assert.deepEqual(withoutIds(read), {
      strategy: "accumulative",
      criteria: [
        { description: "<p>Is it clear?</p>", maxGrade: 20, weight: 2 },
        { description: "<p>Is it tidy?</p>", scaleId: 2, scale: "Default competence scale", weight: 1 },
        { description: "<p>Is it complete?</p>", maxGrade: 10, weight: 1 },
        { description: "<p>Is it original?</p>", maxGrade: 10, weight: 0 },
      ],
    });
    // What it returns is what reading gives.
    assert.deepEqual({ ...set, changed: "" }, { ...read, changed: "" });
  });

  it("setWorkshopForm: a comments form replaced by a shorter one keeps the first ids", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const first = await teacher.setWorkshopForm(ids.comments, { strategy: "comments", criteria: [{ description: "<p>What works?</p>" }, { description: "<p>What doesn't?</p>" }, { description: "<p>Anything else?</p>" }] });
    assert.equal(first.criteria.length, 3);
    const second = await teacher.setWorkshopForm(ids.comments, { strategy: "comments", criteria: [{ description: "<p>What works best?</p>" }] });
    assert.match(second.changed, /^Replaced .*\(Comments\): 1 aspect\.$/);
    assert.deepEqual(await teacher.workshopForm(ids.comments), { activityId: ids.comments, strategy: "comments", criteria: [{ id: first.criteria[0]!.id, description: "<p>What works best?</p>" }] });
  });

  it("setWorkshopForm: a number-of-errors form and its grade mapping, read back the same", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    await teacher.setWorkshopForm(ids.numerrors, {
      strategy: "numerrors",
      criteria: [{ description: "<p>It runs.</p>", weight: 2, errorWord: "Fails", successWord: "Works" }, { description: "<p>It has tests.</p>" }],
      gradeMapping: [
        { errors: 1, grade: 70 },
        { errors: 3, grade: 10 },
      ],
    });
    assert.deepEqual(withoutIds(await teacher.workshopForm(ids.numerrors)), {
      strategy: "numerrors",
      criteria: [
        { description: "<p>It runs.</p>", weight: 2, errorWord: "Fails", successWord: "Works" },
        { description: "<p>It has tests.</p>", weight: 1, errorWord: "No", successWord: "Yes" },
      ],
      gradeMapping: [
        { errors: 1, grade: 70 },
        { errors: 3, grade: 10 },
      ],
    });
  });

  it("setWorkshopForm: a rubric with more levels than Moodle's blank rows, read back the same", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const levels = [0, 2, 4, 6, 8, 10, 12].map((grade) => ({ grade, definition: `Level worth ${grade}` }));
    await teacher.setWorkshopForm(ids.rubric, { strategy: "rubric", criteria: [{ description: "<p>Style</p>", levels }, { description: "<p>Content</p>", levels: [{ grade: 0, definition: "Missing" }, { grade: 5, definition: "There" }] }], layout: "grid" });
    assert.deepEqual(withoutIds(await teacher.workshopForm(ids.rubric)), {
      strategy: "rubric",
      criteria: [
        { description: "<p>Style</p>", levels },
        { description: "<p>Content</p>", levels: [{ grade: 0, definition: "Missing" }, { grade: 5, definition: "There" }] },
      ],
      layout: "grid",
    });
  });

  it("setWorkshopForm: a form of another strategy is refused, naming the workshop's; Moodle's limits before anything changes", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.setWorkshopForm(ids.rubric, { strategy: "accumulative", criteria: [{ description: "<p>Clear?</p>" }] }), (error: Error) => error instanceof WorkshopError && /grades with the Rubric strategy \("rubric"\)/.test(error.message));
    await assert.rejects(teacher.setWorkshopForm(ids.rubric, { strategy: "rubric", criteria: [{ description: "<p>A</p>", levels: [{ grade: 1, definition: "x" }, { grade: 1, definition: "y" }] }] }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    await assert.rejects(teacher.setWorkshopForm(ids.accumulative, { strategy: "accumulative", criteria: [{ description: "<p>A</p>", scaleId: 999 }] }), /Scale 999 isn't one/);
    assert.equal((await teacher.workshopForm(ids.rubric)).criteria.length, 2);
  });

  it("workshopForm: the student can't read it", { timeout: 300_000 }, async () => {
    await assert.rejects((await as("student")).workshopForm(ids.comments), (error: Error) => error instanceof WorkshopError && /mod\/workshop:editdimensions/.test(error.message));
  });

  it("setWorkshopForm: refused once the teacher assessed a submission with it, unless asked", { timeout: 600_000 }, async () => {
    const teacher = await as("teacher");
    const workshopId = ids.accumulative;
    await teacher.setWorkshopPhase(workshopId, "submission");
    const { submissionId } = await (await as("student")).saveWorkshopSubmission(workshopId, { title: "Driver check suite form work", content: "<p>Work submitted by the sandbox suite.</p>" });
    await teacher.setWorkshopPhase(workshopId, "assessment");
    await teacher.assessWorkshopSubmission(workshopId, submissionId, { criteria: [{ grade: 15 }, { grade: 1 }, { grade: 8 }, { grade: 5 }] });
    const input: WorkshopFormInput = { strategy: "accumulative", criteria: [{ description: "<p>Is it clear enough?</p>", maxGrade: 20, weight: 2 }] };
    await assert.rejects(teacher.setWorkshopForm(workshopId, input), (error: Error) => error instanceof WorkshopError && /has 1 assessment made with its form/.test(error.message));
    assert.equal((await teacher.workshopForm(workshopId)).criteria.length, 4);
    const changed = await teacher.setWorkshopForm(workshopId, { ...input, evenIfAssessed: true });
    assert.deepEqual(
      changed.criteria.map((c) => c.description),
      ["<p>Is it clear enough?</p>"],
    );
  });
});

// A participant's view (#111): the only student who can log in assesses the admin's submission (the
// admin enrolled as a student in the scratch course, to have work to assess).
describe("a workshop as a participant sees it (#111)", () => {
  let course: ScratchCourse;
  let workshopId: number;
  let mine: number;
  let theirs: number;
  let assessmentId: number;

  before(async () => {
    course = await scratchCourse("workshopview");
    const teacher = await as("teacher");
    const admin = await as("admin");
    await admin.enrolUsers(course.id, [await userId("admin")], { roleId: 5 });
    workshopId = (
      await teacher.createActivity({
        courseId: course.id,
        sectionId: course.sectionId,
        type: "workshop",
        name: "Driver check suite participant view",
        visibility: "shown",
        settings: { strategy: "rubric", "instructauthorseditor[text]": "<p>Authors: write it.</p>", "instructreviewerseditor[text]": "<p>Reviewers: be kind.</p>" },
      })
    ).activityId!;
    await teacher.setWorkshopForm(workshopId, {
      strategy: "rubric",
      criteria: [
        { description: "<p>Clarity</p>", levels: [{ grade: 0, definition: "Unclear" }, { grade: 5, definition: "Clear" }] },
        { description: "<p>Content</p>", levels: [{ grade: 0, definition: "Missing" }, { grade: 3, definition: "Some" }, { grade: 6, definition: "All" }] },
      ],
    });
    await teacher.setWorkshopPhase(workshopId, "submission");
  }, { timeout: 600_000 });

  it("workshopView: the submission phase, the instructions for authors, nothing submitted yet", { timeout: 300_000 }, async () => {
    const view = await (await as("student")).workshopView(workshopId);
    assert.equal(view.phase, "submission");
    assert.equal(view.tasks.length, 1);
    assert.equal(view.tasks[0]!.state, "todo");
    assert.match(view.instructions.authors ?? "", /Authors: write it\./);
    assert.deepEqual([view.ownSubmission, view.toAssess, view.form], [undefined, [], undefined]);
  });

  it("workshopView: in the assessment phase, the own submission, the admin's allocated with its ids and author, and the reviewer's form", { timeout: 600_000 }, async () => {
    const teacher = await as("teacher");
    const student = await as("student");
    mine = (await student.saveWorkshopSubmission(workshopId, { title: "Driver check suite own work", content: "<p>Mine.</p>" })).submissionId;
    theirs = (await (await as("admin")).saveWorkshopSubmission(workshopId, { title: "Driver check suite admin work", content: "<p>Theirs.</p>" })).submissionId;
    assessmentId = (await teacher.allocateReviewer(workshopId, { submissionId: theirs, reviewerId: await userId("student") })).assessmentId;
    await teacher.setWorkshopPhase(workshopId, "assessment");
    const before = await teacher.courseLogs(course.id, { userId: await userId("student"), activityId: workshopId });
    const view = await student.workshopView(workshopId);
    assert.equal(view.phase, "assessment");
    assert.deepEqual(view.ownSubmission, { id: mine, title: "Driver check suite own work" });
    assert.match(view.instructions.reviewers ?? "", /Reviewers: be kind\./);
    assert.deepEqual(view.toAssess, [{ assessmentId, submissionId: theirs, title: "Driver check suite admin work", authorId: await userId("admin"), author: view.toAssess[0]!.author, assessed: false }]);
    assert.deepEqual(view.form, {
      strategy: "rubric",
      criteria: [
        { description: view.form!.criteria[0]!.description, grades: [{ grade: 1, label: "Unclear" }, { grade: 2, label: "Clear" }], comment: false },
        { description: view.form!.criteria[1]!.description, grades: [{ grade: 1, label: "Missing" }, { grade: 2, label: "Some" }, { grade: 3, label: "All" }], comment: false },
      ],
      feedback: view.form!.feedback,
    });
    assert.match(view.form!.criteria[0]!.description, /Clarity/);
    // Reading logged only that the student viewed the workshop: no assessment started or saved.
    const after = await teacher.courseLogs(course.id, { userId: await userId("student"), activityId: workshopId });
    const added = after.slice(0, after.length - before.length);
    assert.deepEqual(added.map((entry) => /viewed the 'workshop' activity/.test(entry.description)), [true], JSON.stringify(added.map((entry) => entry.description)));
  });

  it("workshopView: the form's grades taken by assessWorkshopSubmission, then the submission read back assessed with its grade", { timeout: 300_000 }, async () => {
    const student = await as("student");
    const { form } = await student.workshopView(workshopId);
    const assessed = await student.assessWorkshopSubmission(workshopId, theirs, { criteria: form!.criteria.map((criterion) => ({ grade: criterion.grades.at(-1)!.grade })) });
    assert.equal(assessed.assessmentId, assessmentId);
    const view = await student.workshopView(workshopId);
    assert.deepEqual(
      view.toAssess.map((item) => [item.assessmentId, item.assessed, item.grade, item.maxGrade]),
      [[assessmentId, true, assessed.grade, assessed.maxGrade]],
    );
    assert.equal(view.tasks[0]!.state, "done");
  });

  it("workshopView: the teacher has no allocation, and no form; an activity that isn't a workshop is refused", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const view = await teacher.workshopView(workshopId);
    assert.deepEqual([view.phase, view.toAssess, view.form, view.ownSubmission], ["assessment", [], undefined, undefined]);
    const other = (await teacher.courseStructure(course.id)).flatMap((s) => s.activities).find((a) => a.type !== "workshop");
    if (other) await assert.rejects(teacher.workshopView(other.id), WorkshopError);
  });
});
