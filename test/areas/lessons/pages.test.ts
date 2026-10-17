import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { FormError, LessonError, addLessonPage, deleteLessonPage, editLessonPage, lessonPages, moveLessonPage } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface FakePage {
  id: number;
  qtype: number;
  contents: string;
  /** The page's form values as last saved, by field name. */
  values: Record<string, string>;
}

const CODES = ["0", "-1", "-40", "-9"];
const BRANCH_CODES = ["-50", "-60", "-70"];
const MAX = 3;

/**
 * A made-up lesson (cmid 40) in Moodle 5.2's lesson editor, with 3 answers a page: the editor's
 * collapsed and expanded views (the view asked for is remembered), each page type's form (new,
 * after a page, or a page's own with `edit=1`; a new question put first offers no pages to jump to,
 * as Moodle's), the structural pages made by their sesskey link, and the move and delete links.
 */
function fakeEditor({ pages = [] as FakePage[], custom = true } = {}) {
  let nextId = 100;
  let view: "collapsed" | "full" = "collapsed";
  const views: string[] = [];
  const posted: URLSearchParams[] = [];
  const html = (route: Route, bodyId: string, main: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId, body: `<div id="region-main"><div role="main">${main}</div></div>` }) });
  const editor = () => {
    if (pages.length === 0) return `<div class="firstpageoptions"><a href="${SITE}mod/lesson/editpage.php?id=40&amp;pageid=0&amp;qtype=20&amp;firstpage=1">Add a content page</a></div>`;
    if (view === "collapsed") return `<table class="generaltable"><tbody>${pages.map((p) => `<tr><td><a id="lesson-${p.id}" href="${SITE}mod/lesson/edit.php?id=40&amp;mode=single&amp;pageid=${p.id}">${p.values.title}</a></td><td>Type</td></tr>`).join("")}</tbody></table>`;
    const tables = pages.map(
      (p) =>
        `<div><table><thead><tr><th colspan="2"><a id="lesson-${p.id}"></a>${p.values.title} <a title="Move" href="#"><i class="icon fa fa-arrows-up-down"></i></a></th></tr></thead>
<tbody><tr><td colspan="2"><div class="no-overflow">${p.contents}</div></td></tr><tr><td><strong>Type</strong></td></tr></tbody></table></div>`,
    );
    return `<div class="box edit_pages_box">${tables.join("")}</div>`;
  };
  const select = (name: string, options: string[], value: string) => `<select name="${name}">${options.map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  /** The type's form, filled with `values`, jumps from `options`. */
  const form = (qtype: number, values: Record<string, string>, options: string[], hidden: string) => {
    const v = (name: string) => (values[name] ?? "").replaceAll('"', "&quot;");
    const text = (name: string) => `<input name="${name}" value="${v(name)}">`;
    const area = (name: string) => `<textarea name="${name}" id="id_${name.replace(/\W/g, "_")}">${v(name)}</textarea>`;
    const jump = (i: number, fallback = "-1") => select(`jumpto[${i}]`, options, values[`jumpto[${i}]`] ?? fallback);
    const score = (i: number) => (custom ? text(`score[${i}]`) : `<input type="hidden" name="score[${i}]" value="${v(`score[${i}]`) || "0"}">`);
    const rows: string[] = [];
    if (qtype === 20) for (let i = 0; i < MAX; i++) rows.push(text(`answer_editor[${i}]`) + jump(i, i === 0 ? "0" : "-1"));
    if (qtype === 3 || qtype === 2) for (let i = 0; i < (qtype === 2 ? 2 : MAX); i++) rows.push(area(`answer_editor[${i}][text]`) + area(`response_editor[${i}][text]`) + jump(i) + score(i));
    if (qtype === 1 || qtype === 8) {
      for (let i = 0; i < MAX; i++) rows.push(text(`answer_editor[${i}]`) + area(`response_editor[${i}][text]`) + jump(i) + score(i));
      rows.push(`<input type="hidden" name="enableotheranswers" value="0"><input type="checkbox" name="enableotheranswers" value="1"${values.enableotheranswers === "1" ? " checked" : ""}>` + area(`response_editor[${MAX}][text]`) + jump(MAX) + score(MAX));
    }
    if (qtype === 5) {
      for (let i = 0; i < 2; i++) rows.push(area(`answer_editor[${i}][text]`) + jump(i) + score(i));
      for (let i = 2; i < MAX + 2; i++) rows.push(area(`answer_editor[${i}][text]`) + text(`response_editor[${i}]`));
    }
    if (qtype === 10) rows.push(jump(0) + score(0));
    if (qtype === 30 || qtype === 31 || qtype === 21) rows.push(jump(0));
    const qoption = qtype === 3 || qtype === 1 ? `<input type="checkbox" name="qoption" value="1"${values.qoption === "1" ? " checked" : ""}>` : "";
    // Moodle's check in the page: a missing title shows its message and sends nothing.
    return `<form class="mform" id="mform1" method="post" action="${SITE}mod/lesson/editpage.php" onsubmit="if (!this.title.value) { document.getElementById('id_error_title').textContent = 'Required'; return false; }">
