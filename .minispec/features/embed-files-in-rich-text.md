# Images and files embedded in rich text

Issue: [#52](https://github.com/falkenslab/moodle-driver/issues/52)

## Goal

Put images and files inside the HTML a function writes (a page, a label, a description, a forum post), as a person inserting an image in Moodle's editor does.

## Context

- Text goes in as HTML, and Moodle keeps the files a text shows in the editor's own draft area (the field's `[itemid]`), which no function reaches: `files` is only a file resource's, a folder's or a package's.
- Asked in a moodle-mcp test session (falkenslab/moodle-mcp#1): a teacher couldn't put an image in a page, a label, a description or a forum post.
- `uploadToDraft` already uploads to a form's draft area; the editor's draft URL (`draftfile.php/<context>/user/draft/<itemid>/<name>`) is what the editor writes into the HTML, and Moodle rewrites it to `@@PLUGINFILE@@` on saving.

## Changes

- An option on the functions that write rich text (`createActivity`, `updateActivity`, `addSection`, `editSection`, `startDiscussion`, `replyToPost`, `editPost`, and `updateCourse`'s summary): local files to embed (`embed: ["/path/shot.png"]`).
- Each is uploaded to that editor's draft area, and the `src` and `href` in the HTML that name the file (`<img src="shot.png">`) are rewritten to its draft URL before saving; a name the HTML uses with no file given, or a file the HTML doesn't use, is refused before anything is sent.
- Docs: the files page and each area page that gains the option; fake-Moodle tests (the upload and the rewritten HTML posted).

## Acceptance

- In the sandbox, a page created with `<img src="shot.png">` and that file shows the image to the student (the image's URL in `activityContent` downloads with `downloadFile`).
- A forum reply with an embedded image shows it to the other participant.
