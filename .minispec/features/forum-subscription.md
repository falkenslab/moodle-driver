# Forum subscription: read it, and confirm what startDiscussion set

Issue: [#53](https://github.com/falkenslab/moodle-driver/issues/53)

## Goal

Know whether the person is subscribed to a forum and its discussions, and have `startDiscussion` confirm the subscription and pin it set.

## Context

- `startDiscussion` with `subscribe: true` and `fields: { pinned: true }` returns only the discussion's id, and `forumDiscussions` gives `pinned` but not whether the person is subscribed: an agent couldn't confirm the subscription took (falkenslab/moodle-mcp#5).
- Moodle's discussion list shows a subscription toggle per discussion, and `mod_forum_set_subscription_state` (open to AJAX) changes it; the forum's own subscription is on its page.

## Changes

- `forumDiscussions` and `discussion`: `subscribed` for each discussion, and the forum's own subscription where the page shows it.
- `startDiscussion`, and `replyToPost` where it subscribes: return the resulting `pinned` and `subscribed`, read back, so one call confirms what it set.
- `setDiscussionSubscription(activityId, discussionId, subscribed)`: subscribe and unsubscribe on its own, as the discussion list's toggle does.
- Categories as the other forum functions (`own` for the person's subscription); docs in the forums page; fake-Moodle tests.

## Acceptance

- In the sandbox, a discussion started with `subscribe: true` and pinned comes back `subscribed: true, pinned: true`, and `forumDiscussions` agrees; unsubscribing shows `subscribed: false`.