${hidden}<input type="hidden" name="qtype" value="${qtype}"><input name="title" value="${v("title")}"><div id="id_error_title"></div>${area("contents_editor[text]")}${qoption}${rows.join("\n")}
<input type="submit" name="submitbutton" value="Save page"></form>`;
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/lesson/**`, (route: Route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams;
      if (q.get("id") !== "40" && route.request().method() === "GET") return html(route, "page-mod-lesson-view", `<div class="errorbox">Invalid course module ID</div>`);
      switch (url.pathname) {
        case "/mod/lesson/edit.php": {
          const mode = q.get("mode");
          if (mode === "full" || mode === "collapsed") view = mode;
          views.push(mode ?? "");
          return html(route, "page-mod-lesson-edit", editor());
        }
        case "/mod/lesson/editpage.php": {
          if (route.request().method() === "POST") {
            const data = new URLSearchParams(route.request().postData() ?? "");
            posted.push(data);
            const values = Object.fromEntries([...data].filter(([name]) => !["id", "pageid", "edit", "qtype", "submitbutton"].includes(name)));
            const contents = data.get("contents_editor[text]") ?? "";
            if (data.get("edit")) {
              const page = pages.find((p) => p.id === Number(data.get("pageid")))!;
              Object.assign(page, { contents, values: { ...page.values, ...values } });
            } else {
              const previous = Number(data.get("pageid"));
              const at = previous === 0 ? 0 : pages.findIndex((p) => p.id === previous) + 1;
              pages.splice(at, 0, { id: nextId++, qtype: Number(data.get("qtype")), contents, values });
            }
            return html(route, "page-mod-lesson-edit", editor());
          }
          const pageid = Number(q.get("pageid"));
          const qtype = Number(q.get("qtype"));
          if (q.get("edit")) {
            const page = pages.find((p) => p.id === pageid)!;
            const options = [...CODES, ...(page.qtype === 20 ? BRANCH_CODES : []), ...pages.map((p) => String(p.id))];
            return html(route, "page-mod-lesson-editpage", form(page.qtype, page.values, options, `<input type="hidden" name="id" value="40"><input type="hidden" name="pageid" value="${pageid}"><input type="hidden" name="edit" value="1">`));
          }
          if ([30, 31, 21].includes(qtype)) {
            assert.equal(q.get("sesskey"), "s1");
            const at = pageid === 0 ? 0 : pages.findIndex((p) => p.id === pageid) + 1;
            // An end of branch needs a content page before it: without one, Moodle adds nothing.
            if (qtype !== 21 || pages.slice(0, at).some((p) => p.qtype === 20)) {
              pages.splice(at, 0, { id: nextId++, qtype, contents: "Structure", values: { title: qtype === 30 ? "Cluster" : qtype === 31 ? "End of cluster" : "End of branch", "jumpto[0]": qtype === 30 ? "-80" : "-1" } });
            }
            return html(route, "page-mod-lesson-edit", editor());
          }
          const listsPages = qtype === 20 ? !q.get("firstpage") : pageid !== 0;
          const options = [...CODES, ...(qtype === 20 ? BRANCH_CODES : []), ...(listsPages ? pages.map((p) => String(p.id)) : [])];
          return html(route, "page-mod-lesson-editpage", form(qtype, {}, options, `<input type="hidden" name="id" value="40"><input type="hidden" name="pageid" value="${pageid}">`));
        }
        case "/mod/lesson/lesson.php": {
          assert.equal(q.get("sesskey"), "s1");
          const at = pages.findIndex((p) => p.id === Number(q.get("pageid")));
          const [page] = pages.splice(at, 1);
          if (q.get("action") === "moveit") {
            const target = Number(q.get("after"));
            pages.splice(target === 0 ? 0 : pages.findIndex((p) => p.id === target) + 1, 0, page!);
          }
          return html(route, "page-mod-lesson-edit", editor());
        }
        default:
          return route.fallback();
      }
    });
  };
  return { routes, pages, posted, views };
}

