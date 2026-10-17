# Course completion: its criteria and each participant's status

Issue: [#73](https://github.com/falkenslab/moodle-driver/issues/73)

## Goal

A teacher reads and sets a course's completion criteria and follows each participant's course completion.

## Context

- `src/areas/completion/completion.ts` covers activity completion (`setCompletion`, `overrideCompletion`, `completionReport`, the progress report); nothing reads course completion, which `setBadgeCriteria`'s course completion criterion depends on.
- Moodle, to confirm on the sandbox: `course/completion.php?id=` (the criteria form), `report/completion/index.php?course=` (the course completion report, with the manual completion by role), `core_completion_get_course_completion_status`.
- moodle-mcp needs it.

## Changes

- `courseCompletionCriteria(courseId)` and `setCourseCompletionCriteria(courseId, { overall?, activities?, date?, grade?, self?, roles?, courses? })`: each criterion as the form has it, with all or any where the form offers it.
- `courseCompletionStatus(courseId, { userId? })`: each participant's state and their criteria met; paged with `limit` and `offset`.
- `markCourseComplete(courseId, userId)` by hand, where a manual completion by role criterion allows it.
- Errors naming a missing capability (`moodle/course:update`, `report/completion:view`, `moodle/course:markcomplete`) or completion disabled on the site or the course.
- Data categories: the criteria `course-content`; the statuses `others-personal`; marking someone `others-write`.
- Docs in the completion page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a scratch course given activity and grade criteria, read back, and the student's status read before and after meeting them.
