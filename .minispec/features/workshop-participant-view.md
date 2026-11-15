# Workshop: a participant's view

Issue: [#111](https://github.com/falkenslab/moodle-driver/issues/111)

## Goal

A participant can read a workshop as its page shows it to them: the phase and their tasks, their own submission, the submissions allocated to them to assess, and the assessment form they fill.

## Context

- `workshopInfo` reads the workshop's report as a teacher sees it; a participant gets it empty. `workshopForm` reads the teacher's editing form, which needs `mod/workshop:editdimensions`.
- So a student can't find the ids of the submissions to assess (which `assessWorkshopSubmission` and `workshopSubmission` take), nor the criteria `assessWorkshopSubmission` takes in order.
- Asked from moodle-mcp (falkenslab/moodle-mcp#66). Moodle 4.5 and 5.x.

## Changes

- A function (name to decide, such as `workshopView`) reading `mod/workshop/view.php` as the person sees it, participant or teacher:
  - the phase and the person's tasks for it (submit; assess peers, with how many are allocated and how many still to assess);
  - the instructions for authors and for reviewers;
  - the person's own submission: its id, title and whether it was submitted;
  - the submissions allocated to them to assess: id, title, author (with the author's user id), whether it's assessed, and the grade given.
- The assessment form as a reviewer gets it, from an allocated submission's assess form: its criteria in order, with their levels and points (rubric), maximum or scale (accumulative) and words (number of errors). Reading it must not save or start an assessment.
- Only the view page's "Course module viewed" is logged, as when a student opens the workshop.
- In `src/areas/workshops/`, its page in `FOLLOWED_PAGES`, doc comments, the workshops page in both languages, `npm run cli:generate`.

## Acceptance

- Tests in Docker against the fake Moodle: a participant's view with allocated submissions, and a teacher's.
- On the sandbox, in a test course (never course 2): a workshop with a rubric in its assessment phase, a student allocated to assess another's submission, read as that student with the ids and criteria `assessWorkshopSubmission` then takes.
