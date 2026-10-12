# Page through notifications

Issue: [#55](https://github.com/falkenslab/moodle-driver/issues/55)

## Goal

Read the person's notifications a page at a time, newest first, and know whether there are more.

## Context

- `notifications({ unreadOnly: true })` returned 120 notifications, about 61,000 characters, more than a consumer takes in one go, with no way to ask for fewer (falkenslab/moodle-mcp#12, #13).
- `notifications()` asks `message_popup_get_popup_notifications` with `limit: 0` (all of them; Moodle 5.x has no cap there) and filters the unread ones afterwards, so a caller always gets everything.
- The popup service takes `limit` and `offset` but has no unread filter.

## Changes

- `notifications({ limit?, offset?, unreadOnly? })`: `limit` and `offset` passed to the service, newest first as now; the result says whether there are more (`more: true`).
- With `unreadOnly`, paging over the unread ones: pages of the service are fetched until `limit` unread ones are found or there are no more, and `offset` counts unread ones; documented as such.
- Without `limit`, everything, as now (no change for existing callers). The result's shape: decide between an object `{ notifications, more }` (a breaking change, documented in the release notes) and keeping the array with `more` available another way; prefer the clearer one and say why in the report.
- Docs in the messages page; fake-Moodle tests (pages, `more`, unread paging across service pages).

## Acceptance

- In the sandbox, with more notifications than the page size, `notifications({ limit: 2 })` gives the two newest and `more: true`, and the next page continues where it left; with `unreadOnly`, only unread ones, paged the same way.
