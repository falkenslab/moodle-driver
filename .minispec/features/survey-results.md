# Results of choices, feedback and questionnaires, for teachers

Issue: [#70](https://github.com/falkenslab/moodle-driver/issues/70)

## Goal

A teacher reads what people answered in a choice, a feedback activity or a questionnaire.

## Context

- The driver answers them as a student (`getChoice`, `answerChoice` in `src/areas/surveys/choice.ts`; `getSurvey`, `submitSurvey` in `surveys.ts`), but reads no one else's answers.
- Moodle, to confirm on the sandbox: `mod_choice_get_choice_results` and `mod/choice/report.php`; feedback's `mod/feedback/analysis.php` and `show_entries.php` (or `mod_feedback_get_analysis`, `get_responses_analysis`); the questionnaire plugin's `mod/questionnaire/report.php`. Each has its own download (CSV, Excel).
- moodle-mcp needs it.

## Changes

- `choiceResults(activityId)`: each option with its count and, where the choice isn't anonymous to the teacher, who chose it (user ids and names).
- `surveyResults(activityId, { type? })` for feedback and questionnaire, as `getSurvey` tells them apart: per question its answers (by person where not anonymous) and the counts or averages Moodle shows.
- Optional, as the issue says: exporting them as Moodle does to a local file; a choice to settle on the sandbox.
- Errors naming a missing capability (`mod/choice:readresponses`, `mod/feedback:viewreports`, `mod/questionnaire:readallresponses`), and the questionnaire plugin not installed.
- Data categories: `others-aggregate` for the counts, `others-personal` where answers carry names.
- Docs in the surveys and choices page (both languages, ADR-015); fake-Moodle tests, anonymous and named.

## Acceptance

- In the sandbox, a choice and a feedback (and a questionnaire, where installed) in a scratch course, answered by the student, then read as the teacher: counts and answers match.
