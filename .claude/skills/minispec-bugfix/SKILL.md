---
name: minispec-bugfix
description: Document a bug and its fix as a MiniSpec bugfix note under .minispec/features/ from the bugfix template. Use when fixing a non-trivial bug worth recording.
---

# MiniSpec: new bugfix

Document a bug and its fix using the bugfix format. It is temporal knowledge, so
it lives under `.minispec/features/`.

## Steps

1. Read `.minispec/README.md` for the standard.
2. Read the template `.minispec/templates/bugfix.md`.
3. Create `.minispec/features/fix-<slug>.md` with `<slug>` in kebab-case.
4. Fill the four sections:
   - **Problem** — observable symptom.
   - **Cause** — root cause.
   - **Solution** — what was changed.
   - **Verification** — how the fix was confirmed.
5. Open its GitHub issue, one per note, in this repo: title and body in English (ADR-008) (the symptom as a program using the driver sees it, and the cause), label `fix` (`gh label create fix` if the repo lacks it), and a last line `Fix: \`.minispec/features/fix-<slug>.md\``. Then link the note to it: a line `Issue: [#N](<issue URL>)` right under the note's title. When the fix is committed, close it as `minispec-implement` says (`Closes #N` in the commit, then the summary comment). If the repo has no GitHub remote yet, skip this step and say so; `sync-issues` opens it later.

## Rules

- Max 100 lines. Short and factual. Base it on the real diff.
- Temporal: once the fix is merged and verified, delete this file. If the fix
  revealed a permanent lesson (a rule, a decision), promote it to `core/` or an
  ADR first. Mention this; do not delete now.
