# A student's assignment: drafts and the submission statement

Issue: [#113](https://github.com/falkenslab/moodle-driver/issues/113)

## Goal

`studentAssignment` says whether saving leaves a draft to submit separately and whether submitting asks to accept a statement (its words), as far as the student's pages tell it; `saveSubmission` accepts the statement where saving is submitting.

## Context

- Found in moodle-mcp (falkenslab/moodle-mcp#67): a student's agent learns both only afterwards (the submission stays a draft, or `submitForGrading` fails on the statement).
- Moodle 5.2 (read in its code): the `submissiondrafts` setting reaches a student only through the "Submit assignment" button, shown once there's a non-empty draft; `mod_assign_get_assignments` and `get_submission_status` aren't AJAX services.
- Without drafts, the statement is a required checkbox in the edit form, so `saveSubmission` fails today on such an assignment; with drafts, it's on the confirmation page, which shows its form only once something is saved.
- With drafts, a submitted submission can't be edited: submitted and editable means no drafts.

## Changes

- `StudentAssignment.drafts?: boolean`: true with the submit button; false when submitted and still editable, or when the edit form carries the statement; absent when the pages don't tell (before the first save, without a statement).
- `StudentAssignment.statement?: string`: the statement's words; known whenever `drafts` is (absent then means none). The public read opens the edit page (or the confirmation page, with a draft to submit) to find it; the reads after saving and submitting don't.
- `saveSubmission`'s input takes `acceptStatement`; without it, the edit form's statement is a `SubmissionError` with its words, as in `submitForGrading`. Its `changed` says when what was saved is a draft to submit.
- Docs on `assignments.md`, en and es.

## Acceptance

- Fake Moodle tests: drafts known from the button and from the edit form's statement, unknown before saving; the statement from both pages; saving with the statement refused, then accepted.
- Sandbox, 5.2 and 4.5: an assignment without drafts and with the statement read before saving, saved with `acceptStatement` and submitted; one with drafts read before and after saving.
