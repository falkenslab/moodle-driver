import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { NotAForumError, discussion, forumDiscussions, replyToPost, setDiscussionState, startDiscussion } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-posts-"));
  await writeFile(path.join(dir, "shot.txt"), "a screenshot\n");
});
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

/** A discussion row as Moodle 5.2's forum page renders it, reduced; the data is made up. */
function row(id: number, subject: string, author: string, started: number, last: { author: string; time: number; post: number }, replies: number, locked = false): string {
  return `<tr data-region="discussion-list-item" data-discussionid="${id}" data-forumid="1">
<th scope="row"><a href="${SITE}mod/forum/discuss.php?d=${id}"> ${subject} </a><span data-region="locked-label"${locked ? "" : " hidden"}>Locked</span></th>
<td><div><div>${author}</div><div><time data-timestamp="${started}">2 Oct</time></div></div></td>
<td><div><div>${last.author}</div><div><a href="${SITE}mod/forum/discuss.php?d=${id}&amp;parent=${last.post}"><time data-timestamp="${last.time}">3 Oct</time></a></div></div></td>
<td><span>${replies}</span></td>
</tr>`;
}

const FORUM_PAGE = `<table>${row(2, "Can a variable change?", "Ada Lovelace", 1_790_000_000, { author: "Alan Turing", time: 1_790_000_600, post: 3 }, 1)}${row(1, "Bool question", "Grace Hopper", 1_789_000_000, { author: "Grace Hopper", time: 1_789_000_000, post: 1 }, 0, true)}</table>`;

