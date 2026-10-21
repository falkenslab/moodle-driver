# The question types a site has enabled

Issue: [#90](https://github.com/falkenslab/moodle-driver/issues/90)

## Goal

A program can read which question types a site offers, as a bank's "Add a question" chooser shows them, before it picks one to create.

## Context

- `createQuestion` makes the types in `QUESTION_TYPES` (core and four plugins, `src/areas/questions/types.ts`), opening the type's edit form directly (`question/bank/editquestion/question.php?…&qtype=<type>`): nothing reads which types the site actually has. A type may be disabled, or a plugin may be missing or installed beyond the driver's list.
- The only way today is inferring them from questions already in a bank, which says nothing in an empty course.
- moodle-mcp needs it for a tool that lists the types (falkenslab/moodle-mcp#49).

## Changes

- A function, by bank (as the other bank functions take it, so 4.x course banks work: there a bank's id is its course's id), that reads the "Add a question" chooser: each type's internal name (`multichoice`, `coderunner`…), the name Moodle shows, whether it's a plugin (not core), and the chooser's group when it groups them (questions, other).
- Moodle 4.5 and 5.x, Boost and Classic; `QUESTION_TYPES` stays what the driver can make.
- A `moodle` command (`npm run cli:generate`), doc comments, the question bank guides in both languages.
- Fake-Moodle tests for the chooser's shapes (5.x and 4.5), and sandbox checks on both series.

## Acceptance

- On the 5.2 sandbox (CodeRunner, Formulas, Gap fill, drag and drop matching installed) and the 4.5 one: the list matches the chooser, plugins marked.
- A type disabled in the site's question type settings isn't listed.
