# The page that shows every function's result

Issue: [#95](https://github.com/falkenslab/moodle-driver/issues/95)

## Goal

A program can tell, for any function with a page, the Moodle page that shows its result, headed or headless, so it can link the person to it.

## Context

- `FOLLOWED_PAGES` (`src/followed-pages.ts`, #88) maps the functions that may open no page of their own (about 40, through AJAX) to the page that shows their work, from `(args, result)`; `UNFOLLOWED_METHODS` lists the ones with none. `test/followed-pages.test.ts` checks every AJAX-only function is in one or the other.
- Every other function opens its own tab (`openSitePage`) and closes it: its page reaches only the context's follower (`followPages` in `src/core/session.ts`, not exported), and only while a window is shown (ADR-007). Headless, a program never learns it.
- Where the follower gets it, it's the page as opened: for a creation, the form (`course/modedit.php?add=label&course=3&section=1`), which as a link would add another activity.
- moodle-mcp wants it for each tool's result (falkenslab/moodle-mcp#56, for miyagi's "View in the classroom").

## Changes

- `FOLLOWED_PAGES` extended to every method whose work has a page, the result's page rather than the form: a creation, what it made (`createActivity` → `mod/<type>/view.php?id=<id>`, a discussion, a question's bank…); an edit, the item, or the page that lists it; a read, the page it reads. `undefined` when there's none; `UNFOLLOWED_METHODS` keeps the rest.
- The same paths on Moodle 4.5 and 5.x, `moodleVersion` where they differ.
- Follow mode shows the mapped page after a call for these functions too, instead of the form it worked in.
- The test covers every method of the Moodle object, in the map or in the list, so a new function can't be left out.
- Doc comment and the browser guide in both languages (ADR-015).

## Acceptance

- Every method of the Moodle object is either in `FOLLOWED_PAGES` or in `UNFOLLOWED_METHODS`, checked by a test.
- On the sandbox (4.5 and 5.2), a sample of creations, edits and reads (`createActivity`, `addDiscussion`, `createQuestion`, `editActivity`, `gradeSubmission`, `quizResults`) gives a page that opens and shows the result, headless.
- With the window shown, a creation leaves what it made in the working tab, not its form.
