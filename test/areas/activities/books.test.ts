import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { BookError, addBookChapter, bookChapters, deleteBookChapter, editBookChapter, moveBookChapter, setBookChapterVisible } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-book-"));
  await writeFile(path.join(dir, "dot.png"), "PNG");
});
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

interface Chapter {
  id: number;
  title: string;
  subchapter: boolean;
  hidden: boolean;
  content: string;
}

// The book is activity 6; anything else is another module. Its pages are made up after Moodle 5.2's
// mod/book: the table of contents' fake block, the chapter form, and the move, show and delete links.
const BOOK = 6;

/** The table of contents as mod/book's book_get_toc writes it with editing off, numbered; `current` in bold. */
function toc(chapters: Chapter[], current: number | undefined): string {
  let html = '<section class="block block_book_toc"><div class="book_toc book_toc_numbered clearfix"><ul>';
  let n = 0;
  let s = 0;
  chapters.forEach((ch, i) => {
    if (!ch.subchapter) {
      html += i === 0 ? "<li>" : "</ul></li><li>";
      if (!ch.hidden) [n, s] = [n + 1, 0];
    } else html += "<li>";
    const number = ch.subchapter ? (ch.hidden ? `${n}.x.` : `${n}.${++s}.`) : ch.hidden ? "x." : `${n}.`;
    const css = ch.hidden ? "dimmed_text" : "";
    html += ch.id === current ? `<strong class="${css}">${number} ${ch.title}</strong>` : `<a class="${css}" href="view.php?id=${BOOK}&amp;chapterid=${ch.id}">${number} ${ch.title}</a>`;
    html += ch.subchapter ? "</li>" : "<ul>";
  });
  return `${html}</ul></li></ul></div></section>`;
}

function chapterForm(chapter: Partial<Chapter>, pagenum: number, itemId = "888"): string {
  return `<form class="mform" action="edit.php" method="post">
<input type="hidden" name="id" value="${chapter.id ?? ""}"><input type="hidden" name="cmid" value="${BOOK}"><input type="hidden" name="pagenum" value="${pagenum}"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="title" id="id_title" value="${chapter.title ?? ""}">
<input type="hidden" name="subchapter" value="0"><input type="checkbox" name="subchapter" value="1" id="id_subchapter"${chapter.subchapter ? " checked" : ""}${pagenum === 1 ? " disabled" : ""}>
<textarea name="content_editor[text]" id="id_content_editor">${chapter.content ?? ""}</textarea><input type="hidden" name="content_editor[itemid]" value="${itemId}">
<input type="submit" name="submitbutton" value="Save changes"></form>
<script>var filepicker = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`;
}

const ERROR = '<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Edit book chapters).</p></div>';

