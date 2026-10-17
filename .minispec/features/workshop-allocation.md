# A workshop's allocation: who assesses whom

Issue: [#66](https://github.com/falkenslab/moodle-driver/issues/66)

## Goal

A teacher reads and sets a workshop's allocation through the driver, so the assessment phase has reviewers.

## Context

- `src/areas/workshops/workshops.ts` switches the phase (`setWorkshopPhase`), reads the workshop (`workshopInfo`) and assesses a submission, but can't allocate reviewers: Moodle's allocation page (`mod/workshop/allocation.php`, methods manual, random and scheduled) does it.
- moodle-mcp needs it (falkenslab/moodle-mcp#22).

## Changes

- `workshopAllocation(activityId)`: for each submission, its id, author and reviewers (user ids).
- `allocateReviewer(activityId, { submissionId | authorId, reviewerId })` and removing one (manual); `allocateRandomly(activityId, { perSubmission | perReviewer, groups?, selfAssessment?, keepCurrent? })` returning what Moodle reports (allocations made, problems); `scheduleAllocation(activityId, { enabled, … })` for the random allocation at the end of the submission phase.
- Errors naming a missing capability (`mod/workshop:allocate`) or a reviewer not in the course; data category others' work; docs in the workshops section (both languages); fake-Moodle tests for each method.

## Acceptance

- In the sandbox, in a scratch course with a workshop and submissions: a manual allocation added and removed, a random allocation run and read back.
