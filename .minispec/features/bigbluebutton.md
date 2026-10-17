# BigBlueButton: sessions and recordings

Issue: [#81](https://github.com/falkenslab/moodle-driver/issues/81)

## Goal

A program reads a BigBlueButton activity's state and recordings, manages the recordings and gives the person the join URL.

## Context

- `createActivity` creates a BigBlueButton activity; nothing reads it afterwards.
- Moodle's services, to confirm on the sandbox: `mod_bigbluebuttonbn_meeting_info`, `can_join`, `get_join_url`, `get_recordings`, `update_recording` (publish, unpublish, protect, unprotect, delete).
- moodle-mcp needs it.

## Changes

- `bigBlueButton(activityId)`: open or not, its schedule (opening and closing times), whether the person can join, and the recordings (id, name, date, length, URL, published or not).
- `setRecordingPublished(activityId, recordingId, published)` and `deleteRecording(activityId, recordingId)`; whether "hiding" in the issue means unpublishing or Moodle's protect is a choice to settle on the sandbox.
- `bigBlueButtonJoinUrl(activityId)`: the person's join URL, opened by the person, never joined by the driver.
- Errors naming a missing capability (`mod/bigbluebuttonbn:join`, `mod/bigbluebuttonbn:managerecordings`) and a site whose BigBlueButton server isn't configured (a clear error, never an empty state).
- Data categories: the state and recordings `course-content` (recordings show people: `others-personal` too); managing them `course-content`; the join URL `own`.
- A new docs page for BigBlueButton (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, where the server is configured: an activity's recordings listed, one published and hidden; otherwise the state read and the missing server's error checked.
