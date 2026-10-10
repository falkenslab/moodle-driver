# Use-case examples in the documentation

Issue: [#20](https://github.com/falkenslab/moodle-driver/issues/20)

## Goal

A section of the documentation site with complete programs for real use cases, each explained step by step and with its code commented.

## Context

- The site has one full program (`getting-started/first-program.md`) and one short example per area page, which shows that area's functions, not a task from start to end.
- Writing small programs against the API showed what a newcomer trips on (the shape of results, which id goes where, closing the browser); whole use cases teach that better than signatures.
- The docs' examples are typechecked by hand with a scratch script, outside the repository: nothing stops an example from going stale when the API changes.

## Changes

- New sidebar category "Examples" (`docs/content/examples/`), one page per use case, each with:
  - who it's for (student, teacher) and what it does;
  - the complete program, commented line by line where Moodle or the driver does something non-obvious;
  - a walkthrough of the steps, what the person sees (a login window, the pace), and the result printed;
  - variations, the errors to expect and how to handle them, and its data categories.
- Use cases, students: a weekly agenda (courses, deadlines, pending work); downloading a course's files; reading a course's content at a person's pace; submitting an assignment, accepting the statement; answering a quiz page by page; answering surveys and choices.
- Use cases, teachers: grading pending submissions with feedback (simple and rubric); granting extensions and quiz overrides to a student; messaging inactive students; building a course from an outline (sections, pages, an assignment with dates); exporting the grader report to CSV; importing questions and adding them to a quiz; a daily report of notifications and forum activity.
- Use cases, programs: handling an expired session and other errors; `await using` and one object per site; a service the driver doesn't wrap (`callService`, `/internals`); testing a program with the fake Moodle.
- The intro and the area pages link to the examples that use them.
- A script in the repository extracts every `ts` block of the docs and typechecks it against `src/` (`npm run docs:check`), run by the `verify` skill and the docs workflow; fragments that aren't programs are marked so it skips them.

## Acceptance

- The "Examples" section is in the site with every use case listed above, and `npm run docs:build` passes with no broken links.
- Every example is a complete program that compiles against the current API (`npm run docs:check` passes), with comments on each non-obvious step.
- Changing a function's signature or result breaks `docs:check` until the examples are updated.
