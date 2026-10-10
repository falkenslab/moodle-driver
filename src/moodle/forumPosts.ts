// A forum's discussions and posts as plain data, and posting through Moodle's own post form
// (mod/forum/post.php), which takes attachments and prefills a reply's subject (ADR-004: no AJAX
// service opens a discussion).
import type { BrowserContext } from "playwright-core";
import { callService } from "./ajax.js";
import { isoDate } from "./courses.js";
import { checkLocalFiles } from "./files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "./forms.js";
import { NotAForumError, discussionPosts, forumInstanceId, htmlToTexts, listDiscussions } from "./forum.js";
import { decodeEntities } from "./text.js";

export interface ForumDiscussion {
  id: number;
  subject: string;
  author: string;
  started?: string;
  lastPost: { author: string; time?: string; postId?: number };
  replies: number;
  locked: boolean;
  pinned: boolean;
}

/** A forum's discussions, as its page lists them: who started each, replies, last post. */
export async function forumDiscussions(context: BrowserContext, siteUrl: string, forumCmid: number): Promise<ForumDiscussion[]> {
  const rows = await listDiscussions(context, siteUrl, forumCmid);
  return rows.map((row) => ({
    id: row.id,
    subject: row.subject,
    author: row.author,
    started: isoDate(row.started),
    lastPost: { author: row.lastPost.author, time: isoDate(row.lastPost.time), postId: row.lastPost.postId },
    replies: row.replies,
    locked: row.locked,
    pinned: row.pinned,
  }));
}

export interface ForumPost {
  id: number;
  parentId?: number;
  subject: string;
  author: { id: number; fullName: string };
  created?: string;
  /** Only when edited more than a minute after posting. */
  modified?: string;
  /** The message as plain text, paragraphs and lists kept. */
  text: string;
  attachments: { name: string; url: string }[];
  privateReply: boolean;
  unread?: boolean;
}

/** A discussion's posts, oldest first, with their messages as text. */
export async function discussion(context: BrowserContext, siteUrl: string, discussionId: number) {
  const { posts, forumid, courseid } = await discussionPosts(context, siteUrl, discussionId);
  const texts = await htmlToTexts(
    context,
    posts.map((post) => post.message),
  );
  return {
    discussion: { id: discussionId, forumId: forumid, courseId: courseid },
    posts: posts.map(
      (post, i): ForumPost => ({
        id: post.id,
        parentId: post.parentid ?? undefined,
        subject: decodeEntities(post.subject),
        author: { id: post.author.id, fullName: post.author.fullname },
        created: isoDate(post.timecreated),
        modified: post.timemodified && post.timemodified - post.timecreated > 60 ? isoDate(post.timemodified) : undefined,
        text: texts[i] ?? "",
        attachments: (post.attachments ?? []).map((file) => ({ name: file.filename, url: file.url ?? file.fileurl ?? "" })),
        privateReply: post.isprivatereply ?? false,
        unread: post.unread ?? undefined,
      }),
    ),
  };
}

export interface PostInput {
  /** The message (HTML). */
  message: string;
  /** Absolute local paths to attach. */
  files?: string[];
  /** Subscribe to the discussion; Moodle's default when missing. */
  subscribe?: boolean;
  /** Other post form fields by name ({"pinned": true} for a teacher). */
  fields?: Record<string, FieldValue>;
}

/** Fills and submits the post form at `formPath`; returns the URL Moodle lands on. */
async function post(context: BrowserContext, siteUrl: string, formPath: string, input: PostInput & { subject?: string }): Promise<string> {
  // Moodle takes "<p></p>" as a message and posts it blank (confirmed empirically, 5.2).
  const text = input.message.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  if (text === "" && !/<(img|video|audio|iframe)\b/i.test(input.message)) throw new Error("The message is empty: write something before posting.");
  if (input.files) await checkLocalFiles(input.files);
  const page = await openForm(context, siteUrl, formPath);
  try {
    if (input.files && input.files.length > 0) {
      const draft = await formValue(page, "attachments");
      if (!draft) throw new Error("This forum takes no attachments.");
      await uploadToDraft(page, draft, input.files);
    }
    const values: Record<string, FieldValue> = { "message[text]": input.message, ...input.fields };
    if (input.subject !== undefined) values.subject = input.subject;
    if (input.subscribe !== undefined) values.discussionsubscribe = input.subscribe;
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    return page.url();
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Replies to a post; returns the new post's id and its discussion's. */
export async function replyToPost(context: BrowserContext, siteUrl: string, postId: number, input: PostInput & { subject?: string }) {
  const landed = new URL(await post(context, siteUrl, `mod/forum/post.php?reply=${postId}`, input));
  // Moodle lands on the discussion, at the new post: discuss.php?d=<discussion>#p<post>.
  const newPost = /^#p(\d+)$/.exec(landed.hash)?.[1];
  const discussionId = landed.searchParams.get("d");
  return {
    changed: `Replied to post ${postId}${newPost ? ` with post ${newPost}` : ""}.`,
    postId: newPost ? Number(newPost) : undefined,
    discussionId: discussionId ? Number(discussionId) : undefined,
  };
}

/** Starts a discussion in a forum; returns its id. */
export async function startDiscussion(context: BrowserContext, siteUrl: string, forumCmid: number, input: PostInput & { subject: string }) {
  const instance = await forumInstanceId(context, siteUrl, forumCmid);
  const before = new Set((await listDiscussions(context, siteUrl, forumCmid)).map((d) => d.id));
  await post(context, siteUrl, `mod/forum/post.php?forum=${instance}`, input);
  const created = (await listDiscussions(context, siteUrl, forumCmid)).find((d) => !before.has(d.id));
  return { changed: `Started discussion ${created?.id ?? "?"} "${input.subject}" in forum ${forumCmid}.`, discussionId: created?.id };
}

/**
 * Pins or unpins, locks or unlocks a discussion, as the discussion list's menu does; what's already
 * so is left alone. Returns the discussion as the forum lists it afterwards.
 */
export async function setDiscussionState(
  context: BrowserContext,
  siteUrl: string,
  forumCmid: number,
  discussionId: number,
  { pinned, locked }: { pinned?: boolean; locked?: boolean },
): Promise<{ changed: string; discussion?: ForumDiscussion }> {
  const find = async () => (await forumDiscussions(context, siteUrl, forumCmid)).find((d) => d.id === discussionId);
  const row = (await listDiscussions(context, siteUrl, forumCmid)).find((d) => d.id === discussionId);
  if (!row) throw new NotAForumError(`Forum ${forumCmid} has no discussion ${discussionId}. Take its id from the forum's discussions.`);
  const done: string[] = [];
  if (pinned !== undefined && pinned !== row.pinned) {
    await callService(context, siteUrl, "mod_forum_set_pin_state", { discussionid: discussionId, targetstate: pinned ? 1 : 0 });
    done.push(pinned ? "pinned" : "unpinned");
  }
  if (locked !== undefined && locked !== row.locked) {
    // Rows don't always carry the forum's id (confirmed empirically, 5.2): its page does.
    const forumId = row.forumId ?? (await forumInstanceId(context, siteUrl, forumCmid));
    // The service takes the current lock and switches it: 0 locks now, anything else unlocks.
    await callService(context, siteUrl, "mod_forum_set_lock_state", { forumid: forumId, discussionid: discussionId, targetstate: locked ? 0 : 1 });
    done.push(locked ? "locked" : "unlocked");
  }
  return { changed: done.length > 0 ? `Discussion ${discussionId} ${done.join(" and ")}.` : "Nothing to change.", discussion: await find() };
}
