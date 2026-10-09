# ADR-003: Session cookies saved in the profile

## Decision

The driver saves the browser's session cookies (those with no expiry) to `moodle-mcp-session-cookies.json` inside the profile folder after a login and whenever it closes the browser, and puts them back when it opens the profile again, unless the browser kept a newer one. The file keeps moodle-mcp's name so existing profiles keep their sessions. Moved from moodle-mcp's ADR-007 when the driver was extracted (9 October 2026).

## Motivation

Chromium drops session cookies when a persistent profile closes, and Moodle's `MoodleSession` is one (confirmed empirically, Edge with playwright-core 1.64 and Moodle 5.2): the profile alone would forget the login on every restart, against ADR-002. Chromium's "continue where you left off" setting keeps them, but depends on browser preferences and how the browser was closed; an explicit file doesn't. Playwright's `storageState` file was rejected as it replaces the profile's own state instead of adding to it.

## Consequences

- The file is as sensitive as the profile (a live session): written with owner-only permissions where the system honors them, never outside the profile.
- A session still ends when Moodle says so (its session timeout, a logout, a password change); functions then throw `NotLoggedInError`.
- A program killed without closing the browser keeps the cookies saved at the last login. `logOut()` rewrites them, so a restart doesn't bring an ended session back.
