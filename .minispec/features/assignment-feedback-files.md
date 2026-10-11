# Feedback files when grading an assignment

Issue: [#40](https://github.com/falkenslab/moodle-driver/issues/40)

## Goal

Attach files to a submission's feedback (a corrected PDF, an audio comment) when grading it, and read them as a student.

## Context

- `gradeSubmission` sets the grade, the feedback comment and the rubric; feedback files aren't sent, and `studentAssignment` doesn't list the ones received.
- The grading form (`mod_assign_submit_grading_form`, open to AJAX) carries the feedback files plugin's draft area (`files_filemanager`) when the assignment has "Feedback files" on; the upload is the one `createActivity` already uses.

## Changes

- `gradeSubmission(…, { feedbackFiles: [paths] })`: uploaded to the grading form's feedback draft area, replacing what's there.
- `studentAssignment` gives the feedback's files (name, url) for `downloadFile`; `assignmentSubmissions` gives them to the teacher.
- An assignment without feedback files: refused with that reason (`GradingError`).
- Docs in grading and assignments; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher grades a submission with a PDF and the student downloads it from `studentAssignment`.
