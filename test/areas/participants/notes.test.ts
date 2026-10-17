import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { MoodleError, NoteError, NotesDisabledError, addNote, deleteNote, editNote, notes } from "../../../src/index.js";
import { findDate } from "../../../src/areas/participants/notes.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const fatal = (message: string, code: string) =>
  `<div data-rel="fatalerror"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/${code.includes("notes") ? "notes" : "moodle"}/${code}">More information about this error</a></p></div>`;

interface Note {
  id: number;
  courseId: number;
  userId: number;
  content: string;
  state: "draft" | "public" | "site";
  author: number;
  created: string;
  modified: string;
}

const PEOPLE: Record<number, string> = { 3: "Teacher Uno", 5: "Lucia Student", 6: "Marcos Student" };

/** A made-up course 9: its notes page, form and delete confirmation, as Moodle 5.2 renders them, reduced. */
interface FakeNotes {
  enabled: boolean;
  canView: boolean;
  canManage: boolean;
  notes: Note[];
  posts: Record<string, string>[];
}

function notePost(n: Note, canManage: boolean): string {
  const footer = canManage ? `<div class="footer"><p><a href="${SITE}notes/edit.php?id=${n.id}">Edit</a> | <a href="${SITE}notes/delete.php?id=${n.id}">Delete</a></p></div>` : "";
  return `<div class="notepost ${n.state}notepost${n.author === 3 ? " ownnotepost" : ""}" id="note-${n.id}"><div class="header"><div class="user"><a href="${SITE}user/view.php?id=${n.userId}&amp;course=${n.courseId}"><img src="x.png" alt="Picture of ${PEOPLE[n.userId]}"></a>${PEOPLE[n.userId]}</div><div class="info">by <a href="${SITE}user/view.php?id=${n.author}&amp;course=${n.courseId}">${PEOPLE[n.author]}</a> - ${n.modified} (Created: ${n.created})</div></div><div class="content"><div class="no-overflow">${n.content}</div></div>${footer}</div>`;
}

function notesPage(fake: FakeNotes, userId: number): string {
  const about = (n: Note) => !userId || n.userId === userId;
  const group = (title: string, list: Note[]) => `<h3 class="notestitle">${title}</h3><div class="notesgroup">${list.length ? `<div class="notelist">${list.map((n) => notePost(n, fake.canManage)).join("")}</div>` : ""}</div>`;
  const of = (state: Note["state"], course?: number, author?: number) => fake.notes.filter((n) => n.state === state && about(n) && (course === undefined || n.courseId === course) && (author === undefined || n.author === author)).sort((a, b) => b.id - a.id);
  return group("Site notes", of("site")) + group("Course notes", of("public", 9)) + group("Personal notes", of("draft", 9, 3));
}

function noteForm(note: Partial<Note> & { courseId: number; userId: number }): string {
  const option = (value: string, label: string) => `<option value="${value}"${(note.state ?? "public") === value ? " selected" : ""}>${label}</option>`;
  return `<form class="mform" action="${SITE}notes/edit.php" method="post"><input name="sesskey" type="hidden" value="s1"><input name="_qf__note_edit_form" type="hidden" value="1">
<textarea id="id_content_editor" name="content_editor[text]">${note.content ?? ""}</textarea><select name="publishstate" id="id_publishstate">${option("draft", "Personal")}${option("public", "Course")}${option("site", "Site")}</select>
<input type="submit" name="submitbutton" value="Save changes"><input type="submit" name="cancel" value="Cancel"><input name="courseid" type="hidden" value="${note.courseId}"><input name="userid" type="hidden" value="${note.userId}"><input name="id" type="hidden" value="${note.id ?? ""}"></form>`;
}

