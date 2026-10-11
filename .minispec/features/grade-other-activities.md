# Grade forums, ratings and workshops

Issue: [#46](https://github.com/falkenslab/moodle-driver/issues/46)

## Goal

Grade what teachers grade besides assignments and quizzes: whole-forum grading, ratings in forums, glossaries and databases, and a workshop's phases and assessments.

## Context

- Only assignments (`gradeSubmission`) are graded, and quiz questions once their card is done.
- Moodle: whole-forum grading uses the grading panel services, open to AJAX (`core_grades_grader_gradingpanel_point_fetch|store`, `…_scale_fetch|store`); ratings post to `rating/rate.php` (`rate_ajax.php` from the page); a workshop switches phase in `mod/workshop/switchphase.php` and assesses in `assessment.php`.

## Changes

- `forumGrades(activityId)` and `gradeForumUser(activityId, userId, { grade, feedback? })`: the forum's own grade per user.
- `rate(item, rating)`: a rating on a forum post, glossary entry or database record, by the scale's value or a number.
- Workshop: `workshopInfo(activityId)` (phase, submissions, assessments), `setWorkshopPhase(activityId, phase)`, and assessing a submission as a teacher.
- Categories `others-personal` and `others-write`; docs in grading; tests against the fake Moodle. Split into one card per module if it grows.

## Acceptance

- In the sandbox (course 3), the teacher grades a student in a forum with whole-forum grading and rates one of their posts; both show in `graderReport`.
