# Forum moderation

Issue: [#7](https://github.com/falkenslab/moodle-driver/issues/7)

## Goal

`setDiscussionState`: pin, unpin, lock and unlock discussions.

## Context

- No run needed it yet; small and cheap.
- AJAX: `mod_forum_set_pin_state`, `mod_forum_set_lock_state` (forum instance and discussion ids).

## Changes

- `moodle/forumPosts.ts`: `setDiscussionState(context, siteUrl, forumCmid, discussionId, { pinned?, locked? })`, idempotent.
- `forumDiscussions()` reports pinned besides locked.

## Acceptance

- A discussion in course 3 is pinned and locked; `forumDiscussions()` shows it, and the student can't reply.
