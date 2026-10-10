# The browser

`createMoodle()` makes a `BrowserManager` from its options (it's `moodle.browser`), or takes yours; `createBrowserManager(options)` makes one on its own. It's the one persistent browser your program works Moodle with. It launches nothing until it's needed, keeps the browser open between calls, and closes it on `close()`.

## Options

```ts
interface BrowserOptions {
  /** The persistent profile folder where the person logs in. */
  profileDir: string;
  /** One channel, or undefined for Edge, then Chrome, then (with downloadBrowser) Chromium. */
  channel?: "msedge" | "chrome" | "chromium";
  /** Without a window, unless one is asked for (logging in) or shown on demand. */
  headless: boolean;
  /** Download Playwright's Chromium when no installed browser works. */
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

## Showing the browser

A person may want to watch what a program does, or step in (a page asks something only they can answer). `setVisible(true)` relaunches the browser with a window, keeping the session, and from then on the pages functions open are shown, one after another, in a single working tab of that window ("following"). `setVisible(false)` closes the window; the next call runs headless again. If the person closes the window themselves, the manager notices: the next call opens the browser again, headless.

On Linux a window needs `DISPLAY` or `WAYLAND_DISPLAY`; without them (a server, a container) asking for one throws `NoDisplayError` instead of trying. `canShowWindow()` tells in advance.

## The working tab

Some things can't be done through a function: playing an H5P activity, a page the driver doesn't cover, something a person should see. `tab()` gives the browser's working tab, a Playwright `Page` the program drives as it likes, logged in. It's the same tab following uses while the browser is shown, so the person sees it.

```ts
const tab = await moodle.tab();
await tab.goto(`${moodle.site}mod/h5pactivity/view.php?id=38`);
// ...drive the H5P content in its iframes with Playwright...
```

Leave it open: the manager reuses it.

## The session on disk

The profile holds the browser's cookies and storage. Chromium drops session cookies (those without an expiry date, like Moodle's `MoodleSession`) when it closes, so the manager writes them to a file inside the profile (`SESSION_COOKIES_FILE`, readable only by the user) on `close()`, `saveSession()` and after logging in, and restores them on launch. Treat the whole profile folder as a secret.

## Timeouts

Navigations wait up to 60 seconds: the first pages after a site starts, or a save that makes Moodle regrade, can take long.
