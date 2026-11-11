# Some reads load a page twice, so Moodle logs each view twice

Issue: [#101](https://github.com/falkenslab/moodle-driver/issues/101)

## Problem

Several reads leave the same event twice in the same second in the course log: `discussion` gives two `discussion_viewed`, `myGrades` two `grade_report_viewed`, and `studentAssignment` two each of `course_module_viewed`, `submission_status_viewed` and `feedback_viewed` (moodle-sandbox, Moodle 5.2, reported from padawan's runs). The log then counts views that never happened, and the site serves each page twice.

## Cause

- `discussion` (`src/areas/forums/posts.ts`) reads the posts through a service and, alongside, `discussionSubscription` (`src/areas/forums/discussions.ts`) fetches `mod/forum/discuss.php` only to read the subscription toggle; Moodle logs that fetch as a view.
- `myGrades` and `studentAssignment` open their page once each. The second load is probably the result page the `Moodle` object shows after a call while the browser is shown (`showResult` in `src/client.ts`), when its URL differs from the one the function opened (#95). To be confirmed: the runs that showed it may have had the browser shown.

## Solution

- Read the subscription without a page view: from a service, or from the discussion's page only when the function already loads it.
- Don't show a result page that the call has just loaded under another URL (the same page with other parameters), and use the function's own URL in `FOLLOWED_PAGES` where it is the same page.
- Check the other functions that fetch a page only for one detail (`fetchSitePage`) for the same double view.

## Verification

Tests in Docker against the fake Moodle that count the pages served per call: one load per page for `discussion`, `myGrades` and `studentAssignment`, headless and shown. On the sandbox, the course log of one call of each holds each event once.
