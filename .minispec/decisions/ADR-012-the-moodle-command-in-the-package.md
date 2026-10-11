# ADR-012: The moodle command, in the package

## Decision

The package ships a `moodle` command (`src/cli/`, `"bin": { "moodle": "dist/cli/main.js" }`) that offers every method of the Moodle object from a terminal: `moodle <method> [arguments] [--options]`, in camelCase or kebab-case. Its command table (parameters, types, allowed values, doc comments) is generated from the driver's types by `scripts/generate-cli-commands.mjs`, which also writes the commands' reference page; a test fails when it's stale or misses a method. It uses only Node's own modules (decided with the owner, 10 October 2026).

## Motivation

People want to try the driver, script it from a shell or check something on their site without writing a program. In the same package it costs no dependency: installing the library only links the command in `node_modules/.bin` (`npx moodle …` in a project, handy to debug), and `npm i -g @falkenslab/moodle-driver` gives it everywhere. Generating the table keeps the command complete as the API grows, with no second list to maintain. A separate package (or a workspace) would add a release and a version to keep in step for no gain while the command needs nothing the library doesn't have.

## Consequences

- The npm package `moodle-cli` (another author) also installs a `moodle` command: with both installed globally npm refuses the second unless forced. Accepted by the owner.
- The command is a program on the library: it prints and reads its environment (`MOODLE_SITE`, `MOODLE_PROFILE`) and keeps its sites and profiles in its home (`~/.moodle-driver`, ADR-013); the library still does neither (ADR-006).
- Methods that give a browser tab (`openSitePage`, `openForm`) have no command: a tab means nothing once the command exits.
- A new method needs `npm run cli:generate`; `npm run build` checks the table first.
- Output is a table or key-value lines at a terminal, JSON otherwise (`--json`); exit status 0, 1 (an error, its code printed), 2 (a command line that doesn't fit).
