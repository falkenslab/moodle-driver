# Feedback activities: build their questions

Issue: [#77](https://github.com/falkenslab/moodle-driver/issues/77)

## Goal

A teacher builds a feedback activity's questions through the driver.

## Context

- `getSurvey` and `submitSurvey` (`src/areas/surveys/surveys.ts`) read and answer a feedback as a student; `createActivity` creates an empty one; nothing writes its items.
- Moodle, to confirm on the sandbox: `mod/feedback/edit.php?id=` (the items in order, with move and delete actions), `edit_item.php?cmid=&typ=<type>` (one form per item type), and the templates on `edit.php` (use one, save the current items as one).
- moodle-mcp needs it.

## Changes

- `feedbackItems(activityId)`: in order, each item's id, type (multiple choice, rated multiple choice, short text, long text, numeric, information, label, page break), question, options, required and position.
- `addFeedbackItem(activityId, { type, question, options?, required?, after? })`, `editFeedbackItem(activityId, itemId, …)`, `moveFeedbackItem(activityId, itemId, position)`, `deleteFeedbackItem(activityId, itemId)`.
- Optional, as the issue says: using one of the site's templates and saving the items as one; a choice to settle on the sandbox.
- Errors naming a missing capability (`mod/feedback:edititems`, `mod/feedback:createprivatetemplate`, `mod/feedback:createpublictemplate`) and an item type Moodle doesn't offer; `changed` and the item's id returned.
- Data category `course-content`; docs in the surveys and choices page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a feedback in a scratch course given one item of each type, read back, then answered by the student with `submitSurvey`.
