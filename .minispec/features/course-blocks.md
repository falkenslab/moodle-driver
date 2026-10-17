# Blocks: add, configure and remove a course's blocks

Issue: [#79](https://github.com/falkenslab/moodle-driver/issues/79)

## Goal

A teacher reads and changes the blocks on a course's page, such as a text block with a welcome or links.

## Context

- Nothing reads or changes blocks (backups and copies leave them out, `src/areas/backup/backup.ts`).
- Moodle, to confirm on the sandbox: `core_block_get_course_blocks` (with `returncontents`, a text block's content), and in editing mode the course page's "Add a block" (`core_block_fetch_addable_blocks`, then `bui_addblock`), a block's configure form (`bui_editid`), its move (`bui_moveid`) and delete (`bui_deleteid`) actions.
- moodle-mcp needs it.

## Changes

- `courseBlocks(courseId)`: each block's id, type (`html`, `calendar_upcoming`…), title, region, weight, and for a text block its content (HTML).
- `addBlock(courseId, { type, region?, title?, content?, embed? })`: a text block with its title and HTML (local images embedded), or another core block by its name; the block's id returned.
- `configureBlock(courseId, blockId, fields)` (a text block's title and content by name, other blocks' form fields as `setFields` takes them), `moveBlock(courseId, blockId, { region, weight? })`, `deleteBlock(courseId, blockId)`.
- Errors naming a missing capability (`moodle/site:manageblocks`, `block/<type>:addinstance`) and a block type the course page doesn't offer.
- Data category `course-content`; a new docs page for blocks (both languages, ADR-015); fake-Moodle tests.

## Acceptance

- In the sandbox, a scratch course given a text block with a title and content, read back, changed, moved to the other region and removed.
