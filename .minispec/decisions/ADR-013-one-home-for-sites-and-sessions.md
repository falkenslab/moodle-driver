# ADR-013: One home for sites and sessions

## Decision

The `moodle` command keeps everything in `~/.moodle-driver` on every system (`MOODLE_DRIVER_HOME` moves it): `config.json` with the default site, and a folder per site, `sites/<host>/`, with its `site.json` (its URL, the named profile it uses unless told, a profile folder of the person's own if given) naming the default profile, and its browser profiles, one per account: `profiles/<name>/`. A login without `--as` on a site with no default names its profile after the person's Moodle username (`user-<id>` when Moodle doesn't give it), logging in with a provisional folder first; the profile last logged in with becomes the default. Every account is a name in one place, no special folder for the first one. `moodle sites` lists them and `moodle forget` deletes one. The library exports `siteProfileDir(site, { as, home })`, the same folder, and still chooses none by itself. Decided with the owner, 11 October 2026: no command had been released before, so there's nothing to move from the first layout.

## Motivation

The first version followed each system's custom: `~/.config/moodle-driver` (XDG) on Linux and macOS, `%APPDATA%\moodle-driver` on Windows. `%APPDATA%` is the roaming folder, which networks with roaming profiles (universities, companies) copy between machines, and a browser profile weighs tens to hundreds of MB. A path that changes by system was also harder to find and to explain, and one site's data was split between `config.json` and a profile folder. One folder per site makes listing and forgetting a site trivial, and makes room for several accounts on one site.

## Consequences

- Linux users who keep everything under XDG folders set `MOODLE_DRIVER_HOME`.
- A program that wants to share the command's sessions passes `siteProfileDir(site)` as `profileDir`; one browser at a time per profile still holds, so the command and the program can't use it at once.
- `--profile` and `MOODLE_PROFILE` still win over all of this; a folder given to `login --profile` is remembered in the site's `site.json`.
- `moodle sites` says whether a profile has a session file, not whether Moodle still accepts it.
