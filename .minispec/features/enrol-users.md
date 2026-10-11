# Enrol people in a course, unenrol them and change their roles

Issue: [#28](https://github.com/falkenslab/moodle-driver/issues/28)

## Goal

A teacher enrols users in a course with a role, unenrols them, and gives or removes roles, as the participants page does.

## Context

- `participants`, `courseRoles` and `participantFilters` only read; nothing changes who is in a course.
- Services open to AJAX (Moodle 5.2 sandbox): `core_enrol_get_potential_users` (who can be enrolled), `core_enrol_unenrol_user_enrolment`, `core_enrol_submit_user_enrolment_form` (an enrolment's status and dates). `enrol_manual_enrol_users` and `core_role_assign_roles` aren't: the "Enrol users" dialog submits a dynamic form, and the roles column is an inplace editable (`core_update_inplace_editable`, `core_user` / `user_roles`).

## Changes

- `potentialUsers(courseId, search)`: users the person may enrol through manual enrolment (id, name, email when shown).
- `enrolUsers(courseId, userIds, { roleId?, start?, end? })`: manual enrolment, the course's default role unless given.
- `unenrolUser(courseId, userId)`: removes the user's enrolments the person can remove; `changed` says which.
- `setUserRoles(courseId, userId, roleIds)`: the user's roles in the course, as the participants page's roles column sets them.
- Errors: a course without manual enrolment, a role the person can't assign: `EnrolmentError` (code `enrolment`).
- Categories `others-personal` and `others-write`; docs in the participants area; tests against the fake Moodle.

## Acceptance

- In the sandbox (course 3 only), as the teacher: enrol a user as student, give them a second role, unenrol them; `participants` reflects each step.
- A role the teacher can't assign is refused with Moodle's reason.
