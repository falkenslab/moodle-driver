# The user agent a headless browser sends

Issue: [#102](https://github.com/falkenslab/moodle-driver/issues/102)

## Goal

A program can choose what user agent the browser sends: the one the installed browser sends with a window, also when it runs headless, or a text of its own.

## Context

- Headless, Edge and Chrome send `HeadlessChrome/<version>` in every request: page loads, AJAX calls and `context.request` fetches. With a window they send `Chrome/<version>` (and `Edg/<version>` for Edge). The web server's access log tells the two apart.
- The owner runs the student trail against moodle-sandbox to study how automated activity is detected, so the trail's signals should be a student's as far as possible, and choosable to compare.
- `launchFirstAvailable` (`src/browser/manager.ts`) launches with no `userAgent`. A persistent context's user agent is fixed at launch.

## Changes

- `BrowserOptions.userAgent?: "browser" | string`: undefined keeps the browser's own; `"browser"` sends, headless too, what the installed browser sends with a window (worked out from its headless one, once per channel); any other text is sent as it is.
- Check in Docker what else gives headless away in requests (the `sec-ch-ua` client hints) and whether the user agent reaches `context.request`; cover what can be covered with the same option, and document what can't.
- Doc comment, the browser guide in both languages (ADR-015).

## Acceptance

- With `userAgent: "browser"`, headless requests to a local server carry the headed user agent, for pages and `context.request` alike; with a text, that text; without the option, as before.
- Firefox, whose headless user agent is already its headed one, is unchanged.