async function serve(context: BrowserContext, fake: FakeNotes): Promise<void> {
  await serveFakeMoodle(context, {
    user: { id: 3, fullName: "Teacher Uno" },
    services: {
      core_get_strings: (args) => (args.strings as { stringid: string }[]).map(({ stringid }) => ({ stringid, string: stringid === "locale" ? "en_AU.UTF-8" : "%A, %d %B %Y, %I:%M %p" })),
    },
  });
  await context.route(`${SITE}notes/**`, (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const form = Object.fromEntries(new URLSearchParams(request.postData() ?? ""));
    const html = (body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId, body: `<div role="main">${body}</div>` }) });
    if (request.method() === "POST") fake.posts.push(form);
    const page = url.pathname.slice("/notes/".length).replace(".php", "");
    if (!fake.enabled) return html(fatal("Notes are disabled on this site.", "notesdisabled"), `page-notes-${page}`);
    if (page === "index") {
      if (!fake.canView) return html(fatal("Sorry, but you do not currently have permissions to do that (View notes).", "nopermissions"), "page-notes-index");
      return html(notesPage(fake, Number(url.searchParams.get("user") ?? 0)), "page-notes-index");
    }
    if (page === "edit") {
      if (!fake.canManage) return html(fatal("Sorry, but you do not currently have permissions to do that (Manage notes).", "nopermissions"), "page-notes-edit");
      if (request.method() === "POST") {
        const now = "Saturday, 17 October 2026, 11:30 AM";
        const existing = fake.notes.find((n) => n.id === Number(form.id));
        if (existing) Object.assign(existing, { content: form["content_editor[text]"], state: form.publishstate, modified: now });
        else fake.notes.push({ id: Math.max(0, ...fake.notes.map((n) => n.id)) + 1, courseId: Number(form.courseid), userId: Number(form.userid), content: form["content_editor[text]"]!, state: form.publishstate as Note["state"], author: 3, created: now, modified: now });
        return html(notesPage(fake, Number(form.userid)), "page-notes-index");
      }
      const id = Number(url.searchParams.get("id") ?? 0);
      if (id) {
        const note = fake.notes.find((n) => n.id === id);
        if (!note) return html(fatal("Invalid note id", "invalidid"), "page-notes-edit");
        return html(noteForm(note), "page-notes-edit");
      }
      return html(noteForm({ courseId: Number(url.searchParams.get("courseid")), userId: Number(url.searchParams.get("userid")) }), "page-notes-edit");
    }
    if (page === "delete") {
      const id = Number(url.searchParams.get("id") ?? form.id);
      const note = fake.notes.find((n) => n.id === id);
      if (!note) return html(fatal("Invalid ID", "invalidid"), "page-notes-delete");
      if (!fake.canManage) return html(fatal("You can not delete this note", "nopermissiontodelete"), "page-notes-delete");
      if (request.method() === "POST" && form.sesskey === "s1") {
        fake.notes = fake.notes.filter((n) => n !== note);
        return html(notesPage(fake, note.userId), "page-notes-index");
      }
      return html(
        `<div class="modal-dialog"><form method="post" action="${SITE}notes/delete.php"><input type="hidden" name="id" value="${id}"><input type="hidden" name="sesskey" value="s1"><button type="submit">Continue</button></form><form method="get" action="${SITE}notes/index.php"><input type="hidden" name="course" value="9"><input type="hidden" name="user" value="${note.userId}"><button type="submit">Cancel</button></form></div>${notePost(note, false)}`,
        "page-notes-delete",
      );
    }
    return html(fatal("Not served by the fake", "invalidrecord"), "page-site-index");
  });
}

async function site(overrides: Partial<FakeNotes> = {}) {
  const context = await browser!.newContext();
  const fake: FakeNotes = {
    enabled: true,
    canView: true,
    canManage: true,
    notes: [
      { id: 11, courseId: 4, userId: 5, content: "<p>Site-wide</p>", state: "site", author: 3, created: "Friday, 16 October 2026, 09:00 AM", modified: "Friday, 16 October 2026, 09:00 AM" },
      { id: 12, courseId: 9, userId: 5, content: "<p>Works hard</p>", state: "public", author: 3, created: "Friday, 16 October 2026, 09:05 AM", modified: "Saturday, 17 October 2026, 10:00 AM" },
      { id: 13, courseId: 9, userId: 6, content: "<p>Late twice</p>", state: "public", author: 3, created: "Friday, 16 October 2026, 09:10 AM", modified: "Friday, 16 October 2026, 09:10 AM" },
      { id: 14, courseId: 9, userId: 5, content: "<p>Call home</p>", state: "draft", author: 3, created: "Friday, 16 October 2026, 09:15 AM", modified: "Friday, 16 October 2026, 09:15 AM" },
    ],
    posts: [],
    ...overrides,
  };
  await serve(context, fake);
  return { context, fake };
}

describe("findDate", () => {
  it("finds the date Moodle wrote in a line around it, in the person's time zone", () => {
    const format = { format: "%A, %d %B %Y, %I:%M %p", locale: "en", timeZone: "Europe/Madrid" };
    assert.equal(findDate(" - Saturday, 17 October 2026, 10:00 AM ", format)?.toISOString(), "2026-10-17T08:00:00.000Z");
    assert.equal(findDate("Created: Friday, 16 October 2026, 09:05 PM)", format)?.toISOString(), "2026-10-16T19:05:00.000Z");
    assert.equal(findDate("no date here", format), undefined);
  });
});

