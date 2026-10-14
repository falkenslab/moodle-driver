# The moodle command's tables fit the terminal and show what lists hold

Issue: [#60](https://github.com/falkenslab/moodle-driver/issues/60)

## Goal

A table the `moodle` command prints reads well at the terminal it's printed in: it fits the width, and a field that is a list of objects says what it holds instead of `[1]`.

## Context

- `src/cli/output.ts` prints a list of objects as a table with every field as a column, each cell cut at `MAX_CELL`, and doesn't look at the terminal's width: `moodle list-courses` (ten columns, URLs, dates) and `moodle assignment-submissions 35` wrap every row over two lines at 104 columns, which makes them hard to read (seen making the README's screenshot, 14 October 2026).
- A field that is a list of scalars prints them joined; a list of objects prints only its length (`participants`' `roles` and `groups` show `[1]`), and an object prints as JSON (`deadlines`' `course` shows `{"id":3,"shortname":"mcp-content"}`).
- `--json` gives the whole data and stays as it is; the table is for a person.

## Changes

- At a terminal (`process.stdout.columns`), a table that doesn't fit leaves out columns, from the least useful, until it fits, and says which it left out and that `--json` has them (one line under the table). Which columns matter most: the ids and names first (`id`, `userId`, `activityId`, a field named `name`, `fullName`, `fullname`, `title`), then the order the data has; long text and URLs go first. Not at a terminal (piped), the table stays whole.
- A list of objects shows each item's name (`name`, `shortname`, `fullName`, `title`, else its `id`), joined: `roles` shows `student`, `groups` shows `Group A`. An object shows its name the same way, else its JSON as now.
- Dates keep their ISO form but drop the milliseconds and `Z` when the cell is narrow (`2026-10-22 23:00`), stating the time zone once under the table (UTC).
- Tests in `test/cli/` for each rule (a wide table at 80 columns, piped output unchanged, lists and objects of objects); the command line guide says how tables are cut and that `--json` has everything (both languages).

## Acceptance

- At 80 columns, `moodle list-courses`, `moodle assignment-submissions <id>` and `moodle deadlines` print one line per row, with the ids and names, and a note of the columns left out.
- `moodle participants <course>` shows role and group names; piped (`| cat`) every table prints all its columns as before.
