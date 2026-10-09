---
name: verify
description: Run the full quality gate for moodle-driver (typecheck, lint, the tests in Docker, build, and moodle-mcp's typecheck against the new dist/) and report the result. Use before committing, before a release, and after any change under src/, test/ or scripts/.
---

# Verify moodle-driver

Run from the repo root, in this order, stopping at the first failure and reporting it:

```
npm run typecheck
npm run lint
npm run test:docker
npm run build
(cd ../moodle-mcp && npm run typecheck)
```

Notes:
- The tests open real browsers: run them **only** through `npm run test:docker` (`scripts/in-docker.mjs`), never `npm test` on the developer's desktop. Docker must be running; if it isn't, stop and say so instead of falling back to `npm test`.
- One file at a time while iterating: `MSYS_NO_PATHCONV=1 node scripts/in-docker.mjs npx tsx --test test/moodle/quiz.test.ts` (Git Bash on Windows needs `MSYS_NO_PATHCONV=1`). The gate always runs the whole suite.
- The tests run against the fake Moodle in `src/testing/`, so the Moodle sandbox isn't needed; when it's running, the container joins its network, which only checks against a real Moodle use.
- The test run must report `fail 0`. Quote the pass/fail counts in your report.
- `dist/` is gitignored and `tsc` never deletes stale output. If files were moved or removed under `src/`, run `rm -rf dist` before `npm run build`, otherwise orphaned `.js`/`.d.ts` files linger and hide broken imports.
- moodle-mcp (the sibling folder) uses the driver from `file:../moodle-driver`, so its typecheck sees the `dist/` just built. Run it whenever something exported from `src/index.ts` or `src/testing/index.ts` changed; skip it (and say so) when `../moodle-mcp` doesn't exist or the change touches no export. A failure there is a breaking change for consumers: report it, don't fix moodle-mcp from this repo unless the user asks.
- Never "fix" a failure by weakening a rule, skipping a test, adding `any` or running the tests outside Docker. Find the cause; if the fix is out of scope, report it instead.

Report only: what ran, pass/fail per step, and the exact error for any failure.
