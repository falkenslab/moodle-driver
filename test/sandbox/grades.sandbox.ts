// Grades and the gradebook, against the sandbox: reads on course 3, the gradebook's setup and grades
// changed on a scratch course.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { GradebookError, NoGradeReportError, type GradeScale, type GradebookCategory, type GradebookItem } from "../../src/index.js";
import { COURSE, as, cleanup, scratchCourse, userId, type ScratchCourse, CONTENT_ASSIGNMENT, CONTENT_ASSIGNMENT_ITEM } from "./harness.js";

/** Course 3's assignment and its grade item, as the sandbox seeds them (read only). */
const ASSIGNMENT = CONTENT_ASSIGNMENT;
const ASSIGNMENT_ITEM = CONTENT_ASSIGNMENT_ITEM;
const SLOW = { timeout: 300_000 };

describe("grades and the gradebook", () => {
  let studentId: number;

  before(async () => {
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
    let scale: GradeScale;

    before(async () => {
      course = await scratchCourse("grades");
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

    it("importGrades: a CSV previewed, then imported into the manual item, read back with graderReport", SLOW, async () => {
      const teacher = await as("teacher");
      const folder = await mkdtemp(path.join(tmpdir(), "suite-import-"));
      try {
        const file = path.join(folder, "grades.csv");
        await writeFile(file, `User ID,Suite item,Suite comment\n${studentId},35,Suite imported\n`);
        const options = { mapFrom: "User ID", mapTo: "id" as const, columns: { "Suite item": item.id, "Suite comment": { feedback: item.id } } };
        const preview = await teacher.importGrades(course.id, file, { ...options, preview: true });
        assert.equal(preview.imported, false);
        assert.deepEqual(preview.preview, { columns: ["User ID", "Suite item", "Suite comment"], rows: [[String(studentId), "35", "Suite imported"]] });
        // Previewing imports nothing.
        const before = (await teacher.graderReport(course.id)).rows.find((r) => r.userId === studentId);
        assert.equal(Number(before?.grades.find((g) => g.itemId === item.id)?.grade), 30);
        const imported = await teacher.importGrades(course.id, file, options);
        assert.equal(imported.imported, true);
        const after = (await teacher.graderReport(course.id)).rows.find((r) => r.userId === studentId);
        assert.equal(Number(after?.grades.find((g) => g.itemId === item.id)?.grade), 35);
        // Someone Moodle can't find: nothing imported, Moodle's reason given.
        await writeFile(file, `User ID,Suite item\n999999,10\n`);
        await assert.rejects(teacher.importGrades(course.id, file, { ...options, columns: { "Suite item": item.id } }), (error: Error) => error instanceof GradebookError && /999999/.test(error.message));
        await assert.rejects(teacher.importGrades(course.id, file, { ...options, columns: { "No such column": item.id } }), /no column "No such column"/);
        await assert.rejects((await as("student")).importGrades(course.id, file, options), (error: Error) => error instanceof GradebookError && /moodle\/grade:import/.test(error.message));
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });

    it("addScale: a course scale, beside the site's in courseScales", SLOW, async () => {
      const teacher = await as("teacher");
      const added = await teacher.addScale(course.id, { name: "Driver check scale", items: ["Poor", "Fair", "Good"], description: "<p>Suite scale</p>" });
      assert.ok(added.scale);
      scale = added.scale;
      assert.deepEqual([scale.name, scale.items, scale.used, scale.site], ["Driver check scale", ["Poor", "Fair", "Good"], false, false]);
      const scales = await teacher.courseScales(course.id);
      assert.ok(scales.some((s) => s.id === scale.id && !s.site));
      // The sandbox's site has Moodle's standard scales, with ids a teacher's page doesn't link.
      assert.ok(scales.some((s) => s.site && s.id > 0 && s.items.length > 1));
      // The course can't have the same values twice.
      await assert.rejects(teacher.addScale(course.id, { name: "Driver check again", items: ["Poor", "Fair", "Good"] }), GradebookError);
      await assert.rejects((await as("student")).courseScales(course.id), (error: Error) => error instanceof GradebookError && /moodle\/course:managescales/.test(error.message));
    });

    it("courseScales: a scale an item grades with is used", SLOW, async () => {
      const teacher = await as("teacher");
      const graded = (await teacher.addGradeItem(course.id, { name: "Suite scale item", scaleId: scale.id })).item!;
      try {
        assert.equal((await teacher.courseScales(course.id)).find((s) => s.id === scale.id)?.used, true);
      } finally {
        await teacher.deleteGradeItem(course.id, graded.id);
      }
    });

    it("editScale: an unused scale's values and name", SLOW, async () => {
      const teacher = await as("teacher");
      const edited = await teacher.editScale(course.id, scale.id, { name: "Driver check scale renamed", items: ["Poor", "Fair", "Good", "Great"] });
      assert.deepEqual([edited.scale?.name, edited.scale?.items], ["Driver check scale renamed", ["Poor", "Fair", "Good", "Great"]]);
    });

    it("setGradeLetters: the course's own letters, read back with gradeLetters, then the site's again", SLOW, async () => {
      const teacher = await as("teacher");
      const original = await teacher.gradeLetters(course.id);
      assert.ok(original.letters.length > 0);
      // Put back whatever happens, as it was.
      const putBack = () => teacher.setGradeLetters(course.id, original.overridden ? original.letters : null);
      cleanup(putBack);
      const set = await teacher.setGradeLetters(course.id, [
        { letter: "Pass", minGrade: 50 },
        { letter: "Fail", minGrade: 0 },
      ]);
      assert.deepEqual([set.overridden, set.letters], [true, [{ letter: "Pass", minGrade: 50 }, { letter: "Fail", minGrade: 0 }]]);
      assert.deepEqual(await teacher.gradeLetters(course.id), { overridden: true, letters: set.letters });
      const back = await putBack();
      assert.deepEqual(back.letters, original.letters);
      assert.equal(back.overridden, original.overridden);
      await assert.rejects((await as("student")).gradeLetters(course.id), (error: Error) => error instanceof GradebookError && /moodle\/grade:manageletters/.test(error.message));
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
