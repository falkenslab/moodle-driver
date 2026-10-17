# Groups: create them automatically

Issue: [#76](https://github.com/falkenslab/moodle-driver/issues/76)

## Goal

A teacher splits a course's participants into groups at once, as Moodle's auto-create does.

## Context

- `src/areas/participants/groups.ts` creates groups and groupings one by one (`createGroup`, `createGrouping`, `setGroupMembers`, `setGroupingGroups`); nothing creates several at once.
- Moodle, to confirm on the sandbox: `group/autogroup.php?courseid=` (its preview button shows the groups and members before creating), and `group/import.php` for a CSV of groups.
- moodle-mcp needs it.

## Changes

- `autoCreateGroups(courseId, { by: "groups" | "members", count, roleId?, cohortId?, groupingId?, allocation: "random" | "firstname" | "lastname" | "idnumber" | "none", naming, newGrouping?, preview? })`: with `preview` the groups and their members Moodle would create, nothing written; otherwise the groups created, their ids and members, and the grouping's id.
- Optional, as the issue says: `importGroups(courseId, file)` from a CSV; a choice to settle on the sandbox.
- Errors naming a missing capability (`moodle/course:managegroups`) and options the form refuses (no one to allocate, a naming scheme without `#` or `@`).
- Data categories: `others-personal` and `others-write`, as `setGroupMembers`.
- Docs in the participants page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a scratch course's students split into two groups in a new grouping, previewed first, then created and read back with `groups`.
