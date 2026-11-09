# Recover from a browser lost mid-call

Issue: [#99](https://github.com/falkenslab/moodle-driver/issues/99)

## Goal

A browser that crashes during a call stops failing work that is safe to repeat, and one that keeps crashing is replaced by another that's installed.

## Context

- From falkenslab/moodle-mcp#57: headless Edge crashed repeatedly during long course builds.
- `launchFirstAvailable` (`src/browser/manager.ts`) moves to the next channel only when a browser isn't installed.
- Depends on `fix-browser-lost-error`, which gives the failure its own code (`browser-lost`).
- A retry must never repeat a write that may have reached Moodle: a form sent twice makes two activities. Which calls are safe has to be decided per call, not guessed from a failure.

## Changes

- Relaunch and retry once for navigations and reads only, with an explicit list or marking of what is safe to repeat.
- Fall back to the next channel after repeated crashes, if the design holds up; the session stays in the profile, but each channel's handling of it has to be checked.
- Doc comments and the browser guide in both languages (ADR-015).

## Acceptance

- A read during which the browser dies returns its result after one relaunch.
- A write during which the browser dies fails with code `browser-lost` and isn't repeated, checked by a test that counts the requests Moodle receives.
- With repeated crashes on one channel and another installed, the next call runs on the other, if the fallback is kept.
