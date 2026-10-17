import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { CompetenciesDisabledError, CompetencyError, MoodleError, addCourseCompetency, competencyFrameworks, competencyRating, courseCompetencies, rateCompetency, removeCourseCompetency, setActivityCompetencies } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const raw = (id: number, parentid = 0) => ({ id, shortname: `C${id}`, idnumber: `c-${id}`, description: `<p>Competency ${id}</p>`, descriptionformat: 1, parentid, path: "/0/", competencyframeworkid: 1, sortorder: 0 });

/** A made-up course 9 with framework 1 (competencies 21, 22) and page 30, as Moodle 5.2's competency services answer, reduced. */
interface FakeCompetencies {
  enabled: boolean;
  canManage: boolean;
  canGrade: boolean;
  course: number[];
  /** The competencies linked to page 30. */
  linked: number[];
  grade: number | null;
  evidence: { id: number; action: number; description: string; note: string | null; grade: number | null; gradename: string; actionuserid: number; actionuser: { id: number; fullname: string }; timecreated: number }[];
  posts: string[];
}

function services(fake: FakeCompetencies): Record<string, (args: Record<string, unknown>) => unknown> {
  const on = <T>(fn: (args: Record<string, unknown>) => T) => (args: Record<string, unknown>) => {
    if (!fake.enabled) throw new ServiceFailure("competenciesarenotenabled");
    return fn(args);
  };
  const manage = () => {
    if (!fake.canManage) throw new ServiceFailure("nopermissions");
  };
  return {
    core_competency_list_competency_frameworks: on(() => [{ id: 1, shortname: "Digital skills", idnumber: "ds", description: "<p>Skills</p>", visible: true, scaleid: 2 }]),
    core_competency_list_competencies: on(() => [raw(21), raw(22), raw(23, 21)]),
    tool_lp_data_for_course_competencies_page: on(() => ({
      courseid: 9,
      canmanagecoursecompetencies: fake.canManage,
      competencies: fake.course.map((id) => ({ competency: raw(id), coursemodules: fake.linked.includes(id) ? [{ id: 30, name: "Reading", url: `${SITE}mod/page/view.php?id=30` }] : [], comppath: { ancestors: [], framework: { id: 1, name: "Digital skills" } } })),
    })),
    core_competency_add_competency_to_course: on((args) => {
      manage();
      if (fake.course.includes(Number(args.competencyid))) return false;
      fake.course.push(Number(args.competencyid));
      return true;
    }),
    core_competency_remove_competency_from_course: on((args) => {
      manage();
      const before = fake.course.length;
      fake.course = fake.course.filter((id) => id !== Number(args.competencyid));
      fake.linked = fake.linked.filter((id) => id !== Number(args.competencyid));
      return fake.course.length < before;
    }),
    tool_lp_data_for_user_competency_summary_in_course: on(() => ({
      usercompetencysummary: {
        cangrade: fake.canGrade,
        competency: { scaleid: 2, scaleconfiguration: JSON.stringify([{ scaleid: "2" }, { id: 1, scaledefault: 1, proficient: 0 }, { id: 2, scaledefault: 0, proficient: 1 }]) },
        usercompetencycourse: { userid: 5, courseid: 9, competencyid: 21, grade: fake.grade, gradename: fake.grade ? ["", "Not yet competent", "Competent"][fake.grade] : "-", proficiency: fake.grade === null ? null : fake.grade === 2, proficiencyname: "No" },
        evidence: fake.evidence,
      },
    })),
    core_competency_get_scale_values: on(() => [
      { id: 1, name: "Not yet competent" },
      { id: 2, name: "Competent" },
    ]),
    core_competency_grade_competency_in_course: on((args) => {
      if (!fake.canGrade) throw new ServiceFailure("nopermissions");
      fake.grade = Number(args.grade);
      fake.evidence.unshift({ id: 40 + fake.evidence.length, action: 3, description: "The rating was set manually in the course.", note: (args.note as string | undefined) ?? null, grade: fake.grade, gradename: "Competent", actionuserid: 3, actionuser: { id: 3, fullname: "Teacher Uno" }, timecreated: 1792274400 });
      return {};
    }),
  };
}

function modForm(fake: FakeCompetencies): string {
  const field = fake.canManage
    ? `<select name="competencies[]" id="id_competencies" multiple style="display:none">${fake.course.map((id) => `<option value="${id}"${fake.linked.includes(id) ? " selected" : ""}>C${id}</option>`).join("")}</select><select name="competency_rule"><option value="0">Do nothing</option></select>`
    : "";
  return `<form class="mform" action="${SITE}course/modedit.php" method="post"><input type="hidden" name="course" value="9"><input type="hidden" name="coursemodule" value="30"><input type="hidden" name="modulename" value="page"><input name="name" value="Reading">${field}<input type="submit" name="submitbutton2" value="Save and return to course"></form>`;
}

async function site(overrides: Partial<FakeCompetencies> = {}): Promise<{ context: BrowserContext; fake: FakeCompetencies }> {
  const context = await browser!.newContext();
  const fake: FakeCompetencies = { enabled: true, canManage: true, canGrade: true, course: [21, 22], linked: [21], grade: null, evidence: [], posts: [], ...overrides };
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher Uno" }, services: services(fake) });
  await context.route(`${SITE}course/modedit.php**`, (route: Route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postData() ?? "";
      fake.posts.push(body);
      fake.linked = new URLSearchParams(body).getAll("competencies[]").map(Number);
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-course-view-topics", body: "<p>Course</p>" }) });
    }
    if (new URL(request.url()).searchParams.get("update") !== "30") return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-course-modedit", body: '<div data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>' }) });
    return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-page-mod", body: modForm(fake) }) });
  });
  return { context, fake };
}

