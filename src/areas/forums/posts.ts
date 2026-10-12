// A forum's discussions and posts as plain data, and posting through Moodle's own post form
// (mod/forum/post.php), which takes attachments and prefills a reply's subject (ADR-004: no AJAX
// service opens a discussion).
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { isoDate } from "../courses/list.js";
import { checkLocalFiles } from "../../core/files.js";
import { checkEmbeds, embedFiles } from "../../core/embed.js";
import { FormError, formValue, openForm, removeFromDraft, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { ForumError, NotAForumError, discussionPosts, discussionSubscription, forumInstanceId, listDiscussions, readFragments, type DiscussionRow, type MoodlePost } from "./discussions.js";
import { mapItems, pageWindow, paged, sliceWindow, toPage, type ListPage, type PageOptions, type WithLimit, type WithoutLimit } from "../../core/paging.js";
import { fetchSitePage, moodleErrorMessage, openSitePage } from "../../core/session.js";
import { decodeEntities, type ImageItem } from "../../core/text.js";
import { MoodleError } from "../../core/errors.js";

/** A discussion of a forum, as `forumDiscussions` lists it. */
export interface ForumDiscussion {
  id: number;
  subject: string;
  /** Who started it, by name. */
  author: string;
  started?: string;
  lastPost: { author: string; time?: string; postId?: number };
  replies: number;
  locked: boolean;
  pinned: boolean;
  /** Whether the person is subscribed to it: to the discussion, or to the whole forum without opting out of it. */
  subscribed: boolean;
}

/**
 * A forum's discussions, as its page lists them: who started each, replies, last post, the person's
 * subscription. With `limit`, a page of them in the forum's order (see "Long lists" in the docs'
 * concepts), read from the one page of the forum's own paging that holds it.
 */
export function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number, options: WithLimit<PageOptions>): Promise<ListPage<ForumDiscussion>>;
export function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number, options?: WithoutLimit<PageOptions>): Promise<ForumDiscussion[]>;
export function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number, options?: PageOptions): Promise<ForumDiscussion[] | ListPage<ForumDiscussion>>;
export async function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number, options: PageOptions = {}): Promise<ForumDiscussion[] | ListPage<ForumDiscussion>> {
  const page = await paged(options, (window) => listDiscussions(context, siteUrl, activityId, window));
  return mapItems(page, (rows) => rows.map(toForumDiscussion));
}

function toForumDiscussion(row: DiscussionRow): ForumDiscussion {
  return {
    id: row.id,
    subject: row.subject,
    author: row.author,
    started: isoDate(row.started),
    lastPost: { author: row.lastPost.author, time: isoDate(row.lastPost.time), postId: row.lastPost.postId },
    replies: row.replies,
    locked: row.locked,
    pinned: row.pinned,
    subscribed: row.subscribed,
  };
}

/** A post of a discussion, as `discussion` reads it. */
export interface ForumPost {
  id: number;
  /** The post it replies to; none for the discussion's first. */
  parentId?: number;
  subject: string;
  author: { id: number; fullName: string };
  created?: string;
  /** Only when edited more than a minute after posting. */
  modified?: string;
  /** The message as plain text, paragraphs and lists kept. */
  text: string;
  /** The images in the message, when it has any: their URLs download with `downloadFile`. */
  images?: ImageItem[];
  attachments: { name: string; url: string }[];
  privateReply: boolean;
  unread?: boolean;
}

/** A discussion as `discussion` reads it: where it is, the person's subscription, and its posts (a list, or a page of them). */
export interface DiscussionPosts<P = ForumPost[]> {
  discussion: { id: number; forumInstanceId: number; courseId: number; subscribed: boolean | undefined };
  posts: P;
}

/**
 * A discussion's posts, oldest first, with their messages as text, and whether the person is
 * subscribed to it (`subscribed`, undefined where they can't subscribe or it's forced). With `limit`,
 * `posts` is a page of them (see "Long lists" in the docs' concepts): Moodle's service has no paging,
 * so every post is read and cut, but only the page's messages are turned into text.
 */
