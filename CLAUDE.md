# CLAUDE.md

## MiniSpec (read first)

Before writing any code, read `.minispec/README.md` and follow its reading
contract. As a minimum, always read `.minispec/core/project.md`,
`.minispec/core/conventions.md` and `.minispec/core/principles.md`; read the
rest of `.minispec/` only on demand (architecture, stack, glossary, the relevant
feature or ADR). Keep features small and don't write redundant documentation.

## Commands

- `npm run typecheck`, `npm run lint`, `npm run build` (dist/ with declarations).
- `npm run test:docker` — every test, in Docker: they open browsers, which must never run on the developer's desktop.
- `npm run test:sandbox [files]` — the regression suite against the Moodle sandbox (`test/sandbox/`), before a release; course 3 is only read, course 2 never touched.
- `MSYS_NO_PATHCONV=1 node scripts/in-docker.mjs npx tsx --test test/areas/quizzes/attempts.test.ts` — one file (Git Bash on Windows needs `MSYS_NO_PATHCONV=1`).
- `npm run docs:install` once, then `npm run docs:build` (the documentation site in `docs/`, Docusaurus; fails on a broken link) or `npm run docs:start`.
- `npm run cli:generate` — regenerates the `moodle` command's table and its reference page after an API change (`npm run build` refuses a stale one).
- `npm run docs:check` — every program in the guides compiles against `src/` (fence a partial one as ` ```ts fragment `).

## Things easy to get wrong

- Nothing of moodle-mcp or MCP here: no tool names, no `MOODLE_MCP_*` settings in code or messages (ADR-006). moodle-mcp explains the driver's errors in its own terms.
- moodle-mcp uses this repository from `file:../moodle-driver` and bundles `dist/`: after changing `src/`, run `npm run build` before testing moodle-mcp.
- Page code with helper functions goes through `inPage()`; tsx's keepNames breaks named functions inside `page.evaluate`.
