# assignmentSubmissions creates empty submissions just by reading

Issue: [#54](https://github.com/falkenslab/moodle-driver/issues/54)

## Problem

In the sandbox (Moodle 5.2), course 3, assignment 35, as its teacher: two `assignmentSubmissions` calls minutes apart, nobody submitting in between. The first gave two participants `status: "none"` and two `"new"`; the second (`includeContent: false`) all four `"new"`. The logs show "Grading form viewed" events by the teacher and none by those participants. Seen from moodle-mcp on 12 October 2026 (falkenslab/moodle-mcp#10), which offers the function as a read.

## Cause

Likely: with `includeContent`, `assignmentSubmissions` reads each participant's content through `gradingPanelHtml` (`core_get_fragment`, `mod_assign` `gradingpanel`), and Moodle's grading panel creates an empty submission (`new`) for a participant who has none. The statuses are read before the panels open, so the first call still saw `none` and the second saw the records the first one had created. To confirm on the sandbox (and in `mod/assign`'s code) before changing it.

## Solution

Reading submissions changes nothing in Moodle: the grading panel is not opened for a participant with no submission (their status already says there's nothing to read), or the content comes from something that doesn't create records (`mod_assign_get_submissions`, if it gives what the panel gave). Whatever read can't avoid a write is said in the function's doc comment. Fake-Moodle tests: no panel requested for a participant without a submission.

## Verification

- The fake-Moodle tests above, and the assignments area's tests.
- In the sandbox, `test/sandbox/assignments.sandbox.ts` gains a check on a scratch assignment: two `assignmentSubmissions` reads in a row, with content, leave every participant's status as it was (a participant who never submitted stays `none`).
