# Grade quiz questions by hand

Issue: [#30](https://github.com/falkenslab/moodle-driver/issues/30)

## Goal

A teacher grades the questions Moodle can't grade by itself (essays) and changes any question's mark, with a comment.

## Context

- `quizResults` lists attempts and `readReview` reads one; an essay stays "Requires grading" and its attempt's grade incomplete.
- No service open to AJAX grades a question: Moodle's `mod/quiz/comment.php?attempt=…&slot=…` form (mark and comment) does, and the "Manual grading" report (`mod/quiz/report.php?mode=grading`) lists what's waiting.

## Changes

- `questionsToGrade(activityId)`: per question (slot), the attempts waiting for grading, from the grading report.
- `gradeQuizQuestion(attemptId, slot, { mark, comment? })`: through `comment.php`; a mark over the question's maximum comes back as Moodle's error by field.
- `readReview` shows the new mark and comment; `changed` gives the attempt's new grade when Moodle shows it.
- Categories `others-personal` and `others-write`; docs in the quizzes area; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), a student's essay attempt waiting for grading is graded by the teacher; the student's review shows the mark and comment, and the quiz grade appears in `myGrades`.
