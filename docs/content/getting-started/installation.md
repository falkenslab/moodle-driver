# Installation

The driver is a Node.js library with one peer dependency, `playwright-core`, which drives the browser.

## Requirements

- Node.js 20 or later.
- A Moodle site the person can log in to, Moodle 4.x or 5.x (developed and checked against 5.2; see [Compatibility](../reference/compatibility.md)).
- A browser: Microsoft Edge or Google Chrome installed on the system, or permission to download Playwright's Chromium (about 180 MB) the first time.
- A screen, the first time, so the person can log in by hand in a browser window. After that the driver runs headless, also on servers and in containers.

## Install

The package isn't on npm yet: install it from a GitHub release or from a clone. Each [release](https://github.com/falkenslab/moodle-driver/releases) carries the package, built, as a `.tgz`:

```bash
npm install https://github.com/falkenslab/moodle-driver/releases/download/v0.3.1/falkenslab-moodle-driver-0.3.1.tgz playwright-core
```

Or from a clone, to follow `main` or change the driver:

```bash
# From a clone, next to your program's folder
git clone https://github.com/falkenslab/moodle-driver.git
cd moodle-driver && npm install && npm run build
```

```json
{
  "dependencies": {
    "@falkenslab/moodle-driver": "file:../moodle-driver",
    "playwright-core": "^1.64.0"
  }
}
```

`npm install` builds the library (`prepare` runs `npm run build`), so a `file:` dependency works as is. After changing the driver's sources, run `npm run build` in it again before your program sees the change.

Once it's published on npm:

```bash
npm install @falkenslab/moodle-driver playwright-core
```

## The browser

The driver uses `playwright-core`, which brings no browser of its own. It looks for one in this order:

1. Microsoft Edge (`msedge`), installed on most Windows computers.
2. Google Chrome (`chrome`).
3. Playwright's Chromium (`chromium`), downloaded on first use when `downloadBrowser` is `true`.

You can force one with the `channel` option of `createBrowserManager`. While Chromium downloads, calls fail at once with `BrowserDownloadingError` (the download goes on in the background); try again a minute or two later. `chromiumDownload()` on the browser manager says whether it's downloading or failed. See [The browser](../concepts/browser.md).

Chromium goes where Playwright keeps its browsers: `PLAYWRIGHT_BROWSERS_PATH` when set, else the user's `ms-playwright` cache.

## Two entry points

| Import | What it has |
| --- | --- |
| `@falkenslab/moodle-driver` | The library: the browser manager, logging in, every Moodle area, errors, data categories |
| `@falkenslab/moodle-driver/testing` | Helpers to test a program that uses the driver without a real Moodle: a fake Moodle served inside a browser context, a browser manager that launches nothing |

Both are ESM with TypeScript declarations.

## Next

[Log in](logging-in.md) once, then write [your first program](first-program.md).
