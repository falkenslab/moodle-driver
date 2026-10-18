import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { MoodleError, NotAWikiError, WikiError, WikiPageLockedError, createWikiPage, editWikiPage, wikiPage, wikiPages } from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { newWiki, serveWiki, type FakeWiki } from "./fakeWiki.js";

const browser = await launchTestBrowser();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-wiki-"));
  await writeFile(path.join(dir, "dot.png"), "PNG");
});
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

async function site(overrides: Partial<FakeWiki> = {}) {
  const context = await browser!.newContext();
  const w = newWiki(overrides);
  const state = await serveWiki(context, w);
  return { context, w, state };
}

describe("wikiPages", { skip: !browser && "no system browser" }, () => {
  it("lists the subwiki's pages by title, with their links and latest versions", async () => {
    const { context } = await site();
    try {
      assert.deepEqual(await wikiPages(context, SITE, 40), [
        { id: 11, title: "Home", links: [{ title: "Rules", pageId: 12 }, { title: "Later" }], version: 2, modified: "2026-10-17T12:30:00.000Z", authorId: 5, authorName: "Student" },
        { id: 12, title: "Rules", links: [{ title: "Home", pageId: 11 }], version: 1, modified: "2026-10-17T07:05:00.000Z", authorId: 5, authorName: "Student" },
      ]);
    } finally {
      await context.close();
    }
  });

  it("pages with limit and offset, reading only the window's pages", async () => {
    const { context, state } = await site();
    try {
      const page = await wikiPages(context, SITE, 40, { limit: 1 });
      assert.deepEqual(page.items.map((p) => p.id), [11]);
      assert.equal(page.more, true);
      assert.ok(!state.pagesServed!.some((p) => p.includes("pageid=12&option=2")));
    } finally {
      await context.close();
    }
  });

  it("is empty before the wiki's first page; refuses another module, and a subwiki to choose where there is none", async () => {
    const { context } = await site({ pages: [] });
    try {
      assert.deepEqual(await wikiPages(context, SITE, 40), []);
      await assert.rejects(wikiPages(context, SITE, 41), NotAWikiError);
    } finally {
      await context.close();
    }
    const other = await site();
    try {
      await assert.rejects(wikiPages(other.context, SITE, 40, { groupId: 2 }), WikiError);
    } finally {
      await other.context.close();
    }
  });
});

describe("wikiPage", { skip: !browser && "no system browser" }, () => {
  it("reads the content without Moodle's table of contents, its sections, links and history", async () => {
    const { context } = await site();
    try {
      const page = await wikiPage(context, SITE, 40, 11, { history: true });
      assert.equal(page.title, "Home");
      assert.equal(page.subwikiId, 7);
      assert.deepEqual(page.sections, ["Intro", "More"]);
      assert.doesNotMatch(page.html, /wiki-toc|wiki_edit_section|toc-1/);
      assert.match(page.html, /<h3>Intro <\/h3>/);
      assert.equal(page.text, "Intro\n\nWelcome! Rules Later\n\nMore\n\nMore.");
      assert.deepEqual(page.links, [{ title: "Rules", pageId: 12 }, { title: "Later" }]);
      assert.equal(page.version, 2);
      assert.deepEqual(page.history, [
        { version: 2, modified: "2026-10-17T12:30:00.000Z", authorId: 5, authorName: "Student" },
        { version: 1, modified: "2026-10-17T07:05:00.000Z", authorId: 3, authorName: "Teacher" },
      ]);
    } finally {
      await context.close();
    }
  });

  it("refuses a page that isn't there", async () => {
    const { context } = await site();
    try {
      await assert.rejects(wikiPage(context, SITE, 40, 99), (error: Error) => error instanceof WikiError && /wikiPages/.test(error.message));
    } finally {
      await context.close();
    }
  });
});

