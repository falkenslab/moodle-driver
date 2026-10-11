# A conversation's members are only its senders

## Problem

`conversation()` gives as `members` only the people who wrote one of the messages returned, not everyone in the conversation. Seen from moodle-mcp on 11 October 2026 in the sandbox: a private conversation between the teacher and a student where only the teacher had written gave `members: [teacher]`, while `conversations()` listed the student for the same conversation. Someone who only received messages is missing; a conversation nobody wrote in yet has no members.

## Cause

`conversation()` (`src/areas/messages/messages.ts`) takes `members` from `core_message_get_conversation_messages`, whose `members` field Moodle fills with the messages' senders, not the conversation's members. `conversations()` uses `core_message_get_conversations`, whose `members` are the other members, so it's right.

## Solution

- Read the members with `core_message_get_conversation_members` (`userid` the person, `conversationid`, no contact requests, no privacy info, all of them), and keep `core_message_get_conversation_messages` for the messages only.
- Check on the sandbox whether that service includes the person themselves, and say in `conversation()`'s doc comment what `members` holds (everyone, or everyone but the person, as `conversations()` does): consistent between both functions.
- A comment where the messages are read: that service's `members` are the senders, not to be used as members.
- A test against the fake Moodle: a conversation of two where only one wrote gives both members.
- A patch release (0.4.1).

## Verification

- The test above, and the existing messaging tests.
- In the sandbox, the teacher's private conversation with a student where only the teacher wrote gives the student among its members.
- moodle-mcp bumps to it and repeats its messaging check: `get_conversation` gives the student as an alias among the members.
