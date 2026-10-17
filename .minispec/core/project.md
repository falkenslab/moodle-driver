# Project

## What

`@falkenslab/moodle-driver` is a Node.js library that works a Moodle site as any user, with their own login: no web services, no tokens, no admin. The person logs in once in a browser window (Playwright, ADR-001, ADR-002); the driver then works the site with that session as the person would, and returns plain data.

## What it does

- Drives the system's Edge or Chrome with `playwright-core`, or Chromium downloaded on first use when there is neither (ADR-001), on a persistent profile where the person logs in by hand (ADR-002), keeping the session across restarts (ADR-003).
- Calls Moodle's AJAX services over HTTP with the person's session (ADR-011), the ones the interface itself uses, and reads pages and forms by their structure where no service helps (ADR-004).
- Covers, so far: courses (their settings, and resetting them) and their structure, the blocks on a course's page, copying, backing up (whole or in part), restoring and importing courses, and reading backup files and making them anonymous, content activities (a book's chapters written too), files, assignments (student and teacher, group submissions included), grading (rubrics and marking guides, defining them too, feedback files, the marking workflow), extensions and quiz overrides, quizzes (their results, statistics, questions and grading by hand), forums (posting, editing, deleting, subscribing to discussions, their moderation, whole-forum grades, ratings), workshops (phases, submitting, example submissions, allocating reviewers, assessing, calculating and overriding grades), grades, surveys (questionnaire, feedback, choice; answering them, their results for teachers, and building a feedback's questions and templates), the activities overview, deadlines, course updates, creating and editing activities and sections (files, descriptions, access restrictions, completion), participants and groups (enrolling, unenrolling, roles, groups and groupings, enrolment methods, notes about participants, enrolling, unenrolling, roles, groups and groupings, auto-created or imported from CSV too, enrolment methods), a course's logs and its activity and participation reports, activity completion and the progress report, course completion (its criteria, each participant's status, marking by hand), course badges (creating them, their criteria, enabling, awarding by hand), the gradebook (grader report, exports, CSV imports, grading and overriding in it, items, categories, weights, scales, grade letters), question banks (listing, GIFT and XML imports and exports, single questions of every type created, edited and deleted, categories organized and questions moved between them), notifications and messages, calendar events (creating, changing, deleting), H5P activities (content type, attempts) and a course's content bank (listing, uploading, renaming, downloading, deleting), SCORM activities (attempts, SCOs, the player), external tools (LTI: a course's tools, adding its own, activities made from them, the launch URL), databases (fields, templates, presets, entries and their CSV export and import), glossaries (entries written and approved, categories, XML export and import), lessons (going through them, and building their pages), site information, logging in and out.
- Offers every operation as a `moodle` command too, generated from the API (ADR-012).
- Acts as a student at a person's pace when asked (the trail, ADR-005), so Moodle logs views and completion as for a person.
- Shows the browser on demand and keeps one working tab a program can use (ADR-007); `moodle open` keeps one in the background that separate commands and programs share, behind a token (ADR-014).

## What it doesn't do

- Know about its consumers: no MCP, no agents, no tool names (ADR-006).
- Watch, play or transcribe media: it gives a video's URL or saves the site's files.
- Pseudonymize people: a consumer does it with `@falkenslab/pseudonym` (moodle-mcp's ADR-013).

## For whom

- Programs that work Moodle for a person: first `moodle-mcp` (sibling repository), an MCP server for agents; next, CLIs such as importing and exporting activities.

## Goal

Let any program do in Moodle what the person can do, with their own session, without ever handling their password.

## Status

Not on npm yet: what moodle-mcp had, extracted on 9 October 2026; consumed from the sibling folder (`file:../moodle-driver`). New Moodle areas come one feature at a time (see `features/`).
