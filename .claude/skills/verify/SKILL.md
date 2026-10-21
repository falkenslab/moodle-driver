---
name: verify
description: Run the full quality gate for moodle-driver (typecheck, lint, the tests in Docker, build, moodle-mcp typechecked against the new dist/, and the documentation site) and report the result. Use before committing, before a release, and after any change under src/, test/, scripts/ or docs/.
---

# Verify moodle-driver

Run from the repo root, in this order, stopping at the first failure and reporting it:

```
npm run typecheck
npm run lint
npm run test:docker
npm run build
node scripts/check-consumer.mjs ../moodle-mcp
npm run docs:check
npm run docs:build
```

Notes:
- The tests open real browsers: run them **only** through `npm run test:docker` (`scripts/in-docker.mjs`), never `npm test` on the developer's desktop. Docker must be running; if it isn't, stop and say so instead of falling back to `npm test`.
- One file at a time while iterating: `MSYS_NO_PATHCONV=1 node scripts/in-docker.mjs npx tsx --test test/areas/quizzes/attempts.test.ts` (Git Bash on Windows needs `MSYS_NO_PATHCONV=1`). The gate always runs the whole suite.
- The tests run against the fake Moodle in `src/testing/`, so the Moodle sandbox isn't needed; when it's running, the container joins its network, which only checks against a real Moodle use.
- The test run must report `fail 0`. Quote the pass/fail counts in your report.
- `dist/` is gitignored and `tsc` never deletes stale output. If files were moved or removed under `src/`, run `rm -rf dist` before `npm run build`, otherwise orphaned `.js`/`.d.ts` files linger and hide broken imports.
- moodle-mcp (the sibling folder) depends on the driver published on npm, so its own `npm run typecheck` checks the released version, not this change. `scripts/check-consumer.mjs` typechecks it against the `dist/` just built instead, through a temporary tsconfig that extends its own (nothing in its folder changes). Run it whenever something exported from `src/index.ts`, `src/internals.ts` or `src/testing/index.ts` changed; skip it (and say so) when `../moodle-mcp` doesn't exist or the change touches no export. A failure there is a breaking change for consumers: report it, don't fix moodle-mcp from this repo unless the user asks.
- `npm run docs:check` compiles every program in the guides (` ```ts ` blocks that await or use `moodle.`) against `src/`, and points each error at its Markdown line; a piece of a program is fenced ` ```ts fragment ` to be skipped. Run it whenever `docs/` or anything exported changed.
- `npm run docs:build` builds the site (`docs/`, Docusaurus) and fails on a broken link or anchor; its API reference is generated from `src/`'s doc comments, so it also catches one that breaks the site. If `docs/node_modules` is missing, run `npm run docs:install` first. Run it whenever `docs/` or anything exported changed; skip it (and say so) otherwise.
- Never "fix" a failure by weakening a rule, skipping a test, adding `any` or running the tests outside Docker. Find the cause; if the fix is out of scope, report it instead.

Report only: what ran, pass/fail per step, and the exact error for any failure.
