---
name: upgrade-playwright
description: Upgrade playwright-core in moodle-driver (peer and dev dependency, the Docker test image) and re-validate the Playwright behaviors the driver depends on. Use when the user asks to bump Playwright, or when investigating a browser behavior change after an update.
---

# Upgrading Playwright

The driver relies on Playwright behaviors that aren't all documented (the persistent context on the system's browser, cookies, `page.evaluate` under tsx). A new version can change any of them, and the Docker image the tests run in is pinned to a Playwright version, so an upgrade is more than `npm update`.

## 1. Upgrade

```
npm outdated playwright-core
npm install -D playwright-core@<version>
```

Then, to the same version:
- `peerDependencies` in `package.json`: `^<version>` (a program brings its own `playwright-core`; a narrower range is a breaking change for consumers).
- The image in `scripts/in-docker.mjs` (`mcr.microsoft.com/playwright:v<version>-noble`) and in `.minispec/core/stack.md`. The image's browsers must match `playwright-core`'s, or Chromium won't launch in the container.
- moodle-mcp's `playwright-core` and its own Docker image, if it has one: tell the user; change them only if asked.

Read Playwright's release notes for the versions skipped, looking for changes to `launchPersistentContext`, `channel`, cookies, `page.evaluate`, downloads and file choosers, and the browsers' minimum versions.

## 2. Run the gate

Run the `verify` skill. Type errors and failing tests are the first signs of a changed contract.

## 3. Re-validate the behaviors the driver relies on

Check each against the new version and, where possible, by running it (in Docker, never on the desktop). Do not claim one still holds without evidence.

- The persistent context opens on the system's Edge or Chrome by `channel`, and falls back to downloading Chromium through Playwright's CLI when there's none (ADR-001, `src/chromiumInstaller.ts`: the CLI's path and arguments, its process tree ending with the program).
- Session cookies (no expiry) are lost when the persistent context closes, and are saved and restored by `src/sessionCookies.ts` (ADR-003): `context.cookies()` and `addCookies()` keep their shape.
- Relaunching headed from headless on the same profile, and showing or hiding the window on demand (ADR-007).
- Under tsx, named functions inside `page.evaluate` still get wrapped in `__name`, so `inPage()` is still needed (`src/moodle/inPage.ts`). If that changed, keep `inPage()` anyway and note the version in its comment.
- Draft-area uploads and downloads with the session (`src/moodle/forms.ts`, `src/moodle/files.ts`).

If a behavior changed, adapt the code and its comment (update the "confirmed empirically" note with the version it was re-confirmed on, or remove it if no longer true), and add a test when the fake Moodle can reproduce it.

## 4. Record it

Commit with the `commit` skill (`build(deps): bump playwright-core to <version>` for a plain bump, `fix`/`refactor` for code that had to adapt). A raised minimum in `peerDependencies` or a changed behavior goes in the next release notes, as breaking if a consumer must act.
