# ADR-010: A curated entry, and the internals apart

## Decision

`@falkenslab/moodle-driver` exports, by name, what programs call: the `Moodle` object, the operations (the object's methods, also as functions), their types and their errors. The generic primitives the operations are built from (AJAX services, opening pages, forms, date selectors, `inPage`, text and pace helpers, the course editor's actions, the course's raw state) are a second entry, `@falkenslab/moodle-driver/internals`, under the same versioning. An area's parsers and single steps (a quiz attempt's steps, an assignment's grading panel, the page readers) aren't exported at all (decided with the owner, 10 October 2026, before 0.2.0).

## Motivation

Re-exporting every module made the API reference a list of 200 names where the operations drowned among page parsers, and made each of those parsers a promise: a Moodle page changing would be a breaking change. The primitives are worth keeping public, since they're how a program reaches what the driver doesn't cover yet, but apart, so the main entry reads as the driver's surface. Hiding them altogether would leave such programs with deep imports, which the package's `exports` forbids.

## Consequences

- `src/index.ts` lists its exports by name; a new module's exports don't become public by accident. `src/internals.ts` does the same for the primitives.
- `DATA_CATEGORIES` covers the functions of both entries; a test checks it.
- An area's helpers keep being exported from their module so its tests reach them, and are free to change in any release.
- The object keeps `callService`, `openSitePage` and `openForm` as methods: the low-level calls a program makes most, without the context and the site.
