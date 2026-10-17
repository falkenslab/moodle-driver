# Workshops: a student's submission, example submissions and grade calculation

Issue: [#71](https://github.com/falkenslab/moodle-driver/issues/71)

## Goal

A workshop works end to end through the driver: participants submit, examples are set up, and the teacher calculates and overrides grades.

## Context

- `workshopInfo`, `setWorkshopPhase`, `assessWorkshopSubmission` (`src/areas/workshops/workshops.ts`) and the allocation (`allocation.ts`) exist, but nobody can submit, so allocating couldn't be checked with real submissions.
- Moodle, to confirm on the sandbox: `mod/workshop/submission.php` (or `mod_workshop_add_submission`, `update_submission`, `get_submission`); `exsubmission.php` and `exassessment.php` for examples and their reference assessments; the evaluation phase's grading evaluation settings form (`aggregate.php`) and the override fields of `submission.php` and `assessment.php` (or `mod_workshop_evaluate_submission`, `evaluate_assessment`).
- moodle-mcp needs it.

## Changes

- `workshopSubmission(activityId, { userId? })` and `saveWorkshopSubmission(activityId, { title, content, attachments?, embed? })`, adding or editing in the submission phase.
- `addWorkshopExample(activityId, { title, content, attachments? })` and its reference assessment through the strategy's form, as `assessWorkshopSubmission` fills it; editing and deleting an example to settle on the sandbox.
- `calculateWorkshopGrades(activityId, { comparison? })` in the evaluation phase, and `overrideWorkshopGrade(activityId, submissionId, { submissionGrade?, assessmentGrade? })`.
- Errors naming a missing capability (`mod/workshop:submit`, `mod/workshop:manageexamples`, `mod/workshop:overridegrades`) or the wrong phase.
- Data categories: submitting `own`; examples `course-content`; reading someone's submission `others-personal`; calculating and overriding `others-write`.
- Docs in the grading page, where workshops are (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a workshop in a scratch course: the student submits, reviewers are allocated, an assessment is made, grades are calculated and read back with `workshopInfo`.
