import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { ForumError, NotAForumError, deletePost, discussion, editPost, forumDiscussions, replyToPost, setDiscussionState, setDiscussionSubscription, startDiscussion } from "../../../src/index.js";
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
        subscribed: false,
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
        subscribed: false,
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

/** A discussion page's subscription item (its settings menu), as Moodle 5.2 renders it, reduced. */
const subscriptionToggle = (id: number, subscribed: boolean) =>
  `<a href="${SITE}mod/forum/subscribe.php?id=1&amp;d=${id}" class="dropdown-item" data-type="subscription-toggle" data-action="toggle" data-discussionid="${id}" data-forumid="1" data-targetstate="${subscribed ? 0 : 1}">Subscribe</a>`;

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
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" }, services, bodies: { "/mod/forum/discuss.php": subscriptionToggle(2, true) } });
    const result = await discussion(context, SITE, 2);
    assert.deepEqual(result.discussion, { id: 2, forumInstanceId: 1, courseId: 5, subscribed: true });
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
<input type="hidden" name="pinned" value="0"><input type="checkbox" name="pinned" value="1">
<input type="hidden" name="attachments" value="555"><input type="submit" name="submitbutton" value="Post to forum"></form>
<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`;
}

/** A row of the forum page's discussion list, reduced. */
const shortRow = (id: number, pinnedAndSubscribed = false) => `<tr class="discussion${pinnedAndSubscribed ? " pinned subscribed" : ""}" data-region="discussion-list-item" data-discussionid="${id}" data-forumid="2"><th><a href="${SITE}mod/forum/discuss.php?d=${id}">D${id}</a></th><td><span>0</span></td></tr>`;

describe("replyToPost and startDiscussion", { skip: !browser && "no system browser" }, () => {
  async function site() {
    const posts: URLSearchParams[] = [];
    const uploads: string[] = [];
    const discussions = [1];
    // Discussions listed pinned and subscribed, as Moodle marks their rows.
    const pinnedAndSubscribed = new Set<number>();
    const context: BrowserContext = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" } });
    const page = (body: string, bodyId = "") => moodlePage({ userId: 4, body, bodyId });
    await context.route(`${SITE}mod/forum/view.php**`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: page(`<form action="${SITE}mod/forum/post.php"><input type="hidden" name="forum" value="2"></form><table>${discussions.map((id) => shortRow(id, pinnedAndSubscribed.has(id))).join("")}</table>`, "page-mod-forum-view") }),
    );
    await context.route(`${SITE}mod/forum/post.php**`, (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "text/html", body: page(postForm(url.searchParams.get("reply") ? "Re: Welcome" : "")) });
      const form = new URLSearchParams(request.postData() ?? "");
      posts.push(form);
      if (form.get("reply") === "0") discussions.push(7);
      if (form.get("reply") === "0" && form.getAll("pinned").includes("1") && form.getAll("discussionsubscribe").includes("1")) pinnedAndSubscribed.add(7);
      // Moodle lands on the discussion at the new post; Playwright can't follow a fulfilled redirect, so the page moves there itself.
      return route.fulfill({ status: 200, contentType: "text/html", body: `<script>location.replace("${SITE}mod/forum/discuss.php?d=1#p42")</script>` });
    });
    await context.route(`${SITE}mod/forum/discuss.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: page(subscriptionToggle(1, posts.at(-1)?.get("discussionsubscribe") === "1")) }));
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      uploads.push(/filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return { context, posts, uploads };
  }

  it("replies through the post form, keeping Moodle's subject, with attachments", async () => {
    const { context, posts, uploads } = await site();
    const result = await replyToPost(context, SITE, 4, { message: "<p>Hello</p>", files: [path.join(dir, "shot.txt")], subscribe: false });
    // The subscription asked for, read back from the discussion's page.
    assert.deepEqual(result, { changed: "Replied to post 4 with post 42.", postId: 42, discussionId: 1, subscribed: false });
    assert.equal(posts[0]?.get("subject"), "Re: Welcome");
    assert.equal(posts[0]?.get("message[text]"), "<p>Hello</p>");
    assert.deepEqual(posts[0]?.getAll("discussionsubscribe"), ["0"]);
    assert.deepEqual(uploads, ["shot.txt"]);
    await context.close();
  });

  it("starts a discussion in the forum's instance and returns its id", async () => {
    const { context, posts } = await site();
    const result = await startDiscussion(context, SITE, 9, { subject: "Help", message: "<p>It fails</p>", subscribe: true, fields: { pinned: true } });
    assert.deepEqual(result, { changed: 'Started discussion 7 "Help" in forum 9.', discussionId: 7, pinned: true, subscribed: true });
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

describe("setDiscussionState and setDiscussionSubscription", { skip: !browser && "no system browser" }, () => {
  /** A forum page with one discussion whose pin and lock follow the services, as Moodle 5.2's do; made up. */
  function fakeModeration() {
    const state = { pinned: false, locked: 0, subscribed: false };
    const calls: { methodname: string; args: Record<string, unknown> }[] = [];
    const page = () =>
      `<form action="${SITE}mod/forum/post.php"><input type="hidden" name="forum" value="7"></form><table><tr class="discussion${state.pinned ? " pinned" : ""}${state.subscribed ? " subscribed" : ""}" data-region="discussion-list-item" data-discussionid="4">
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
          // The subscription service takes the state wanted.
          mod_forum_set_subscription_state: ({ targetstate }: Record<string, unknown>) => {
            state.subscribed = targetstate === true;
            return { id: 4, userstate: { subscribed: state.subscribed } };
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

  it("setDiscussionSubscription subscribes and unsubscribes in the forum's instance, leaving alone what's already so", async () => {
    const fake = fakeModeration();
    const context = await browser!.newContext();
    await serveFakeMoodle(context, fake.moodle);
    const on = await setDiscussionSubscription(context, SITE, 37, 4, true);
    assert.equal(on.changed, "Subscribed to discussion 4.");
    assert.equal(on.discussion?.subscribed, true);
    assert.deepEqual(fake.calls.find((c) => c.methodname === "mod_forum_set_subscription_state")?.args, { forumid: 7, discussionid: 4, targetstate: true });
    const calls = fake.calls.length;
    assert.equal((await setDiscussionSubscription(context, SITE, 37, 4, true)).changed, "Nothing to change.");
    assert.equal(fake.calls.length, calls);
    const off = await setDiscussionSubscription(context, SITE, 37, 4, false);
    assert.deepEqual([off.changed, off.discussion?.subscribed], ["Unsubscribed from discussion 4.", false]);
    await assert.rejects(setDiscussionSubscription(context, SITE, 37, 99, true), NotAForumError);
    await context.close();
  });
});

describe("editPost and deletePost", { skip: !browser && "no system browser" }, () => {
  /** Moodle 5.2's error page box, as post.php shows a refusal; reduced. */
  const fatal = (message: string) => `<div role="main"><div data-rel="fatalerror" class="box py-3 errorbox alert alert-danger"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/">More information about this error</a></p></div></div>`;
  /** The notification Moodle redirects with, as on the discussion page; reduced. */
  const notice = (kind: string, message: string) => `<span class="notifications" id="user-notifications"><div class="alert alert-${kind} alert-block fade in alert-dismissible" role="alert">${message}<button type="button" class="btn-close"><span class="visually-hidden">Dismiss this notification</span></button></div></span>`;
  /** The edit form of post 13 (a reply in discussion 7), reduced; made up. */
  const editForm = `<form class="mform" action="${SITE}mod/forum/post.php" method="post">
<input type="hidden" name="discussion" value="7"><input type="hidden" name="parent" value="12"><input type="hidden" name="edit" value="13"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="subject" value="Re: Loops"><textarea name="message[text]" id="id_message">&lt;p&gt;Old&lt;/p&gt;</textarea>
<input type="hidden" name="attachments" value="555"><input type="submit" name="submitbutton" value="Save changes"></form>
<script>var fp = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`;
  /** Post.php's confirmation for deleting post 13, reduced: the cancel and confirm buttons, the posts to go. */
  const confirmPage = `<div role="main"><div class="modal-content"><form method="get" action="${SITE}mod/forum/discuss.php#p13"><input type="hidden" name="d" value="7"><button type="submit">Cancel</button></form>
<form method="post" action="post.php"><input type="hidden" name="delete" value="13"><input type="hidden" name="confirm" value="13"><input type="hidden" name="sesskey" value="s1"><button type="submit">Continue</button></form></div>
<article data-post-id="13" data-content="forum-post"></article><article data-post-id="14" data-content="forum-post"></article></div>`;

  async function site({ refuseSave = false } = {}) {
    const posted: URLSearchParams[] = [];
    const drafts: { action: string; filename?: string }[] = [];
    const uploads: string[] = [];
    const posts = [
      { id: 12, subject: "Loops", message: "<p>Why?</p>", author: { id: 3, fullname: "Teacher" }, parentid: null, timecreated: 1_790_000_000, timemodified: 1_790_000_000, attachments: [] },
      { id: 13, subject: "Re: Loops", message: "<p>Old</p>", author: { id: 5, fullname: "Lucía" }, parentid: 12, timecreated: 1_790_000_600, timemodified: 1_790_000_600, attachments: [{ filename: "old.txt", url: `${SITE}pluginfile.php/old.txt` }] },
      { id: 14, subject: "Re: Loops", message: "<p>Me too</p>", author: { id: 6, fullname: "Ana" }, parentid: 13, timecreated: 1_790_000_900, timemodified: 1_790_000_900, attachments: [] },
    ];
    const context: BrowserContext = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 3, fullName: "Teacher" },
      services: { mod_forum_get_discussion_posts: () => ({ forumid: 1, courseid: 3, posts }) },
    });
    const page = (body: string, bodyId = "page-mod-forum-post") => moodlePage({ userId: 3, body, bodyId });
    const land = (url: string) => `<script>location.replace("${url}")</script>`;
    await context.route(`${SITE}mod/forum/post.php**`, (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());
      const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
      if (request.method() === "GET") {
        if (url.searchParams.get("edit") === "13") return html(page(editForm));
        if (url.searchParams.get("edit")) return html(page(fatal("You can&#039;t edit other people&#039;s posts!")));
        if (url.searchParams.get("delete") === "13") return html(page(confirmPage));
        if (url.searchParams.get("delete") === "12") return html(page(notice("danger", "You can't delete this post!"), "page-mod-forum-discuss"));
        return html(page(fatal("Invalid post ID - {$a}")));
      }
      const form = new URLSearchParams(request.postData() ?? "");
      posted.push(form);
      if (form.get("edit")) {
        if (refuseSave) return html(land(`${SITE}mod/forum/discuss.php?d=7&refused=1`));
        posts[1]!.subject = form.get("subject") ?? "";
        posts[1]!.message = form.get("message[text]") ?? "";
        posts[1]!.timemodified = 1_790_009_000;
      }
      return html(land(`${SITE}mod/forum/discuss.php?d=7`));
    });
    await context.route(`${SITE}mod/forum/discuss.php**`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: page(new URL(route.request().url()).searchParams.get("refused") ? notice("danger", "Sorry, you are not allowed to update this post") : notice("success", "Your post was updated"), "page-mod-forum-discuss") }),
    );
    await context.route(`${SITE}repository/draftfiles_ajax.php**`, (route: Route) => {
      const action = new URL(route.request().url()).searchParams.get("action") ?? "";
      const form = new URLSearchParams(route.request().postData() ?? "");
      drafts.push({ action, filename: form.get("filename") ?? undefined });
      const body = action === "list" ? { list: [{ filename: "old.txt", filepath: "/", type: "file" }] } : { filepath: "/" };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      uploads.push(/filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "");
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    return { context, posted, drafts, uploads };
  }

  it("changes only what's given, attachments by name, and returns the post afterwards", async () => {
    const { context, posted, drafts, uploads } = await site();
    const result = await editPost(context, SITE, 13, { message: "<p>New</p>", files: { add: [path.join(dir, "shot.txt")], remove: ["old.txt"] } });
    assert.equal(result.changed, "Edited post 13: message, 1 attachment(s) added, 1 attachment(s) removed.");
    assert.deepEqual([result.post?.id, result.post?.text, result.post?.subject], [13, "New", "Re: Loops"]);
    assert.equal(posted[0]?.get("subject"), "Re: Loops");
    assert.equal(posted[0]?.get("message[text]"), "<p>New</p>");
    assert.deepEqual(drafts, [{ action: "list", filename: undefined }, { action: "delete", filename: "old.txt" }]);
    assert.deepEqual(uploads, ["shot.txt"]);
    await context.close();
  });

  it("refuses an attachment the post doesn't have, before saving", async () => {
    const { context, posted } = await site();
    await assert.rejects(editPost(context, SITE, 13, { files: { remove: ["nope.txt"] } }), /nope\.txt: not among the files \(old\.txt\)/);
    assert.equal(posted.length, 0);
    assert.equal((await editPost(context, SITE, 13, {})).changed, "Nothing to change.");
    await context.close();
  });

  it("gives Moodle's refusals as ForumError", async () => {
    const { context } = await site();
    await assert.rejects(editPost(context, SITE, 12, { subject: "Mine" }), (error: unknown) => error instanceof ForumError && error.code === "forum" && /can't be edited: You can't edit other people's posts!/.test(error.message));
    await assert.rejects(deletePost(context, SITE, 12), (error: unknown) => error instanceof ForumError && /can't be deleted: You can't delete this post!$/.test(error.message));
    await assert.rejects(deletePost(context, SITE, 99), (error: unknown) => error instanceof ForumError && /Invalid post ID/.test(error.message));
    await context.close();
    const refusing = await site({ refuseSave: true });
    await assert.rejects(editPost(refusing.context, SITE, 13, { subject: "x" }), (error: unknown) => error instanceof ForumError && /wasn't changed: Sorry, you are not allowed to update this post$/.test(error.message));
    await refusing.context.close();
  });

  it("deletes a post after confirming, counting the replies under it", async () => {
    const { context, posted } = await site();
    const result = await deletePost(context, SITE, 13);
    assert.deepEqual(result, { changed: "Deleted post 13 and 1 reply under it.", discussionId: 7, replies: 1, discussionDeleted: false });
    assert.deepEqual([posted[0]?.get("delete"), posted[0]?.get("confirm"), posted[0]?.get("sesskey")], ["13", "13", "s1"]);
    await context.close();
  });
});