describe("notes", { skip: !browser && "no system browser" }, () => {
  it("reads the site, course and personal notes, in the page's order, with their participant, author and dates", async () => {
    const { context } = await site();
    const all = await notes(context, SITE, 9);
    assert.deepEqual(
      all.map((n) => [n.id, n.context, n.userId]),
      [
        [11, "site", 5],
        [13, "course", 6],
        [12, "course", 5],
        [14, "personal", 5],
      ],
    );
    assert.deepEqual(all[2], {
      id: 12,
      courseId: 9,
      userId: 5,
      userName: "Lucia Student",
      content: "<p>Works hard</p>",
      context: "course",
      authorId: 3,
      authorName: "Teacher Uno",
      created: "2026-10-16T07:05:00.000Z",
      modified: "2026-10-17T08:00:00.000Z",
      editable: true,
    });
    assert.equal(all[0]!.courseId, 4);
    await context.close();
  });

  it("reads one participant's notes, and a page of them", async () => {
    const { context } = await site();
    assert.deepEqual(
      (await notes(context, SITE, 9, { userId: 6 })).map((n) => n.id),
      [13],
    );
    assert.deepEqual(await notes(context, SITE, 9, { limit: 2, offset: 1 }), { items: (await notes(context, SITE, 9)).slice(1, 3), more: true });
    await context.close();
  });

  it("names the capability when the person can't view notes, and says when notes are off", async () => {
    const { context, fake } = await site({ canView: false });
    await assert.rejects(notes(context, SITE, 9), (e: Error) => e instanceof NoteError && e.code === "note" && /moodle\/notes:view/.test(e.message));
    fake.enabled = false;
    await assert.rejects(notes(context, SITE, 9), (e: Error) => e instanceof NotesDisabledError && e.code === "notes-disabled");
    await context.close();
  });
});

describe("addNote", { skip: !browser && "no system browser" }, () => {
  it("writes a course note through the form, and returns it", async () => {
    const { context, fake } = await site();
    const result = await addNote(context, SITE, 9, 6, { content: "<p>Good question today</p>" });
    assert.equal(result.noteId, 15);
    assert.equal(result.note?.context, "course");
    assert.equal(result.note?.content, "<p>Good question today</p>");
    assert.equal(fake.posts[0]!.publishstate, "public");
    assert.equal(fake.posts[0]!.courseid, "9");
    assert.equal(fake.posts[0]!.userid, "6");
    assert.match(result.changed, /Note 15 \(course\)/);
    await context.close();
  });

  it("writes a personal note", async () => {
    const { context, fake } = await site();
    const result = await addNote(context, SITE, 9, 6, { content: "<p>Mine</p>", context: "personal" });
    assert.equal(result.note?.context, "personal");
    assert.equal(fake.posts[0]!.publishstate, "draft");
    await context.close();
  });

  it("refuses an empty note or an unknown context, and names the capability when the person can't write notes", async () => {
    const { context } = await site({ canManage: false });
    await assert.rejects(addNote(context, SITE, 9, 6, { content: "  " }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
    await assert.rejects(addNote(context, SITE, 9, 6, { content: "<p>x</p>", context: "public" as never }), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
    await assert.rejects(addNote(context, SITE, 9, 6, { content: "<p>x</p>" }), (e: Error) => e instanceof NoteError && /moodle\/notes:manage/.test(e.message));
    await context.close();
  });
});

describe("editNote", { skip: !browser && "no system browser" }, () => {
  it("changes a note's content and context, keeping what isn't given", async () => {
    const { context, fake } = await site();
    const result = await editNote(context, SITE, 12, { content: "<p>Works very hard</p>" });
    assert.equal(result.note?.content, "<p>Works very hard</p>");
    assert.equal(result.note?.context, "course");
    assert.equal(fake.posts[0]!.publishstate, "public");
    const moved = await editNote(context, SITE, 12, { context: "personal" });
    assert.equal(moved.note?.context, "personal");
    assert.equal(moved.note?.content, "<p>Works very hard</p>");
    await context.close();
  });

  it("says when there's no such note, and refuses nothing to change", async () => {
    const { context } = await site();
    await assert.rejects(editNote(context, SITE, 99, { content: "<p>x</p>" }), NoteError);
    await assert.rejects(editNote(context, SITE, 12, {}), (e: Error) => e instanceof MoodleError && e.code === "invalid-input");
    await context.close();
  });
});

describe("deleteNote", { skip: !browser && "no system browser" }, () => {
  it("deletes a note after Moodle's confirmation", async () => {
    const { context, fake } = await site();
    const result = await deleteNote(context, SITE, 13);
    assert.deepEqual(result, { changed: "Deleted note 13.", noteId: 13 });
    assert.ok(!fake.notes.some((n) => n.id === 13));
    await assert.rejects(deleteNote(context, SITE, 13), NoteError);
    await context.close();
  });

  it("names the capability when the person can't delete it, and says when notes are off", async () => {
    const { context, fake } = await site({ canManage: false });
    await assert.rejects(deleteNote(context, SITE, 12), (e: Error) => e instanceof NoteError && /moodle\/notes:manage/.test(e.message));
    fake.enabled = false;
    await assert.rejects(deleteNote(context, SITE, 12), NotesDisabledError);
    assert.equal(fake.notes.length, 4);
    await context.close();
  });
});
