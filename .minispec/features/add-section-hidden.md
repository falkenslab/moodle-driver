# addSection: create a section hidden

Issue: [#105](https://github.com/falkenslab/moodle-driver/issues/105)

## Goal

A program can add a section that students never see until it's shown.

## Context

- `addSection` (`src/areas/activities/build.ts`) adds a section visible to students; hiding it takes a second call (`editSection` with `visible: false`), so a course that publishes everything hidden first shows each new section for a moment.
- Asked from moodle-mcp (falkenslab/moodle-mcp#63).

## Changes

- A `visible` option on `addSection`, default as today.
- Check whether Moodle can create the section hidden in the same request (the course editor's own action or a setting); if so use it, otherwise hide it right after adding it, and say in the doc comment that it may be visible for that moment.
- Doc comment, the activities page in both languages, `npm run cli:generate`.

## Acceptance

- With `visible: false`, the course structure shows the new section hidden after the call, in Docker and on the sandbox, on Moodle 4.5 and 5.x.
- Without the option, nothing changes.
