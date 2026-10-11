# ADR-014: A background browser, behind a token

## Decision

`moodle open` starts a process of its own (`moodle __background`, detached) that launches the browser on the profile with its debugging connection on a pipe only that process holds (`--remote-debugging-pipe`), never on a port. The process offers it as a WebSocket on 127.0.0.1, on a free port, that speaks Chrome's debugging protocol (so `chromium.connectOverCDP` works) and accepts a connection only with `Authorization: Bearer <token>`: 32 random bytes, written with the endpoint and its pid in the profile's `.browser.json`, readable only by the person (0600). Every command, `moodle shell` and a program (`backgroundBrowser`, `connectBrowserManager`) connects there when the file names a process that answers; otherwise it launches its own browser, as before. `moodle close` asks the process (with the token) to save the session and close. Decided for issue #25, 11 October 2026.

## Motivation

Chrome's debugging port (`--remote-debugging-port`) has no authentication: any program on the machine, any other user on a shared machine, and a web page that reaches it (DNS rebinding) could drive a browser logged in to Moodle as the person. There's no flag to require a token, so the port can't be opened at all; a pipe is reachable only by the process that launched the browser, and the token check goes in front of it, in a small proxy of our own (no dependency: a minimal WebSocket server on `node:http`). The proxy also refuses any request with an `Origin` header (a web page always sends one) and any `Host` but `127.0.0.1:<port>`. Playwright can't hand a persistent context to another process (`launchServer` takes no profile), so the process launches the browser itself, with the executable and switches Playwright uses for that channel (read from a `launchServer` it closes at once).

## Consequences

- One client at a time: the proxy refuses a second connection (409), and the command takes a lock (`.browser.lock`, its pid) next to `.browser.json`, waiting 5 s before saying another command is running. Each client numbers its commands from 1: the proxy renumbers them, and when a client leaves it detaches its sessions and stops auto-attaching, so the next starts clean. A client's `Browser.close` only disconnects it.
- `moodle shell` connects for each line and disconnects after it, so commands from elsewhere get their turn.
- The session cookies are saved after every client and when it closes (ADR-003); closing the window ends the process and its file.
- The window can't be added or removed from a connected browser (ADR-007): `setVisible(true)` on one opened without a window throws `NoDisplayError`; with one, the pages commands open are followed in its first tab.
- A stale `.browser.json` (its process gone, or its port refusing) is removed by whoever finds it. The token gives the same power as the profile itself: whoever can read the profile's files can read both.
- The proxy speaks the protocol Playwright's `connectOverCDP` uses today; a Playwright upgrade re-checks it (`test/browser/host.test.ts`).
