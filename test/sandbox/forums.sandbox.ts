// Forums, ratings and workshops against the sandbox: course 3's forum only read; a forum (rated, and
// graded as a whole), a glossary, a database and a workshop made on the scratch course, where the
// student posts, submits and adds entries and the teacher replies, moderates, rates, grades and assesses.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { before, describe, it } from "node:test";
import { ForumError, GradingError, NotAForumError, WorkshopError, type Moodle } from "../../src/index.js";
import { openForm, setFields, submitForm } from "../../src/internals.js";
import { COURSE, SITE, as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

/** Files to attach, in a folder of their own. */
const dir = mkdtempSync(path.join(tmpdir(), "forums-sandbox-"));
const notes = path.join(dir, "suite-notes.txt");
const extra = path.join(dir, "suite-extra.txt");
writeFileSync(notes, "Notes attached by the driver's sandbox suite.\n");
writeFileSync(extra, "Another file attached by the driver's sandbox suite.\n");

/** Creates an activity on the scratch course as the teacher, shown to students; its id. */
async function newActivity(course: ScratchCourse, type: string, name: string, settings: Record<string, string | number | boolean> = {}): Promise<number> {
  const created = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type, name, visibility: "shown", settings });
  assert.ok(created.activityId, `the ${type} wasn't created: ${created.changed}`);
  return created.activityId;
}

/** Ratings on, out of 5 points, averaged: the rating fields of a forum's, glossary's or database's form. */
const RATINGS = { assessed: 1, "scale[modgrade_type]": "point", "scale[modgrade_point]": 5 };

/** Adds an entry to a glossary through its own form (the driver has no function for it); the entry's id. */
async function addGlossaryEntry(moodle: Moodle, activityId: number, concept: string): Promise<number> {
  const page = await openForm(await moodle.context(), SITE, `mod/glossary/edit.php?cmid=${activityId}`);
  try {
    await setFields(page, { concept, "definition_editor[text]": `<p>${concept}, defined by the sandbox suite.</p>` });
    await submitForm(page, "submitbutton");
    // Moodle lands on the entry: view.php?id=<cm>&mode=entry&hook=<entry>.
    const id = Number(new URL(page.url()).searchParams.get("hook"));
    assert.ok(id > 0, `the glossary entry wasn't added (landed on ${page.url()})`);
    return id;
  } finally {
    await page.close();
  }
}

/** Adds a text field to a database through its fields page (the teacher's), as "Create a field" does. */
async function addDatabaseField(moodle: Moodle, activityId: number, name: string): Promise<void> {
  const page = await (await moodle.context()).newPage();
  try {
    await page.goto(`${SITE}mod/data/field.php?id=${activityId}&mode=new&newtype=text`, { waitUntil: "domcontentloaded" });
    await page.fill('form#editfield input[name="name"]', name);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('form#editfield input[type="submit"]:not([name="cancel"])')]);
  } finally {
    await page.close();
  }
}

/** Adds a record to a database with one text field through its "Add entry" page; the record's id. */
async function addDatabaseRecord(moodle: Moodle, activityId: number, text: string): Promise<number> {
  const page = await (await moodle.context()).newPage();
  try {
    await page.goto(`${SITE}mod/data/edit.php?id=${activityId}`, { waitUntil: "domcontentloaded" });
    await page.fill('input[name^="field_"]', text);
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('[name="saveandview"]')]);
    // Moodle lands on the record: view.php?d=<database>&rid=<record>.
    const id = Number(new URL(page.url()).searchParams.get("rid"));
    assert.ok(id > 0, `the database record wasn't added (landed on ${page.url()})`);
    return id;
  } finally {
    await page.close();
  }
}

/** Defines a workshop's accumulative assessment form with one aspect out of 10 points, through its editing form. */
async function defineWorkshopAspect(moodle: Moodle, activityId: number): Promise<void> {
  const page = await openForm(await moodle.context(), SITE, `mod/workshop/editform.php?cmid=${activityId}`);
  try {
    await setFields(page, { "description__idx_0_editor[text]": "<p>Is it clear?</p>", "grade__idx_0[modgrade_type]": "point", "grade__idx_0[modgrade_point]": 10 });
    await submitForm(page, "saveandclose");
  } finally {
    await page.close();
  }
}

