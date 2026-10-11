# A regression suite against the Moodle sandbox

Issue: [#49](https://github.com/falkenslab/moodle-driver/issues/49)

## Goal

`npm run test:sandbox` checks every function of the driver against a real Moodle (the sandbox), as a student, a teacher and an admin, so a release is known to work on Moodle and not only on the fake one.

## Context

- The 318 tests run against the fake Moodle (`src/testing`): they check the driver's logic, not that Moodle still answers as the fake does. Each feature was checked once against the sandbox with throwaway scripts, outside the repository, not repeatable.
- 0.5.0 merged nine branches and reworked shared code (`forms.ts` draft helpers, date selectors, `courseStructure`, `studentAssignment`, `createEvent`) after those checks.
- The sandbox (`../moodle-sandbox`, Moodle 5.2 in Docker on `localhost:8080`) has course 3 with content, a teacher, students and an admin; `node manage.mjs info --json` gives their credentials. Course 2 must never change.
- Tests open browsers only in Docker (`scripts/in-docker.mjs`, which joins the sandbox's network).

## Changes

- `scripts/test-sandbox.mjs` (`npm run test:sandbox [files…]`): reads the accounts from `../moodle-sandbox` (or `MOODLE_SANDBOX_DIR`) into a temporary folder readable only by the person, mounts it in the container, runs `test/sandbox/**/*.sandbox.ts` one file at a time, and deletes the folder whatever happens. Credentials are never printed, logged or written in the repository.
- `test/sandbox/harness.ts`: `as("student" | "teacher" | "admin")` gives a logged-in Moodle object (profiles in the temporary folder, logged in by the login form the first time); `scratchCourse()` creates a course "Driver check suite <time>" as admin with the teacher and the student enrolled, and deletes it after the file's tests; course 3 is only read.
- One file per area under `test/sandbox/`: every exported function (and `moodle` command families) called against the sandbox, reads on course 3, writes on the scratch course, each test cleaning up what it creates. What the sandbox can't show (a site setting it lacks, a capability nobody has) is skipped with the reason, not left out.
- A summary at the end: per function, passed, failed or skipped (why).
- Docs: the development page and the release skill (run it before a release); `README.md`'s development section.

## Acceptance

- `npm run test:sandbox` passes against the sandbox, with every exported function of `src/index.ts` exercised or skipped with a reason (a check fails when one is in neither).
- After a run, the sandbox has no course, activity, group, event or user left by it, and course 2 is unchanged.
- No credential appears in the repository, the output or the logs.