export function discussion(context: BrowserContext, siteUrl: string, discussionId: number, options: WithLimit<PageOptions>): Promise<DiscussionPosts<ListPage<ForumPost>>>;
export function discussion(context: BrowserContext, siteUrl: string, discussionId: number, options?: WithoutLimit<PageOptions>): Promise<DiscussionPosts>;
export function discussion(context: BrowserContext, siteUrl: string, discussionId: number, options?: PageOptions): Promise<DiscussionPosts<ForumPost[] | ListPage<ForumPost>>>;
export async function discussion(context: BrowserContext, siteUrl: string, discussionId: number, options: PageOptions = {}): Promise<DiscussionPosts<ForumPost[] | ListPage<ForumPost>>> {
  const window = pageWindow(options);
  const { posts: all, forumid, courseid } = await discussionPosts(context, siteUrl, discussionId);
  const [posts, subscribed] = await Promise.all([mapItems(toPage(sliceWindow(all, window), options.limit), (page) => toForumPosts(context, page)), discussionSubscription(context, siteUrl, discussionId)]);
  return { discussion: { id: discussionId, forumInstanceId: forumid, courseId: courseid, subscribed }, posts };
}

async function toForumPosts(context: BrowserContext, posts: MoodlePost[]): Promise<ForumPost[]> {
  const fragments = await readFragments(
    context,
    posts.map((post) => post.message),
  );
  return posts.map(
    (post, i): ForumPost => ({
      id: post.id,
      parentId: post.parentid ?? undefined,
      subject: decodeEntities(post.subject),
      author: { id: post.author.id, fullName: post.author.fullname },
      created: isoDate(post.timecreated),
      modified: post.timemodified && post.timemodified - post.timecreated > 60 ? isoDate(post.timemodified) : undefined,
      text: fragments[i]?.text ?? "",
      ...(fragments[i]?.images.length ? { images: fragments[i]!.images } : {}),
      attachments: (post.attachments ?? []).map((file) => ({ name: file.filename, url: file.url ?? file.fileurl ?? "" })),
      privateReply: post.isprivatereply ?? false,
      unread: post.unread ?? undefined,
    }),
  );
}

/** A post to write, for `startDiscussion` and `replyToPost`. */
export interface PostInput {
  /** The message (HTML). */
  message: string;
  /** Absolute local paths to attach. */
  files?: string[];
  /** Absolute local paths to embed in the message, which names each by its file name (`<img src="shot.png">`). */
  embed?: string[];
  /** Subscribe to the discussion; Moodle's default when missing. */
  subscribe?: boolean;
  /** Other post form fields by name ({"pinned": true} for a teacher). */
  fields?: Record<string, FieldValue>;
}

/** Refuses a message with nothing in it before any form is opened. */
function checkMessage(message: string): void {
  // Moodle takes "<p></p>" as a message and posts it blank (confirmed empirically, 5.2).
  const text = message.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  if (text === "" && !/<(img|video|audio|iframe)\b/i.test(message)) throw new MoodleError("The message is empty: write something before posting.", "invalid-input");
}

