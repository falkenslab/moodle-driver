---
name: add-export
description: Checklist for adding or changing anything in moodle-driver's public API (a function for a Moodle area, an option, an error class, a type, a test helper) - where the code goes, how to read Moodle, how to export it, what to test and which docs to update. Use when adding something a program using the driver will call.
---

# Adding to moodle-driver's public API

Read `.minispec/core/architecture.md` first if you don't know where the area lives, and the feature card in `.minispec/features/` if the work comes from one.

## 1. Decide where the code lives

- `src/areas/<area>/`: one folder per Moodle area (quizzes, forums, assignments…), a file per part of it. Each area keeps its selectors to itself; shared helpers go in `src/core/` (`ajax.ts`, `session.ts`, `forms.ts`, `text.ts`, `inPage.ts`) only when two areas really need them.
- `src/browser/manager.ts`, `src/options.ts`, `src/browser/cookies.ts`: the browser and what a program chooses. A new option is a plain value in `BrowserOptions` or the function's options object; the driver never reads environment variables or arguments.
- `src/testing/`: the fake Moodle and helpers other programs' tests use (`@falkenslab/moodle-driver/testing`).
- Stay generic: nothing of MCP, agents, moodle-mcp's tools or `MOODLE_MCP_*` settings, in code, comments or messages (ADR-006). If a consumer needs a behavior, it's an option or a return value, not knowledge of that consumer.

## 2. Implement

- Signature: the browser context and the site URL first, then the ids, then an options object. Return plain data (ISO dates, decoded texts), never Playwright objects.
- Services before pages (ADR-004): look for the AJAX service Moodle's own page calls (`callService()`), and read pages or forms only where none helps. Reading first: a write function comes only after the reads it relies on.
- Every page the function reads is opened with `openSitePage()`, so a missing session is always `NotLoggedInError`.
- Selectors: prefer ids, data attributes, body ids and URLs over visible texts (the site's language changes them). When the page isn't what's expected, fail with a clear message.
- Page code with helper functions goes through `inPage()`; plain `page.evaluate()` callbacks stay anonymous (tsx's keepNames breaks named functions inside the page).
- Errors a program can act on get their own subclass of `MoodleDriverError` (`NotAForumError`…) with its code added to `MoodleErrorCode` and a message in Moodle's terms: the module, the course structure, logging in again. Anything else is a `MoodleDriverError` with a generic code, never a plain `Error`.
- No `console.*`: a program's stdout may be a protocol. No password ever typed, stored or asked for (ADR-002).
- Relative imports inside `src/` use explicit `.js` extensions (NodeNext).
- Prefer optional parameters with the previous behavior as default, so existing consumers do not break.
- Doc comment that explains *why*. Write "confirmed empirically" (with the Moodle version) only for behavior you actually checked against a real Moodle (the sandbox), not the fake one.

## 3. Export

Add the symbol to `src/index.ts` (the public API), or to `src/testing/index.ts` for test helpers. Consumers must never need deep imports. Helpers exported from a module only so tests can reach them are deliberately **not** re-exported. An operation taking `(context, siteUrl, …)` also goes into `SITE_FUNCTIONS` in `src/client.ts`, so the `Moodle` object has it as a method (ADR-009; a piece other operations are built from stays a function only, and one that uses the object's defaults is bound by hand there); declare its data categories in `src/categories.ts`.

## 4. Test

Add or extend a test under `test/` mirroring the `src/` path (`test/areas/<area>/<file>.test.ts`), with `node:test` + `node:assert/strict`, against the fake Moodle in `src/testing/` (extend it with the pages or services the area needs). A bug fixed gets a regression test. Run it in Docker only: `MSYS_NO_PATHCONV=1 node scripts/in-docker.mjs npx tsx --test test/areas/<area>/<file>.test.ts`. What the fake can't reproduce (Moodle versions, real HTML), say so rather than claiming it works.

## 5. Docs

Run the `update-docs` skill: the doc comment on every export (the API reference is generated from it), the area's page in `docs/content/areas/`, `README.md` if the list of areas or the use changed, `.minispec/core/architecture.md` if a piece was added, an ADR if a decision was taken.

## 6. Finish

Run the `verify` skill (it rebuilds `dist/` and typechecks moodle-mcp against it). If the change breaks existing callers, mark the commit as breaking (`!`) and see the `commit` and `release` skills. Remind the user that moodle-mcp needs `npm run build` here before it sees the change.
