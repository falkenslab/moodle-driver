// backupContents against real backups made on the sandbox (Moodle 5.2.4) from a scratch course:
// "Introduction" (687, section 0) links to "Loops" (685, section 1), and "Loops: check" (686, section
// 1) is restricted on Loops' completion. No Moodle, no browser.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { BackupError, backupContents } from "../../../src/index.js";
import { writeTgz } from "./tgz.js";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);
const dependencies = (contents: Awaited<ReturnType<typeof backupContents>>) => Object.fromEntries(contents.activities.map((a) => [a.id, a.dependencies]));

describe("backupContents", () => {
  it("reads a whole course's backup: its Moodle, its origin, its sections and activities, self-contained", async () => {
    const course = await backupContents(fixture("course.mbz"));
    assert.equal(course.name, "course.mbz");
    assert.equal(course.type, "course");
    assert.deepEqual(course.moodle, { version: "2026042004", release: "5.2.4 (Build: 20261005)" });
    assert.deepEqual(course.original, { site: "http://localhost:8080", courseId: 105, courseFullName: "Driver check fixture 20261013221334", courseShortName: "drivercheck-fixture-20261013221334", format: "topics" });
    assert.deepEqual(
      course.sections.map((s) => [s.id, s.number, s.name]),
      [
        [523, 0, undefined],
        [524, 1, "Unit 1: loops"],
        [525, 2, undefined],
        [526, 3, undefined],
        [527, 4, undefined],
      ],
    );
    assert.equal(course.sections[1]!.summary, "<p>Loops in Python.</p>");
    assert.deepEqual(
      course.activities.map((a) => [a.id, a.type, a.title, a.sectionId]),
      [
        [684, "forum", "Announcements", 523],
        [687, "page", "Introduction", 523],
        [685, "page", "Loops", 524],
        [686, "page", "Loops: check", 524],
        [688, "label", "Read section 1 first.", 525],
      ],
    );
    assert.deepEqual(course.plugins, ["mod_forum", "mod_page", "mod_label", "format_topics"]);
    assert.equal(course.withUsers, false);
    // Everything each activity refers to is in it.
    assert.ok(course.activities.every((a) => a.dependencies.length === 0));
  });

  it("tells what a part of a course refers to that it left out: a restriction, a link", async () => {
    const part = await backupContents(fixture("part.mbz"));
    assert.equal(part.type, "course");
    assert.deepEqual(part.activities.map((a) => a.id), [687, 686]);
    assert.deepEqual(part.sections.map((s) => s.id), [523, 524]);
    assert.deepEqual(dependencies(part), {
      687: [{ kind: "link", activityId: 685, module: "page" }],
      686: [{ kind: "restriction", condition: "completion", activityId: 685 }],
    });
    assert.equal(part.gradebook, false);
  });

  it("reads a section's and an activity's backup, Moodle's own kinds", async () => {
    const section = await backupContents(fixture("section.mbz"));
    assert.equal(section.type, "section");
    assert.deepEqual(section.sections.map((s) => [s.id, s.name]), [[524, "Unit 1: loops"]]);
    // Loops is in it: the restriction on it holds.
    assert.deepEqual(dependencies(section), { 685: [], 686: [] });
    const activity = await backupContents(fixture("activity.mbz"));
    assert.equal(activity.type, "activity");
    assert.deepEqual(dependencies(activity), { 686: [{ kind: "restriction", condition: "completion", activityId: 685 }] });
  });

  it("refuses a file that isn't a Moodle backup, and one that isn't there", async () => {
    await assert.rejects(backupContents(fixture("not-a-backup.mbz")), (error: Error) => error instanceof BackupError && /isn't a Moodle backup/.test(error.message));
    await assert.rejects(backupContents(fixture("missing.mbz")), { code: "not-found" });
  });
});

describe("backupContents, made-up backups", () => {
  let dir: string;
  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "contents-"));
  });
  after(() => rm(dir, { recursive: true, force: true }));

  it("lists question types and blocks among the plugins, and a graded activity's category without the gradebook", async () => {
    const xml = `<moodle_backup><information><moodle_version>2024100700</moodle_version><moodle_release>4.5 (Build: 20241007)</moodle_release><original_course_id>9</original_course_id>
<details><detail backup_id="x"><type>course</type></detail></details>
<contents><activities><activity><moduleid>7</moduleid><sectionid>2</sectionid><modulename>quiz</modulename><title>Quiz</title><directory>activities/quiz_7</directory></activity></activities>
<sections><section><sectionid>2</sectionid><title>1</title><directory>sections/section_2</directory></section></sections></contents>
<settings><setting><level>root</level><name>users</name><value>1</value></setting></settings></information></moodle_backup>`;
    const availability = JSON.stringify({ op: "|", c: [{ type: "grade", id: 41, min: 50 }, { op: "&", c: [{ type: "group", id: 3 }, { type: "completion", cm: -1, e: 1 }] }] });
    const file = path.join(dir, "quiz.mbz");
    await writeFile(
      file,
      writeTgz([
        ["moodle_backup.xml", xml],
        ["activities/quiz_7/module.xml", `<module id="7"><availability>${availability.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}</availability></module>`],
        ["activities/quiz_7/grades.xml", '<activity_gradebook><grade_items><grade_item id="40"><categoryid>12</categoryid><itemtype>mod</itemtype></grade_item></grade_items></activity_gradebook>'],
        ["activities/quiz_7/quiz.xml", '<activity><quiz><intro>See $@FORUMVIEWBYID*8@$ and $@COURSEVIEWBYID*9@$</intro></quiz></activity>'],
        ["activities/quiz_7/blocks/html_31/block.xml", "<block/>"],
        ["questions.xml", "<question_categories><question_category id=\"1\"><questions><question id=\"5\"><qtype>multichoice</qtype></question><question id=\"6\"><qtype>truefalse</qtype></question></questions></question_category></question_categories>"],
      ]),
    );
    const contents = await backupContents(file);
    assert.deepEqual(contents.plugins, ["mod_quiz", "qtype_multichoice", "qtype_truefalse", "block_html"]);
    assert.equal(contents.withUsers, true);
    assert.deepEqual(dependencies(contents), {
      7: [
        { kind: "restriction", condition: "grade", gradeItemId: 41 },
        { kind: "restriction", condition: "group", groupId: 3 },
        { kind: "link", activityId: 8, module: "forum" },
        { kind: "grade-category", categoryId: 12 },
      ],
    });
  });
});
