---
name: update-docs
description: Keep moodle-driver's documentation in step with the code - the doc comments on the public API, README.md and .minispec/ (architecture, conventions, stack, glossary, ADRs). Use after any change to src/, scripts/ or package.json, before every commit of such a change, and before a release. A change is not done until its documentation is.
---

# Keep the documentation up to date

The driver has no documentation site: a program's developer learns it from the doc comments (they ship in `dist/*.d.ts` and show in the editor) and `README.md`; future sessions learn it from `.minispec/`. Code that changes what a program sees, can do or must write, and isn't documented, is unfinished work.

## 1. Find what changed

```
git status --short
git diff --stat
git diff -- src/index.ts src/testing/index.ts
```

For each change, ask: would a program using the driver, or a future session working on it, notice it? Count as yes:

- a new, removed or renamed export, option, parameter, type field or error class;
- a changed default, return shape, behavior or error message;
- a new Moodle area covered, or a write where there was only a read;
- a fix that changes what someone could rely on;
- new or changed scripts, requirements (Node, Playwright, Docker image) or install steps;
- a new rule, decision or term learned while working.

Internal refactors, tests and comments with no visible effect need no change beyond their own comments.

## 2. Update what owns it

- **Doc comments**: every export of `src/index.ts` and `src/testing/index.ts` has one that says what it's for, what it returns and which errors it throws, not how it's built. Check new exports: `git diff -- src/index.ts` lists them, and each must have a `/** … */` at its declaration.
- **`README.md`** (English, for a program's developer): the areas covered in its first paragraph, the "Use" example (it must still compile), the "Development" commands. Touch it only when the change shows at that level.
- **`.minispec/core/project.md`**: "What it does" when a Moodle area is added. `architecture.md`: when a file or piece is added, moved or changes role. `stack.md`: dependencies, Docker image, distribution. `conventions.md`: a new rule. `glossary.md`: a new term. A decision that's hard to reverse: a new ADR (`minispec-adr`), or update the ADR whose rule changed.
- **`CLAUDE.md`**: only commands and things easy to get wrong; don't duplicate `.minispec/`.

Search too: `grep -rn "<the function or option>" README.md .minispec CLAUDE.md` finds every place that mentions it, so none keeps describing the old behavior. Change the existing explanation rather than appending a note that contradicts it.

## 3. Write it

- English (ADR-008), technical and concrete.
- Markdown: one line per paragraph and list item (no hard wraps), no horizontal rules between sections.
- MiniSpec limits: 100 lines per document, `project.md` ≤ 50, `principles.md` ≤ 20. When a document grows past them, cut.
- Nothing of moodle-mcp's tools or MCP in the driver's docs, except naming moodle-mcp as a consumer (ADR-006).

## 4. Commit with the code

The documentation goes in the same commit as the change it describes (or right next to it, `docs: …` / `docs(minispec): …`, when one commit per concern reads better). When the change completes a MiniSpec feature or fix, its issue's closing comment mentions what was documented.

Report which documents you changed, or why none needed to.
