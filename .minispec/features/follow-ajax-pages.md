# Show the page an AJAX function works on, when the browser is visible

Issue: [#88](https://github.com/falkenslab/moodle-driver/issues/88)

## Goal

With a visible browser, a function that works through Moodle's AJAX services leaves in the working tab the Moodle page that shows its work, as functions that open a page already do.

## Context

- ADR-007: while the person watches, the pages functions open are shown in one working tab. `src/core/session.ts` has `followPages(context, show)`; `openSitePage` and `fetchSitePage` call the context's follower with the page they worked on, and the browser manager (`src/browser/manager.ts`, `followPages(context, (url) => manager.show(url))`) shows it when `visible()`.
- Functions that only call AJAX services (`callService`, which fetches its session page with `follow: false`) show nothing: in the `moodle` shell with `--show`, `listCourses`, `courseStructure`, `discussion`, `gradeSubmission` or `editActivity` look like nothing happened (seen by the owner, 18 October 2026).
- moodle-mcp maps each of its AJAX tools to the page that shows its work in `src/tools/follow.ts` (about 30 entries: the course page for `courseStructure` or `editActivity`, the discussion for `discussion`, the grader for `gradeSubmission`, the notifications page…). Which page shows a function's work is Moodle knowledge, so it belongs in the driver, shared by every client (falkenslab/moodle-driver#88).

## Changes

- A map, exported, from each function that works through AJAX and opens no page of its own to the page that shows its work, built from its arguments and result (a path relative to the site: `course/view.php?id=<courseId>`, `mod/forum/discuss.php?d=<discussionId>`, the grader for a submission…); functions with no page that shows them are left out. Moodle 4.5's and 5.x's pages where they differ (`moodleVersion`).
- The `Moodle` object's bound methods (`src/client.ts`) follow that page after a call succeeds, through the context's follower: best effort (an error showing it never fails or changes the call), nothing at all while the browser is hidden or for a function that already opened its page.
- The shell gets it with no change of its own; the browser and command line guides say so (both languages); the moodle-mcp side (dropping its `follow.ts`) is moodle-mcp's own work.
- Fake-Moodle tests: the followed page for a few functions, nothing followed headless, a failed show not failing the call; a test that every AJAX-only function is either in the map or listed as having no page.

## Acceptance

- In the shell with the browser visible, on the sandbox (4.5 and 5.2): `listCourses`, `courseStructure`, `discussion`, `gradeSubmission` and `editActivity` each leave their page in the working tab; headless, no page is loaded for it.
