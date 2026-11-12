# Board: its columns

Issue: [#106](https://github.com/falkenslab/moodle-driver/issues/106)

## Goal

A program can read and set a Board activity's (mod_board) columns.

## Context

- A board is created with three default columns titled "Heading", and the driver can't rename, add or remove them, so a board meant for students goes live with "Heading / Heading / Heading".
- moodle-sandbox's image has mod_board installed. Asked from moodle-mcp (falkenslab/moodle-mcp#64).

## Changes

- Read a board's columns: name, colour, locked, and how many notes each has.
- Set the columns (names, and optionally colour and locked) when the board has no notes yet.
- Rename, add, remove or lock one column afterwards; removing one with notes refused unless asked.
- How the plugin saves columns (its AJAX services or its pages) is found on the sandbox first.
- A new area `src/areas/boards/`, doc comments, its page in both languages, `npm run cli:generate`.

## Acceptance

- On the sandbox, a new board's columns set and read back; a column with notes isn't removed without being asked.
- Tests in Docker against a fake board.
