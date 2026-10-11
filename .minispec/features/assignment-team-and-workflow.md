# Group submissions and the marking workflow

Issue: [#41](https://github.com/falkenslab/moodle-driver/issues/41)

## Goal

Work assignments that use group submissions or the marking workflow: see who submits for whom, set a submission's workflow state and marker, and release grades.

## Context

- `assignmentSubmissions`, `gradeSubmission` and `studentAssignment` treat each submission as one person's; with "Students submit in groups" the submission is the group's, and with the marking workflow grades stay hidden until released.
- Moodle: the grading form has `workflowstate` (and `allocatedmarker` with marker allocation) and `applytoall` for a group; batch operations in `mod/assign/view.php?action=grading` (`setmarkingworkflowstate`, `setmarkingallocation`).

## Changes

- `assignmentSubmissions` gives `group` (id, name), `workflowState` and `marker` when the assignment uses them.
- `gradeSubmission(…, { workflowState?, applyToGroup? })`.
- `setWorkflowState(activityId, userIds, state)` and `allocateMarker(activityId, userIds, markerId)`: Moodle's batch operations; releasing notifies as Moodle does.
- `studentAssignment` says whether the submission is the group's, and its members.
- Docs in assignments and grading; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), on an assignment with group submissions and the workflow, the teacher grades a group's submission for all its members and releases it; each member sees the grade.
