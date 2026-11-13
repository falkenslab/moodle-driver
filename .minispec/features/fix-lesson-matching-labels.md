# A lesson's matching page gives its selects without the item each one is for

Issue: [#110](https://github.com/falkenslab/moodle-driver/issues/110)

## Problem

On a lesson's matching page, `lessonPage` lists the selects (`response[<id>]`) with their options but no `label`, so a program can't tell which value each one classifies. Seen in padawan's sandbox run (Moodle 5.2, a lesson's page with five values to classify by type).

## Cause

`src/areas/lessons/lessons.ts` takes a field's label from `input.closest("label")`, which works for radios and checkboxes that Moodle wraps in their label. A matching page is a moodleform: each select's label is the form item's own `<label for="id_response_<id>">`, beside the select.

## Solution

When no label wraps the field, take it from `label[for="<the field's id>"]`, or from its `.fitem`'s label column.

## Verification

A test against the fake Moodle with a matching page shaped as Moodle's form. On the sandbox, the lesson's matching page gives each select the value it's for.
