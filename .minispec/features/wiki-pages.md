# Wikis: read and edit pages

Issue: [#74](https://github.com/falkenslab/moodle-driver/issues/74)

## Goal

A program reads a wiki's pages and their history, and creates and edits pages as the person.

## Context

- Nothing reads or writes a wiki: `createActivity` creates one, `activityContent` doesn't read its pages.
- Moodle's services, to confirm on the sandbox: `mod_wiki_get_subwikis` (group and individual wikis), `get_subwiki_pages`, `get_page_contents`, `get_page_for_editing` (which takes the edit lock), `new_page`, `edit_page`; the history is only on `mod/wiki/history.php?pageid=`.
- moodle-mcp needs it.

## Changes

- `wikiPages(activityId, { groupId?, userId? })`: the pages of the person's subwiki (or the one asked): id, title, links to other pages, last change and its author.
- `wikiPage(activityId, pageId, { history? })`: its content (HTML, images as `activityContent` gives them) and, with `history`, its versions (number, date, author).
- `createWikiPage(activityId, { title, content, groupId?, userId?, embed? })` and `editWikiPage(activityId, pageId, { content, section?, embed? })`, with local images embedded; a page locked by someone else is an error naming who holds it, never overridden.
- Errors naming a missing capability (`mod/wiki:createpage`, `mod/wiki:editpage`, `mod/wiki:viewpage`); `changed` and the page's id returned.
- Data categories: reading `course-content` and `others-personal` (pages and versions carry their authors); writing `course-content` (`own` in an individual wiki is a choice to settle).
- A new docs page for wikis (both languages, ADR-015); fake-Moodle tests, the lock included.

## Acceptance

- In the sandbox, a collaborative wiki in a scratch course: pages created and edited by the teacher and the student, read with their history.
