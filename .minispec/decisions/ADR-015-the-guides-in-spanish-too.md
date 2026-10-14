# ADR-015: The guides in Spanish too

## Decision

The documentation site is in English and Spanish. English stays the source (ADR-008): every guide is written in `docs/content/` first, and its Spanish translation lives in `docs/i18n/es/docusaurus-plugin-content-docs/current/` under the same path, published under `/es/`. The API reference and the command reference are generated from the code's English doc comments and are not translated: the Spanish site shows them in English.

## Motivation

Many of the driver's users are teachers and developers in Spanish-speaking schools and universities, where Moodle itself runs in Spanish. A guide in their language lowers the barrier more than anything else in the docs. Translating the generated references would mean doc comments in two languages in the code, against ADR-008, for pages a developer reads next to the code anyway.

## Consequences

- A change to a guide changes its Spanish page in the same commit (the `update-docs` skill says how and lists the terms to use). `npm run docs:check` fails when a guide exists in one language only, and compiles the Spanish pages' examples too; `npm run docs:build` builds both languages and fails on a broken link or anchor in either.
- Spanish pages keep the English headings' anchors (`## Encabezado {#english-anchor}`), so links and anchors are the same in both languages.
- Diagrams (SVG) keep their English text; their alt text is translated.
- The site's own strings (navbar, footer, sidebar, landing page) are in `docs/i18n/es/*.json`; the landing page's text goes through `<Translate>`.
