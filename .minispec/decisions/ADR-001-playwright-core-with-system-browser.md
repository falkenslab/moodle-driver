# ADR-001: playwright-core with the system's browser

## Decision

The driver uses `playwright-core` (a peer dependency), not `playwright`, and launches the browser already installed on the machine (`channel: "msedge"` or `"chrome"`). When neither is found and the program allows it (`downloadBrowser`), it downloads Chromium with `playwright-core`'s own installer, into `PLAYWRIGHT_BROWSERS_PATH` when set. Moved from moodle-mcp's ADR-001 when the driver was extracted (9 October 2026).

## Motivation

`playwright` downloads browsers in a `postinstall` script, and programs installed by tools that never run install scripts (agent-kit's plugins) would have none. `playwright-core` has no install script. Edge ships with Windows and Chrome is on most machines, so using them avoids a ~150 MB download in the common case.

## Consequences

- Requirements: Node plus Edge or Chrome, or an internet connection for the first launch. By default the driver tries Edge, then Chrome, then the downloaded Chromium; a program may choose one channel.
- The browser's version is whatever the machine has; Playwright supports the current stable channels.
- With no system browser, the first launch starts `playwright-core`'s CLI (`install chromium --no-shell --no-remove`) in the background, its output on stderr, as a process tree that ends with the program: `--no-shell` because full Chromium also runs headless (channel `chromium`), `--no-remove` because the browser cache is shared with other Playwright installations. Calls meanwhile fail at once with `BrowserDownloadingError`, since a download (about 45 s for 180 MB, confirmed empirically) can outlast a caller's patience. On Linux, Chromium may still need system libraries that only `install-deps` (root) adds; the driver doesn't run it.
- Firefox (`channel: "firefox"`, added 18 October 2026) is Playwright's own build, launched with its `firefox` browser type: Playwright can't drive the system's Firefox. It's never in the default order, only chosen, and is downloaded the same way (`install firefox --no-remove`). It keeps a Firefox profile, so it needs a profile folder of its own, and it can't be the background browser (ADR-014), which speaks Chromium's debugging protocol.
