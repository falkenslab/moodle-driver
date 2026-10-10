# Handling errors and expired sessions

A program that runs for a long time, or unattended, meets an expired session, a browser still downloading, a server with no screen and Moodle's refusals. This page shows a program that handles each of them and always closes the browser, for programmers writing anything longer than a one-off script.

**Uses:** [Errors](../concepts/errors.md), [Logging in](../getting-started/logging-in.md), [The browser](../concepts/browser.md), [The Moodle object and the functions](../concepts/calling-functions.md), [Courses](../areas/courses.md).

## The program

```ts
import { setTimeout as sleep } from "node:timers/promises";
import {
  createMoodle,
  BrowserDownloadingError,
  LoginTimeoutError,
  LoginWindowClosedError,
  MoodleError,
  MoodleServiceError,
  NoDisplayError,
  NotLoggedInError,
  type Moodle,
} from "@falkenslab/moodle-driver";

// Runs one step; if Moodle's session ended, logs in again (a window opens) and retries it once.
async function withSession<T>(moodle: Moodle, step: () => Promise<T>): Promise<T> {
  try {
    return await step();
  } catch (error) {
    if (!(error instanceof NotLoggedInError)) throw error;
    console.error("The Moodle session ended: log in again in the window that opens.");
    await moodle.logIn();
    return await step();
  }
}

// The first call may start downloading Chromium in the background: wait and try again.
async function whenBrowserReady<T>(step: () => Promise<T>, attempts = 10): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof BrowserDownloadingError) || attempt === attempts) throw error;
      console.error(`Downloading a browser (attempt ${attempt} of ${attempts}), trying again in 30 seconds...`);
      await sleep(30_000);
    }
  }
}

async function main(): Promise<void> {
  // `await using` closes the browser (saving the session) when main() ends, also on an error.
  await using moodle = createMoodle({
    site: process.env.MOODLE_URL ?? "https://campus.example.org/",
    profileDir: `${process.env.HOME}/.config/pending-report/moodle-profile`,
    headless: true,
    downloadBrowser: true,
    loginTimeoutMs: 3 * 60_000,
  });
  // At once with a saved session; otherwise a login window, once the browser is there.
  const me = await whenBrowserReady(() => moodle.logIn());
  console.log(`${me.fullName} (${me.status})`);

  const courses = await withSession(moodle, () => moodle.listCourses("inprogress"));
  for (const course of courses) {
    // Each step on its own: a session that ends halfway costs one retry, not the whole run.
    const { pending } = await withSession(moodle, () => moodle.pendingActivities(course.id));
    console.log(`${course.fullname}: ${pending.length} pending`);
  }
}

try {
  await main();
} catch (error) {
  process.exitCode = 1;
  if (error instanceof NoDisplayError) console.error("No screen to log in on: log in once on a computer with this profile, then copy the profile here.");
  else if (error instanceof LoginTimeoutError || error instanceof LoginWindowClosedError) console.error("Nobody logged in: run again when you can.");
  else if (error instanceof MoodleServiceError) console.error(`Moodle refused ${error.methodname} (${error.errorcode}): ${error.message}`);
  else if (error instanceof MoodleError) console.error(`[${error.code}] ${error.message}`);
  else throw error; // A bug of the program, not something Moodle said: let it crash with its stack.
}
```

## Step by step

1. `withSession` wraps one step of the program. When it throws `NotLoggedInError` (the session expired, or the person logged out elsewhere), it calls `moodle.logIn()`, which opens a window at the site's login page, and runs the step once more. A second `NotLoggedInError` goes up: something else is wrong.
2. `whenBrowserReady` handles the first run on a computer without Edge or Chrome: with `downloadBrowser: true`, the first call starts downloading Chromium and throws `BrowserDownloadingError` at once, and so do later calls until the download finishes. The program waits and tries again.
3. `await using moodle = createMoodle(...)` makes the object disposable: when `main()` returns or throws, `moodle.close()` runs, which saves the session cookies to the profile and closes the browser. No `finally` needed.
4. `logIn()` answers at once with `already-logged-in` when the profile has a session; otherwise the person logs in by hand, within `loginTimeoutMs`.
5. Every read goes through `withSession`, one step at a time, so an expiry in the middle of a long loop costs one login and one retry.
6. The outer `catch` runs after the browser is closed. It turns the driver's errors into messages for the person: by class for the ones the program acts on, by `code` for the rest. Errors that aren't `MoodleError` are the program's own bugs and go up.

## What it prints

An example run whose session expired between two courses:

```text
Ada Lovelace (already-logged-in)
Programming 1: 3 pending
The Moodle session ended: log in again in the window that opens.
Databases: 0 pending
Web design: 5 pending
```

## Variations

- Match by `error.code` instead of by class (`error.code === "not-logged-in"`) when the error may come from another bundle of the driver: `instanceof` needs the same copy of the class, the code doesn't.
- An unattended program (a nightly job) shouldn't open a login window nobody will see: catch `NotLoggedInError` and report "log in again" instead of retrying, or check `canShowWindow()` first.
- Retry reads freely. For writes that create something (a post, an activity), read the state before retrying: the write may have happened before the session check failed.
- Without `await using` (an older TypeScript, a runtime without it), call `await moodle.close()` in a `finally`, as in [Your first program](../getting-started/first-program.md).

## When something goes wrong

- `NotLoggedInError` twice in a row: the login worked but the site ends the session at once (a single-session policy, the person logged in elsewhere). Log out the other session.
- `NoDisplayError`: on Linux without `DISPLAY` or `WAYLAND_DISPLAY` (a server, a container) the driver won't open the login window. Log in where there's a screen with the same profile folder and copy the profile over; see [Logging in](../getting-started/logging-in.md).
- `BrowserNotFoundError`: no Edge or Chrome, and `downloadBrowser` is `false`. Install one, or allow the download.
- `BrowserDownloadingError` after every attempt: the download is slow or failing; `moodle.browser.chromiumDownload()` says `"failed"` when it failed (it's retried on the next call).
- `MoodleServiceError` with `nopermissions`: the person can't do that in Moodle. The driver has no permissions of its own; see [Errors](../concepts/errors.md).

## Data it touches

Only the person's own courses and pending activities: the `own` and `course-content` [data categories](../concepts/data-categories.md). Handling errors and logging in touch nothing of anyone's (`none`).