/** Submits work to a workshop in its submission phase, through its submission form; the submission's id. */
async function submitWorkshopWork(moodle: Moodle, activityId: number, title: string): Promise<number> {
  const page = await openForm(await moodle.context(), SITE, `mod/workshop/submission.php?cmid=${activityId}&edit=on`);
  try {
    await setFields(page, { title, "content_editor[text]": "<p>Work submitted by the sandbox suite.</p>" });
    await submitForm(page, "submitbutton");
    // Moodle lands on the submission: submission.php?cmid=<cm>&id=<submission>.
    const id = Number(new URL(page.url()).searchParams.get("id"));
    assert.ok(id > 0, `the workshop submission wasn't saved (landed on ${page.url()})`);
    return id;
  } finally {
    await page.close();
  }
}

describe("forums of the content course", () => {
  let forumId: number;

  before(async () => {
    const sections = await (await as("student")).courseStructure(COURSE);
    const forum = sections.flatMap((s) => s.activities).find((a) => a.type === "forum" && a.availableToMe);
    assert.ok(forum, `course ${COURSE} has no forum the student can open`);
    forumId = forum.id;
  });

  it("forumDiscussions: course 3's forum as the student sees it", async () => {
    const student = await as("student");
    const discussions = await student.forumDiscussions(forumId);
    for (const d of discussions) {
      assert.ok(d.id > 0 && d.subject && d.author);
      assert.ok(d.replies >= 0);
    }
    const sections = await student.courseStructure(COURSE);
    const other = sections.flatMap((s) => s.activities).find((a) => a.type !== "forum" && a.availableToMe);
    if (other) await assert.rejects(student.forumDiscussions(other.id), NotAForumError);
  });

  it("discussion: a discussion of course 3's forum, oldest post first", async () => {
    const student = await as("student");
    const [first] = await student.forumDiscussions(forumId);
    if (!first) return;
    const read = await student.discussion(first.id);
    assert.equal(read.discussion.id, first.id);
    assert.equal(read.discussion.courseId, COURSE);
    assert.equal(read.posts.length, first.replies + 1);
    assert.equal(read.posts[0]!.parentId, undefined);
    assert.equal(read.posts[0]!.subject, first.subject);
    for (const post of read.posts.slice(1)) assert.ok(read.posts.some((p) => p.id === post.parentId));
  });
});

