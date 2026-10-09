# Project

## What

`@falkenslab/moodle-driver` is a Node.js library that works a Moodle site with the person's own session, through a real browser (Playwright): no web services, no tokens. It drives Moodle as the person would, and returns plain data.

## What it does

- Drives the system's Edge or Chrome with `playwright-core`, or Chromium downloaded on first use when there is neither (ADR-001), on a persistent profile where the person logs in by hand (ADR-002), keeping the session across restarts (ADR-003).
- Calls Moodle's AJAX services from a logged-in tab, the ones the interface itself uses, and reads pages and forms by their structure where no service helps (ADR-004).
- Covers, so far: courses and their structure, content activities, files, assignments (student and teacher), grading, quizzes, forums, grades, surveys (questionnaire, feedback), the activities overview, deadlines, course updates, creating and editing activities and sections, participants and groups, activity completion and the progress report, the gradebook (grader report, categories, weights), question banks (listing, GIFT and XML imports, single questions), notifications and messages, calendar events, H5P activities (content type, attempts), site information, logging in and out.
- Acts as a student at a person's pace when asked (the trail, ADR-005), so Moodle logs views and completion as for a person.
- Shows the browser on demand and keeps one working tab a program can use (ADR-007).

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