describe("competencies", { skip: !browser && "no system browser" }, () => {
  it("competencyFrameworks: each framework with its competencies, their parents", async () => {
    const { context } = await site();
    const [framework] = await competencyFrameworks(context, SITE, 9);
    assert.deepEqual({ ...framework, competencies: framework!.competencies.map((c) => [c.id, c.shortName, c.parentId]) }, { id: 1, shortName: "Digital skills", idNumber: "ds", description: "<p>Skills</p>", competencies: [[21, "C21", 0], [22, "C22", 0], [23, "C23", 21]] });
  });

  it("courseCompetencies: the course's competencies, their framework and linked activities", async () => {
    const { context } = await site();
    assert.deepEqual(await courseCompetencies(context, SITE, 9), [
      { id: 21, shortName: "C21", idNumber: "c-21", description: "<p>Competency 21</p>", framework: { id: 1, name: "Digital skills" }, activities: [{ id: 30, name: "Reading" }] },
      { id: 22, shortName: "C22", idNumber: "c-22", description: "<p>Competency 22</p>", framework: { id: 1, name: "Digital skills" }, activities: [] },
    ]);
  });

  it("courseCompetencies: competencies off on the site", async () => {
    const { context } = await site({ enabled: false });
    await assert.rejects(courseCompetencies(context, SITE, 9), CompetenciesDisabledError);
  });

  it("addCourseCompetency and removeCourseCompetency: once each, with the course's competencies afterwards", async () => {
    const { context } = await site();
    const added = await addCourseCompetency(context, SITE, 9, 23);
    assert.equal(added.changed, "Added competency 23 to course 9.");
    assert.deepEqual(added.competencies.map((c) => c.id), [21, 22, 23]);
    assert.equal((await addCourseCompetency(context, SITE, 9, 23)).changed, "Competency 23 was already in course 9.");
    const removed = await removeCourseCompetency(context, SITE, 9, 21);
    assert.equal(removed.changed, "Removed competency 21 from course 9.");
    assert.deepEqual(removed.competencies.map((c) => c.id), [22, 23]);
    assert.equal((await removeCourseCompetency(context, SITE, 9, 21)).changed, "Competency 21 wasn't in course 9.");
  });

  it("addCourseCompetency: without the capability, it names it", async () => {
    const { context } = await site({ canManage: false });
    await assert.rejects(addCourseCompetency(context, SITE, 9, 23), (error: unknown) => error instanceof CompetencyError && error.code === "competency" && error.message.includes("moodle/competency:coursecompetencymanage"));
  });

  it("setActivityCompetencies: sets the form's course competencies field, and reads the links back", async () => {
    const { context, fake } = await site();
    const result = await setActivityCompetencies(context, SITE, 30, [22]);
    assert.deepEqual(result, { changed: "Activity 30 linked to competencies 22.", activityId: 30, competencyIds: [22] });
    assert.deepEqual(new URLSearchParams(fake.posts[0]).getAll("competencies[]"), ["22"]);
    assert.deepEqual((await setActivityCompetencies(context, SITE, 30, [])).competencyIds, []);
    assert.deepEqual(fake.linked, []);
  });

  it("setActivityCompetencies: refuses a competency not in the course, a missing field, a missing activity", async () => {
    const { context, fake } = await site();
    await assert.rejects(setActivityCompetencies(context, SITE, 30, [23]), (error: unknown) => error instanceof CompetencyError && error.message.includes("addCourseCompetency"));
    await assert.rejects(setActivityCompetencies(context, SITE, 31, [21]), CompetencyError);
    await assert.rejects(setActivityCompetencies(context, SITE, 30, [0]), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
    fake.canManage = false;
    await assert.rejects(setActivityCompetencies(context, SITE, 30, [21]), (error: unknown) => error instanceof CompetencyError && error.message.includes("coursecompetencymanage"));
    assert.equal(fake.posts.length, 0);
  });

  it("competencyRating: unrated, with the scale and which rating is proficient", async () => {
    const { context } = await site();
    assert.deepEqual(await competencyRating(context, SITE, 9, 5, 21), {
      courseId: 9,
      userId: 5,
      competencyId: 21,
      rating: null,
      proficient: null,
      scale: [
        { value: 1, name: "Not yet competent", proficient: false },
        { value: 2, name: "Competent", proficient: true },
      ],
      evidence: [],
      canRate: true,
    });
  });

  it("rateCompetency: by the scale item's name, with a note kept as evidence", async () => {
    const { context } = await site();
    const { changed, rating } = await rateCompetency(context, SITE, 9, 5, 21, { rating: "competent", note: "Shown in class." });
    assert.equal(changed, 'Rated user 5 "Competent" in competency 21 of course 9, with a note.');
    assert.deepEqual([rating.rating, rating.proficient], [{ value: 2, name: "Competent" }, true]);
    assert.deepEqual(rating.evidence, [{ id: 40, action: "override", description: "The rating was set manually in the course.", note: "Shown in class.", rating: { value: 2, name: "Competent" }, by: { id: 3, name: "Teacher Uno" }, created: "2026-10-17T22:00:00.000Z" }]);
  });

  it("rateCompetency: a rating not on the scale, or without the capability", async () => {
    const { context, fake } = await site();
    await assert.rejects(rateCompetency(context, SITE, 9, 5, 21, { rating: 3 }), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input" && error.message.includes("2 (Competent)"));
    fake.canGrade = false;
    await assert.rejects(rateCompetency(context, SITE, 9, 5, 21, { rating: 1 }), (error: unknown) => error instanceof CompetencyError && error.message.includes("moodle/competency:competencygrade"));
    assert.equal(fake.grade, null);
  });
});