async function open(fake: ReturnType<typeof fakeEditor>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 4, fullName: "Teo Teacher" } });
  await fake.routes(context);
  return context;
}

/** A lesson with a page of each kind, as Moodle saves them. */
function seeded(): FakePage[] {
  return [
    { id: 1, qtype: 20, contents: "<p>Pick one.</p>", values: { title: "Start", "answer_editor[0]": "Question", "jumpto[0]": "-1", "answer_editor[1]": "Leave", "jumpto[1]": "-9" } },
    {
      id: 2,
      qtype: 3,
      contents: "<p>Blue?</p>",
      values: { title: "Sky", qoption: "1", "answer_editor[0][text]": "<p>Yes</p>", "response_editor[0][text]": "<p>Right.</p>", "jumpto[0]": "3", "score[0]": "1", "answer_editor[1][text]": "<p>No</p>", "jumpto[1]": "0", "score[1]": "0" },
    },
    { id: 3, qtype: 1, contents: "<p>Say hi</p>", values: { title: "Hi", "answer_editor[0]": "hi", "jumpto[0]": "-1", "score[0]": "1", enableotheranswers: "1", "response_editor[3][text]": "<p>No.</p>", "jumpto[3]": "0", "score[3]": "0" } },
    {
      id: 4,
      qtype: 5,
      contents: "<p>Match</p>",
      values: { title: "Pairs", "answer_editor[0][text]": "<p>Good</p>", "jumpto[0]": "-1", "score[0]": "1", "answer_editor[1][text]": "<p>Bad</p>", "jumpto[1]": "0", "score[1]": "0", "answer_editor[2][text]": "<p>Cat</p>", "response_editor[2]": "meow" },
    },
    { id: 5, qtype: 10, contents: "<p>Write</p>", values: { title: "Essay", "jumpto[0]": "-1", "score[0]": "2" } },
    { id: 6, qtype: 21, contents: "End of branch", values: { title: "End of branch", "jumpto[0]": "1" } },
  ];
}

describe("lessonPages", { skip: !browser && "no system browser" }, () => {
  it("reads every page's type, contents, buttons and answers, and puts the collapsed view back", async () => {
    const fake = fakeEditor({ pages: seeded() });
    const context = await open(fake);
    const pages = await lessonPages(context, SITE, 40);
    assert.deepEqual(pages, [
      {
        id: 1,
        type: "content",
        title: "Start",
        contents: "<p>Pick one.</p>",
        buttons: [
          { label: "Question", jumpTo: "next-page" },
          { label: "Leave", jumpTo: "end-of-lesson" },
        ],
      },
      {
        id: 2,
        type: "multichoice",
        title: "Sky",
        contents: "<p>Blue?</p>",
        multipleAnswers: true,
        answers: [
          { text: "<p>Yes</p>", response: "<p>Right.</p>", score: 1, jumpTo: 3 },
          { text: "<p>No</p>", score: 0, jumpTo: "this-page" },
        ],
      },
      {
        id: 3,
        type: "shortanswer",
        title: "Hi",
        contents: "<p>Say hi</p>",
        caseSensitive: false,
        answers: [
          { text: "hi", score: 1, jumpTo: "next-page" },
          { response: "<p>No.</p>", score: 0, jumpTo: "this-page", others: true },
        ],
      },
      {
        id: 4,
        type: "matching",
        title: "Pairs",
        contents: "<p>Match</p>",
        answers: [
          { text: "<p>Good</p>", score: 1, jumpTo: "next-page" },
          { text: "<p>Bad</p>", score: 0, jumpTo: "this-page" },
          { text: "<p>Cat</p>", response: "meow" },
        ],
      },
      { id: 5, type: "essay", title: "Essay", contents: "<p>Write</p>", answers: [{ score: 2, jumpTo: "next-page" }] },
      { id: 6, type: "end-of-branch", title: "End of branch", contents: "End of branch", answers: [{ jumpTo: 1 }] },
    ]);
    // The person's collapsed view: the expanded one opened to read, collapsed asked for again after.
    assert.deepEqual(fake.views, ["", "full", "collapsed"]);
    assert.deepEqual(await lessonPages(context, SITE, 41).catch((error: Error) => error.constructor.name), "LessonError");
    await context.close();
  });

  it("reads an empty lesson as no pages", async () => {
    const context = await open(fakeEditor());
    assert.deepEqual(await lessonPages(context, SITE, 40), []);
    await context.close();
  });
});