/** Fills and submits the post form at `formPath`; returns the URL Moodle lands on. */
async function post(context: BrowserContext, siteUrl: string, formPath: string, input: PostInput & { subject?: string }): Promise<string> {
  checkMessage(input.message);
  if (input.files) await checkLocalFiles(input.files);
  if (input.embed) await checkEmbeds([input.message], input.embed);
  const page = await openForm(context, siteUrl, formPath);
  try {
    if (input.files && input.files.length > 0) {
      const draft = await formValue(page, "attachments");
      if (!draft) throw new MoodleError("This forum takes no attachments.", "not-available");
      await uploadToDraft(page, draft, input.files);
    }
    const values: Record<string, FieldValue> = { "message[text]": input.message, ...input.fields };
    if (input.embed) await embedFiles(page, values, input.embed);
    if (input.subject !== undefined) values.subject = input.subject;
    if (input.subscribe !== undefined) values.discussionsubscribe = input.subscribe;
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    return page.url();
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Replies to a post; returns the new post's id and its discussion's, and, when `subscribe` is given,
 * the person's subscription to the discussion afterwards, read back (`subscribed`).
 */
export async function replyToPost(context: BrowserContext, siteUrl: string, postId: number, input: PostInput & { subject?: string }) {
  const landed = new URL(await post(context, siteUrl, `mod/forum/post.php?reply=${postId}`, input));
  // Moodle lands on the discussion, at the new post: discuss.php?d=<discussion>#p<post>.
  const newPost = /^#p(\d+)$/.exec(landed.hash)?.[1];
  const discussionId = landed.searchParams.get("d");
  const subscribed = input.subscribe !== undefined && discussionId ? await discussionSubscription(context, siteUrl, Number(discussionId)) : undefined;
  return {
    changed: `Replied to post ${postId}${newPost ? ` with post ${newPost}` : ""}.`,
    postId: newPost ? Number(newPost) : undefined,
    discussionId: discussionId ? Number(discussionId) : undefined,
    ...(subscribed !== undefined && { subscribed }),
  };
}

/**
 * Starts a discussion in a forum; returns its id, and whether it's pinned and the person subscribed
 * to it, as the forum lists it afterwards, so one call confirms what `subscribe` and `fields` set.
 */
export async function startDiscussion(context: BrowserContext, siteUrl: string, activityId: number, input: PostInput & { subject: string }) {
  const instance = await forumInstanceId(context, siteUrl, activityId);
  const before = new Set((await listDiscussions(context, siteUrl, activityId)).map((d) => d.id));
  await post(context, siteUrl, `mod/forum/post.php?forum=${instance}`, input);
  const created = (await listDiscussions(context, siteUrl, activityId)).find((d) => !before.has(d.id));
  return {
    changed: `Started discussion ${created?.id ?? "?"} "${input.subject}" in forum ${activityId}.`,
    discussionId: created?.id,
    pinned: created?.pinned,
    subscribed: created?.subscribed,
  };
}

/**
 * Subscribes the person to a discussion or unsubscribes them, as the discussion list's toggle does
 * (`mod_forum_set_subscription_state`); what's already so is left alone. Returns the discussion as
 * the forum lists it afterwards.
 */
export async function setDiscussionSubscription(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  discussionId: number,
  subscribed: boolean,
): Promise<{ changed: string; discussion?: ForumDiscussion }> {
  const row = (await listDiscussions(context, siteUrl, activityId)).find((d) => d.id === discussionId);
  if (!row) throw new NotAForumError(`Forum ${activityId} has no discussion ${discussionId}. Take its id from the forum's discussions.`);
  let changed = "Nothing to change.";
  if (subscribed !== row.subscribed) {
    const instance = row.forumInstanceId ?? (await forumInstanceId(context, siteUrl, activityId));
    // Unlike the lock service, this one takes the state wanted.
    await callService(context, siteUrl, "mod_forum_set_subscription_state", { forumid: instance, discussionid: discussionId, targetstate: subscribed });
    changed = `${subscribed ? "Subscribed to" : "Unsubscribed from"} discussion ${discussionId}.`;
  }
  return { changed, discussion: (await forumDiscussions(context, siteUrl, activityId)).find((d) => d.id === discussionId) };
}

/**
 * Pins or unpins, locks or unlocks a discussion, as the discussion list's menu does; what's already
 * so is left alone. Returns the discussion as the forum lists it afterwards.
 */
export async function setDiscussionState(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  discussionId: number,
  { pinned, locked }: { pinned?: boolean; locked?: boolean },
): Promise<{ changed: string; discussion?: ForumDiscussion }> {
  const find = async () => (await forumDiscussions(context, siteUrl, activityId)).find((d) => d.id === discussionId);
  const row = (await listDiscussions(context, siteUrl, activityId)).find((d) => d.id === discussionId);
  if (!row) throw new NotAForumError(`Forum ${activityId} has no discussion ${discussionId}. Take its id from the forum's discussions.`);
  const done: string[] = [];
  if (pinned !== undefined && pinned !== row.pinned) {
    await callService(context, siteUrl, "mod_forum_set_pin_state", { discussionid: discussionId, targetstate: pinned ? 1 : 0 });
    done.push(pinned ? "pinned" : "unpinned");
  }
  if (locked !== undefined && locked !== row.locked) {
    // Rows don't always carry the forum's id (confirmed empirically, 5.2): its page does.
    const instance = row.forumInstanceId ?? (await forumInstanceId(context, siteUrl, activityId));
    // The service takes the current lock and switches it: 0 locks now, anything else unlocks.
    await callService(context, siteUrl, "mod_forum_set_lock_state", { forumid: instance, discussionid: discussionId, targetstate: locked ? 0 : 1 });
    done.push(locked ? "locked" : "unlocked");
  }
  return { changed: done.length > 0 ? `Discussion ${discussionId} ${done.join(" and ")}.` : "Nothing to change.", discussion: await find() };
}

/** What to change in a post: only what's given changes. */
export interface PostChanges {
  subject?: string;
  /** The new message (HTML), replacing the old one. */
  message?: string;
  /** Attachments to add (absolute local paths) and to remove (by name, as the post lists them). */
  files?: { add?: string[]; remove?: string[] };
  /** Absolute local paths to embed in the new message, which names each by its file name (`<img src="shot.png">`). */
  embed?: string[];
}

/** Moodle's reason on a notification it redirected with (`#user-notifications .alert-danger`), or undefined. */
function refusalNotice(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as {
      document: { querySelector(s: string): { cloneNode(deep: boolean): { querySelectorAll(s: string): ArrayLike<{ remove(): void }>; textContent: string | null } } | null };
    }).document;
    const box = doc.querySelector("#user-notifications .alert-danger");
    if (!box) return undefined;
    const copy = box.cloneNode(true);
    for (const extra of Array.from(copy.querySelectorAll("button, .visually-hidden"))) extra.remove();
    return (copy.textContent ?? "").replace(/\s+/g, " ").trim() || undefined;
  });
}

