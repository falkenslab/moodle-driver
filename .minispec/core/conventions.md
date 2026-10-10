# Conventions

- Everything in English: code, comments, `README.md`, `CLAUDE.md`, `.minispec/`, error messages, commit messages (ADR-008).
- Commits follow Conventional Commits, one logical change each.
- ESM TypeScript; relative imports inside `src/` use explicit `.js` extensions (NodeNext).
- The public API is what `src/index.ts` exports; test helpers are what `src/testing/index.ts` exports (`@falkenslab/moodle-driver/testing`). Everything else is internal.
- Functions take the browser context and the site URL first, then the ids, then an options object (as `Moodle` methods, without the first two, ADR-009); they return plain data (ISO dates, decoded texts), never Playwright objects.
- Errors a program can act on have their own class (`NotLoggedInError`, `NotAForumError`…) and a message in Moodle's terms: the module, the course structure, logging in again; never a consumer's tool or setting.
- Every public function declares the data it reads or writes (own, course content, others' personal data, writing about others, communication, aggregates, any) in `src/categories.ts`, a test enforcing it (the `data-categories` card; consumers such as moodle-mcp restrict agents with it).
- The library never prints (`no-console`): a program's stdout may be a protocol.
- Every function that reads a site page opens it with `openSitePage()`, so a missing session is always `NotLoggedInError`.
- Page code that needs helper functions runs through `inPage()` (`src/core/inPage.ts`): under tsx (the tests) named functions get wrapped in a `__name` helper the page doesn't have. Plain `page.evaluate()` callbacks keep to anonymous callbacks and loops.
- Options are plain values (`BrowserOptions`, `Trail`), read when used: the driver reads no environment variables or arguments.
- Tests mirror `src/` under `test/`, against the fake Moodle in `src/testing/`; a bug fixed gets a regression test. Test files run one at a time: each launches a real browser. Anything that launches a browser runs in Docker (`npm run test:docker`, `scripts/in-docker.mjs`), never on the developer's desktop (asked by the owner, 9 October 2026).
- Every export has a doc comment (the site's API reference is generated from them); doc comments explain *why*, and mark Moodle or Playwright behavior verified by hand as "confirmed empirically" (with the Moodle version).
- Documentation Markdown: one line per paragraph and list item, no horizontal rules between sections.