describe("addLessonPage", { skip: !browser && "no system browser" }, () => {
  it("builds a lesson from nothing: a first content page, a question after it, a jump to no page refused before anything is saved", async () => {
    const fake = fakeEditor();
    const context = await open(fake);
    const start = await addLessonPage(context, SITE, 40, { type: "content", title: "Start", contents: "<p>Go.</p>", buttons: [{ label: "On", jumpTo: "next-page" }, { label: "Out", jumpTo: "end-of-lesson" }] });
    assert.deepEqual(start, { changed: 'Added content page 100 "Start" to lesson 40, first.', pageId: 100, pageIds: [100] });
    assert.deepEqual([fake.posted[0]!.get("answer_editor[0]"), fake.posted[0]!.get("jumpto[0]"), fake.posted[0]!.get("jumpto[1]"), fake.posted[0]!.get("contents_editor[text]")], ["On", "-1", "-9", "<p>Go.</p>"]);
    await assert.rejects(
      addLessonPage(context, SITE, 40, { type: "multichoice", title: "Q", contents: "<p>?</p>", answers: [{ text: "A", jumpTo: 555 }] }),
      (error: Error) => error instanceof LessonError && /no page 555 to jump to: its pages are 100/.test(error.message),
    );
    assert.equal(fake.posted.length, 1);
    const question = await addLessonPage(context, SITE, 40, {
      type: "multichoice",
      title: "Q",
      contents: "<p>?</p>",
      multipleAnswers: true,
      answers: [
        { text: "A", response: "<p>Yes</p>", score: 1, jumpTo: 100 },
        { text: "B", jumpTo: "end-of-lesson" },
      ],
    });
    assert.deepEqual([question.pageId, question.pageIds], [101, [100, 101]]);
    const form = fake.posted[1]!;
    assert.deepEqual(
      ["qoption", "answer_editor[0][text]", "response_editor[0][text]", "score[0]", "jumpto[0]", "answer_editor[1][text]", "jumpto[1]", "answer_editor[2][text]"].map((name) => form.get(name)),
      ["1", "A", "<p>Yes</p>", "1", "100", "B", "-9", ""],
    );
    await context.close();
  });

  it("maps true/false, short answer's other answers and matching rows to their forms", async () => {
    const fake = fakeEditor({ pages: seeded().slice(0, 1) });
    const context = await open(fake);
    await addLessonPage(context, SITE, 40, { type: "truefalse", title: "TF", contents: "<p>Wet?</p>", answers: [{ text: "True", jumpTo: "next-page" }, { text: "False", response: "<p>No</p>" }] });
    await addLessonPage(context, SITE, 40, { type: "shortanswer", title: "SA", contents: "<p>Hi</p>", caseSensitive: true, answers: [{ text: "hi" }, { others: true, response: "<p>Try again</p>", jumpTo: "this-page" }] });
    await addLessonPage(context, SITE, 40, { type: "matching", title: "M", contents: "<p>M</p>", answers: [{ text: "<p>Good</p>" }, { text: "<p>Bad</p>" }, { text: "<p>Cat</p>", response: "meow" }] });
    const [tf, sa, matching] = fake.posted;
    assert.deepEqual([tf!.get("answer_editor[1][text]"), tf!.get("response_editor[1][text]"), tf!.get("jumpto[0]")], ["False", "<p>No</p>", "-1"]);
    assert.deepEqual([sa!.get("qoption"), sa!.getAll("enableotheranswers"), sa!.get("response_editor[3][text]"), sa!.get("jumpto[3]")], ["1", ["0", "1"], "<p>Try again</p>", "0"]);
    assert.deepEqual([matching!.get("answer_editor[1][text]"), matching!.get("answer_editor[2][text]"), matching!.get("response_editor[2]")], ["<p>Bad</p>", "<p>Cat</p>", "meow"]);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "truefalse", title: "X", contents: "<p>x</p>", answers: [{ text: "True" }] }), /two answers/);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "multichoice", title: "X", contents: "<p>x</p>", answers: [1, 2, 3, 4].map((n) => ({ text: String(n) })) }), /3 answers at most/);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "multichoice", title: "X", contents: "<p>x</p>", buttons: [{ label: "Go" }] }), /answers, not buttons/);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "content", contents: "<p>x</p>" }), /needs a title/);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "multichoice", title: "X", contents: "<p>x</p>", answers: [{ text: "A", jumpTo: "random-branch" }] }), /can't jump to "random-branch"/);
    await context.close();
  });

  it("makes structural pages by their link, then sets what's given; a page put first gets its jumps to pages afterwards", async () => {
    const fake = fakeEditor({ pages: seeded().slice(0, 1) });
    const context = await open(fake);
    const end = await addLessonPage(context, SITE, 40, { type: "end-of-branch", answers: [{ jumpTo: 1 }] });
    assert.deepEqual([end.pageId, end.pageIds, fake.posted[0]!.get("jumpto[0]"), fake.posted[0]!.get("edit")], [100, [1, 100], "1", "1"]);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "end-of-branch" }, { after: 0 }), /no end of branch after page 0/);
    const first = await addLessonPage(context, SITE, 40, { type: "essay", title: "E", contents: "<p>Write</p>", answers: [{ jumpTo: 1, score: 3 }] }, { after: 0 });
    assert.deepEqual(first.pageIds, [101, 1, 100]);
    // Saved first with the form's own jump, then the jump to page 1 on the saved page.
    assert.deepEqual([fake.posted[1]!.get("jumpto[0]"), fake.posted[1]!.get("score[0]"), fake.posted[2]!.get("jumpto[0]"), fake.posted[2]!.get("edit")], ["-1", "3", "1", "1"]);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "essay", title: "E" }, { after: 77 }), /no page 77 to put the new one after/);
    await context.close();
  });

  it("refuses a score without custom scoring, and tells Moodle's own check in the page", async () => {
    const context = await open(fakeEditor({ pages: seeded().slice(0, 1), custom: false }));
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "essay", title: "E", contents: "<p>x</p>", answers: [{ score: 2 }] }), /doesn't use custom scoring/);
    await assert.rejects(addLessonPage(context, SITE, 40, { type: "essay", title: "E", fields: { title: "" } }), (error: Error) => error instanceof FormError && /title: Required/.test(error.message));
    await context.close();
  });
});

