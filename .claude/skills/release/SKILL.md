---
name: release
description: Cut a new moodle-driver release - decide the semver bump (patch vs minor) from the commits since the last tag, bump the version, commit, tag, push, create the GitHub release and publish to npm as @falkenslab/moodle-driver. Only when the user explicitly asks to release or publish.
disable-model-invocation: true
---

# Release moodle-driver

A release is a version commit, a `vX.Y.Z` git tag on `main`, a GitHub release, and the same version published to npm as `@falkenslab/moodle-driver`. Programs install it with `npm install @falkenslab/moodle-driver playwright-core`.

## 1. Preconditions

- The repository has a GitHub remote (`git remote -v` shows `origin`). If not, stop: the first release needs the repo created first (`gh repo create falkenslab/moodle-driver --source . --push`, only if the user asks).
- On branch `main`, working tree clean (`git status --short` empty), up to date with `origin/main` (`git fetch && git status -sb`). If there are uncommitted changes, stop and ask (or use the `commit` skill first if the user wants them included).
- Run the `verify` skill; a release must be green. The sandbox suite (`npm run test:sandbox`) is not part of a release: it takes hours and runs on demand; mention in the notes when it last passed, if it has.
- `gh auth status` works.
- `npm whoami` works (logged in with an account in the `falkenslab` organization). If it doesn't, stop and ask the user to run `npm login` themselves: it's interactive.
- `package.json` has `"publishConfig": { "access": "public" }` (a scoped package is private by default). If it's missing, add it in the release commit and say so.
- **The documentation is up to date.** Run the `update-docs` skill over `git diff <last tag>..HEAD` (or the whole history for the first release): every export documented, the site's guides (`docs/content/`) describing every change a program would notice, README and `.minispec/core/project.md` listing what the driver covers, `project.md` and `stack.md` no longer saying "not published" once it is.

## 2. Decide the bump

Find the last tag: `git describe --tags --abbrev=0` (none: the first release is the version already in `package.json`, `0.1.0`, with no bump). Read `git log <tag>..HEAD --format=%s`.

While the version is `0.x` (current policy):
- **minor** (`0.1.1 -> 0.2.0`): any `feat`, or any breaking change (`!` in a subject / `BREAKING` in a body). In `0.x`, breaking changes bump minor, not major.
- **patch** (`0.1.0 -> 0.1.1`): only `fix`, `docs`, `refactor`, `chore`, `build`, `test` with no API change.
- **major**: only when the user decides to declare `1.0.0`. After `1.0.0`: breaking = major, feature = minor, fix = patch.

If nothing but `docs`/`chore` changed since the last tag, tell the user a release may not be worthwhile and confirm before continuing. State the chosen bump and why; if it is ambiguous, ask.

## 3. Bump

```
npm version <patch|minor|major> --no-git-tag-version
```

This updates `package.json` and `package-lock.json`. `grep -rn "<old version>" README.md .minispec` in case one slipped in.

## 3b. Notes

Draft the release notes in English from the commits since the last tag, grouped as: new (Moodle areas and functions), fixes, breaking changes (with migration hints), internal. Only include what matters to a program using the driver; mention a raised `playwright-core` peer range.

## 4. Commit, tag, push, publish

```
git add package.json package-lock.json   # plus README.md / .minispec if they changed
git commit -m "chore(release): vX.Y.Z"   # plus the attribution trailer required by the session
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
gh release create vX.Y.Z --verify-tag --title "vX.Y.Z" --notes "<notes>"
npm publish
```

`npm publish` runs `prepublishOnly` first (typecheck, lint, `docs:check` and `test:docker`: Docker must be running, and a failure stops the publish), then `prepare` (the build); check with `npm pack --dry-run` beforehand that the tarball holds only `dist/`, `README.md`, `LICENSE` and `package.json`, with `dist/index.d.ts`, `dist/internals.d.ts` and `dist/testing/index.d.ts`. If the account has two-factor authentication, it asks for a one-time code: ask the user for it and run `npm publish --otp=<code>`. A published version can't be reused; if something is wrong after publishing, fix it with a new patch release.

Tags are lightweight (`git tag vX.Y.Z`). Never move or delete an existing tag, and never force-push. If a step fails half-way, report the exact state (what is pushed, what is not) instead of retrying blindly.

## 5. Verify the release

- `git ls-remote --tags origin` shows the tag on the release commit.
- `gh release view vX.Y.Z` works.
- `npm view @falkenslab/moodle-driver version` shows the new version.
- The documentation workflow ran for the release commit (`gh run list --workflow docs.yml --limit 1`) and https://falkenslab.github.io/moodle-driver/ is up.
- Optionally prove the install path in the session scratchpad (not the repo): `npm install @falkenslab/moodle-driver@X.Y.Z playwright-core` and check `node_modules/@falkenslab/moodle-driver/dist/index.js` exists.

Report the version, the tag, the release URL, the npm package page and the notes you published. moodle-mcp depends on the published version (`^X.Y.Z`): a new minor (`0.x`) isn't in its range until someone raises it there, which belongs to moodle-mcp's own session (another repository).