describe("forumDiscussions", { skip: !browser && "no system browser" }, () => {
  it("lists a forum's discussions with ISO dates", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, bodies: { "/mod/forum/view.php": FORUM_PAGE } });
    assert.deepEqual(await forumDiscussions(context, SITE, 4), [
      {
        id: 2,
        subject: "Can a variable change?",
        author: "Ada Lovelace",
        started: new Date(1_790_000_000_000).toISOString(),
        lastPost: { author: "Alan Turing", time: new Date(1_790_000_600_000).toISOString(), postId: 3 },
        replies: 1,
        locked: false,
        pinned: false,
      },
      {
        id: 1,
        subject: "Bool question",
        author: "Grace Hopper",
        started: new Date(1_789_000_000_000).toISOString(),
        lastPost: { author: "Grace Hopper", time: new Date(1_789_000_000_000).toISOString(), postId: 1 },
        replies: 0,
        locked: true,
        pinned: false,
      },
    ]);
    await context.close();
  });

  it("refuses a page that isn't a forum", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" } });
    // Another activity's page has another body id.
    await context.route(`${SITE}mod/forum/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-page-view", body: FORUM_PAGE }) }));
    await assert.rejects(forumDiscussions(context, SITE, 5), (error: unknown) => error instanceof NotAForumError && /isn't a forum/.test(error.message));
    await context.close();
  });
});

describe("discussion", { skip: !browser && "no system browser" }, () => {
  const services = {
    mod_forum_get_discussion_posts: ({ discussionid }: Record<string, unknown>) => {
      // A missing discussion fails inside Moodle with a PHP error.
      if (discussionid !== 2) throw new ServiceFailure("generalexceptionmessage");
      return {
        forumid: 1,
        courseid: 5,
        posts: [
          { id: 2, subject: "Can a variable change?", message: "<p>If I set <code>x = 1</code>…</p><p>can I change it?</p>", author: { id: 6, fullname: "Ada Lovelace" }, parentid: null, timecreated: 1_790_000_000, timemodified: 1_790_000_000, isprivatereply: false, unread: null, attachments: [] },
          { id: 3, subject: "Re: Can a variable change? &amp; more", message: "<p>Yes &amp; no.</p>", author: { id: 7, fullname: "Alan Turing" }, parentid: 2, timecreated: 1_790_000_600, timemodified: 1_790_000_900, isprivatereply: false, unread: true, attachments: [{ filename: "proof.pdf", url: `${SITE}pluginfile.php/1/mod_forum/attachment/3/proof.pdf` }] },
        ],
      };
    },
  };

  it("reads a discussion's posts as text", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, services });
    const result = await discussion(context, SITE, 2);
    assert.deepEqual(result.discussion, { id: 2, forumId: 1, courseId: 5 });
    const [first, reply] = result.posts;
    assert.deepEqual([first?.text, first?.parentId, first?.modified, first?.unread], ["If I set x = 1…\n\ncan I change it?", undefined, undefined, undefined]);
    assert.deepEqual(reply, {
      id: 3,
      parentId: 2,
      subject: "Re: Can a variable change? & more",
      author: { id: 7, fullName: "Alan Turing" },
      created: new Date(1_790_000_600_000).toISOString(),
      modified: new Date(1_790_000_900_000).toISOString(),
      text: "Yes & no.",
      attachments: [{ name: "proof.pdf", url: `${SITE}pluginfile.php/1/mod_forum/attachment/3/proof.pdf` }],
      privateReply: false,
      unread: true,
    });
    await context.close();
  });

  it("explains a missing discussion", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, services });
    await assert.rejects(discussion(context, SITE, 9), (error: unknown) => error instanceof NotAForumError && /doesn't exist or you can't see it/.test(error.message));
    await context.close();
  });
});

/** Moodle's post form, reduced; made up. */
function postForm(subject: string): string {
  return `<form class="mform" action="${SITE}mod/forum/post.php" method="post">
<input type="hidden" name="forum" value="2"><input type="hidden" name="reply" value="0"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="subject" value="${subject}"><textarea name="message[text]" id="id_message"></textarea>
<input type="hidden" name="discussionsubscribe" value="0"><input type="checkbox" name="discussionsubscribe" value="1" checked>
<input type="hidden" name="attachments" value="555"><input type="submit" name="submitbutton" value="Post to forum"></form>
<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`;
}

/** A row of the forum page's discussion list, reduced. */
const shortRow = (id: number) => `<tr data-region="discussion-list-item" data-discussionid="${id}" data-forumid="2"><th><a href="${SITE}mod/forum/discuss.php?d=${id}">D${id}</a></th><td><span>0</span></td></tr>`;

describe("replyToPost and startDiscussion", { skip: !browser && "no system browser" }, () => {
  async function site() {
    const posts: URLSearchParams[] = [];
    const uploads: string[] = [];
    const discussions = [1];
    const context: BrowserContext = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const page = (body: string, bodyId = "") => moodlePage({ userId: 4, body, bodyId });
    await context.route(`${SITE}mod/forum/view.php**`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: page(`<form action="${SITE}mod/forum/post.php"><input type="hidden" name="forum" value="2"></form><table>${discussions.map(shortRow).join("")}</table>`, "page-mod-forum-view") }),
    );
    await context.route(`${SITE}mod/forum/post.php**`, (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "text/html", body: page(postForm(url.searchParams.get("reply") ? "Re: Welcome" : "")) });
      const form = new URLSearchParams(request.postData() ?? "");
      posts.push(form);
      if (form.get("reply") === "0") discussions.push(7);
      // Moodle lands on the discussion at the new post; Playwright can't follow a fulfilled redirect, so the page moves there itself.
      return route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace("${SITE}mod/forum/discuss.php?d=1#p42")</script>` });
    });
    await context.route(`${SITE}mod/forum/discuss.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: page("<p>Discussion</p>") }));
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      uploads.push(/filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return { context, posts, uploads };
  }

  it("replies through the post form, keeping Moodle's subject, with attachments", async () => {
    const { context, posts, uploads } = await site();
    const result = await replyToPost(context, SITE, 4, { message: "<p>Hello</p>", files: [path.join(dir, "shot.txt")], subscribe: false });
    assert.deepEqual(result, { changed: "Replied to post 4 with post 42.", postId: 42, discussionId: 1 });
    assert.equal(posts[0]?.get("subject"), "Re: Welcome");
    assert.equal(posts[0]?.get("message[text]"), "<p>Hello</p>");
    assert.deepEqual(posts[0]?.getAll("discussionsubscribe"), ["0"]);
    assert.deepEqual(uploads, ["shot.txt"]);
    await context.close();
  });

  it("starts a discussion in the forum's instance and returns its id", async () => {
    const { context, posts } = await site();
    const result = await startDiscussion(context, SITE, 9, { subject: "Help", message: "<p>It fails</p>" });
    assert.deepEqual(result, { changed: 'Started discussion 7 "Help" in forum 9.', discussionId: 7 });
    assert.equal(posts[0]?.get("forum"), "2");
    assert.equal(posts[0]?.get("subject"), "Help");
    await context.close();
  });

  it("refuses an empty message before posting anything", async () => {
    const { context, posts } = await site();
    await assert.rejects(replyToPost(context, SITE, 4, { message: "<p> &nbsp; </p>" }), /message is empty/);
    await assert.rejects(startDiscussion(context, SITE, 9, { subject: "Empty", message: "<p></p>" }), /message is empty/);
    assert.equal(posts.length, 0);
    await context.close();
  });

  it("refuses to start a discussion where the page isn't a forum", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    await context.route(`${SITE}mod/forum/view.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-page-view" }) }));
    await assert.rejects(startDiscussion(context, SITE, 9, { subject: "Help", message: "<p>x</p>" }), NotAForumError);
    await context.close();
  });
});

