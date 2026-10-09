# ADR-002: Manual login on a persistent profile

## Decision

The driver never types a password. `logIn()` opens a visible browser at the site and waits for the person to log in; the session lives in a persistent browser profile (`launchPersistentContext`) whose folder the program gives (`BrowserOptions.profileDir`). Moved from moodle-mcp's ADR-002 when the driver was extracted (9 October 2026).

## Motivation

Credentials in a program end up in configuration files, logs and, with agents, transcripts a model can read. Institutional Moodles often log in through SSO, with two-factor authentication or captchas that a script can't pass anyway. A persistent profile keeps the session (cookies, SSO) between runs, as the person's own browser would.

## Consequences

- The first use, and every expired session, needs a person at a screen; functions detect a logged-out page and throw `NotLoggedInError`. Where there's no screen (Linux without `DISPLAY` or `WAYLAND_DISPLAY`), a window is refused with `NoDisplayError` instead of tried.
- The profile holds a live session: programs keep it outside their own folders, repositories and packages.
- Only one browser can open a profile at a time: the driver keeps a single context and reuses it, one operation at a time.
