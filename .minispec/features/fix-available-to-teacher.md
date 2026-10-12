# courseStructure tells a teacher a hidden activity isn't available to them

Issue: [#50](https://github.com/falkenslab/moodle-driver/issues/50)

## Problem

As course 3's teacher in the sandbox (Moodle 5.2), a page just created (hidden, as `createActivity` makes it) comes back from `courseStructure` with `visible: false, availableToMe: false`, though the teacher can open it (`moodle/course:viewhiddenactivities`). Seen from moodle-mcp on 12 October 2026 (falkenslab/moodle-mcp#4).

## Cause

Likely: `src/areas/courses/structure.ts` computes `availableToMe` as `(cm.uservisible ?? true) && (cm.accessvisible ?? true)` from `core_courseformat_get_state`, and Moodle's `accessvisible` is false for any hidden activity, whoever looks; `uservisible` is what says whether this person can open it. To confirm on the sandbox before changing it.

## Solution

`availableToMe` from what says whether the person can open the activity (`uservisible`, and `accessvisible` only where it means that), true for a teacher on a hidden activity, false for a student on a hidden or restricted one; the doc comment and the courses page say what it means. `pendingActivities`, which skips activities neither visible nor available, keeps working for students. A fake-Moodle test with the state as Moodle 5.2 gives it to a teacher and to a student.

## Verification

- The fake-Moodle test above, and the courses area's tests.
- In the sandbox, `test/sandbox/courses.sandbox.ts` gains a check: a hidden activity in the scratch course is `availableToMe` for the teacher and not for the student.
