# A book's chapters: list, add, edit, move and remove

Issue: [#62](https://github.com/falkenslab/moodle-driver/issues/62)

## Goal

A program reads and writes a book's chapters, which hold its content.

## Context

- `createActivity` creates a book, but empty; `activityContent` reads a book's text, but nothing lists its chapters with their ids or writes them (Moodle's `mod/book/edit.php` form, and the move, show/hide and delete links of the book's table of contents in editing mode).
- moodle-mcp needs it (falkenslab/moodle-mcp#18).

## Changes

- `bookChapters(activityId, { content? })`: each chapter's id, title, subchapter or not, hidden or not and order, and its HTML (and images, as `activityContent` gives them) with `content`.
- `addBookChapter(activityId, { title, content, subchapter?, hidden?, after? })`, `editBookChapter(activityId, chapterId, { title?, content?, subchapter? })`, `moveBookChapter(activityId, chapterId, { up | down })` or to a position, `setBookChapterVisible`, `deleteBookChapter`; whatever reads clearer in the API, one function per thing a person does on the page.
- `embed` for images in the content, as `createActivity` does for a page's content (`src/core/embed.ts`).
- `changed` sentences and the chapter's id returned; errors for a chapter not in the book; data category course content; docs in the content and activities pages (both languages); fake-Moodle tests.

## Acceptance

- In the sandbox, on a book in a scratch course: two chapters and a subchapter added, one with an embedded image, one edited, one hidden, one moved and one removed, each read back as set; the student sees the hidden one missing.
