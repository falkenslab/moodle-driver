# A browser that can't start on a long profile path fails without saying so

Issue: [#98](https://github.com/falkenslab/moodle-driver/issues/98)

## Problem

From falkenslab/moodle-mcp#58: on Windows, with a long data folder, `launchPersistentContext` fails with `browser has been closed`; the same data on a much shorter path works. Nothing tells the program or the person what's wrong.

## Cause

`launchFirstAvailable` (`src/browser/manager.ts`) rethrows any launch failure that isn't a missing browser as it comes. The browser's own files inside the profile go past Windows' path limit; the exact profile length where that happens hasn't been measured.

## Solution

On Windows, when a launch fails with no more specific cause and the profile path is longer than a named constant, throw a `ProfilePathTooLongError` (`MoodleError`, code `profile-path-too-long`) that says the path's length may be why and to use a shorter one. Decided on 2026-11-09 not to open browsers on the developer's desktop to measure it: the constant is an estimate (Windows' 260 characters less room for the browser's files inside the profile), says so in its comment, and the message says "may". Below it, the original error stays as it is.

## Verification

Tests in Docker, with a fake launch that fails and a stubbed platform: a long path gives the new code with the length in its message, a short one the original error, and a missing browser still moves to the next channel.
