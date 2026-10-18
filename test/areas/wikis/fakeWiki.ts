// A made-up collaborative wiki, as Moodle 5.2 renders its pages (view.php, map.php, history.php,
// create.php, edit.php; Moodle 4.5's Classic theme draws the same markup inside them), keeping what
// is posted as Moodle keeps it. Moodle redirects after a post; the fake serves the page it would
// redirect to in place (Playwright doesn't route a request after a redirect it fulfilled).
import type { BrowserContext, Route } from "playwright-core";
import { SITE, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

export interface FakeVersion {
  version: number;
  userId: number;
  userName: string;
  /** "18 October 2026" and "11:41 AM", as the history writes them. */
  date: string;
  time: string;
  content: string;
}

export interface FakeWikiPage {
  id: number;
  title: string;
  versions: FakeVersion[];
}

export interface FakeWiki {
  /** The wiki's course module id. */
  cmid: number;
  wid: number;
  subwikiId: number;
  firstTitle: string;
  pages: FakeWikiPage[];
  user: { id: number; name: string };
  /** Pages someone else has open in the editor. */
  locked: number[];
  /** The person can't edit (no mod/wiki:editpage). */
  readOnly?: boolean;
  /** Every POST received, by path. */
  posts: { path: string; form: URLSearchParams }[];
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function page(w: FakeWiki, body: string, script: string): string {
  return moodlePage({ userId: w.user.id, body, bodyId: `page-mod-wiki-${script}`, bodyClass: `path-mod-wiki context-${w.cmid * 10} cmid-${w.cmid}` });
}

function fatal(w: FakeWiki, message: string, component: string, code: string): string {
  return moodlePage({ userId: w.user.id, bodyId: "page-site-index", body: `<div role="main"><div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/${component}/${code}">More information about this error</a></p></div></div>` });
}

const current = (p: FakeWikiPage) => p.versions[p.versions.length - 1];

/** `[[Title]]` as Moodle's parser renders it: a link to the page, or to create it. */
function render(w: FakeWiki, content: string): string {
  return content.replace(/\[\[([^\]]+)\]\]/g, (_, title: string) => {
    const target = w.pages.find((p) => p.title === title);
    return target ? `<a href="${SITE}mod/wiki/view.php?pageid=${target.id}">${escape(title)}</a>` : `<a class="wiki_newentry" href="${SITE}mod/wiki/create.php?swid=${w.subwikiId}&amp;title=${encodeURIComponent(title).replaceAll("%20", "+")}&amp;action=new">${escape(title)}</a>`;
  });
}

/** A page's content with the table of contents and "[edit]" links Moodle adds for its `<h3>` sections. */
function withSections(p: FakeWikiPage, html: string): string {
  const sections = [...html.matchAll(/<h3>(.*?)<\/h3>/g)].map((m) => m[1]!);
  if (sections.length === 0) return html;
  const edit = (s: string) => `<a href="edit.php?pageid=${p.id}&amp;section=${encodeURIComponent(s)}" class="wiki_edit_section">[edit]</a>`;
  const toc = `<div class="wiki-toc"><p class="wiki-toc-title">Table of contents</p>${sections.map((s, i) => `<p class="wiki-toc-section-1 wiki-toc-section">${i + 1}. <a href="#toc-${i + 1}">${s} </a>${edit(s)}</p>`).join("")}</div>`;
  let i = 0;
  return toc + html.replace(/<h3>(.*?)<\/h3>/g, (_, s: string) => `<h3><a name="toc-${++i}"></a>${s} ${edit(s)}</h3>`);
}

function actionBar(w: FakeWiki, pageId: number): string {
  const options = ["view", ...(w.readOnly ? [] : ["edit"]), "comments", "history", "map", "files"].map((s) => `<option value="/mod/wiki/${s}.php?pageid=${pageId}">${s}</option>`).join("");
  return `<div class="container-fluid tertiary-navigation"><form method="post" action="${SITE}course/jumpto.php" id="wikiactionselect"><select name="jump" class="form-select urlselect">${options}</select></form></div>`;
}

const searchForm = (w: FakeWiki) => `<form action="${SITE}mod/wiki/search.php" class="mform simplesearchform"><input type="hidden" name="cmid" value="${w.cmid}"><input type="hidden" name="subwikiid" value="${w.subwikiId}"><input type="text" name="searchstring"></form>`;

function viewPage(w: FakeWiki, p: FakeWikiPage): string {
  const content = withSections(p, render(w, current(p)?.content ?? ""));
  return page(w, `${searchForm(w)}<div role="main">${actionBar(w, p.id)}<div class="wiki_headingtitle"><h3>${escape(p.title)}</h3></div><div class="box py-3 generalbox"><div class="no-overflow">${content}</div></div></div>`, "view");
}

function createPage(w: FakeWiki, title: string): string {
  return page(
    w,
    `${searchForm(w)}<div role="main"><form class="mform" method="post" action="${SITE}mod/wiki/create.php?action=create&amp;wid=${w.wid}&amp;group=0&amp;uid=0" id="mform1_x"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="action" value="create"><input type="text" name="pagetitle" id="id_pagetitle" value="${escape(title)}" readonly="readonly"><input type="radio" name="pageformat" value="html" checked><input type="submit" name="submitbutton" id="id_submitbutton" value="Create page"></form></div>`,
    "create",
  );
}

function editPage(w: FakeWiki, p: FakeWikiPage, section: string | null): string {
  const head = `${searchForm(w)}<div role="main">${actionBar(w, p.id)}<div class="wiki_clear wiki_headingtitle"><h3>${escape(p.title)}</h3></div>`;
  if (w.locked.includes(p.id)) return page(w, `${head}<div class="box py-3 generalbox boxwidthnormal boxaligncenter">Someone is editing this page right now. Try to edit it in a few minutes.</div></div>`, "edit");
  const text = current(p)?.content ?? "";
  return page(
    w,
    `${head}<form class="mform" method="post" action="${SITE}mod/wiki/edit.php?pageid=${p.id}${section ? `&amp;section=${encodeURIComponent(section)}` : ""}" id="mform1"><input type="hidden" name="sesskey" value="s1"><textarea name="newcontent_editor[text]" id="id_newcontent_editor">${escape(text)}</textarea><input type="hidden" name="newcontent_editor[itemid]" value="900"><input type="hidden" name="version" value="${current(p)?.version ?? 0}"><input type="hidden" name="contentformat" value="html"><input type="submit" name="editoption" id="save" value="Save"><input type="submit" name="editoption" id="preview" value="Preview"><input type="submit" name="editoption" id="cancel" value="Cancel"></form></div>
<script>var filepicker = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`,
    "edit",
  );
}

function historyPage(w: FakeWiki, p: FakeWikiPage): string {
  const saved = [...p.versions].filter((v) => v.version > 0).reverse();
  const rows = saved.map((v) => `<tr class="wiki_histnewdate"><td class="cell c0"></td><td class="cell c1"><a href="${SITE}mod/wiki/viewversion.php?pageid=${p.id}&amp;versionid=${p.id * 100 + v.version}">${v.version}</a></td><td class="cell c2"><a href="${SITE}user/view.php?id=${v.userId}&amp;course=2" class="d-inline-block aabtn"><span class="userinitials">XX</span></a><a href="${SITE}user/view.php?id=${v.userId}&amp;course=2">${escape(v.userName)}</a></td><td class="cell c3">${v.time}</td><td class="cell c4 lastcol"><div class="wiki_histdate">${v.date}</div></td></tr>`);
  const table = rows.length > 0 ? `<form action="${SITE}mod/wiki/diff.php" id="diff"><table class="table generaltable"><thead><tr><th>Diff</th><th>Version</th><th>User</th><th>Modified</th><td></td></tr></thead><tbody>${rows.join("")}</tbody></table></form>` : "No history for this page";
  return page(w, `<div role="main">${actionBar(w, p.id)}<div class="wiki_headingtitle"><h3>${escape(p.title)}</h3></div><div class="wiki_headingtime">Created: by someone</div>${table}</div>`, "history");
}

function mapPage(w: FakeWiki, p: FakeWikiPage, option: string): string {
  let body: string;
  if (option === "2") {
    const to = [...(current(p)?.content ?? "").matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `<tr><td class="cell c0">${render(w, `[[${m[1]}]]`)}</td></tr>`);
    const from = w.pages.filter((other) => (current(other)?.content ?? "").includes(`[[${p.title}]]`)).map((other) => `<tr><td><a href="${SITE}mod/wiki/view.php?pageid=${other.id}">${escape(other.title)}</a></td></tr>`);
    body = `<div class="wiki_navigation_container row"><div class="col-md-6"><table class="wiki_navigation_from table"><thead><tr><th>This page comes from:</th></tr></thead><tbody>${from.join("")}</tbody></table></div><div class="col-md-6"><table class="wiki_navigation_to table"><thead><tr><th>This page goes to:</th></tr></thead><tbody>${to.join("")}</tbody></table></div></div>`;
  } else {
    const sorted = [...w.pages].sort((a, b) => a.title.localeCompare(b.title));
    body = `<table class="generalbox table"><thead><tr><th>Page list</th></tr></thead><tbody><tr><td>D</td></tr>${sorted.map((other) => `<tr><td><a href="${SITE}mod/wiki/view.php?pageid=${other.id}">${escape(other.title)}</a></td></tr>`).join("")}</tbody></table>`;
  }
  return page(w, `<div role="main">${actionBar(w, p.id)}<div class="wiki_headingtitle"><h3>${escape(p.title)}</h3></div><div class="midpad"><form action="${SITE}mod/wiki/map.php"><select name="option"></select></form></div>${body}</div>`, "map");
}

/** Replaces the section titled `section` (its `<h3>` up to the next one) with `content`, as wiki_save_section does. */
function replaceSection(text: string, section: string, content: string): string | undefined {
  const start = text.indexOf(`<h3>${section}</h3>`);
  if (start < 0) return undefined;
  const next = text.indexOf("<h3>", start + 4);
  return text.slice(0, start) + content + (next < 0 ? "" : text.slice(next));
}

/** Serves the wiki's pages at `SITE`, as `w.user`; other course module ids are Moodle's invalidcoursemodule. */
export async function serveWiki(context: BrowserContext, w: FakeWiki): Promise<FakeMoodleState> {
  const state: FakeMoodleState = {
    user: { id: w.user.id, fullName: w.user.name },
    pagesServed: [],
    serviceCalls: [],
    services: {
      core_get_strings: () => [
        { stringid: "strftimedate", string: "%d %B %Y" },
        { stringid: "strftimetime", string: "%I:%M %p" },
        { stringid: "locale", string: "en_AU.UTF-8" },
      ],
    },
  };
  await serveFakeMoodle(context, state);
  let nextId = 100;
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  await context.route(`${SITE}mod/wiki/*.php**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const q = url.searchParams;
    const form = new URLSearchParams(request.postData() ?? "");
    const script = url.pathname.slice("/mod/wiki/".length, -".php".length);
    state.pagesServed?.push(`${url.pathname}${url.search}`);
    if (request.method() === "POST") w.posts.push({ path: url.pathname, form });
    const byId = (id: string | null) => w.pages.find((p) => p.id === Number(id));
    if (script === "view" && q.get("id")) {
      if (Number(q.get("id")) !== w.cmid) return html(route, fatal(w, "Invalid course module ID", "moodle", "invalidcoursemodule"));
      const first = w.pages.find((p) => p.title === w.firstTitle);
      return html(route, first ? viewPage(w, first) : createPage(w, w.firstTitle));
    }
    if (script === "create") {
      if (request.method() === "POST" && q.get("action") === "create") {
        const title = form.get("pagetitle") ?? "";
        let p = w.pages.find((other) => other.title === title);
        if (!p) w.pages.push((p = { id: nextId++, title, versions: [{ version: 0, userId: w.user.id, userName: w.user.name, date: "", time: "", content: "" }] }));
        return html(route, editPage(w, p, null));
      }
      if (w.readOnly) return html(route, fatal(w, "You do not have permission to create a page", "wiki", "nocreatepermission"));
      return html(route, createPage(w, q.get("title") ?? "New page"));
    }
    const p = byId(q.get("pageid"));
    if (!p) return html(route, fatal(w, "Page ID is incorrect.", "wiki", "incorrectpageid"));
    if (script === "view") return html(route, viewPage(w, p));
    if (script === "history") return html(route, historyPage(w, p));
    if (script === "map") return html(route, mapPage(w, p, q.get("option") ?? "5"));
    if (script === "edit") {
      if (w.readOnly) return html(route, fatal(w, "You can not edit this page.", "wiki", "cannoteditpage"));
      const section = q.get("section");
      const text = current(p)?.content ?? "";
      if (section && !text.includes(`<h3>${section}</h3>`)) return html(route, fatal(w, "Invalid section.", "wiki", "invalidsection"));
      if (request.method() === "POST" && form.get("editoption") === "Save" && form.get("sesskey") === "s1") {
        const sent = form.get("newcontent_editor[text]") ?? "";
        const content = section ? replaceSection(text, section, sent)! : sent;
        p.versions.push({ version: (current(p)?.version ?? 0) + 1, userId: w.user.id, userName: w.user.name, date: "18 October 2026", time: "11:41 AM", content });
        return html(route, viewPage(w, p));
      }
      return html(route, editPage(w, p, section));
    }
    return html(route, fatal(w, "Not served", "wiki", "unknown"));
  });
  // The editor's draft area: files uploaded into it.
  await context.route(`${SITE}repository/repository_ajax.php**`, (route) => {
    const body = route.request().postData() ?? "";
    const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1] ?? "";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/${field("itemid")}/${field("title")}` }) });
  });
  return state;
}

const v = (version: number, userId: number, userName: string, content: string, time = "09:05 AM"): FakeVersion => ({ version, userId, userName, date: "17 October 2026", time, content });

export const newWiki = (overrides: Partial<FakeWiki> = {}): FakeWiki => ({
  cmid: 40,
  wid: 4,
  subwikiId: 7,
  firstTitle: "Home",
  pages: [
    { id: 11, title: "Home", versions: [v(0, 3, "Teacher", ""), v(1, 3, "Teacher", "<h3>Intro</h3><p>Welcome. [[Rules]] [[Later]]</p><h3>More</h3><p>More.</p>"), v(2, 5, "Student", "<h3>Intro</h3><p>Welcome! [[Rules]] [[Later]]</p><h3>More</h3><p>More.</p>", "02:30 PM")] },
    { id: 12, title: "Rules", versions: [v(0, 5, "Student", ""), v(1, 5, "Student", "<p>Be kind. [[Home]]</p>")] },
  ],
  user: { id: 3, name: "Teacher" },
  locked: [],
  posts: [],
  ...overrides,
});
