# Access restrictions and completion conditions, in plain terms

Issue: [#33](https://github.com/falkenslab/moodle-driver/issues/33)

## Goal

Set when an activity or section is available (dates, a grade, another activity's completion, a group) and when it counts as complete, without Moodle's raw form fields.

## Context

- Today only through `settings` by field name: `availabilityconditionsjson` (Moodle's JSON tree) and the completion fields (`completion`, `completionview`, `completionusegrade`, `completionexpected`…), which differ by module and version.
- `activitySettings` reads them raw; `courseStructure({ details })` gives availability as text.

## Changes

- `restrictions` on `createActivity`, `updateActivity` and `editSection`: a list of `{ type: "date", from?, until? }`, `{ type: "grade", activityId, min?, max? }`, `{ type: "completion", activityId, state }`, `{ type: "group", groupId }`; all or any; shown or hidden when not met. Built into Moodle's JSON.
- `completion` on `createActivity` and `updateActivity`: `"none"`, `"manual"` or `{ view?, grade?, passGrade?, submit?, expected? }`, mapped to the module's fields; a condition the module doesn't have is refused by name.
- `activitySettings` gives both back in these terms.
- Docs in activities and completion; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), an activity restricted to "after completing activity X" stays unavailable to a student until they mark X done; a page set to complete on view is complete after `activityContent`.
