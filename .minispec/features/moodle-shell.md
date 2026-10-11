# moodle shell

Issue: [#24](https://github.com/falkenslab/moodle-driver/issues/24)

## Goal

An interactive session of the `moodle` command that keeps one browser open across commands, so a person types commands one after another and, with `--show`, watches each act in the window.

## Context

- Each `moodle …` is a process of its own: it opens the browser on the profile, works and closes it. With `--show` the window lives only while that command runs, and a profile can be open in one browser at a time, so the next command can't reuse the window (ADR-012, ADR-013).
- A program using the library keeps its browser for its lifetime, and `setVisible(true)` shows every call; Node's REPL with top-level `await` already does this by hand, but means writing JavaScript.
- A second way, a background browser separate commands connect to, is its own card, after this one: #25 (`background-browser.md`).

## Changes

- `moodle shell` (with the global options: `--site`, `--as`, `--profile`, `--show`, `--allow`, `--json`): one Moodle object for the session; a prompt (`moodle> `, naming the site and profile) reads command lines with `node:readline`, and each runs as `moodle <line>` would, on that object, without reopening the browser.
- Lines parsed like the command line (quotes, `--flags`, JSON arguments); `help`, `help <command>`, `exit`/`quit`, Ctrl+D to leave; Ctrl+C cancels the line, not the session.
- `show` and `hide` inside the session (`setVisible`); `--show` starts with the window open.
- An error prints its code and message and the session goes on; exit status 0 when left normally.
- Tab completion of command names and of a command's options; history kept in the command's home (`~/.moodle-driver/history`).
- `sites`, `forget` and `login` keep working inside; `login --as` or `use <site>` switch the session's site or profile by closing and opening the browser.
- `run(argv, deps)` and the shell share the parsing and output code; the session is testable with injected input and output, against the fake Moodle.
- Docs: a section of the command line guide; the commands reference mentions the shell.

## Acceptance

- In `moodle shell --show`, typing `list-courses` then `course-structure 3` uses one browser window that stays open and shows each page as it's opened.
- A failing command doesn't end the session; `exit` closes the browser and saves the session.
- Tests in Docker run a scripted session against the fake Moodle: several commands on one object, an error in between, help and exit.
