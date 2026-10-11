# Run a workshop's phases and assess its submissions

Issue: [#48](https://github.com/falkenslab/moodle-driver/issues/48) (split from [#46](https://github.com/falkenslab/moodle-driver/issues/46))

## Goal

A teacher follows a workshop through its phases and assesses its submissions, as with forums and assignments.

## Context

- Forums are graded as a whole with `forumGrades` and `gradeForumUser`, and posts, entries and records rated with `rate`; workshops have nothing yet.
- Moodle: a workshop's page (`mod/workshop/view.php`) shows its phase and, per phase, the submissions and allocated assessments; it switches phase in `mod/workshop/switchphase.php?cmid=&phase=&confirm=1` (with sesskey), assesses in `mod/workshop/assessment.php?asid=` (the grading strategy's form: accumulative, comments, number of errors, rubric), and a teacher's own assessment is started from `submission.php?cmid=&id=` ("Assess"). No AJAX service covers any of it.

## Changes

- `workshopInfo(activityId)`: its phase, submissions (author, title, grade) and assessments (reviewer, reviewee, grade), read from its page by structure.
- `setWorkshopPhase(activityId, phase)`: `"setup" | "submission" | "assessment" | "evaluation" | "closed"`, through the switch phase confirmation.
- `assessWorkshopSubmission(activityId, submissionId, { criteria, feedback? })`: a teacher's assessment through the strategy's form, its fields by name.
- Categories `others-personal` and `others-write`; docs in grading; tests against the fake Moodle, modelled on the real pages.

## Acceptance

- In the sandbox (course 3), the teacher creates a workshop "Driver check workshop", a student submits, the teacher moves it to the assessment phase, assesses the submission, and `workshopInfo` shows the grade; the workshop is deleted afterwards.
