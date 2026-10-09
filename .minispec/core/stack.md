# Stack

## Runtime

- Node.js ≥ 20, ESM, TypeScript with `NodeNext` resolution.
- `playwright-core` (peer dependency) — browser automation with the system's Edge or Chrome, no bundled browsers (ADR-001).
- No other runtime dependency.

## Tooling

- `tsc` builds `dist/` with declarations (`tsconfig.build.json`); `prepare` builds on install, so a `file:` dependency works.
- Tests: `node:test` + `node:assert/strict`, run with `tsx --test` against the source, in Docker (`mcr.microsoft.com/playwright:v1.64.0-noble`) on the Moodle sandbox's network.
- ESLint with `typescript-eslint`.

## Distribution

npm package `@falkenslab/moodle-driver` with two entry points: the library and `/testing`. Not published yet: moodle-mcp uses it from the sibling folder.
