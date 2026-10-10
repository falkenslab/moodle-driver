# The moodle command

Issue: [#22](https://github.com/falkenslab/moodle-driver/issues/22)

## Goal

A `moodle` command, in the same package, that offers the whole API of the Moodle object from a terminal, without writing a program.

## Context

- The driver is only a library: using it means a Node project and a script. People want to try it, script it from a shell or debug a site from a terminal.
- Decided with the owner (10 October 2026): the command lives in this package (`src/cli/`), not in a separate one, because it adds no dependencies; installing the library also links the command in `node_modules/.bin` (`npx moodle …` in a project), and `npm i -g @falkenslab/moodle-driver` gives it everywhere.
- The command is named `moodle`. The npm package `moodle-cli` (another author) also installs a `moodle` command: with both installed globally, npm refuses the second unless forced. Accepted by the owner.
- The library prints nothing and reads no environment (conventions, ADR-006); the command is a program on top of it, so it may do both.

## Changes

- `src/cli/` with its entry point `dist/cli.js` (shebang), `"bin": { "moodle": "dist/cli.js" }`; only Node's own modules (`node:util` `parseArgs`, `node:readline`), no new dependency. Not exported from the library.
- Every method of the Moodle object is a command: the bound functions (`MOODLE_METHODS`) and the object's own (`logIn`, `logOut`, `publicSiteInfo`, `callService`, `setVisible`…), as `moodle <method> [args] [--options]`, in camelCase and kebab-case (`moodle listCourses`, `moodle list-courses`).
- A table of each method's parameters (names, types, which are options, the description from its doc comment), generated from the TypeScript sources at build time; a test fails when a method of the object has no command.
- Arguments: positional ids as numbers, an options object from `--name value` flags (booleans, numbers, dates, lists), or the whole object as `--json '{…}'`; files and folders as paths.
- Site and profile: `moodle login --site URL` saves them in a config file (`~/.config/moodle-driver/config.json`, one profile folder per site); `--site`/`--profile` flags and `MOODLE_SITE`/`MOODLE_PROFILE` override it. `--show` shows the browser while it works.
- Output: readable tables and key-value lists at a terminal, `--json` for scripts (`| jq`); `changed` printed for writes; errors as `code: message` with a non-zero exit status (2 for usage errors).
- `moodle help`, `moodle <method> --help` (parameters, options, description, data categories), `moodle --version`.
- `--allow <categories>` refuses commands outside those data categories, from `DATA_CATEGORIES`.
- An ADR for the command inside the package; conventions: the command may print and read its environment, the library still doesn't (ESLint's `no-console` off in `src/cli/` only).
- Tests in Docker against the fake Moodle: parsing, the generated table covering every method, a read, a write, `--json`, errors and exit codes, `--allow`.
- Docs: a "Command line" guide (install, log in, examples, every command from the table), a section in the README, the examples linking to it.

## Acceptance

- `npm i -g` (or `npm link`) gives `moodle`; `moodle --help` lists every method of the Moodle object, and each one runs with its arguments and options.
- `moodle login` opens the window once; later commands reuse the saved site and session.
- `--json` prints exactly what the method returns; errors exit non-zero with their code.
- No new runtime dependency; the library's exports and behavior don't change.
