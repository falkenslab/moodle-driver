# A CodeRunner question's text is empty, and a gap-fill text loses its gaps

Issue: [#109](https://github.com/falkenslab/moodle-driver/issues/109)

## Problem

Reading a quiz attempt gives a CodeRunner question an empty `text`. A gap-fill question's text comes back without its gaps: "The [cat] sat on the [mat]" reads `"matcat\nThe sat on the"`, the draggable words and the sentence with no mark of where each gap goes. Seen in padawan's sandbox run (Moodle 5.2, slots 1 and 3 of the plugins quiz).

## Cause

`src/areas/quizzes/attempts.ts` takes the text from `.qtext`. CodeRunner's renderer writes its text straight into `.formulation`, followed by its examples table, with no `.qtext`. For gap-fill, the inputs sit inside the text, and `innerText` drops them.

## Solution

- With no `.qtext`, take the text from `.formulation`, leaving out the inputs and the question's controls; CodeRunner's examples come with it, as a student reads them.
- Mark each input's place in the text with its field name (for example `[q238:3_p1]`), so a gap can be matched to its field.

## Verification

Tests against the fake Moodle for both shapes. On the sandbox, the plugins quiz's CodeRunner question gives its statement and examples, and its gap-fill question gives the sentence with each gap's field name in place.
