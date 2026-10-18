// Wikis against the sandbox: a collaborative wiki made by the teacher on the scratch course, its
// first page created by the teacher (an image embedded, two sections, a link to a page not created
// yet), the linked page created by the student, both edited by each of them (a section too), read
// back with their history, and the editor's lock held by the teacher while the student tries.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { NotAWikiError, WikiError, WikiPageLockedError } from "../../src/index.js";
import { openForm, openSitePage } from "../../src/internals.js";
import { SITE, as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

// A 1×1 PNG, embedded in a page.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const HOME = "Driver check home";
const SECOND = "Driver check second";

describe("wikis", () => {
  let course: ScratchCourse;
  let wikiId: number;
  let pageActivityId: number;
  let dir: string;
  let homeId: number;
  let secondId: number;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "driver-check-wiki-"));
    await writeFile(path.join(dir, "dot.png"), PNG);
    course = await scratchCourse("wikis");
    const teacher = await as("teacher");
    wikiId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "wiki", name: "Driver check wiki", visibility: "shown", settings: { wikimode: "collaborative", firstpagetitle: HOME } })).activityId!;
    pageActivityId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check page", content: "<p>x</p>", visibility: "shown" })).activityId!;
  }, SETUP);
  after(() => rm(dir, { recursive: true, force: true }));

  it("wikiPages: none before the first page; another module refused", SLOW, async () => {
    const student = await as("student");
    assert.deepEqual(await student.wikiPages(wikiId), []);
    await assert.rejects(student.wikiPages(pageActivityId), NotAWikiError);
  });

  it("createWikiPage: the teacher's first page, with an image, two sections and a link to a page to come; another title first, and the same title again, refused", SLOW, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.createWikiPage(wikiId, { title: "Driver check other", content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && error.message.includes(HOME));
    const created = await teacher.createWikiPage(wikiId, {
      title: HOME,
      content: `<h3>Intro</h3><p>Home, by the teacher. <img src="dot.png" alt="Dot"> [[${SECOND}]]</p><h3>More</h3><p>More to read.</p>`,
      embed: [path.join(dir, "dot.png")],
    });
    homeId = created.pageId;
    const page = created.page;
    assert.equal(page.id, homeId);
    assert.equal(page.title, HOME);
    assert.match(page.html, /pluginfile\.php\/\d+\/mod_wiki\/attachments\/\d+\/dot\.png/);
    assert.doesNotMatch(page.html, /wiki-toc|wiki_edit_section/);
    assert.match(page.text, /Home, by the teacher\./);
    assert.deepEqual(page.sections, ["Intro", "More"]);
    assert.deepEqual(page.links, [{ title: SECOND }]);
    assert.equal(page.images?.length, 1);
    assert.equal(page.version, 1);
    assert.equal(page.authorId, await userId("teacher"));
    assert.ok(Math.abs(Date.parse(page.modified!) - Date.now()) < 15 * 60_000, page.modified);
    await assert.rejects(teacher.createWikiPage(wikiId, { title: HOME, content: "<p>Again</p>" }), (error: Error) => error instanceof WikiError && error.message.includes(String(homeId)));
  });

  it("createWikiPage: the student's page, the one the first page links to", SLOW, async () => {
    const created = await (await as("student")).createWikiPage(wikiId, { title: SECOND, content: `<p>Second, by the student. [[${HOME}]]</p>` });
    secondId = created.pageId;
    assert.equal(created.page.title, SECOND);
    assert.deepEqual(created.page.links, [{ title: HOME, pageId: homeId }]);
    assert.equal(created.page.authorId, await userId("student"));
    assert.deepEqual((await (await as("teacher")).wikiPage(wikiId, homeId)).links, [{ title: SECOND, pageId: secondId }]);
  });

  it("editWikiPage: a section by the teacher, the whole page by the student; a section the page hasn't refused", SLOW, async () => {
    const teacher = await as("teacher");
    const section = await teacher.editWikiPage(wikiId, homeId, { section: "More", content: "<h3>More</h3><p>More, changed by the teacher.</p>" });
    assert.equal(section.page.version, 2);
    assert.match(section.page.text, /More, changed by the teacher\./);
    assert.match(section.page.text, /Home, by the teacher\./);
    await assert.rejects(teacher.editWikiPage(wikiId, homeId, { section: "Driver check nowhere", content: "<p>x</p>" }), WikiError);
    const whole = await (await as("student")).editWikiPage(wikiId, homeId, { content: `<p>Home, rewritten by the student. [[${SECOND}]]</p>` });
    assert.equal(whole.page.version, 3);
    assert.equal(whole.page.authorId, await userId("student"));
    assert.deepEqual(whole.page.sections, []);
  });

  it("wikiPage: the content and every version, newest first; a page of another id refused", SLOW, async () => {
    const page = await (await as("teacher")).wikiPage(wikiId, homeId, { history: true });
    assert.match(page.text, /rewritten by the student/);
    assert.deepEqual(page.history?.map((v) => [v.version, v.authorId]), [
      [3, await userId("student")],
      [2, await userId("teacher")],
      [1, await userId("teacher")],
    ]);
    assert.ok(page.history!.every((v) => v.modified && v.authorName));
    await assert.rejects((await as("teacher")).wikiPage(wikiId, 999_999_999), WikiError);
  });

  it("wikiPages: both pages by title, with their links and latest versions; a group to choose refused", SLOW, async () => {
    const pages = await (await as("student")).wikiPages(wikiId);
    assert.deepEqual(
      pages.map((p) => [p.id, p.title, p.version, p.authorId, p.links]),
      [
        [homeId, HOME, 3, await userId("student"), [{ title: SECOND, pageId: secondId }]],
        [secondId, SECOND, 1, await userId("student"), [{ title: HOME, pageId: homeId }]],
      ],
    );
    const first = await (await as("teacher")).wikiPages(wikiId, { limit: 1, offset: 1 });
    assert.deepEqual(first.items.map((p) => p.id), [secondId]);
    assert.equal(first.more, false);
    // A collaborative wiki without groups has one subwiki: there is none to choose.
    await assert.rejects((await as("student")).wikiPages(wikiId, { groupId: 1 }), WikiError);
  });

  it("editWikiPage: refused while the teacher has the page open in its editor, saved once they leave", SLOW, async () => {
    const teacher = await as("teacher");
    const context = await teacher.context();
    const editor = await openForm(context, SITE, `mod/wiki/edit.php?pageid=${secondId}`);
    const student = await as("student");
    try {
      await assert.rejects(student.editWikiPage(wikiId, secondId, { content: "<p>Locked out.</p>" }), WikiPageLockedError);
    } finally {
      // Leaving the editor through the page's view releases its lock, as in Moodle.
      await editor.goto(new URL(`mod/wiki/view.php?pageid=${secondId}`, SITE).href, { waitUntil: "domcontentloaded" });
      await editor.close();
    }
    const saved = await student.editWikiPage(wikiId, secondId, { content: `<p>Second, after the lock. [[${HOME}]]</p>` });
    assert.equal(saved.page.version, 2);
    // Every account's last wiki page is a view, so the next run's first wiki page opens cleanly.
    await (await openSitePage(context, SITE, `mod/wiki/view.php?pageid=${secondId}`)).close();
  });
});
