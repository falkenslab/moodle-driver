# A course's enrolment methods

Issue: [#44](https://github.com/falkenslab/moodle-driver/issues/44)

## Goal

Read and set how people get into a course: self enrolment with a key, guest access, and the methods' dates, roles and limits.

## Context

- Nothing reads or changes them; a teacher opening self enrolment with a key does it in Moodle's pages.
- Moodle: `enrol/instances.php?id=<course>` lists them (enable and disable links with the sesskey), `enrol/editinstance.php?type=self|guest&courseid=…&id=…` edits one (key, dates, role, maximum users, welcome message); no service open to AJAX.

## Changes

- `enrolmentMethods(courseId)`: each method's type, name, whether it's enabled, its role and, for self enrolment, whether it has a key, its dates and limit.
- `setEnrolmentMethod(courseId, methodId | { type }, { enabled?, key?, start?, end?, roleId?, maxUsers?, welcome? })`: adds one of that type when the course has none and the person may.
- Category `course-content`; docs in participants; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3), the teacher enables self enrolment with a key, a new student enrols with it in Moodle, and the teacher disables it again.