describe("forums, ratings and workshops on the scratch course", () => {
  let course: ScratchCourse;
  let forumId: number;
  let studentId: number;
  let discussionId: number;
  let firstPostId: number;
  let replyId: number;

  before(async () => {
    course = await scratchCourse("forums");
    studentId = await userId("student");
    forumId = await newActivity(course, "forum", "Driver check suite forum", { ...RATINGS, "grade_forum[modgrade_type]": "point", "grade_forum[modgrade_point]": 10 });
  });

  it("startDiscussion: the student starts one, which the teacher sees", { timeout: 300_000 }, async () => {
    const student = await as("student");
    const result = await student.startDiscussion(forumId, { subject: "Driver check suite question", message: "<p>A question from the sandbox suite.</p>" });
    assert.ok(result.discussionId);
    discussionId = result.discussionId;
    const listed = (await (await as("teacher")).forumDiscussions(forumId)).find((d) => d.id === discussionId);
    assert.ok(listed);
    assert.equal(listed.subject, "Driver check suite question");
    assert.equal(listed.replies, 0);
    const read = await student.discussion(discussionId);
    firstPostId = read.posts[0]!.id;
    assert.equal(read.posts[0]!.author.id, studentId);
    assert.equal(read.posts[0]!.text, "A question from the sandbox suite.");
    await assert.rejects(student.startDiscussion(forumId, { subject: "Driver check suite empty", message: "<p> </p>" }), /empty/);
  });

  it("replyToPost: the teacher replies with an attachment", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const result = await teacher.replyToPost(firstPostId, { message: "<p>An answer from the sandbox suite.</p>", files: [notes] });
    assert.ok(result.postId);
    assert.equal(result.discussionId, discussionId);
    replyId = result.postId;
    const read = await (await as("student")).discussion(discussionId);
    const reply = read.posts.find((p) => p.id === replyId);
    assert.ok(reply);
    assert.equal(reply.parentId, firstPostId);
    assert.equal(reply.text, "An answer from the sandbox suite.");
    assert.match(reply.subject, /Driver check suite question/);
    assert.deepEqual(
      reply.attachments.map((a) => a.name),
      ["suite-notes.txt"],
    );
    assert.ok(reply.attachments[0]!.url.includes("pluginfile.php"));
  });

  it("editPost: the teacher changes the reply's subject, message and attachments", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const result = await teacher.editPost(replyId, { subject: "Driver check suite answer", message: "<p>An edited answer.</p>", files: { add: [extra], remove: ["suite-notes.txt"] } });
    assert.equal(result.post?.subject, "Driver check suite answer");
    const reply = (await (await as("student")).discussion(discussionId)).posts.find((p) => p.id === replyId);
    assert.equal(reply?.subject, "Driver check suite answer");
    assert.equal(reply?.text, "An edited answer.");
    assert.deepEqual(
      reply?.attachments.map((a) => a.name),
      ["suite-extra.txt"],
    );
    // Someone else's post: Moodle refuses the student.
    await assert.rejects((await as("student")).editPost(replyId, { message: "<p>Driver check suite: not mine.</p>" }), ForumError);
  });

  it("setDiscussionState: pinned and locked, then back", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const done = await teacher.setDiscussionState(forumId, discussionId, { pinned: true, locked: true });
    assert.equal(done.discussion?.pinned, true);
    assert.equal(done.discussion?.locked, true);
    const seen = (await (await as("student")).forumDiscussions(forumId)).find((d) => d.id === discussionId);
    assert.equal(seen?.pinned, true);
    assert.equal(seen?.locked, true);
    // A locked discussion takes no replies from the student.
    await assert.rejects((await as("student")).replyToPost(firstPostId, { message: "<p>Driver check suite: locked out.</p>" }));
    assert.equal((await teacher.setDiscussionState(forumId, discussionId, { pinned: true })).changed, "Nothing to change.");
    const back = await teacher.setDiscussionState(forumId, discussionId, { pinned: false, locked: false });
    assert.equal(back.discussion?.pinned, false);
    assert.equal(back.discussion?.locked, false);
    await assert.rejects(teacher.setDiscussionState(forumId, 999_999_999, { pinned: true }), NotAForumError);
  });

  it("rate: the teacher rates the student's post; the student can't rate it", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const item = { type: "forum-post" as const, id: firstPostId, discussionId };
    const rated = await teacher.rate(item, 4);
    assert.equal(rated.count, 1);
    assert.equal(Number(rated.aggregate), 4);
    // A new rating replaces the person's own.
    const again = await teacher.rate(item, 2);
    assert.equal(again.count, 1);
    assert.equal(Number(again.aggregate), 2);
    await assert.rejects(teacher.rate(item, 9), GradingError);
    await assert.rejects((await as("student")).rate(item, 3), GradingError);
    const cleared = await teacher.rate(item, null);
    assert.equal(cleared.aggregate, undefined);
  });

  it("gradeForumUser: the teacher grades the student's participation, then takes it away", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const result = await teacher.gradeForumUser(forumId, studentId, { grade: 7 });
    assert.equal(result.grade.value, 7);
    const mine = (await teacher.forumGrades(forumId)).grades.find((g) => g.userId === studentId);
    assert.equal(mine?.value, 7);
    await assert.rejects(teacher.gradeForumUser(forumId, studentId, { grade: 11 }), GradingError);
    const cleared = await teacher.gradeForumUser(forumId, studentId, { grade: null });
    assert.equal(cleared.grade.value, undefined);
    assert.equal((await teacher.forumGrades(forumId)).grades.find((g) => g.userId === studentId)?.value, undefined);
  });

  it("forumGrades: the forum's grading, and the student can't open the grader", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const grades = await teacher.forumGrades(forumId);
    assert.equal(grades.activityId, forumId);
    assert.equal(grades.method, "point");
    assert.equal(grades.maxGrade, 10);
    assert.ok(grades.grades.some((g) => g.userId === studentId));
    await assert.rejects((await as("student")).forumGrades(forumId), GradingError);
  });

  it("deletePost: the student can't delete the teacher's reply; the teacher deletes it, then the discussion", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    await assert.rejects((await as("student")).deletePost(replyId), ForumError);
    const reply = await teacher.deletePost(replyId);
    assert.equal(reply.discussionDeleted, false);
    assert.equal(reply.replies, 0);
    assert.deepEqual(
      (await teacher.discussion(discussionId)).posts.map((p) => p.id),
      [firstPostId],
    );
    const whole = await teacher.deletePost(firstPostId);
    assert.equal(whole.discussionDeleted, true);
    assert.equal(whole.discussionId, discussionId);
    assert.ok(!(await teacher.forumDiscussions(forumId)).some((d) => d.id === discussionId));
  });

  it("rate: a glossary entry the student added", { timeout: 300_000 }, async () => {
    const glossaryId = await newActivity(course, "glossary", "Driver check suite glossary", RATINGS);
    const entryId = await addGlossaryEntry(await as("student"), glossaryId, "Driver check suite term");
    const teacher = await as("teacher");
    const rated = await teacher.rate({ type: "glossary-entry", id: entryId }, 5);
    assert.equal(rated.count, 1);
    assert.equal(Number(rated.aggregate), 5);
    await assert.rejects((await as("student")).rate({ type: "glossary-entry", id: entryId }, 1), GradingError);
    assert.equal((await teacher.rate({ type: "glossary-entry", id: entryId }, null)).aggregate, undefined);
  });

  it("rate: a database record the student added", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const databaseId = await newActivity(course, "data", "Driver check suite database", RATINGS);
    await addDatabaseField(teacher, databaseId, "Note");
    const recordId = await addDatabaseRecord(await as("student"), databaseId, "Driver check suite record");
    const rated = await teacher.rate({ type: "database-record", id: recordId }, 3);
    assert.equal(rated.count, 1);
    assert.equal(Number(rated.aggregate), 3);
    await assert.rejects((await as("student")).rate({ type: "database-record", id: recordId }, 1), GradingError);
    assert.equal((await teacher.rate({ type: "database-record", id: recordId }, null)).aggregate, undefined);
  });

  describe("a workshop", () => {
    let workshopId: number;
    let submissionId: number;

    before(async () => {
      workshopId = await newActivity(course, "workshop", "Driver check suite workshop");
      await defineWorkshopAspect(await as("teacher"), workshopId);
    });

    it("setWorkshopPhase: the teacher opens submissions; the student can't switch phases", { timeout: 300_000 }, async () => {
      const teacher = await as("teacher");
      assert.equal((await teacher.workshopInfo(workshopId)).phase, "setup");
      const result = await teacher.setWorkshopPhase(workshopId, "submission");
      assert.equal(result.phase, "submission");
      assert.equal((await (await as("student")).workshopInfo(workshopId)).phase, "submission");
      await assert.rejects((await as("student")).setWorkshopPhase(workshopId, "assessment"), WorkshopError);
    });

    it("workshopInfo: the student's submission in the teacher's report", { timeout: 300_000 }, async () => {
      submissionId = await submitWorkshopWork(await as("student"), workshopId, "Driver check suite work");
      const info = await (await as("teacher")).workshopInfo(workshopId);
      assert.equal(info.activityId, workshopId);
      const submission = info.submissions.find((s) => s.id === submissionId);
      assert.ok(submission, "the submission isn't in the report");
      assert.equal(submission.title, "Driver check suite work");
      assert.equal(submission.authorId, studentId);
      assert.equal(submission.grade, undefined);
      // The student sees no report.
      assert.deepEqual((await (await as("student")).workshopInfo(workshopId)).submissions, []);
      await assert.rejects((await as("teacher")).workshopInfo(forumId), WorkshopError);
    });

    it("assessWorkshopSubmission: the teacher assesses it in the assessment phase", { timeout: 300_000 }, async () => {
      const teacher = await as("teacher");
      await assert.rejects(teacher.assessWorkshopSubmission(workshopId, submissionId, { criteria: [{ grade: 8 }] }), WorkshopError);
      await teacher.setWorkshopPhase(workshopId, "assessment");
      await assert.rejects(teacher.assessWorkshopSubmission(workshopId, submissionId, { criteria: [{ grade: 11 }] }), WorkshopError);
      const result = await teacher.assessWorkshopSubmission(workshopId, submissionId, { criteria: [{ grade: 8, comment: "Clear enough." }], feedback: "<p>Driver check suite feedback.</p>" });
      assert.ok(result.assessmentId > 0);
      assert.equal(result.grade, 64);
      assert.equal(result.maxGrade, 80);
      // Assessing again changes the same assessment.
      const again = await teacher.assessWorkshopSubmission(workshopId, submissionId, { criteria: [{ grade: 5 }] });
      assert.equal(again.assessmentId, result.assessmentId);
      assert.equal(again.grade, 40);
      const info = await teacher.workshopInfo(workshopId);
      const assessment = info.assessments.find((a) => a.id === result.assessmentId);
      assert.ok(assessment, "the assessment isn't in the report");
      assert.equal(assessment.submissionId, submissionId);
      assert.equal(assessment.authorId, studentId);
      assert.equal(assessment.reviewerId, await userId("teacher"));
      assert.equal(assessment.grade, 40);
      assert.equal((await teacher.setWorkshopPhase(workshopId, "closed")).phase, "closed");
    });
  });
});