describe("createWikiPage", { skip: !browser && "no system browser" }, () => {
  it("creates a page through the new page form and its editor, an image embedded", async () => {
    const { context, w } = await site();
    try {
      const created = await createWikiPage(context, SITE, 40, { title: "Later", content: '<p>Now. <img src="dot.png"></p>', embed: [path.join(dir, "dot.png")] });
      assert.equal(created.pageId, 100);
      assert.equal(created.page.title, "Later");
      assert.equal(created.page.version, 1);
      assert.match(created.changed, /Created page 100 "Later" in wiki 40/);
      const saved = w.posts.find((p) => p.path === "/mod/wiki/edit.php")!.form.get("newcontent_editor[text]");
      assert.match(saved!, /draftfile\.php\/9\/user\/draft\/900\/dot\.png/);
    } finally {
      await context.close();
    }
  });

  it("starts an empty subwiki with the wiki's first page only; refuses a title already there", async () => {
    const empty = await site({ pages: [] });
    try {
      await assert.rejects(createWikiPage(empty.context, SITE, 40, { title: "Other", content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && /"Home"/.test(error.message));
      const first = await createWikiPage(empty.context, SITE, 40, { title: "Home", content: "<p>First</p>" });
      assert.equal(first.page.text, "First");
    } finally {
      await empty.context.close();
    }
    const { context } = await site();
    try {
      await assert.rejects(createWikiPage(context, SITE, 40, { title: "rules", content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && /editWikiPage/.test(error.message));
      await assert.rejects(createWikiPage(context, SITE, 40, { title: " ", content: "<p>x</p>" }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    } finally {
      await context.close();
    }
  });

  it("names the capability Moodle asks for", async () => {
    const { context } = await site({ readOnly: true });
    try {
      await assert.rejects(createWikiPage(context, SITE, 40, { title: "Later", content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && /mod\/wiki:createpage/.test(error.message));
    } finally {
      await context.close();
    }
  });
});

describe("editWikiPage", { skip: !browser && "no system browser" }, () => {
  it("saves the whole page, or a section of it", async () => {
    const { context, w } = await site();
    try {
      const whole = await editWikiPage(context, SITE, 40, 12, { content: "<p>Be very kind.</p>" });
      assert.equal(whole.page.version, 2);
      assert.equal(whole.page.text, "Be very kind.");
      const section = await editWikiPage(context, SITE, 40, 11, { section: "More", content: "<h3>More</h3><p>Even more.</p>" });
      assert.match(section.page.text, /Welcome!.*Even more\./s);
      assert.match(section.changed, /section "More" of page 11/);
      assert.equal(w.pages[0]!.versions.length, 4);
      await assert.rejects(editWikiPage(context, SITE, 40, 11, { section: "Nowhere", content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && /sections/.test(error.message));
    } finally {
      await context.close();
    }
  });

  it("refuses a page someone else is editing, never overriding the lock, and leaves through the page's view", async () => {
    const { context, state, w } = await site({ locked: [12] });
    try {
      await assert.rejects(editWikiPage(context, SITE, 40, 12, { content: "<p>x</p>" }), WikiPageLockedError);
      assert.equal(w.posts.length, 0);
      assert.equal(state.pagesServed!.at(-1), "/mod/wiki/view.php?pageid=12");
    } finally {
      await context.close();
    }
  });

  it("refuses without the capability, and a page of another wiki", async () => {
    const { context } = await site({ readOnly: true });
    try {
      await assert.rejects(editWikiPage(context, SITE, 40, 12, { content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && /mod\/wiki:editpage/.test(error.message));
      await assert.rejects(editWikiPage(context, SITE, 40, 12, { content: "" }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
    } finally {
      await context.close();
    }
    const other = await site();
    try {
      await assert.rejects(editWikiPage(other.context, SITE, 41, 12, { content: "<p>x</p>" }), (error: Error) => error instanceof WikiError && /isn't in wiki 41/.test(error.message));
    } finally {
      await other.context.close();
    }
  });
});
