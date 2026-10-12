# Forums

A forum's discussions and their posts as plain data, posting as the person (replies and new discussions, with attachments), editing and deleting posts, subscribing to discussions, and a teacher's moderation (pinning and locking discussions, changing or removing anyone's posts). Grading a forum as a whole and rating posts are in [Grading](grading.md#forumgrades). Students and teachers read and post alike, within what the forum allows them; pinning and locking need the moderation rights a teacher has.

**Terms:** [participant](../reference/glossary.md#participant), [instance id](../reference/glossary.md#instance-id), [notification](../reference/glossary.md#notification).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

A forum is identified by its activity id (`activityId`, the `id` in `mod/forum/view.php?id=`), discussions and posts by Moodle's ids. Discussions are read from the forum's pages (by data attributes, links and timestamps, so in any language), posts through Moodle's `mod_forum_get_discussion_posts` service, and posting goes through Moodle's own post form (`mod/forum/post.php`), which takes attachments and fills in a reply's subject. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## forumDiscussions

A forum's discussions as its page lists them, through all its pages: who started each, how many replies, the last post, whether it's pinned or locked, and whether the person is subscribed to it.

```ts
function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number, options?: { limit?: number; offset?: number }): Promise<ForumDiscussion[]>; // ListPage<ForumDiscussion> with limit

interface ForumDiscussion {
  id: number;
  subject: string;
  author: string;
  started?: string;
  lastPost: { author: string; time?: string; postId?: number };
  replies: number;
  locked: boolean;
  pinned: boolean;
  subscribed: boolean;
}
```

- `id`: the discussion's id, which `discussion`, `setDiscussionState` and `setDiscussionSubscription` take.
- `author`: the name of who started it, as shown; `started`: when, as an ISO date.
- `lastPost`: who posted last, when (ISO), and that post's id when the page links it.
- `replies`: the reply count shown.
- `pinned`: the discussion stays on top of the list; `locked`: nobody can reply any more.
- `subscribed`: the person gets its posts by notification, whether subscribed to the discussion itself or to the whole forum (and not opted out of this discussion), as Moodle marks the row.

The person's subscription to the forum as a whole isn't read: the forum's page shows it only as a button whose link is the same either way, with only its label telling the state.

With `limit` and `offset`, a page of the discussions in the forum's order (see [Long lists](../concepts/calling-functions.md#long-lists)): the driver opens the one page of the forum's own paging (its `s` and `p` parameters) that holds it, instead of every page.

Throws `NotAForumError` when the id isn't a forum the person can view.

## discussion

A discussion's posts, oldest first, with their messages as plain text, and whether the person is subscribed to it.

```ts
function discussion(context: BrowserContext, siteUrl: string, discussionId: number, options?: { limit?: number; offset?: number }): Promise<{
  discussion: { id: number; forumInstanceId: number; courseId: number; subscribed?: boolean };
  posts: ForumPost[]; // ListPage<ForumPost> with limit
}>;

interface ForumPost {
  id: number;
  parentId?: number;
  subject: string;
  author: { id: number; fullName: string };
  created?: string;
  modified?: string;
  text: string;
  images?: ImageItem[]; // { url, alt? }
  attachments: { name: string; url: string }[];
  privateReply: boolean;
  unread?: boolean;
}
```

- `discussion.forumInstanceId`: the forum's instance id (not its activity id, which the forum functions take); `courseId`: its course.
- `discussion.subscribed`: whether the person is subscribed to it, read from the subscription item of the discussion's page (its settings menu); missing where the page has none (the person can't subscribe, or the forum forces the subscription).
- `parentId`: the post it replies to; missing for the discussion's first post.
- `limit`, `offset`: `posts` as a page (see [Long lists](../concepts/calling-functions.md#long-lists)). Moodle's service has no paging: every post is read and cut, but only the page's messages are turned into text.
- `created`, `modified`: ISO dates; `modified` only when the post was edited more than a minute after posting.
- `text`: the message as text, with its paragraphs and lists kept.
- `images`: the images in the message (`{ url, alt? }`), when it has any; their `pluginfile.php` URLs download with [`downloadFile`](files.md).
- `attachments`: each file's name and URL; download them with the session through [`downloadFile`](files.md).
- `privateReply`: a private reply, which only its author and the person replied to (and teachers) see.
- `unread`: whether the person hasn't read it, when Moodle tracks it.

Throws `NotAForumError` when the discussion doesn't exist or the person can't see it, and `MoodleServiceError` for other refusals of the service.

## replyToPost

Replies to a post through Moodle's post form, and returns the new post's id and its discussion's; when `subscribe` is given, also the person's subscription to the discussion afterwards, read back from its page, so the call confirms it took.

```ts
function replyToPost(context: BrowserContext, siteUrl: string, postId: number, input: PostInput & { subject?: string }): Promise<{
  changed: string;
  postId?: number;
  discussionId?: number;
  subscribed?: boolean;
}>;

interface PostInput {
  message: string;
  files?: string[];
  embed?: string[];
  subscribe?: boolean;
  fields?: Record<string, FieldValue>;
}
```

- `message`: the message as HTML (`"<p>Thanks, that worked.</p>"`).
- `subject`: the reply's subject; without it, the one Moodle fills in ("Re: ...").
- `files`: absolute paths of local files to attach, uploaded as the file picker does.
- `embed`: absolute paths of local images and files to put inside the message, which names each by its file name (`'<p>Here: <img src="error.png"></p>'`), as Moodle's editor inserts an image (see [Embedding files in rich text](files.md#embedding-files-in-rich-text)).
- `subscribe`: subscribe to the discussion or not; without it, Moodle's default.
- `fields`: other fields of the post form by name, set after the others (a teacher's `{ pinned: true }` on a new discussion, or `{ mailnow: true }`).

Errors before anything is posted: a `MoodleError` when the message is empty (`invalid-input`) (Moodle would post `<p></p>` as a blank message; a message with only an image, video, audio or iframe counts as content), when a file path isn't absolute or doesn't exist, or when the forum takes no attachments (`not-available`). `FormError` when Moodle shows no post form (the person can't reply there: a locked discussion, no permission), when the form has no field by a given name, or when Moodle refuses the values, with its messages by field.

## startDiscussion

Starts a discussion in a forum, through the same form, and returns its id, whether it's pinned and whether the person is subscribed to it, as the forum lists it afterwards: one call confirms what `subscribe` and `fields: { pinned: true }` set.

```ts
function startDiscussion(context: BrowserContext, siteUrl: string, activityId: number, input: PostInput & { subject: string }): Promise<{
  changed: string;
  discussionId?: number;
  pinned?: boolean;
  subscribed?: boolean;
}>;
```

`subject` is required here; the rest is as for `replyToPost`. The new discussion's id is found by comparing the forum's discussions before and after posting, so it's missing if the forum's list doesn't show the new discussion to the person. Throws `NotAForumError` when the id isn't a forum the person can view or post in, and the same errors as `replyToPost` otherwise. Some forum types limit who starts discussions (an announcements forum, to teachers): where the person can't, Moodle shows no post form and `FormError` says so.

## setDiscussionState

Pins or unpins, locks or unlocks a discussion, as the discussion list's menu does, through Moodle's `mod_forum_set_pin_state` and `mod_forum_set_lock_state` services. Returns the discussion as the forum lists it afterwards.

```ts
function setDiscussionState(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  discussionId: number,
  state: { pinned?: boolean; locked?: boolean },
): Promise<{ changed: string; discussion?: ForumDiscussion }>;
```

It's idempotent: what's already so is left alone, and a call that changes nothing calls no service and answers `"Nothing to change."`. A state not given isn't touched. Throws `NotAForumError` when the forum has no such discussion, and `MoodleServiceError` when Moodle refuses (the person can't pin or lock discussions).

## setDiscussionSubscription

Subscribes the person to a discussion or unsubscribes them, as the discussion list's toggle does, through Moodle's `mod_forum_set_subscription_state` service. Returns the discussion as the forum lists it afterwards.

```ts
function setDiscussionSubscription(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  discussionId: number,
  subscribed: boolean,
): Promise<{ changed: string; discussion?: ForumDiscussion }>;
```

It's idempotent: when the person is already so, it calls no service and answers `"Nothing to change."`. Unsubscribing from a discussion of a forum the person is subscribed to opts them out of that discussion only. Throws `NotAForumError` when the forum has no such discussion, and `MoodleServiceError` when Moodle refuses (a forum where subscriptions are disabled or forced).

## editPost

Changes a post through Moodle's own post form (`post.php?edit=`), as its author or a moderator: only what's given changes. Returns the post afterwards, as `discussion` reads it.

```ts
function editPost(context: BrowserContext, siteUrl: string, postId: number, changes: PostChanges): Promise<{
  changed: string;
  post?: ForumPost;
}>;

interface PostChanges {
  subject?: string;
  message?: string;
  files?: { add?: string[]; remove?: string[] };
  embed?: string[];
}
```

- `message`: the new message as HTML, replacing the old one.
- `embed`: absolute paths of local images and files the new `message` names, as in `replyToPost`.
- `files.add`: absolute paths of local files to attach; `files.remove`: attachments to remove, by name (as `discussion` lists them in `attachments`).
- With nothing to change, it opens no form and answers `"Nothing to change."`.

Moodle lets the author edit a post only within the site's editing time (30 minutes by default) and a moderator (a teacher, `mod/forum:editanypost`) edit any post at any time. Errors before anything is saved: a `MoodleError` when the message or the subject is empty (`invalid-input`), when a file path isn't absolute or doesn't exist, or when the forum takes no attachments (`not-available`); `FormError` when the post has no attachment by a name to remove. `ForumError` with Moodle's reason when it refuses: the editing time is over, the post is someone else's, or there's no such post.

## deletePost

Deletes a post and every reply under it, through Moodle's own confirmation (`post.php?delete=`). A discussion's first post takes the whole discussion.

```ts
function deletePost(context: BrowserContext, siteUrl: string, postId: number): Promise<{
  changed: string;
  discussionId?: number;
  replies: number;
  discussionDeleted: boolean;
}>;
```

- `replies`: how many replies went with it, at any depth.
- `discussionDeleted`: the post was the discussion's first, so the discussion is gone.

The author deletes their own post within the editing time and while it has no replies; a moderator (`mod/forum:deleteanypost`) deletes any post, replies included. Throws `ForumError` with Moodle's reason when it refuses (someone else's post, a post with replies, the editing time over, no such post).

## NotAForumError

The class every forum function throws when the id isn't a forum's course module, the person can't view it, or a discussion isn't there. Its message says where to take the right id from (the course structure, the forum's discussions). Catch it with `instanceof NotAForumError`.

## ForumError

What `editPost` and `deletePost` throw when Moodle refuses to change or delete a post; its message ends with Moodle's own reason, in the site's language. Code `forum`.

## Example

```ts
import { ForumError, NotAForumError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.
const forumId = 37;

try {
  const discussions = await moodle.forumDiscussions(forumId);
  for (const d of discussions) console.log(`${d.pinned ? "[pinned] " : ""}${d.subject} by ${d.author}, ${d.replies} replies`);

  const first = discussions[0];
  if (first) {
    const { posts } = await moodle.discussion(first.id);
    const opening = posts[0]!;
    console.log(`${opening.author.fullName}: ${opening.text}`);
    const reply = await moodle.replyToPost(opening.id, { message: "<p>Thanks, Ada. The loop ends at 2.</p>", subscribe: false });
    // A second thought, within the editing time.
    if (reply.postId) await moodle.editPost(reply.postId, { message: "<p>Thanks, Ada. The loop ends at 3.</p>" });
  }

  const started = await moodle.startDiscussion(forumId, {
    subject: "Exercise 3 solutions",
    message: "<p>Post your solution to exercise 3 here.</p>",
    files: ["/home/me/exercise3.pdf"],
  });

  // Stop following it.
  if (started.subscribed && started.discussionId) await moodle.setDiscussionSubscription(forumId, started.discussionId, false);

  // As a teacher: keep it on top and closed to replies.
  if (started.discussionId) await moodle.setDiscussionState(forumId, started.discussionId, { pinned: true, locked: true });
} catch (error) {
  if (error instanceof NotAForumError || error instanceof ForumError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `forumDiscussions`, `discussion`: `others-personal` (others' names and posts).
- `replyToPost`, `startDiscussion`: `communication` (writing before others).
- `setDiscussionState`: `others-personal` and `communication`.
- `setDiscussionSubscription`: `own` (the person's subscription) and `others-personal` (the discussion it returns names who started it).
- `editPost`, `deletePost`: `communication` (one's own posts) and `others-write` (a moderator changing or removing someone else's).

See [Data categories](../concepts/data-categories.md).
