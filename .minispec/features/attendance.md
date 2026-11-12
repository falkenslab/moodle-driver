# Attendance: sessions, taking attendance and its report

Issue: [#103](https://github.com/falkenslab/moodle-driver/issues/103)

## Goal

A program can fill an Attendance activity (mod_attendance): add its sessions, take attendance and read the report.

## Context

- The driver can create an Attendance activity, but nothing in it: sessions, taking attendance and the report are done by hand in Moodle.
- A teacher who applies a rule on unjustified absences needs the sessions and each participant's counts.
- moodle-sandbox's image has mod_attendance installed. Asked from moodle-mcp (falkenslab/moodle-mcp#60).

## Changes

- Add sessions: one, or repeated weekly on given days and times between two dates, with a description and an optional group, through the plugin's add session form.
- List the sessions, edit one, delete one.
- Take attendance for a session: one status per participant, from the activity's own status set (read, not assumed).
- Read the report: each participant's count and percentage per status.
- A new area `src/areas/attendance/`, its doc comments, the area's page in both languages (ADR-015), `npm run cli:generate`.

## Acceptance

- Tests in Docker against a fake attendance plugin, and on the sandbox: weekly sessions added between two dates appear in the session list; attendance taken shows in the report with the expected counts and percentages.
- A status not in the activity's set is refused before anything is saved.
