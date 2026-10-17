// Course badges against the sandbox: a badge made with an image on a scratch course by the teacher,
// given an activity completion criterion and a manual one, enabled, awarded by hand to the student,
// read back by both, and disabled again. A deleted course only archives its badges: the badge is deleted after the file.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { BadgeError, type CourseBadge } from "../../src/index.js";
import { openSitePage } from "../../src/internals.js";
import { SITE, as, cleanup, quietly, scratchCourse, userId, type ScratchCourse } from "./harness.js";
import { pngFile } from "./packages.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
/** The sandbox's editing teacher role, the teacher's role in the scratch course. */
const EDITING_TEACHER = 3;

/** Deletes a badge for good, as the teacher, through the badges page's delete confirmation (with the session key). */
async function deleteBadge(courseId: number, badgeId: number): Promise<void> {
  const context = await (await as("teacher")).context();
  const page = await openSitePage(context, SITE, `badges/index.php?type=2&id=${courseId}`);
  try {
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    await page.goto(`${SITE}badges/index.php?type=2&id=${courseId}&delete=${badgeId}&confirm=1&sesskey=${sesskey}`, { waitUntil: "domcontentloaded" });
  } finally {
    await page.close();
  }
}

describe("badges", () => {
  let course: ScratchCourse;
  let pageId: number;
  let badge: CourseBadge;

  before(async () => {
    course = await scratchCourse("badges");
    const made = await (await as("teacher")).createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check badge page", content: "<p>Read me.</p>", visibility: "shown", completion: "manual" });
    pageId = made.activityId!;
  }, { timeout: 1_800_000 });

  it("createBadge: a disabled badge with its image, without criteria", SLOW, async () => {
    const teacher = await as("teacher");
    const result = await teacher.createBadge(course.id, { name: "Driver check badge", description: "Made by the sandbox suite.", image: pngFile("badge.png") });
    badge = result.badge;
    cleanup(() => quietly(() => deleteBadge(course.id, badge.id)));
    assert.match(result.changed, /created/);
    assert.equal(badge.courseId, course.id);
    assert.equal(badge.name, "Driver check badge");
    assert.equal(badge.description, "Made by the sandbox suite.");
    assert.match(badge.imageUrl, new RegExp(`/pluginfile\\.php/\\d+/badges/badgeimage/${badge.id}/f1$`));
    assert.deepEqual([badge.enabled, badge.criteria, badge.recipients, badge.awarded], [false, "", 0, false]);
    await assert.rejects((await as("student")).createBadge(course.id, { name: "Driver check refused", description: "No.", image: pngFile("badge.png") }), BadgeError);
  });

  it("courseBadges: the teacher sees the disabled badge, the student doesn't", SLOW, async () => {
    assert.deepEqual(await (await as("teacher")).courseBadges(course.id), [badge]);
    assert.deepEqual(await (await as("student")).courseBadges(course.id), []);
  });

  it("setBadgeCriteria: activity completion and a manual award, either one earns it", SLOW, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.setBadgeCriteria(badge.id, { activities: { activityIds: [999_999] } }), BadgeError);
    const result = await teacher.setBadgeCriteria(badge.id, { activities: { activityIds: [pageId] }, manual: { roleIds: [EDITING_TEACHER] }, all: false });
    assert.deepEqual(result.criteria, { activities: { activityIds: [pageId], all: true }, manual: { roleIds: [EDITING_TEACHER], all: false }, all: false });
    const [listed] = await teacher.courseBadges(course.id);
    assert.ok(listed?.criteria.includes("Driver check badge page"), listed?.criteria);
  });

  it("setBadgeEnabled: enabled, its criteria no longer change, the student sees it", SLOW, async () => {
    const teacher = await as("teacher");
    const result = await teacher.setBadgeEnabled(badge.id, true);
    assert.equal(result.badge.enabled, true);
    assert.match((await teacher.setBadgeEnabled(badge.id, true)).changed, /already/);
    await assert.rejects(teacher.setBadgeCriteria(badge.id, { manual: null }), BadgeError);
    const seen = await (await as("student")).courseBadges(course.id);
    assert.deepEqual(seen.map((b) => [b.id, b.enabled, b.awarded, b.recipients]), [[badge.id, true, false, undefined]]);
  });

  it("awardBadge: the teacher awards it by hand to the student, who has it", SLOW, async () => {
    const teacher = await as("teacher");
    const student = await userId("student");
    await assert.rejects((await as("student")).awardBadge(badge.id, student), BadgeError);
    const result = await teacher.awardBadge(badge.id, student);
    assert.match(result.changed, /awarded/);
    assert.equal(result.badge.recipients, 1);
    assert.match((await teacher.awardBadge(badge.id, student)).changed, /already/);
    const [mine] = await (await as("student")).courseBadges(course.id);
    assert.equal(mine?.awarded, true);
  });

  it("setBadgeEnabled: disabled again, gone from the student's list", SLOW, async () => {
    const teacher = await as("teacher");
    const result = await teacher.setBadgeEnabled(badge.id, false);
    assert.deepEqual([result.badge.enabled, result.badge.recipients], [false, 1]);
    assert.deepEqual(await (await as("student")).courseBadges(course.id), []);
    await assert.rejects(teacher.awardBadge(badge.id, await userId("admin")), BadgeError);
  });
});
