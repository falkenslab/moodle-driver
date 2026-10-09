# Messages and notifications

Issue: [#11](https://github.com/falkenslab/moodle-driver/issues/11)

## Goal

Read notifications and conversations, mark notifications read, and message a user.

## Context

- Students got forum-reply notifications and read them by hand; no run messaged anyone yet.
- AJAX: `message_popup_get_popup_notifications`, `core_message_mark_all_notifications_as_read`, `core_message_get_conversations`, `core_message_get_conversation_messages`, `core_message_send_instant_messages`.

## Changes

- `moodle/messages.ts`: `notifications(context, siteUrl, { unreadOnly? })`, `markNotificationsRead()` (idempotent); `conversations()`, `conversation(context, siteUrl, conversationId)`; `sendMessage(context, siteUrl, userId, text)` (refuses an empty text).
- People as user id and full name; pseudonymizing is the consumer's job.

## Acceptance

- After a forum reply in the sandbox, the other user sees it in `notifications()`, and none unread after marking.
- A message sent as the teacher shows in the student's `conversation()`.
