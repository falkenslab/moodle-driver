# Moodle 4.5 and 5.x, each function on the versions it works on

Issue: [#86](https://github.com/falkenslab/moodle-driver/issues/86)

## Goal

The driver works on Moodle 4.5 (the long-term support release, until 2027) and 5.x: it knows which a site runs, takes the path that version needs where Moodle changed, and refuses what a version doesn't have with an error that says so.

## Context

- The driver is developed and checked against Moodle 5.2 only; `docs/content/reference/compatibility.md` lists a few 5.0-only parts (question banks as activities, the activities overview).
- A read-only sweep on a real Moodle 4.5 site (a test course on a regional campus: CAS login, Classic theme, many local plugins, 17 October 2026) passed 54 of 63 reads. It found three bugs, fixed in 8057d5d and 6f7f5ad: `whoAmI(courseId)` (4.5 answers `invalidrecord` to `core_courseformat_get_section_content_items`), a missing page reported as `NotLoggedInError` instead of `not-found`, and BigBlueButton's HTML-escaped join URL. Writes, student functions and the Boost-only paths weren't checked there.
- The whole sandbox suite on moodle-sandbox's 4.5.15 site (`npm run test:sandbox -- --moodle 4.5`, 18 October 2026): 167 functions passed, 85 failed. Of the failures, about 25 read the content course, which only the 5.2 site has (filled by hand there: moodle-sandbox should seed one on both), 6 are Moodle 5.0 features, and most of the rest were cancelled after an earlier failure in their block. The 4.5 differences to fix, each to confirm: `surveyResults` (a feedback's counts), `allocateMarker` (marking allocation settings), `createBadge`/`awardBadge`/`setBadgeEnabled`, `updateCourse` (a short name already taken), `addBlock` and the other block functions (adding a block times out), `siteProfileDir` and `createMoodle` on another browser (to check: may be the suite expecting port 8080), `editDatabaseField` (a field's type read as unknown), `databaseEntries`' values, `backupCourse` with a selection (no file made), `addNote` (4.5's note form has no `content_editor`), and a cleanup that failed (the participants file).
- Sites don't always publish their version; whether a page or service exists tells it (`mod/subsection/` 4.5+, `mod/qbank/` 5.0+).
- moodle-sandbox can build any Moodle tag (`MOODLE_VERSION`); a 4.5 sandbox next to the 5.2 one is its own issue there (falkenslab/moodle-sandbox#3).

## Changes

- `moodleVersion()` on the `Moodle` object (and an internal cached per session): the site's branch (`4.5`, `5.0`, `5.1`, `5.2`…) found by feature (pages and services that exist), the release when the site shows it; `unknown` never guessed as the newest.
- A function that needs a later Moodle refuses with `MoodleError` code `not-available` naming the minimum ("needs Moodle 5.0 or later; this site runs 4.5"), before opening anything. Each export's doc comment says its minimum where it isn't 4.5.
- The 4.5 paths where Moodle changed, found by running the sandbox suite against a 4.5 sandbox: fixed as `whoAmI` was (fallback, or a branch on the detected version), each with a fake-Moodle test of the 4.5 shape.
- `npm run test:sandbox` takes the sandbox to run against (`--moodle 4.5` / `5.2`, or `MOODLE_SANDBOX_DIR`/port); the suite's checks for 5.0+ functions expect the refusal on 4.5.
- `docs/content/reference/compatibility.md` (both languages): the supported versions, a table of the functions whose minimum isn't 4.5, how the version is found; the Classic theme noted where pages differ.

## Acceptance

- The whole sandbox suite passes on a Moodle 4.5 sandbox and on the 5.2 one (with the 5.0+ functions refused on 4.5 with the minimum named).
- `moodleVersion()` gives `4.5` on the 4.5 sandbox and on the real campus test course, `5.2` on the 5.2 sandbox.
- The read-only sweep on the real 4.5 test course passes every read whose data exists there.
