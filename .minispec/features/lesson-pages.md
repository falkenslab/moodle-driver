# A lesson's pages, answers and jumps

Issue: [#63](https://github.com/falkenslab/moodle-driver/issues/63)

## Goal

A teacher builds a lesson's pages through the driver: content pages with buttons, question pages with answers, scores and jumps.

## Context

- The driver plays a lesson as a student (`lessonPage`, `answerLessonPage` in `src/areas/lessons/lessons.ts`) and can create the lesson, not its pages: Moodle's lesson editor (`mod/lesson/edit.php`, `editpage.php` per page type, the move and delete links) builds them.
- moodle-mcp needs it (falkenslab/moodle-mcp#19).

## Changes

- `lessonPages(activityId)`: the pages as the editor's expanded view shows them: id, type (content, each question type, cluster, end of cluster, end of branch), title, contents, and answers with their response, score and jump (next page, a page id, end of lesson, …).
- `addLessonPage`, `editLessonPage`, `moveLessonPage`, `deleteLessonPage`: type, title, HTML contents (`embed` for images), for a question page its answers with response, score and jump; for a content page its buttons with jumps. A jump to a page that doesn't exist is an error before anything is saved.
- `changed` sentences and the page's id; data category course content; docs in the lessons page (both languages); fake-Moodle tests per page type.

## Acceptance

- In the sandbox, in a scratch course: a branching lesson built from nothing (a content page with two buttons, a multiple-choice page whose answers lead to different pages, an end of branch), read back as set, and played through as the student with `lessonPage` and `answerLessonPage`.
