// FOLLOWED_PAGES against the sandbox, headless: what creations, edits and reads in a scratch course
// give as the page of their result, each opened to check it's the Moodle page meant and shows no error.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { FOLLOWED_PAGES, type Moodle } from "../../src/index.js";
import { openSitePage } from "../../src/internals.js";
import { SERIES, SITE, as, scratchCourse, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow (a page in 20 s under load): every Moodle round trip gets time.
const SLOW = { timeout: 1_200_000 };

/** Opens `path` as the teacher, without following it, and gives its body id; fails on Moodle's error page. */
async function opened(teacher: Moodle, path: string | undefined): Promise<string> {
  assert.ok(path, "a page to show");
  const page = await openSitePage(await teacher.context(), SITE, path, { follow: false });
  try {
    assert.equal(await page.locator('[data-rel="fatalerror"]').count(), 0, `${path} shows Moodle's error page`);
    return (await page.locator("body").getAttribute("id")) ?? "";
  } finally {
    await page.close();
  }
}

describe("FOLLOWED_PAGES", () => {
  let course: ScratchCourse;
  let teacher: Moodle;

  before(async () => {
    course = await scratchCourse("followed");
    teacher = await as("teacher");
  }, SLOW);

  it("createActivity: the activity made, not its form; editActivity: the course", SLOW, async () => {
    for (const type of ["page", "forum", "assign", "quiz"] as const) {
      const input = { courseId: course.id, sectionId: course.sectionId, type, name: `Driver check followed ${type}`, visibility: "shown" as const, ...(type === "page" ? { content: "<p>x</p>" } : {}) };
      const made = await teacher.createActivity(input);
      assert.equal(await opened(teacher, FOLLOWED_PAGES.createActivity!([input], made)), `page-mod-${type}-view`, type);
      const args: Parameters<Moodle["editActivity"]> = [course.id, made.activityId!, { name: `Driver check followed ${type} renamed` }];
      assert.match(await opened(teacher, FOLLOWED_PAGES.editActivity!(args, await teacher.editActivity(...args))), /^page-course-view/);
    }
  });

  it("startDiscussion: the discussion it started", SLOW, async () => {
    const forumId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "forum", name: "Driver check followed discussions", visibility: "shown" })).activityId!;
    const args: Parameters<Moodle["startDiscussion"]> = [forumId, { subject: "Driver check followed", message: "<p>A discussion to follow.</p>" }];
    const started = await teacher.startDiscussion(...args);
    assert.equal(await opened(teacher, FOLLOWED_PAGES.startDiscussion!(args, started)), "page-mod-forum-discuss");
  });

  it("createQuestion: the question made, in its preview, on Moodle 4.x's course banks too", SLOW, async () => {
    // A bank: Moodle 5's shared bank activity, or Moodle 4.x's course bank, whose id is the course's.
    let bankId = course.id;
    if (!SERIES.startsWith("4.")) {
      await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "qbank", name: "Driver check followed bank" });
      bankId = (await teacher.questionBanks(course.id)).find((b) => b.type === "qbank")!.id;
    }
    const args: Parameters<Moodle["createQuestion"]> = [bankId, { type: "truefalse", name: "Driver check followed question", text: "<p>Water is wet.</p>", correct: true }];
    const made = await teacher.createQuestion(...args);
    assert.equal(await opened(teacher, FOLLOWED_PAGES.createQuestion!(args, made)), "page-question-bank-previewquestion-preview");
  });

  it("assignmentSubmissions and quizResults: the pages they read", SLOW, async () => {
    const assignId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "assign", name: "Driver check followed submissions", visibility: "shown" })).activityId!;
    assert.equal(await opened(teacher, FOLLOWED_PAGES.assignmentSubmissions!([assignId], await teacher.assignmentSubmissions(assignId))), "page-mod-assign-grading");
    const quizId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "quiz", name: "Driver check followed results", visibility: "shown" })).activityId!;
    assert.equal(await opened(teacher, FOLLOWED_PAGES.quizResults!([quizId], await teacher.quizResults(quizId))), "page-mod-quiz-report");
  });
});