describe("editLessonPage, moveLessonPage and deleteLessonPage", { skip: !browser && "no system browser" }, () => {
  it("changes only what's given, the answers replaced", async () => {
    const fake = fakeEditor({ pages: seeded() });
    const context = await open(fake);
    assert.deepEqual(await editLessonPage(context, SITE, 40, 2, { answers: [{ text: "Only", jumpTo: 1 }] }), { changed: "Saved page 2 of lesson 40.", pageId: 2 });
    const form = fake.posted[0]!;
    assert.deepEqual(["title", "answer_editor[0][text]", "jumpto[0]", "answer_editor[1][text]", "response_editor[1][text]"].map((name) => form.get(name)), ["Sky", "Only", "1", "", ""]);
    await editLessonPage(context, SITE, 40, 1, { buttons: [{ label: "Single" }] });
    assert.deepEqual([fake.posted[1]!.get("answer_editor[0]"), fake.posted[1]!.get("answer_editor[1]")], ["Single", ""]);
    await assert.rejects(editLessonPage(context, SITE, 40, 9, { title: "X" }), /no page 9: its pages are 1, 2, 3, 4, 5, 6/);
    await assert.rejects(editLessonPage(context, SITE, 40, 1, {}), /Give what to change/);
    await assert.rejects(editLessonPage(context, SITE, 40, 1, { answers: [{ text: "x" }] }), /buttons, not answers/);
    await context.close();
  });

  it("moves and deletes pages through the editor's links", async () => {
    const fake = fakeEditor({ pages: seeded() });
    const context = await open(fake);
    assert.deepEqual(await moveLessonPage(context, SITE, 40, 5, 0), { changed: "Moved page 5 of lesson 40 first.", pageIds: [5, 1, 2, 3, 4, 6] });
    assert.deepEqual((await moveLessonPage(context, SITE, 40, 5, 6)).pageIds, [1, 2, 3, 4, 6, 5]);
    await assert.rejects(moveLessonPage(context, SITE, 40, 5, 5), /not after 5/);
    assert.deepEqual(await deleteLessonPage(context, SITE, 40, 3), { changed: "Deleted page 3 from lesson 40.", pageIds: [1, 2, 4, 6, 5] });
    await assert.rejects(deleteLessonPage(context, SITE, 40, 3), LessonError);
    await context.close();
  });
});