/** Moodle's message on the error page `path` answers with (its fatal error box), read over HTTP. */
async function errorPageMessage(context: BrowserContext, siteUrl: string, path: string): Promise<string | undefined> {
  const { html } = await fetchSitePage(context, siteUrl, path, { follow: false });
  const message = /data-rel="fatalerror"[^>]*>\s*<p class="errormessage">([\s\S]*?)<\/p>/.exec(html)?.[1];
  return message === undefined ? undefined : decodeEntities(message.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
}

/**
 * Changes a post through Moodle's own post form (`post.php?edit=`), as its author (within the site's
 * editing time) or a moderator: only what's given changes. Returns the post afterwards. Throws
 * `ForumError` with Moodle's reason when it refuses.
 */
export async function editPost(context: BrowserContext, siteUrl: string, postId: number, changes: PostChanges): Promise<{ changed: string; post?: ForumPost }> {
  const add = changes.files?.add ?? [];
  const remove = changes.files?.remove ?? [];
  if (changes.message !== undefined) checkMessage(changes.message);
  if (changes.subject !== undefined && changes.subject.trim() === "") throw new MoodleError("The subject is empty: a post needs one.", "invalid-input");
  if (changes.embed) await checkEmbeds([changes.message], changes.embed);
  if (changes.subject === undefined && changes.message === undefined && add.length === 0 && remove.length === 0) return { changed: "Nothing to change." };
  if (add.length > 0) await checkLocalFiles(add);
  const formPath = `mod/forum/post.php?edit=${postId}`;
  let page: Page;
  try {
    page = await openForm(context, siteUrl, formPath);
  } catch (error) {
    // Moodle refuses with an error page, not a form: edit time over, someone else's post, no such post.
    if (!(error instanceof FormError)) throw error;
    throw new ForumError(`Post ${postId} can't be edited: ${(await errorPageMessage(context, siteUrl, formPath)) ?? "Moodle didn't show its form"}`);
  }
  let discussionId: number;
  try {
    discussionId = Number(await formValue(page, "discussion"));
    if (add.length > 0 || remove.length > 0) {
      const draft = await formValue(page, "attachments");
      if (!draft) throw new MoodleError("This forum takes no attachments.", "not-available");
      if (remove.length > 0) await removeFromDraft(page, draft, remove);
      if (add.length > 0) await uploadToDraft(page, draft, add);
    }
    const values: Record<string, FieldValue> = {};
    if (changes.subject !== undefined) values.subject = changes.subject;
    if (changes.message !== undefined) values["message[text]"] = changes.message;
    if (changes.embed) await embedFiles(page, values, changes.embed);
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    // A refusal after posting comes back as a notification on the discussion.
    const refused = await refusalNotice(page);
    if (refused) throw new ForumError(`Post ${postId} wasn't changed: ${refused}`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const done = [
    changes.subject !== undefined && "subject",
    changes.message !== undefined && "message",
    add.length > 0 && `${add.length} attachment(s) added`,
    remove.length > 0 && `${remove.length} attachment(s) removed`,
  ].filter(Boolean);
  const post = discussionId ? (await discussion(context, siteUrl, discussionId)).posts.find((p) => p.id === postId) : undefined;
  return { changed: `Edited post ${postId}: ${done.join(", ")}.`, post };
}

/**
 * Deletes a post and its replies through Moodle's own confirmation (`post.php?delete=`); a
 * discussion's first post takes the whole discussion. Only a moderator deletes a post with replies,
 * or someone else's. `replies` says how many replies went with it. Throws `ForumError` with
 * Moodle's reason when it refuses.
 */
export async function deletePost(
  context: BrowserContext,
  siteUrl: string,
  postId: number,
): Promise<{ changed: string; discussionId?: number; replies: number; discussionDeleted: boolean }> {
  const page = await openSitePage(context, siteUrl, `mod/forum/post.php?delete=${postId}`);
  try {
    const fatal = await moodleErrorMessage(page);
    if (fatal) throw new ForumError(`Post ${postId} can't be deleted: ${fatal}`);
    // Moodle asks to confirm with a form posting `confirm`; a refusal redirects to the discussion with a notification.
    const confirm = page.locator('form[action$="post.php"]:has(input[name="confirm"]) [type="submit"]');
    if ((await confirm.count()) === 0) throw new ForumError(`Post ${postId} can't be deleted: ${(await refusalNotice(page)) ?? "Moodle didn't ask to confirm it"}`);
    // The cancel button goes back to the discussion.
    const discussionId = Number(await page.locator('form[action*="discuss.php"] input[name="d"]').first().getAttribute("value").catch(() => null)) || undefined;
    let replies = 0;
    let first = false;
    if (discussionId) {
      const { posts } = await discussionPosts(context, siteUrl, discussionId);
      first = posts.find((p) => p.id === postId)?.parentid === null;
      // Every post under it, at any depth.
      const under = new Set([postId]);
      for (let grew = true; grew; ) {
        grew = false;
        for (const p of posts) {
          if (p.parentid !== null && under.has(p.parentid) && !under.has(p.id)) {
            under.add(p.id);
            grew = true;
          }
        }
      }
      replies = under.size - 1;
    }
    await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), confirm.first().click({ noWaitAfter: true })]);
    const refused = await refusalNotice(page);
    if (refused) throw new ForumError(`Post ${postId} wasn't deleted: ${refused}`);
    const what = first ? `discussion ${discussionId} (its first post ${postId})` : `post ${postId}`;
    const withReplies = replies === 0 ? "" : ` and ${replies} ${replies === 1 ? "reply" : "replies"} under it`;
    return { changed: `Deleted ${what}${withReplies}.`, discussionId, replies, discussionDeleted: first };
  } finally {
    await page.close().catch(() => undefined);
  }
}
