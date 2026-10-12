# setEnrolmentMethod fails on the manual enrolment method

Issue: [#51](https://github.com/falkenslab/moodle-driver/issues/51)

## Problem

In the sandbox (Moodle 5.2), course 3, as its teacher, `setEnrolmentMethod(context, site, 3, { type: "manual" }, { enabled: true })` throws `FormError` "The form has no such field: status". `enrolmentMethods` lists the method (`type: "manual"`, enabled). Seen from moodle-mcp on 12 October 2026.

## Cause

`src/areas/participants/methods.ts` sets `enabled` through the edit form's `status` field, which the self and guest methods' forms have; the manual method's form doesn't (or names it otherwise), and enabling and disabling it goes through the methods page's enable/disable link instead, which `enrolmentMethods` already reads. A teacher may also not be able to open the manual method's form at all (`enrol/manual:config`), as the docs say for its role. To confirm on the sandbox, as teacher and as admin.

## Solution

`enabled` through the methods page's enable/disable link (with the sesskey) for every method type, or wherever the form has no `status`; the form only for the settings it has (role, enrolment duration, dates…). A setting the person's form lacks is refused with a clear reason, as now. Docs in the participants page; fake-Moodle tests with the manual method's form as Moodle 5.2 renders it.

## Verification

- The fake-Moodle tests above.
- In the sandbox, `test/sandbox/participants.sandbox.ts` gains a check per method type (manual, self, guest): disable and enable again, read back with `enrolmentMethods`, leaving course 3's methods as they were (on the scratch course).