async function site({ student = false, printLink = true } = {}): Promise<{ context: BrowserContext; chapters: Chapter[]; posts: URLSearchParams[]; actions: string[]; uploads: string[] }> {
  const chapters: Chapter[] = [
    { id: 35, title: "One", subchapter: false, hidden: false, content: '<p>Body of One <img src="http://moodle.test/pluginfile.php/9/mod_book/chapter/35/dot.png" alt="Dot"></p>' },
    { id: 36, title: "One.sub", subchapter: true, hidden: false, content: "<p>Body of One.sub</p>" },
    { id: 37, title: "Two", subchapter: false, hidden: true, content: "<p>Body of Two</p>" },
  ];
  const posts: URLSearchParams[] = [];
  const actions: string[] = [];
  const uploads: string[] = [];
  let nextId = 40;
  const context = await browser!.newContext();
  const user = student ? 5 : 3;
  await serveFakeMoodle(context, { user: { id: user, fullName: "Someone" } });
  const visible = () => (student ? chapters.filter((c) => !c.hidden) : chapters);
  const page = (bodyId: string, body: string) => moodlePage({ userId: user, bodyId, body });
  const view = (chapterId: number | undefined) => {
    const shown = visible();
    const current = shown.find((c) => c.id === chapterId) ?? shown[0];
    const print = printLink && current ? `<a href="${SITE}mod/book/tool/print/index.php?id=${BOOK}&amp;chapterid=${current.id}">Print this chapter</a>` : "";
    const body = current ? `<div id="mod_book-chapter" class="box generalbox book_content"><h2>1. ${current.title}</h2><div class="no-overflow">${current.content}</div></div>` : "";
    return page("page-mod-book-view", `${toc(shown, current?.id)}${print}<div role="main">${body}</div>`);
  };
  await context.route(`${SITE}mod/book/**`, async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const q = (name: string) => url.searchParams.get(name);
    const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
    const action = url.pathname.replace("/mod/book/", "");
    if (action === "edit.php" && request.method() === "POST") {
      const form = new URLSearchParams(request.postData() ?? "");
      posts.push(form);
      const values = { title: form.get("title")!, subchapter: form.getAll("subchapter").includes("1"), content: form.get("content_editor[text]")! };
      const existing = chapters.find((c) => c.id === Number(form.get("id")));
      if (existing) Object.assign(existing, values);
      else chapters.splice(Number(form.get("pagenum")) - 1, 0, { id: nextId++, hidden: false, ...values });
      return html(view(undefined));
    }
    if (action === "edit.php") {
      if (Number(q("cmid")) !== BOOK || student) return html(page("page-site-index", ERROR));
      const chapter = chapters.find((c) => c.id === Number(q("id")));
      const pagenum = chapter ? chapters.indexOf(chapter) + 1 : Number(q("pagenum") ?? 0) + 1;
      return html(page("page-mod-book-edit", `${chapters.length > 0 ? toc(chapters, undefined) : ""}${chapterForm(chapter ?? { subchapter: q("subchapter") === "1" }, pagenum)}`));
    }
    if (action === "view.php") return html(Number(q("id")) === BOOK ? view(q("chapterid") ? Number(q("chapterid")) : undefined) : page("page-site-index", '<div data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>'));
    // The table of contents' links: each needs the sesskey, and acts on a chapter of the book.
    const chapter = chapters.find((c) => c.id === Number(q("chapterid")));
    if (q("sesskey") !== "s1" || !chapter) return html(page("page-site-index", '<div data-rel="fatalerror"><p class="errormessage">Invalid sesskey</p></div>'));
    actions.push(`${action}:${chapter.id}${q("up") !== null ? `:${q("up")}` : ""}`);
    const at = chapters.indexOf(chapter);
    const blockEnd = (start: number) => {
      let end = start;
      if (!chapters[start]!.subchapter) while (chapters[end + 1]?.subchapter) end++;
      return end;
    };
    if (action === "show.php") {
      chapter.hidden = !chapter.hidden;
      if (!chapter.subchapter) for (let i = at + 1; chapters[i]?.subchapter; i++) chapters[i]!.hidden = chapter.hidden;
    } else if (action === "delete.php") {
      chapters.splice(at, blockEnd(at) - at + 1);
    } else if (action === "move.php") {
      // Simplified after Moodle's move.php: a chapter's block past the neighbouring block, a subchapter past one.
      const block = chapters.splice(at, blockEnd(at) - at + 1);
      let to: number;
      if (q("up") === "1") {
        to = at - 1;
        if (!chapter.subchapter) while (to > 0 && chapters[to]!.subchapter) to--;
      } else to = chapter.subchapter ? at + 1 : blockEnd(at) + 1;
      chapters.splice(to, 0, ...block);
    }
    return html(view(chapter.id));
  });
  await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
    const body = route.request().postData() ?? "";
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
    uploads.push(`${field("itemid")}:${field("title")}`);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/${field("itemid")}/${field("title")}` }) });
  });
  return { context, chapters, posts, actions, uploads };
}

describe("bookChapters", { skip: !browser && "no system browser" }, () => {
  it("lists a teacher every chapter from the chapter form's page, numbers taken off the titles", async () => {
    const { context } = await site();
    assert.deepEqual(await bookChapters(context, SITE, BOOK), [
      { id: 35, title: "One", subchapter: false, hidden: false, position: 1 },
      { id: 36, title: "One.sub", subchapter: true, hidden: false, position: 2 },
      { id: 37, title: "Two", subchapter: false, hidden: true, position: 3 },
    ]);
    await context.close();
  });

  it("reads each chapter's HTML and images with content", async () => {
    const { context } = await site();
    const [one, , two] = await bookChapters(context, SITE, BOOK, { content: true });
    assert.match(one!.content!, /^<p>Body of One <img/);
    assert.deepEqual(one!.images, [{ url: `${SITE}pluginfile.php/9/mod_book/chapter/35/dot.png`, alt: "Dot" }]);
    assert.deepEqual([two!.content, two!.images], ["<p>Body of Two</p>", undefined]);
    await context.close();
  });

  it("lists a student the chapters they see, from the book's page, the shown one's id from its print link", async () => {
    const { context } = await site({ student: true });
    assert.deepEqual((await bookChapters(context, SITE, BOOK)).map((c) => [c.id, c.title, c.subchapter]), [
      [35, "One", false],
      [36, "One.sub", true],
    ]);
    await context.close();
  });

  it("without a print link, takes the shown chapter's id from another chapter's page", async () => {
    const { context } = await site({ student: true, printLink: false });
    assert.deepEqual((await bookChapters(context, SITE, BOOK)).map((c) => c.id), [35, 36]);
    await context.close();
  });

  it("refuses an activity that isn't a book", async () => {
    const { context } = await site();
    await assert.rejects(bookChapters(context, SITE, 99), (error: unknown) => error instanceof BookError && error.code === "book" && /isn't a book you can read: Invalid course module ID/.test(error.message));
    await context.close();
  });
});

describe("writing a book's chapters", { skip: !browser && "no system browser" }, () => {
  it("adds a chapter at the end, and a hidden subchapter after another, with an embedded image", async () => {
    const { context, posts, actions, uploads } = await site();
    const added = await addBookChapter(context, SITE, BOOK, { title: "Three", content: "<p>3</p>" });
    assert.deepEqual([added.chapterId, added.changed], [40, 'Added chapter 40 "Three" to book 6 at the end.']);
    assert.deepEqual(added.chapters.at(-1), { id: 40, title: "Three", subchapter: false, hidden: false, position: 4 });
    assert.equal(posts[0]!.get("pagenum"), "4");
    const sub = await addBookChapter(context, SITE, BOOK, { title: "One.two", content: '<p><img src="dot.png" alt="Dot"></p>', subchapter: true, hidden: true, afterChapterId: 36, embed: [path.join(dir, "dot.png")] });
    assert.equal(sub.changed, 'Added subchapter 41 "One.two" to book 6 after chapter 36, hidden.');
    assert.deepEqual(sub.chapters.map((c) => [c.id, c.subchapter, c.hidden]), [
      [35, false, false],
      [36, true, false],
      [41, true, true],
      [37, false, true],
      [40, false, false],
    ]);
    assert.deepEqual(uploads, ["888:dot.png"]);
    assert.equal(posts[1]!.get("content_editor[text]"), `<p><img src="${SITE}draftfile.php/9/user/draft/888/dot.png" alt="Dot"></p>`);
    assert.deepEqual(actions, ["show.php:41"]);
    await context.close();
  });

  it("refuses a subchapter first, a chapter to add after that isn't in the book, and a student", async () => {
    const { context, posts } = await site();
    await assert.rejects(editBookChapter(context, SITE, BOOK, 35, { subchapter: true }), /first chapter can't be a subchapter/);
    await assert.rejects(addBookChapter(context, SITE, BOOK, { title: "X", content: "x", afterChapterId: 99 }), (error: unknown) => error instanceof BookError && /has no chapter 99; it has 35, 36, 37/.test(error.message));
    assert.equal(posts.length, 0);
    const { context: other } = await site({ student: true });
    await assert.rejects(addBookChapter(other, SITE, BOOK, { title: "X", content: "x" }), /can't edit book 6's chapters/);
    await Promise.all([context.close(), other.close()]);
  });

  it("edits only what's given", async () => {
    const { context, posts } = await site();
    const edited = await editBookChapter(context, SITE, BOOK, 37, { title: "Second", subchapter: true });
    assert.equal(edited.changed, 'Chapter 37 of book 6 renamed to "Second", made a subchapter.');
    assert.deepEqual(edited.chapters[2], { id: 37, title: "Second", subchapter: true, hidden: true, position: 3 });
    assert.equal(posts[0]!.get("content_editor[text]"), "<p>Body of Two</p>");
    assert.equal((await editBookChapter(context, SITE, BOOK, 37, {})).changed, "Nothing to change.");
    await context.close();
  });

  it("moves a chapter with its subchapters, and says when it's already at the end", async () => {
    const { context, actions } = await site();
    const moved = await moveBookChapter(context, SITE, BOOK, 35, { direction: "down" });
    assert.equal(moved.changed, "Chapter 35 of book 6 moved down.");
    assert.deepEqual(moved.chapters.map((c) => c.id), [37, 35, 36]);
    assert.match((await moveBookChapter(context, SITE, BOOK, 35, { direction: "down" })).changed, /already last in book 6; nothing moved/);
    assert.match((await moveBookChapter(context, SITE, BOOK, 37, { direction: "up" })).changed, /already first/);
    assert.deepEqual(actions, ["move.php:35:0"]);
    await context.close();
  });

  it("shows or hides a chapter only when it isn't so already", async () => {
    const { context, actions } = await site();
    const hidden = await setBookChapterVisible(context, SITE, BOOK, 35, { visible: false });
    assert.equal(hidden.changed, "Chapter 35 of book 6 hidden.");
    assert.deepEqual(hidden.chapters.map((c) => c.hidden), [true, true, true]);
    assert.equal((await setBookChapterVisible(context, SITE, BOOK, 37, { visible: false })).changed, "Chapter 37 is already hidden.");
    assert.deepEqual(actions, ["show.php:35"]);
    await context.close();
  });

  it("deletes a chapter with its subchapters", async () => {
    const { context, actions } = await site();
    const deleted = await deleteBookChapter(context, SITE, BOOK, 35);
    assert.equal(deleted.changed, 'Chapter 35 "One" deleted from book 6, with its subchapters 36.');
    assert.deepEqual(deleted.chapters, [{ id: 37, title: "Two", subchapter: false, hidden: true, position: 1 }]);
    await assert.rejects(deleteBookChapter(context, SITE, BOOK, 35), BookError);
    assert.deepEqual(actions, ["delete.php:35"]);
    await context.close();
  });
});
