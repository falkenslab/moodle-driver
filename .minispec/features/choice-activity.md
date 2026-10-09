# Choice activity

## Goal

Read and answer a choice activity.

## Context

- No run needed it yet; it's the last survey-like student activity.
- AJAX: `mod_choice_get_choice_options`, `mod_choice_submit_choice_response` (instance id from the view page); availability to confirm.

## Changes

- `"choice"` as a `SurveyType` in `getSurvey` and `submitSurvey` if its form fits their layout model; otherwise `moodle/choice.ts` with `getChoice()` and `answerChoice()`.
- Read: options with ids and limits, whether the answer can be changed, the current answer.

## Acceptance

- A choice in course 3 is answered, and reading it again shows the answer.
- A closed choice gives Moodle's message.
