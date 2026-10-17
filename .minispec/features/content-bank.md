# The content bank and H5P content

Issue: [#80](https://github.com/falkenslab/moodle-driver/issues/80)

## Goal

A program works a course's content bank: lists, uploads, renames, downloads and deletes its H5P content.

## Context

- `createActivity` creates an H5P activity from a local package and `h5pActivity` (`src/areas/h5p/h5p.ts`) reads one; nothing reaches the content bank (backups leave it out).
- Moodle, to confirm on the sandbox: `contentbank/index.php?contextid=` (the list), `contentbank/upload.php`, `core_contentbank_rename_content`, `core_contentbank_delete_content`, and each content's download link (a pluginfile URL `downloadFile` may already save).
- moodle-mcp needs it.

## Changes

- `contentBank(courseId)`: each content's id, name, type, author, created and modified dates, and its file URL.
- `uploadToContentBank(courseId, file)` (a local `.h5p`), `renameContent(contentId, name)`, `downloadContent(contentId, file)` (or `downloadFile` with its URL, if that's enough), `deleteContent(contentId)`.
- Optional, as the issue says: creating an H5P activity from a content's file instead of a local package; a choice to settle on the sandbox.
- Errors naming a missing capability (`moodle/contentbank:access`, `moodle/contentbank:upload`, `moodle/contentbank:manageowncontent`, `manageanycontent`, `downloadcontent`).
- Data category `course-content`; docs in the H5P page (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, an `.h5p` file uploaded to a scratch course's content bank, listed, renamed, downloaded and deleted.
