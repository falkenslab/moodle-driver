# Glossary in the documentation

Issue: [#19](https://github.com/falkenslab/moodle-driver/issues/19)

## Goal

A glossary page in the documentation site that explains the Moodle and driver terms the guides and the API use.

## Context

- The guides and the API use Moodle's terms as Moodle's code names them (submission, assignment, attempt, slot, grade item, override…), which differ from the interface a person sees ("Entrega", "Tarea") and aren't obvious to a programmer new to Moodle.
- Each area page explains its own terms in passing; there's no single place to look one up.
- `.minispec/core/glossary.md` holds the driver's internal terms for agents, not for programs using the driver.

## Changes

- New page `docs/content/reference/glossary.md`, in the Reference sidebar, terms in alphabetical order, one short paragraph each: what it is in Moodle, its name in the interface when it differs, and where it appears in the driver (the functions and fields, linked to the area page).
- Moodle terms: activity and module, course module id (activity id) and instance id, section, assignment, submission (draft, submitted, reopened), grading (simple, rubric, marking guide), extension, quiz, attempt, slot, review, override, question bank and category, gradebook, grade item, grade category, scale, completion, role, group, participant, notification and conversation, calendar event, lesson page, choice, survey (feedback, questionnaire), H5P, sesskey, AJAX service.
- Driver terms: site, profile, session, trail (realistic, fast), working tab, kept tab, shown on demand, data category, `changed`, `MoodleError` code, `/internals`.
- Link each term's first use in the concept and area guides to its entry, where it helps; the intro page points to the glossary.
- Keep `.minispec/core/glossary.md` for agents; no duplication of its wording.

## Acceptance

- The page is in the site's Reference section and `npm run docs:build` passes, with no broken links.
- Every term listed above has an entry, and each entry names the functions or fields where it appears.
- A reader who meets "submission", "slot" or "override" in any area page can reach its definition in one click.
