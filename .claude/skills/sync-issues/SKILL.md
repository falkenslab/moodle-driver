---
name: sync-issues
description: Keep moodle-driver's MiniSpec feature and fix notes (.minispec/features/) and its GitHub issues in sync, in English - open and link the issue a note lacks, close with a solution summary the issue whose note is done. Use when the user asks to sync issues and features, after creating or finishing a note by hand, or when asked what's pending.
---

# Sync features and issues

Every note in `.minispec/features/` (a feature `<slug>.md` or a fix `fix-<slug>.md`) has exactly one GitHub issue in this repo, and every open issue labelled `feature` or `fix` has its note. Everything is in English (ADR-008): titles, bodies, comments and label descriptions.

If the repository has no GitHub remote yet (`git remote -v` empty), stop and say so: there's nothing to sync until it's created.

## 1. Collect both sides

```
ls .minispec/features/
gh issue list --state all --label feature --limit 100 --json number,title,state,body
gh issue list --state all --label fix --limit 100 --json number,title,state,body
```

A note is linked when it has an `Issue: [#N](<issue URL>)` line right under its title. An issue is linked when its body's last line points to `.minispec/features/<file>.md`.

## 2. Fix each mismatch

- **Note without an issue:** open one (`gh issue create --label feature` or `--label fix`; `gh label create` if the label is missing). Title: what it achieves, for someone who uses the driver (e.g. "Read a quiz's results"). Body: the problem and the proposal in a few sentences (not the note's wording), and a last line `Feature: \`.minispec/features/<slug>.md\`` (`Fix:` for a fix). Then add the `Issue:` line under the note's title, with a blank line before and after.
- **Note with an issue that isn't linked from it:** add the `Issue:` line.
- **Issue not in English:** translate its title and body with `gh issue edit`; don't open a duplicate.
- **Open issue whose note no longer exists:** the work is done or dropped. Find the commits (`git log --oneline -- .minispec/features/<file>.md` and the ones after), then close it with a comment describing the solution and how it was implemented: what changed for a program using the driver, the design choices, how it was verified (tests in Docker, against the sandbox), the commits (`gh issue close N --comment "…"`). If it was dropped, say why instead. Ask the user when you can't tell which.
- **Closed issue whose note still exists:** ask the user whether to reopen the issue or delete the note.

Nothing of moodle-mcp's tools or MCP in issues, except naming moodle-mcp as the consumer that needs something (ADR-006).

## 3. Commit

Commit the notes you linked (`docs: link <slug> to its issue`, with the session's attribution trailer) and push only if the user asked for it. Report a table of notes and issues, and what you opened, edited or closed.

## Rules

- One issue per note, never two; search before creating.
- Never close an issue for work that isn't pushed.
- The notes' own lifecycle (create, implement, delete) belongs to `minispec-feature`, `minispec-bugfix` and `minispec-implement`, which open and close the issue as they go; this skill repairs whatever drifted.
