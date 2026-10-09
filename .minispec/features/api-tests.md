# API tests

Issue: [#2](https://github.com/falkenslab/moodle-driver/issues/2)

## Goal

Every public function tested here, against the fake Moodle, not only through moodle-mcp's tools.

## Context

- When the driver was extracted, its unit tests came along (55), but much of its behavior is still tested only by moodle-mcp's tool tests (74), which drive these functions through MCP: `activityContent`, `createActivity`/`updateActivity` and the layout functions, `assignmentSubmissions`, `gradeSubmission`, `studentAssignment`/`saveSubmission`/`submitForGrading`, the quiz attempt functions, `forumDiscussions`/`discussion`/`replyToPost`/`startDiscussion`, `getSurvey`/`submitSurvey`, `activitiesOverview`/`deadlines`/`courseUpdates`, `logIn`/`logOut`, `downloadFile`, `whoAmI`, `listCourses`, `courseStructure`, `pendingActivities`.
- The fake site and its page fixtures live in those tool tests (`moodle-mcp/test/tools/*.test.ts`).

## Changes

- One `test/moodle/<area>.test.ts` per area above, calling the functions directly with the fixtures brought over (made-up data only).
- Once each area is covered here, moodle-mcp's tool tests can shrink to what MCP adds (schemas, annotations, error explanations, progress, following); that's a moodle-mcp change, noted in its `driver-tools` card.

## Acceptance

- Each function listed has at least one test here exercising its main path and its main error.
- The suite runs in Docker, one file at a time, without the sandbox.
