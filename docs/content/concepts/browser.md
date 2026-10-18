# The browser

`createMoodle()` makes a `BrowserManager` from its options (it's `moodle.browser`), or takes yours; `createBrowserManager(options)` makes one on its own. It's the one persistent browser your program works Moodle with. It launches nothing until it's needed, keeps the browser open between calls, and closes it on `close()`.

**Terms:** [profile](../reference/glossary.md#profile), [working tab](../reference/glossary.md#working-tab), [shown on demand](../reference/glossary.md#shown-on-demand).

## Options

```ts
interface BrowserOptions {
  /** The persistent profile folder where the person logs in. */
  profileDir: string;
  /** One channel, or undefined for Edge, then Chrome, then (with downloadBrowser) Chromium. */
  channel?: "msedge" | "chrome" | "chromium" | "firefox";
  /** Without a window, unless one is asked for (logging in) or shown on demand. */
  headless: boolean;
  /** Download Playwright's Chromium (or Firefox, when chosen) when no installed browser works. */
  downloadBrowser: boolean;
}
```

The manager reads the options each time it launches the browser, so a program may change them on the same object between launches (another profile, another channel) and close the browser to apply them.

## The manager

| Method | What it does |
| --- | --- |
| `context({ headed? })` | The open `BrowserContext`, launching the browser if needed. `headed: true` relaunches a headless browser with a window; a headless request reuses a window already open rather than closing it under the person. |
| `close()` | Saves the session cookies and closes the browser. |
| `saveSession()` | Saves the session cookies of the open browser now (logging in does it). |
| `visible()` | Whether the browser shows a window now. |
| `setVisible(visible)` | Shows the browser (relaunching it with a window, session kept) and follows the pages functions open, or hides it. |
| `show(url)` | While shown, brings a page of the site to the front of the window; never throws. |
| `tab()` | The one working tab a program drives itself, opening the browser if needed. |
| `openChannel()` | The channel of the open browser, or `undefined`. |
| `chromiumDownload()` | `"downloading"`, `"failed"` or `undefined`. |

Calls on the manager run one at a time: a launch and a relaunch never overlap on the profile.

## Choosing a browser

Without a `channel`, the manager tries Edge, then Chrome, then (only with `downloadBrowser: true`) Playwright's Chromium. When none is installed and downloading isn't allowed, it throws `BrowserNotFoundError`. With downloading allowed, the first call starts the download in the background and throws `BrowserDownloadingError` at once; later calls throw it too until the download finishes (a few minutes), then launch Chromium. A failed download is retried on the next call, and `chromiumDownload()` reports `"failed"` meanwhile.

`channel: "firefox"` launches Playwright's own build of Firefox instead, never the system's Firefox (Playwright can't drive that one); it's only launched when chosen. It's downloaded on first use the same way when `downloadBrowser` is `true` (`chromiumDownload()` reports it too), and without it a missing Firefox throws `BrowserNotFoundError`. Firefox keeps its own kind of profile, so give it a `profileDir` of its own rather than one a Chromium-based browser used. A browser left open in the background (below) can't be Firefox: it's offered over Chromium's debugging protocol, and `hostBrowser` refuses it.

## Showing the browser

A person may want to watch what a program does, or step in (a page asks something only they can answer). `setVisible(true)` relaunches the browser with a window, keeping the session, and from then on the pages functions open are shown, one after another, in a single working tab of that window ("following"). A `Moodle` object's method that works through Moodle's AJAX services and opens no page of its own (`listCourses`, `courseStructure`, `discussion`, `gradeSubmission`, `editActivity`…) leaves in that tab, once it succeeds, the page that shows its work: the course page, the discussion, the grader at the participant graded. Showing it is a courtesy: it never fails or changes the call, and nothing is loaded for it while the browser is hidden. `FOLLOWED_PAGES` says which page each method shows, built from its arguments and result, for a program that calls the functions itself. `setVisible(false)` closes the window; the next call runs headless again. If the person closes the window themselves, the manager notices: the next call opens the browser again, headless.

On Linux a window needs `DISPLAY` or `WAYLAND_DISPLAY`; without them (a server, a container) asking for one throws `NoDisplayError` instead of trying. `canShowWindow()` tells in advance.

## The working tab

Some things can't be done through a function: playing an H5P activity, doing a SCORM package (`openScorm` opens its player here), a page the driver doesn't cover, something a person should see. `tab()` gives the browser's working tab, a Playwright `Page` the program drives as it likes, logged in. It's the same tab following uses while the browser is shown, so the person sees it.

```ts
const tab = await moodle.tab();
await tab.goto(`${moodle.site}mod/h5pactivity/view.php?id=38`);
// ...drive the H5P content in its iframes with Playwright...
```

Leave it open: the manager reuses it.

## A browser left open in the background

`moodle open` keeps a browser open on a profile for every command on it (see [the command line](../getting-started/command-line.md#watching-separate-commands-act)). A program can work in that browser too, instead of launching one on the same profile (which would fail: a profile is open in one browser at a time). `backgroundBrowser(profileDir)` reads where it is and its token from the profile's `.browser.json` (`undefined` when none runs, a stale file removed), and `connectBrowserManager()` gives a manager on it for `createMoodle`:

```ts
import { backgroundBrowser, connectBrowserManager, createMoodle, siteProfileDir } from "@falkenslab/moodle-driver";

const site = "https://campus.example.org/";
const profileDir = siteProfileDir(site);
const running = await backgroundBrowser(profileDir);
if (!running) throw new Error("Run `moodle open --show` first.");

const moodle = createMoodle({ site, browser: connectBrowserManager({ ...running, profileDir }) });
console.log(await moodle.listCourses());
await moodle.close(); // disconnects: the browser stays open
```

The connected manager works in the browser's own context, and `close()` saves the session and disconnects. It can't add or remove a window from a browser it didn't launch: with one, the pages functions open are followed in its first tab, and `setVisible(true)` on one without throws `NoDisplayError`. The browser takes one client at a time; another connecting meanwhile is refused. Nothing connects without the token in `.browser.json`, readable only by the person: Chromium's own debugging port, which has no such check, is never opened.

## The session on disk

The profile holds the browser's cookies and storage. Chromium drops session cookies (those without an expiry date, like Moodle's `MoodleSession`) when it closes, so the manager writes them to a file inside the profile (`SESSION_COOKIES_FILE`, readable only by the user) on `close()`, `saveSession()` and after logging in, and restores them on launch. Treat the whole profile folder as a secret.

## Several sites, several accounts

One profile can hold sessions on several sites at once: Moodle's session cookie (`MoodleSession`) belongs to the site's host and path, so sites on different hosts, or on different paths of one host (Moodle's default cookie path is the site's own), don't overwrite each other's. Two `Moodle` objects can then share one browser, `createMoodle({ site: other, browser: moodle.browser })`, the person logging in once on each site. The driver keeps one site's `sesskey` per browser at a time, so alternating sites in one browser reads the session page again at each switch (one request more), nothing else. Two accounts on the same site share that cookie, so each needs a profile of its own (`siteProfileDir` names one per site and account for the `moodle` command). This comes from how the driver and Moodle keep sessions, not from a test on two sites.

## Timeouts

Navigations wait up to 60 seconds: the first pages after a site starts, or a save that makes Moodle regrade, can take long.
