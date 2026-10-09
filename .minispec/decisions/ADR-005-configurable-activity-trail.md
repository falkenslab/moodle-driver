# ADR-005: Configurable activity trail for student actions

## Decision

Functions that view or do something as a student (read content, attempt quizzes, later watch videos) take a `trail` option: `realistic` (the default) goes through the real pages at a person's pace, so Moodle logs views and completion as for a person; `fast` uses AJAX, print pages and direct file URLs where possible, leaving less or no trail. Reads that leave no trail anyway (course structure, grades) don't take it. Moved from moodle-mcp's ADR-012 when the driver was extracted (9 October 2026).

## Motivation

A student's agent (padawan) has rules asking for a realistic trail (no direct file URLs, real page visits, human pace), and Moodle's completion often depends on views. Other programs only want the content, fast. The owner chose an option (decided 9 October 2026).

## Consequences

- Each function documents what it does in each mode, and its result says how it went (`trail`, `readingSeconds`).
- `realistic` pacing adds pauses (`pace.ts`: about 240 words a minute, bounded); functions report them through an `onProgress` callback so a program can keep its caller waiting.
- `fast` may leave activities incomplete.
