// Grades and the gradebook, against the sandbox: reads on course 3, the gradebook's setup and grades
// changed on a scratch course.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { GradebookError, NoGradeReportError, type GradebookCategory, type GradebookItem } from "../../src/index.js";
import { COURSE, as, userId, type ScratchCourse } from "./harness.js";
import { logInPatiently, patientScratchCourse } from "./patience.js";

/** Course 3's assignment and its grade item, as the sandbox seeds them (read only). */
const ASSIGNMENT = 35;
const ASSIGNMENT_ITEM = 17;
const SLOW = { timeout: 300_000 };

describe("grades and the gradebook", () => {
  let studentId: number;

  before(async () => {
    for (const role of ["admin", "teacher", "student"] as const) await logInPatiently(role);
    studentId = await userId("student");
  });

  describe("reading course 3", () => {
    it("myGrades: the student's own report, with the assignment's grade", SLOW, async () => {
      const student = await as("student");
      const rows = await student.myGrades(COURSE);
      const assignment = rows.find((row) => row.activityId === ASSIGNMENT);
      assert.equal(assignment?.kind, "item");
      assert.equal(assignment?.activityType, "assign");
      assert.ok(assignment?.grade, "the seeded assignment is graded");
      assert.ok(rows.some((row) => row.kind === "courseTotal"));
    });

    it("myGrades: a course the student isn't in has no report of theirs", SLOW, async () => {
      const student = await as("student");
      await assert.rejects(student.myGrades(999_999), NoGradeReportError);
    });

    it("graderReport: every student's grades in the course's columns", SLOW, async () => {
      const teacher = await as("teacher");
      const report = await teacher.graderReport(COURSE);
      const column = report.columns.find((c) => c.id === ASSIGNMENT_ITEM);
      assert.equal(column?.kind, "item");
      assert.equal(column?.activityId, ASSIGNMENT);
      assert.ok(report.columns.some((c) => c.kind === "course"));
      // The student's own report says what the teacher's must.
      const mine = (await (await as("student")).myGrades(COURSE)).find((r) => r.activityId === ASSIGNMENT);
      const student = report.rows.find((r) => r.userId === studentId);
      assert.ok(student, "the student has a row");
      assert.equal(student.grades.find((g) => g.itemId === ASSIGNMENT_ITEM)?.grade, mine?.grade);
    });

    it("graderReport: refused to a student", SLOW, async () => {
      const student = await as("student");
      await assert.rejects(student.graderReport(COURSE));
    });

    it("gradebookSetup: course 3's categories and items", SLOW, async () => {
      const teacher = await as("teacher");
      const setup = await teacher.gradebookSetup(COURSE);
      const top = setup.categories.find((c) => c.parentId === undefined);
      assert.ok(top);
      const item = setup.items.find((i) => i.id === ASSIGNMENT_ITEM);
      assert.equal(item?.type, "assign");
      assert.ok(setup.categories.some((c) => c.id === item?.categoryId));
      // Totals are their categories', not items.
      assert.ok(!setup.items.some((i) => setup.categories.some((c) => c.itemId === i.id)));
    });

    it("gradebookSetup: refused to a student", SLOW, async () => {
      const student = await as("student");
      await assert.rejects(student.gradebookSetup(COURSE), GradebookError);
    });
  });

  describe("changing a scratch course's gradebook", () => {
    let course: ScratchCourse;
    let category: GradebookCategory;
    let item: GradebookItem;
    /** A second item, moved to the top level beside the category: so weights have something to share with. */
    let other: GradebookItem;

    before(async () => {
      course = await patientScratchCourse("grades");
    });

    it("addGradeCategory: a Natural category at the top level", SLOW, async () => {
      const teacher = await as("teacher");
      const added = await teacher.addGradeCategory(course.id, { name: "Suite category", aggregation: "natural" });
      assert.ok(added.category);
      category = added.category;
      assert.equal(category.name, "Suite category");
      assert.equal(category.aggregation, "natural");
      assert.ok(category.parentId !== undefined);
      const setup = await teacher.gradebookSetup(course.id);
      assert.ok(setup.categories.some((c) => c.id === category.id));
    });

    it("addGradeItem: a manual item out of 50 in the category", SLOW, async () => {
      const teacher = await as("teacher");
      const added = await teacher.addGradeItem(course.id, { name: "Suite item", maxGrade: 50, categoryId: category.id });
      assert.ok(added.item);
      item = added.item;
      assert.equal(item.type, "manual");
      assert.equal(item.maxGrade, 50);
      assert.equal(item.categoryId, category.id);
      await assert.rejects(teacher.addGradeItem(course.id, { name: "" }), /name/);
    });

    it("updateGradeItem: its maximum and its weight", SLOW, async () => {
      const teacher = await as("teacher");
      other = (await teacher.addGradeItem(course.id, { name: "Suite other item", maxGrade: 10, categoryId: category.id })).item!;
      const updated = await teacher.updateGradeItem(course.id, item.id, { maxGrade: 40, weight: 75 });
      assert.equal(updated.item?.maxGrade, 40);
      assert.equal(updated.item?.weight, 75);
      assert.equal(updated.item?.weightOverridden, true);
      const moved = await teacher.updateGradeItem(course.id, other.id, { category: category.parentId! });
      assert.equal(moved.item?.categoryId, category.parentId);
    });

    it("updateGradeCategory: renamed and weighted in its parent; an aggregation the site lacks refused", SLOW, async () => {
      const teacher = await as("teacher");
      const updated = await teacher.updateGradeCategory(course.id, category.id, { name: "Suite category renamed", weight: 40 });
      assert.equal(updated.category?.name, "Suite category renamed");
      assert.equal(updated.category?.weight, 40);
      // The sandbox's site offers only Natural (its grade_aggregations_visible): another is refused, naming it.
      await assert.rejects(teacher.updateGradeCategory(course.id, category.id, { aggregation: "mean" }), (error: Error) => error instanceof GradebookError && /natural/.test(error.message));
      assert.equal((await teacher.gradebookSetup(course.id)).categories.find((c) => c.id === category.id)?.aggregation, "natural");
      const top = (await teacher.gradebookSetup(course.id)).categories.find((c) => c.parentId === undefined)!;
      await assert.rejects(teacher.updateGradeCategory(course.id, top.id, { weight: 10 }), GradebookError);
    });

    it("setGrade: the student's grade and feedback in the manual item, seen in their report", SLOW, async () => {
      const teacher = await as("teacher");
      const student = studentId;
      const set = await teacher.setGrade(course.id, item.id, student, { grade: 30, feedback: "Suite feedback" });
      assert.equal(Number(set.grade.grade), 30);
      assert.equal(set.grade.feedback, "Suite feedback");
      assert.equal(set.grade.overridden, false);
      await assert.rejects(teacher.setGrade(course.id, item.id, student, { grade: 99 }), GradebookError);
      const rows = await (await as("student")).myGrades(course.id);
      const row = rows.find((r) => r.name === "Suite item");
      assert.equal(Number(row?.grade), 30);
      assert.match(row?.feedback ?? "", /Suite feedback/);
    });

    it("graderReport: the scratch course's grade in its column", SLOW, async () => {
      const teacher = await as("teacher");
      const report = await teacher.graderReport(course.id);
      assert.ok(report.columns.some((c) => c.id === item.id && c.kind === "item"));
      const row = report.rows.find((r) => r.userId === studentId);
      assert.ok(row);
      assert.equal(Number(row.grades.find((g) => g.itemId === item.id)?.grade), 30);
    });

    it("exportGrades: the course's grades as CSV, with the student's grade", SLOW, async () => {
      const teacher = await as("teacher");
      const folder = await mkdtemp(path.join(tmpdir(), "suite-grades-"));
      try {
        const file = await teacher.exportGrades(course.id, { format: "csv", itemIds: [item.id], feedback: true, destDir: folder });
        assert.ok(file.size > 0);
        const text = await readFile(file.path, "utf8");
        assert.match(text, /Suite item/);
        assert.match(text, /30[.,]00/);
        assert.match(text, /Suite feedback/);
        await assert.rejects(teacher.exportGrades(course.id, { format: "csv", itemIds: [999_999], destDir: folder }), GradebookError);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("deleteGradeItem: the manual item and its grades go", SLOW, async () => {
      const teacher = await as("teacher");
      await teacher.deleteGradeItem(course.id, item.id);
      await teacher.deleteGradeItem(course.id, other.id);
      const setup = await teacher.gradebookSetup(course.id);
      assert.ok(!setup.items.some((i) => i.id === item.id || i.id === other.id));
      await assert.rejects(teacher.deleteGradeItem(course.id, item.id), GradebookError);
    });

    it("deleteGradeCategory: the category goes; the course's own can't", SLOW, async () => {
      const teacher = await as("teacher");
      await teacher.deleteGradeCategory(course.id, category.id);
      const setup = await teacher.gradebookSetup(course.id);
      assert.ok(!setup.categories.some((c) => c.id === category.id));
      const top = setup.categories.find((c) => c.parentId === undefined)!;
      await assert.rejects(teacher.deleteGradeCategory(course.id, top.id), GradebookError);
    });

    it("addGradeCategory: refused to a student", SLOW, async () => {
      const student = await as("student");
      await assert.rejects(student.addGradeCategory(course.id, { name: "Not allowed" }));
      const setup = await (await as("teacher")).gradebookSetup(course.id);
      assert.ok(!setup.categories.some((c) => c.name === "Not allowed"));
    });
  });
});