describe("setDiscussionState", { skip: !browser && "no system browser" }, () => {
  /** A forum page with one discussion whose pin and lock follow the services, as Moodle 5.2's do; made up. */
  function fakeModeration() {
    const state = { pinned: false, locked: 0 };
    const calls: { methodname: string; args: Record<string, unknown> }[] = [];
    const page = () =>
      `<form action="${SITE}mod/forum/post.php"><input type="hidden" name="forum" value="7"></form><table><tr class="discussion${state.pinned ? " pinned" : ""}" data-region="discussion-list-item" data-discussionid="4">
<th><a href="${SITE}mod/forum/discuss.php?d=4">Loops</a><span data-region="locked-label"${state.locked ? "" : " hidden"}>Locked</span></th><td><span>0</span></td></tr></table>`;
    return {
      state,
      calls,
      moodle: {
        user: { id: 3, fullName: "Teacher" },
        serviceCalls: calls,
        bodies: new Proxy({} as Record<string, string>, { get: (_, path) => (path === "/mod/forum/view.php" ? page() : undefined) }),
        services: {
          mod_forum_set_pin_state: ({ targetstate }: Record<string, unknown>) => {
            state.pinned = targetstate === 1;
            return {};
          },
          // Moodle's lock service switches the current state it's given.
          mod_forum_set_lock_state: ({ targetstate }: Record<string, unknown>) => {
            state.locked = targetstate ? 0 : 1_790_000_000;
            return { locked: state.locked };
          },
        },
      },
    };
  }

  it("pins and locks a discussion, leaves alone what's already so, and unlocks it", async () => {
    const fake = fakeModeration();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, fake.moodle);
    const done = await setDiscussionState(context, SITE, 37, 4, { pinned: true, locked: true });
    assert.equal(done.changed, "Discussion 4 pinned and locked.");
    assert.deepEqual([done.discussion?.pinned, done.discussion?.locked], [true, true]);
    assert.deepEqual(fake.calls.find((c) => c.methodname === "mod_forum_set_lock_state")?.args, { forumid: 7, discussionid: 4, targetstate: 0 });
    const calls = fake.calls.length;
    assert.equal((await setDiscussionState(context, SITE, 37, 4, { pinned: true, locked: true })).changed, "Nothing to change.");
    assert.equal(fake.calls.length, calls);
    assert.equal((await setDiscussionState(context, SITE, 37, 4, { locked: false })).discussion?.locked, false);
    await assert.rejects(setDiscussionState(context, SITE, 37, 99, { pinned: true }), NotAForumError);
    await context.close();
  });
});
