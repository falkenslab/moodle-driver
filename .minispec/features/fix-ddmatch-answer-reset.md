# A drag-and-drop matching answer is reported saved, then reset by the question's script

Issue: [#108](https://github.com/falkenslab/moodle-driver/issues/108)

## Problem

`answerQuizQuestions` reports a ddmatch question (`qtype_ddmatch`) saved, but Moodle keeps it empty: every select is back at "Choose..." (0) when the page is saved, and the review grades it not answered. Seen in padawan's sandbox run (Moodle 5.2, slot 4 of the plugins quiz).

## Cause

`setField` (`src/core/forms.ts`) sets a select through `option.selected` and then dispatches `change`. ddmatch's script listens to that `change` on its fallback select and reads the choice from the `selected` attribute, which still marks option 0: it treats the place as empty and sets the select back to 0.

## Solution

For a select, move the `selected` attribute to the chosen option(s) as well, before dispatching `change`. After the event, read the field back: if a script changed it, fail with a clear error instead of reporting it saved. Check gapselect and ddwtos the same way.

## Verification

A test against the fake Moodle with a script that resets a select from the attribute. On the sandbox, a ddmatch answer is saved and the review shows it answered; the same for gapselect and ddwtos.
