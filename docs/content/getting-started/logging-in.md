# Logging in

The driver never handles a password. The person logs in by hand, in a browser window the driver opens at the site's login page, with whatever the site uses: its own form, single sign-on, two factors. The driver waits until there's a session and keeps it in a browser profile on disk, so later runs start already logged in.

## The profile

A profile is a folder where the browser keeps its cookies and storage, the same as a browser's user profile. Choose one per person and per site, outside your program's folder and outside any repository: it holds a live session, as sensitive as a password.

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.config/my-program/moodle-profile",
  headless: true,
  downloadBrowser: true,
});
```

Chromium forgets session cookies when a persistent profile closes, and Moodle's `MoodleSession` cookie is one. The driver saves them in a file inside the profile (`SESSION_COOKIES_FILE`) when it closes or after logging in, and puts them back when it opens the browser again, so the login survives restarts until Moodle ends the session itself.

## logIn

`moodle.logIn({ timeoutMs, onWait? })` is the function `logIn(browser, siteUrl, options)` with the object's browser and site.

```ts
function logIn(
  browser: BrowserManager,
  siteUrl: string,
  options: { timeoutMs: number; onWait?: (elapsedMs: number) => void },
): Promise<LoginResult>;

interface LoginResult {
  status: "already-logged-in" | "logged-in";
  userId: number;
  fullName: string;
}
```

- If the profile already has a session, it answers at once with `already-logged-in`.
- Otherwise it opens a window at the site's login page and waits, calling `onWait` every second with the time elapsed, until the person has logged in (a page of the site with a real user). Going through other domains on the way (an identity provider) is fine.
- Then it saves the session and, unless the browser is being shown on demand, closes the window: the next call opens the browser headless again.

It throws `LoginTimeoutError` when nobody logs in within `timeoutMs` (the window is closed), `LoginWindowClosedError` when the person closes the window first, and `NoDisplayError` where there's no screen to show a window (a server, a container without a display).

```ts
import { createMoodle, LoginTimeoutError } from "@falkenslab/moodle-driver";

const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
try {
  const me = await moodle.logIn({
    timeoutMs: 5 * 60_000,
    onWait: (ms) => process.stderr.write(`\rWaiting for you to log in... ${Math.round(ms / 1000)}s`),
  });
  console.log(`\n${me.status}: ${me.fullName} (${me.userId})`);
} catch (error) {
  if (error instanceof LoginTimeoutError) console.error("Nobody logged in in time.");
  else throw error;
}
```

## Finding the site's URL

People often have a course's or the login page's URL at hand, not the site's base. `findMoodleSite(url)` fetches it (no browser, no session) and reads the base URL Moodle writes in every page; `parseSiteUrl(url)` only normalizes one (http or https, a trailing slash, no query). Both throw `MoodleUrlError` for something that isn't a Moodle site or a URL.

```ts
import { findMoodleSite } from "@falkenslab/moodle-driver";

const site = await findMoodleSite("https://campus.example.org/course/view.php?id=3");
// "https://campus.example.org/"
```

`publicSiteInfo(site)` reads what the site tells anyone before logging in: its name, languages, whether it uses identity providers, maintenance mode. See [Users and the site](../areas/users-and-site.md).

## When the session ends

Moodle ends sessions after inactivity, on logout, or when the person logs in elsewhere and the site allows one session. Any operation that needs the session then throws `NotLoggedInError`: call `logIn` again (a window opens) and retry. See [Errors](../concepts/errors.md).

## Logging out

`moodle.logOut()` ends Moodle's session through the user menu's logout link, and answers `false` when nobody was logged in. A single sign-on provider may keep its own session: the next login may then go through without a password.

## Where there's no screen

On a server or in a container there's no screen for the login window. Log in once where there is one (your computer) with the same profile folder, then copy or mount the profile where the program runs: it starts headless and logged in. On Linux the driver only opens a window when `DISPLAY` or `WAYLAND_DISPLAY` is set; otherwise it throws `NoDisplayError` instead of trying.
