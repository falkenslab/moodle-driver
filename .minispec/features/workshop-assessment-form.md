# Workshop: set and read its assessment form

Issue: [#104](https://github.com/falkenslab/moodle-driver/issues/104)

## Goal

A program can define a workshop's assessment form for its grading strategy and read it back.

## Context

- The driver assesses workshop submissions through the assessment form, but can't define it: after creating a workshop, its aspects or criteria have to be typed in Moodle (*Assessment form*).
- Each strategy has its own edit form: `accumulative` (aspects with a grade and a weight), `comments` (aspects only), `numerrors` (assertions with a weight and a grade mapping), `rubric` (criteria with levels).
- `setRubric` already does the equivalent for assignments. Asked from moodle-mcp (falkenslab/moodle-mcp#61).

## Changes

- `setWorkshopForm` (name to decide): the strategy's aspects or criteria as that strategy takes them, saved through `mod/workshop/editform.php`, adding blank rows as Moodle's form does.
- Read it back: the strategy and its aspects or criteria.
- Refuse a change once assessments exist, as Moodle warns, unless asked.
- In `src/areas/workshops/`, doc comments, the workshops page in both languages, `npm run cli:generate`.

## Acceptance

- For each of the four strategies, a form set is read back the same (tests in Docker, and on the sandbox in a test course).
- A strategy's input given for another strategy is refused with a message naming the workshop's strategy.
