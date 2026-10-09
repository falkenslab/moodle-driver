---
name: commit
description: Create smart, atomic commits for moodle-driver following the repo's conventions (Conventional Commits, English messages, grouped by logical change). Use whenever the user asks to commit, or when finishing a piece of work that should be committed.
---

# Smart commits for moodle-driver

Only commit when the user asked for it. Never push from this skill unless the user also asked to push.

## 1. Understand what changed

Run `git status --short` and `git diff --stat`, then read the diffs. Other sessions or the user may have changed files too: commit only what belongs to the work at hand, and mention anything unrelated instead of sweeping it in. Never commit `dist/`, `node_modules/`, browser profiles or secrets (`.env`, cookies, tokens).

## 2. Verify

Run the `update-docs` skill first when the change touches `src/`, `scripts/` or `package.json`: the README, `.minispec/` and the doc comments must describe it before it's committed. Then run the `verify` skill. Do not commit a tree that fails typecheck, lint or tests, nor a visible change without its documentation.

Check the diff against the rules that are easy to break: nothing of MCP, moodle-mcp's tools or `MOODLE_MCP_*` settings in code or messages (ADR-006), no `console.*` in `src/`, no password handled anywhere (ADR-002).

## 3. Group into atomic commits

One logical change per commit, ordered so each commit builds on the previous ones (nothing imports something introduced by a later commit). Typical groups: a feature or fix together with its tests, a refactor/move on its own, `.minispec/` docs on their own, dependency/tooling changes on their own.

- Stage by path (`git add <paths>`), never `git add -A` blindly; check `git status --short` after staging.
- When one file mixes two concerns, split the hunks: `printf 'y\nn\n' | git add -p <file>` (answers per hunk), then check with `git diff --cached`.
- Use `git mv` for moves so history follows the rename, and keep pure renames free of content changes.

## 4. Write the message

Format: `type(scope): description`, lowercase type, no trailing period. Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `build`, `test`. The scope is optional; when one helps, use the Moodle area (`quiz`, `forum`, `assign`, `grading`, `activities`, `survey`…) or the piece (`browser`, `ajax`, `forms`, `testing`, `docker`, `deps`, `minispec`, `release`).

- **Language: English** for the subject and body (ADR-008).
- Breaking API change: add `!` after the type/scope (`refactor(forum)!: ...`) and say what breaks and what to use instead. A change that breaks moodle-mcp's typecheck is breaking.
- The body explains *why* (the problem, the constraint, the Moodle behavior confirmed empirically and on which version), not a line-by-line list of what changed. Keep the subject under ~72 columns; wrap the body at ~80.
- A commit that completes a MiniSpec feature or fix with a GitHub issue says `Closes #N` in its body (see `minispec-implement`).
- End the message with the attribution trailer that the session's instructions require for commits (do not invent your own).
- Pass the message through a HEREDOC to keep formatting.

## 5. Finish

Run `git status --short` (must be clean unless you deliberately left unrelated changes) and `git log --oneline -n <commits made>`. Report the commits created. Never use `--no-verify`, `--amend` on pushed commits, or force-push.
