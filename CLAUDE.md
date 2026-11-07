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
- `npm run test:sandbox [files] [--moodle 4.5] [--grep <pattern>] [--browser firefox]` (or the **Sandbox suite** workflow on GitHub, or pushing a `sandbox-run/*` branch) — the regression suite against the Moodle sandbox (`test/sandbox/`), on demand (it takes hours, never part of a release); `--grep` runs only the tests whose name matches, `--browser firefox` runs it in Playwright's Firefox; course 3 is only read, course 2 never touched.
- `MSYS_NO_PATHCONV=1 node scripts/in-docker.mjs npx tsx --test test/areas/quizzes/attempts.test.ts` — one file (Git Bash on Windows needs `MSYS_NO_PATHCONV=1`).
- `npm run docs:install` once, then `npm run docs:build` (the documentation site in `docs/`, Docusaurus; fails on a broken link) or `npm run docs:start`.
- `npm run cli:generate` — regenerates the `moodle` command's table and its reference page after an API change (`npm run build` refuses a stale one).
- `npm run docs:check` — every program in the guides compiles against `src/` (fence a partial one as ` ```ts fragment `).

## Things easy to get wrong

- Nothing of moodle-mcp or MCP here: no tool names, no `MOODLE_MCP_*` settings in code or messages (ADR-006). moodle-mcp explains the driver's errors in its own terms.
- moodle-mcp depends on the version published on npm (`^X.Y.Z`), not on this folder: a change here reaches it only with a release. `node scripts/check-consumer.mjs ../moodle-mcp` typechecks it against this checkout's `dist/` (after `npm run build`) without touching it.
- Page code with helper functions goes through `inPage()`; tsx's keepNames breaks named functions inside `page.evaluate`.
- Every guide in `docs/content/` has a Spanish twin in `docs/i18n/es/docusaurus-plugin-content-docs/current/` (ADR-015): change both in the same commit, with the Spanish terms ADR-015 lists.

## This project in the falkenslab-dev skills

- **Gate** (`verify`), in this order: `npm run typecheck`, `npm run lint`, `npm run test:docker` (never `npm test` on the desktop; `fail 0`), `rm -rf dist && npm run build`, `node scripts/check-consumer.mjs ../moodle-mcp` (when an export of `src/index.ts`, `src/internals.ts` or `src/testing/index.ts` changed and `../moodle-mcp` exists; a failure there is a breaking change), `npm run docs:check`, `npm run docs:build`. The sandbox suite isn't part of it.
- **Commits** (`commit`): the scope is the Moodle area (`quizzes`, `forums`, `assignments`, `h5p`…) or the piece (`browser`, `ajax`, `forms`, `testing`, `sandbox`, `deps`, `minispec`, `release`). Breaking (`!`) includes anything that breaks moodle-mcp's typecheck. Check the diff for `console.*` in `src/` and for anything that handles a password (ADR-002): neither is allowed.
- **Docs** (`update-docs`): a Moodle function is documented on its area's page in `docs/content/areas/` (signature, options and defaults, what it returns, its errors, Moodle's behaviors, an example, its data categories). The API reference is generated from the doc comments of every export of the three entry points, so each needs one. The generated references (`api/`, `reference/commands.md`) aren't translated by hand: `npm run cli:generate` writes the commands page's Spanish copy.
- **Release** (`release`): the owner publishes, with `npm publish --otp=<code>`. `prepublishOnly` runs the Docker suite first (up to 25 minutes on a busy machine), so the code can expire; E404 means the npm token expired (`npm login`). The tarball holds `dist/` (with `index.d.ts`, `internals.d.ts`, `testing/index.d.ts`), `README.md`, `LICENSE` and `package.json`. npm can take minutes to show a new version: check again before reporting a failed publish. moodle-mcp's `^0.x` range doesn't take a new minor until its own session raises it.
