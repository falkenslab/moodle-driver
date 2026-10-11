# SCORM activities

## Goal

Read a SCORM activity as the person sees it (attempts, grade, its SCOs and their status), open one in Moodle's player to do it, and create one from a package.

## Context

- The driver has nothing for SCORM: `createActivity` uploads `files` into a form field named `files`, and the SCORM form's is `packagefile`, so `type: "scorm"` with a package fails ("A scorm takes no files in its form").
- Tried from moodle-mcp on 11 October 2026, in the sandbox (Moodle 5.x, course 3, activity 43, a SCORM 1.2 package made for the test): a teacher uploaded it with moodle-mcp's browser fallback tools; a student entered the player, answered it and submitted it with the same tools, whose accessibility snapshot reads the player's and the SCO's frames (refs `f1e…`, `f2e…`); Moodle recorded "Grade for attempt 1: 100%". What was missing: knowing the attempts and the result without reading the page, and entering the player directly.
- A SCORM package is the teacher's own HTML and JavaScript: what happens inside it can't be a driver function. Moodle only stores what the package reports through the SCORM API (`cmi.core.lesson_status`, `cmi.core.score.raw`…).
- Services: `mod_scorm_get_scorms_by_courses`, `mod_scorm_get_scorm_attempt_count`, `mod_scorm_get_scorm_scoes`, `mod_scorm_get_scorm_user_data`, `mod_scorm_get_scorm_sco_tracks`, `mod_scorm_view_scorm`. The player: `mod/scorm/view.php`'s "Enter" form (with "Start a new attempt"), or `mod/scorm/player.php?a=…&scoid=…&currentorg=…&mode=normal`.

## Changes

- `scorm(context, siteUrl, activityId)`: name, description, SCORM version, attempts allowed and made, grading method, the grade reported and per attempt, and its SCOs (id, title) with the person's status per SCO (not attempted, incomplete, completed, passed, failed) and score. Categories `course-content` and `own`.
- `openScorm(context, siteUrl, activityId, { scoId?, newAttempt? })`: opens the player in normal mode on the working tab (`BrowserManager.tab()`), continuing the last attempt or starting a new one, at the first SCO or the one given; returns the attempt, the SCO and the player's URL. Category `own`.
- `createActivity` with `type: "scorm"` takes the package (the first of `files`) into `packagefile`.
- Never write tracks (`mod_scorm_insert_scorm_tracks`) or a grade for the person: a SCORM's result comes from doing it in the player, and the driver offers no way around that (decided by the owner, 11 October 2026).
- Tests against the fake Moodle: the services' shapes, the player's URL, a package uploaded to `packagefile`.

## Acceptance

- In the sandbox as a student: `scorm` on a SCORM activity gives its attempts and SCO statuses; `openScorm` leaves the working tab in the player with the SCO's frame loaded; after doing the package in that page, `scorm` gives the new grade.
- As a teacher: `createActivity({ type: "scorm", files: [package] })` creates the activity from the package.
