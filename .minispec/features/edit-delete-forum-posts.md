# Edit and delete forum posts

Issue: [#39](https://github.com/falkenslab/moodle-driver/issues/39)

## Goal

Change a post's subject, message or attachments, and delete a post with its replies, as its author or a moderator.

## Context

- `replyToPost`, `startDiscussion` and `setDiscussionState` write; a post can't be changed or removed.
- Moodle edits through `mod/forum/post.php?edit=<postId>` (the reply form; a student only within the edit time) and deletes through `post.php?delete=<postId>` with a confirmation; no service open to AJAX does either.

## Changes

- `editPost(postId, { subject?, message?, files? })`: only what's given; attachments added or removed by name.
- `deletePost(postId)`: `changed` says how many replies went with it.
- Moodle's refusals (edit time over, neither the author nor a moderator) as `ForumError`.
- Categories `communication` (own posts) and `others-write` (a moderator's); docs in forums; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher edits their post and deletes a student's reply; `discussionPosts` shows both.
