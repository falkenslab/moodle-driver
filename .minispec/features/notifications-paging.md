# Page through long lists: notifications, messages, forums, submissions, quiz results…

Issue: [#55](https://github.com/falkenslab/moodle-driver/issues/55)

## Goal

Read long lists a page at a time and know whether there are more, the same way in every function that can return one: notifications first, then conversations, forums, submissions, quiz results and the rest below.

## Context

- `notifications({ unreadOnly: true })` returned 120 notifications, about 61,000 characters, more than a consumer takes in one go, with no way to ask for fewer (falkenslab/moodle-mcp#12, #13). It asks `message_popup_get_popup_notifications` with `limit: 0` and filters the unread ones afterwards; the popup service takes `limit` and `offset` but has no unread filter.
- Other functions return everything too, and grow without bound on a real course:
  - `conversation` (every message, `core_message_get_conversation_messages` with `limitnum: 0`) and `conversations` (`core_message_get_conversations`, `limitnum: 0`): both services take `limitfrom` and `limitnum`.
  - `discussion` (every post of a discussion, with its text) and `forumDiscussions` (every discussion of a forum, read from its pages).
  - `assignmentSubmissions`: with content, every participant's submitted text, which with a large class is huge.
  - `quizResults`: every attempt, and with `responses` every answer, read from the report's pages.
  - `participants` (already filtered by role, group and inactivity, but never capped), `questions` (a bank's questions, often hundreds), and `courseLogs` (already has `limit`, but no `offset` nor a way to know there are more).
- `graderReport` and `completionReport` are students × activities tables: what they need is a filter by students (`userIds`), besides the group they already take, rather than pages.
- Not paged: lists already bounded by dates or small (`listCourses`, `upcomingEvents`, `deadlines`), a search (`potentialUsers`), and settings (`gradebookSetup`, `enrolmentMethods`, `groupings`…).

## Changes

- **One convention for every paged function**, documented once (a section of the concepts pages, linked from each function):
  - options `limit` (how many) and `offset` (how many to skip), counted in the function's own items, in its natural order (newest first for notifications and messages, as Moodle lists the rest);
  - without `limit`, everything, as now: existing callers see no change;
  - with `limit`, the result is `{ items, more }` instead of the list (`more`: whether a page after this one has something). TypeScript overloads give the right type for each call. (Option kept open: always `{ items, more }`, more uniform but a breaking change; chosen against for now so 0.x consumers don't break.)
  - a shared helper for the shape and the overloads, so each function only says how to fetch a page.
- **Notifications:** `limit` and `offset` passed to the service; with `unreadOnly`, pages of the service are fetched until `limit` unread ones are found or there are no more, and `offset` counts unread ones.
- **`conversation`, `conversations`:** through the services' `limitfrom` and `limitnum` (asking for one more than `limit` to know `more`).
- **`discussion`, `forumDiscussions`, `quizResults`, `questions`, `participants`:** through what Moodle offers (a service's limits, a page's own `perpage`/`page` parameters), fetching only the pages needed; where Moodle can't page, read everything and slice, and say so in the doc comment.
- **`assignmentSubmissions`:** `limit`/`offset` over participants, and the grading panels opened only for the participants of the page (fewer requests, not only a smaller result); also `userIds` to ask for given participants.
- **`courseLogs`:** `offset` and `more` added to its existing `limit` (its default of 100 stays).
- **`graderReport`, `completionReport`:** a `userIds` filter, no pages.
- The `moodle` command takes `--limit` and `--offset` from the options as for any option (`cli:generate`); its table output shows a page as its items, and says when there are more.
- Fake-Moodle tests per function: a first page, the next one, the last (`more: false`), and no `limit` (the full list, as before).

## Acceptance

- In the sandbox, with more notifications than the page size, `notifications({ limit: 2 })` gives the two newest and `more: true`, and `{ limit: 2, offset: 2 }` continues where it left off; with `unreadOnly`, only unread ones, paged the same way.
- In the sandbox, a conversation and a forum discussion with more items than `limit` page the same way, and `assignmentSubmissions({ limit: 2 })` opens grading panels for two participants only.
- Every function called without `limit` returns exactly what it returned before (the existing sandbox suite passes unchanged).
