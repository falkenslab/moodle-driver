# Create groups and groupings, and choose their members

Issue: [#29](https://github.com/falkenslab/moodle-driver/issues/29)

## Goal

A teacher creates, renames and deletes a course's groups and groupings, and adds or removes their members.

## Context

- `groups(courseId)` reads groups with their members; nothing changes them.
- No group service that writes is open to AJAX (only `core_group_get_course_groups` and `core_group_get_groups_for_selector`): Moodle's pages do it (`group/group.php` form, `group/members.php`, `group/grouping.php`, `group/assign.php`, `group/delete.php`).

## Changes

- `createGroup(courseId, { name, description?, idNumber?, enrolmentKey? })`, `updateGroup(groupId, …)`, `deleteGroup(groupId)`.
- `setGroupMembers(groupId, { add?, remove? })`: user ids, through the members page.
- `groupings(courseId)`, `createGrouping(courseId, { name, … })`, `deleteGrouping(groupingId)`, `setGroupingGroups(groupingId, groupIds)`.
- Every write returns `changed`. Categories: `course-content` for groups and groupings, `others-personal` and `others-write` for members.
- Docs in the participants area; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher creates a group, adds two students, puts it in a new grouping, and deletes both; `groups` shows each step.
