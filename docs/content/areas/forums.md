# Forums

A forum's discussions and their posts as plain data, posting as the person (replies and new discussions, with attachments), and a teacher's moderation (pinning and locking discussions). Students and teachers read and post alike, within what the forum allows them; pinning and locking need the moderation rights a teacher has.

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

A forum is identified by its activity id (`activityId`, the `id` in `mod/forum/view.php?id=`), discussions and posts by Moodle's ids. Discussions are read from the forum's pages (by data attributes, links and timestamps, so in any language), posts through Moodle's `mod_forum_get_discussion_posts` service, and posting goes through Moodle's own post form (`mod/forum/post.php`), which takes attachments and fills in a reply's subject. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## forumDiscussions

A forum's discussions as its page lists them, through all its pages: who started each, how many replies, the last post, and whether it's pinned or locked.

```ts
function forumDiscussions(context: BrowserContext, siteUrl: string, activityId: number): Promise<ForumDiscussion[]>;

interface ForumDiscussion {
  id: number;
  subject: string;
  author: string;
  started?: string;
  lastPost: { author: string; time?: string; postId?: number };
  replies: number;
  locked: boolean;
  pinned: boolean;
}
```

- `id`: the discussion's id, which `discussion` and `setDiscussionState` take.
- `author`: the name of who started it, as shown; `started`: when, as an ISO date.
- `lastPost`: who posted last, when (ISO), and that post's id when the page links it.
- `replies`: the reply count shown.
- `pinned`: the discussion stays on top of the list; `locked`: nobody can reply any more.

Throws `NotAForumError` when the id isn't a forum the person can view.

## discussion

A discussion's posts, oldest first, with their messages as plain text.

```ts
function discussion(context: BrowserContext, siteUrl: string, discussionId: number): Promise<{
  discussion: { id: number; forumInstanceId: number; courseId: number };
  posts: ForumPost[];
}>;

interface ForumPost {
  id: number;
  parentId?: number;
  subject: string;
  author: { id: number; fullName: string };
  created?: string;
  modified?: string;
  text: string;
  attachments: { name: string; url: string }[];
  privateReply: boolean;
  unread?: boolean;
}
```

- `discussion.forumInstanceId`: the forum's instance id (not its activity id, which the forum functions take); `courseId`: its course.
- `parentId`: the post it replies to; missing for the discussion's first post.
- `created`, `modified`: ISO dates; `modified` only when the post was edited more than a minute after posting.
- `text`: the message as text, with its paragraphs and lists kept.
- `attachments`: each file's name and URL; download them with the session through [`downloadFile`](files.md).
- `privateReply`: a private reply, which only its author and the person replied to (and teachers) see.
- `unread`: whether the person hasn't read it, when Moodle tracks it.

Throws `NotAForumError` when the discussion doesn't exist or the person can't see it, and `MoodleServiceError` for other refusals of the service.

## replyToPost

Replies to a post through Moodle's post form, and returns the new post's id and its discussion's.

```ts
function replyToPost(context: BrowserContext, siteUrl: string, postId: number, input: PostInput & { subject?: string }): Promise<{
  changed: string;
  postId?: number;
  discussionId?: number;
}>;

interface PostInput {
  message: string;
  files?: string[];
  subscribe?: boolean;
  fields?: Record<string, FieldValue>;
}
```

- `message`: the message as HTML (`"<p>Thanks, that worked.</p>"`).
- `subject`: the reply's subject; without it, the one Moodle fills in ("Re: ...").
- `files`: absolute paths of local files to attach, uploaded as the file picker does.
- `subscribe`: subscribe to the discussion or not; without it, Moodle's default.
- `fields`: other fields of the post form by name, set after the others (a teacher's `{ pinned: true }` on a new discussion, or `{ mailnow: true }`).

Errors before anything is posted: a `MoodleError` when the message is empty (`invalid-input`) (Moodle would post `<p></p>` as a blank message; a message with only an image, video, audio or iframe counts as content), when a file path isn't absolute or doesn't exist, or when the forum takes no attachments (`not-available`). `FormError` when Moodle shows no post form (the person can't reply there: a locked discussion, no permission), when the form has no field by a given name, or when Moodle refuses the values, with its messages by field.

## startDiscussion

Starts a discussion in a forum, through the same form, and returns its id.

```ts
function startDiscussion(context: BrowserContext, siteUrl: string, activityId: number, input: PostInput & { subject: string }): Promise<{
  changed: string;
  discussionId?: number;
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

## NotAForumError

The class every forum function throws when the id isn't a forum's course module, the person can't view it, or a discussion isn't there. Its message says where to take the right id from (the course structure, the forum's discussions). Catch it with `instanceof NotAForumError`.

## Example

```ts
import { NotAForumError } from "@falkenslab/moodle-driver";

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
    await moodle.replyToPost(opening.id, { message: "<p>Thanks, Ada. The loop ends at 2.</p>", subscribe: false });
  }

  const started = await moodle.startDiscussion(forumId, {
    subject: "Exercise 3 solutions",
    message: "<p>Post your solution to exercise 3 here.</p>",
    files: ["/home/me/exercise3.pdf"],
  });

  // As a teacher: keep it on top and closed to replies.
  if (started.discussionId) await moodle.setDiscussionState(forumId, started.discussionId, { pinned: true, locked: true });
} catch (error) {
  if (error instanceof NotAForumError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `forumDiscussions`, `discussion`: `others-personal` (others' names and posts).
- `replyToPost`, `startDiscussion`: `communication` (writing before others).
- `setDiscussionState`: `others-personal` and `communication`.

See [Data categories](../concepts/data-categories.md).
