# The H5P content types a site can run

Issue: [#92](https://github.com/falkenslab/moodle-driver/issues/92)

## Goal

A program can read which H5P content types a site can run, as a teacher sees them, before it builds a package that ships only its content.

## Context

- An H5P package without its libraries plays only where its main library is installed (downloaded by Moodle from h5p.org, or installed by an administrator).
- `h5pActivity` reads one activity and `contentBank` lists the content already uploaded (`src/areas/h5p/`), each item's library from its icon; nothing lists the types available.
- Which types a teacher can use shows in the content bank's "Add" menu (the types the H5P editor offers), without the administrator's libraries page.
- moodle-mcp needs it for a tool that lists the types (falkenslab/moodle-mcp#52); seeding the usual types on the sandbox is falkenslab/moodle-sandbox#6.

## Changes

- A read by course, from what a teacher already sees (the content bank's "Add" menu, or the H5P editor's content types where the menu doesn't carry them): each type's machine name (`H5P.MultiChoice`), version (`1.16`) and title, and whether the person may install new ones (`moodle/h5p:updatelibraries`).
- Moodle 4.5 and 5.x, Boost and Classic.
- A `moodle` command (`npm run cli:generate`), doc comments, the H5P guide in both languages, data categories.
- Fake-Moodle tests for each shape, and sandbox checks on both series once the sandbox has the types (moodle-sandbox#6).

## Acceptance

- On the 5.2 and 4.5 sandboxes: the list matches the content types the content bank offers to add, with versions.
- A site with no H5P libraries installed gives an empty list, not an error; a student who can't use the content bank is refused with a clear error.
