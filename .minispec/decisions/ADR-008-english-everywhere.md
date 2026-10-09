# ADR-008: English everywhere in the repository

## Decision

Code, comments, documentation, `.minispec/`, error messages and commit messages are in English. Conversation with the owner may be in Spanish.

## Motivation

The same rule as moodle-mcp (its ADR-006): the library is meant for other programs and other people, and one language keeps the repository consistent. Moodle sites may be in any language; the driver reads them by structure, not by text (ADR-004).

## Consequences

- Test fixtures may hold Spanish Moodle content, as data.
