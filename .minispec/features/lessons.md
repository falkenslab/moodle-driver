# Lessons

## Goal

`lessonPage` and `answerLessonPage`: go through a lesson page by page.

## Context

- A student's run had a lesson gating an escape room.
- Lesson pages are content or questions with jumps; `mod_lesson_get_page_data` and `mod_lesson_process_page` exist (AJAX to confirm); otherwise the `mod/lesson/view.php` forms.

## Changes

- `moodle/lesson.ts`: `lessonPage(context, siteUrl, cmid)` (the current page: content as text, question and options, buttons); `answerLessonPage(context, siteUrl, cmid, answer, { trail })` (an answer or a button; returns the feedback and the next page). Both follow the trail (ADR-005); starting and ending the attempt happen inside them.

## Acceptance

- A seeded lesson in course 3 (content page, multichoice question, end) is completed through them, and its grade shows in `myGrades()`.
- A wrong answer returns the lesson's feedback and where it jumps.
