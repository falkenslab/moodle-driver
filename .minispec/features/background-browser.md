# A background browser for separate commands

Issue: [#25](https://github.com/falkenslab/moodle-driver/issues/25)

## Goal

Let separate `moodle` commands (from any terminal or script) work on one browser left open in the background, so a person can watch them act one after another, without an interactive session.

## Context

- Each `moodle …` opens and closes its browser, and a profile can be open in one browser at a time: separate commands can't share a window (ADR-012, ADR-013).
- `moodle shell` (#24, `moodle-shell.md`) keeps one browser for the commands typed in it; this card is for commands run separately, after it.
- Playwright can drive a browser another process opened, over Chrome's debugging protocol (`chromium.connectOverCDP`): a browser launched with a debugging port gives its contexts to whoever connects.
- That port gives full control of the browser, logged in to Moodle as the person, to anything on the machine that reaches it: the design starts from closing that door.

## Changes

- `moodle open [--show]`: starts a background process holding the site's profile in a browser with a debugging port on 127.0.0.1 only (a free port), and writes where to reach it and a random token in `sites/<host>/profiles/<name>/.browser.json`, readable only by the person. `moodle close` stops it; `moodle sites` says which profiles have one running.
- Every command first looks for a running browser for its profile: when one answers, it connects to it (`connectOverCDP`) instead of launching its own, works in a tab of its own, and leaves the browser open; otherwise it launches as now.
- The token: the background process exposes the debugging endpoint only behind a check (a small local proxy that requires it, or Chromium's own when it has one); a stale `.browser.json` (the process gone) is removed.
- One command at a time on a background browser: a lock next to `.browser.json`; a second command waits briefly, then says another one is running.
- The library: a `BrowserManager` that connects to an existing browser (`connectBrowserManager({ endpoint })`), so programs can share it too; `createMoodle({ site, browser })` takes it as it takes any manager.
- `moodle shell` connects to a running background browser for its profile when there is one.
- Docs: the command line guide (watching commands act, the security of the background browser), an ADR for the endpoint and its protection.
- Tests in Docker: open, a command that reuses it (no second launch), close, a stale file, the lock, a connection without the token refused.

## Acceptance

- After `moodle open --show`, `moodle list-courses` and `moodle course-structure 3` from another terminal act in the same window, which stays open; `moodle close` closes it.
- Nothing without the token in `.browser.json` (readable only by the person) can drive the browser through its port.
- Without a background browser, every command behaves as before.
