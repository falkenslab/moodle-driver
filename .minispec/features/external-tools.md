# External tools (LTI) in a course

Issue: [#84](https://github.com/falkenslab/moodle-driver/issues/84)

## Goal

A teacher lists and adds a course's external tools, creates an LTI activity from one, and the person gets its launch URL.

## Context

- `createActivity` creates an external tool activity from its form's fields; nothing lists the tools a course may use.
- Moodle 5.x, to confirm on the sandbox: the course's "LTI External tools" page (`mod/lti/coursetools.php?id=`) with site preconfigured tools and the course's own, its "Show in activity chooser" toggle (`mod_lti_toggle_showinactivitychooser`), `mod/lti/coursetooledit.php?course=` (URL, key, secret), dynamic registration where the tool offers it, and `mod/lti/launch.php?id=`.
- moodle-mcp needs it.

## Changes

- `externalTools(courseId)`: each tool's id, name, URL, site or course, and whether it's shown in the activity chooser.
- `addExternalTool(courseId, { name, url, key?, secret? })`; dynamic registration as well, or only manual configuration, is a choice to settle on the sandbox.
- Creating an LTI activity from a tool: `createActivity` with the tool's id (`typeid`), if its form takes it, or a dedicated option; to settle on the sandbox.
- `externalToolLaunchUrl(activityId)`: the person's launch URL, opened by the person.
- Errors naming a missing capability (`mod/lti:addcoursetool`, `mod/lti:addpreconfiguredinstance`, `mod/lti:view`).
- Data categories: tools `course-content` (a secret is never returned); the launch URL `own`.
- A new docs page for external tools (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a course tool added to a scratch course with a test URL, listed, and an LTI activity created from it.
