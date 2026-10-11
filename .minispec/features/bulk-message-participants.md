# Message several participants at once

Issue: [#47](https://github.com/falkenslab/moodle-driver/issues/47)

## Goal

Send one message to several participants of a course (chosen, a role, a group, or the inactive ones), as the participants page's "Send a message" does.

## Context

- `sendMessage(userId, text)` sends to one person; writing to a group means a loop the program writes.
- The participants page sends to the selected users through `core_message_send_instant_messages` (open to AJAX): one message per user, in one call.

## Changes

- `messageParticipants(courseId, text, { userIds } | { role?, group?, inactiveSince? })`: the users chosen as `participants` chooses them, in one call; `changed` says how many got it, and the result lists who Moodle refused (blocked, can't be messaged).
- The result lists exactly who was written to.
- Category `communication`; docs in messages and participants; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher messages the students of a group; each one's `conversations` shows it, and a student who blocked the teacher is listed as refused.
