# One home for sites and sessions

Issue: [#23](https://github.com/falkenslab/moodle-driver/issues/23)

## Goal

Keep the `moodle` command's sites, profiles and sessions in one folder, the same on every system (`~/.moodle-driver`), one subfolder per site, with commands to list and forget sites and named profiles for several accounts on one site.

## Context

- Today the command keeps `config.json` (the default site, a profile folder per site) and `profiles/<host>/` under `~/.config/moodle-driver` on Linux and macOS (`$XDG_CONFIG_HOME` when set) and `%APPDATA%\moodle-driver` on Windows (ADR-012).
- `%APPDATA%` is the roaming folder: in networks with roaming profiles (universities, companies) a Chromium profile, tens to hundreds of MB, would be copied between machines.
- A path that changes by system is harder to find and to document; one site's data is split between `config.json` and a profile folder.
- Only one profile per site is remembered: a second account on the same site needs `--profile` on every command. There's no command to list or forget sites.
- The library chooses no paths: a program passes `profileDir` (ADR-006); a program that wants to share sessions with the command can't find them without knowing these rules.
- Decided with the owner (11 October 2026): `~/.moodle-driver` on every system.

## Changes

- The command's home: `~/.moodle-driver` everywhere (`os.homedir()`), or `MOODLE_DRIVER_HOME`:
  - `config.json`: the default site (and future options).
  - `sites/<host>/site.json`: the site's exact URL; `sites/<host>/profile/`: its browser profile, `moodle-session.json` inside; `<host>` as now (`localhost:8080` is `localhost_8080`).
  - Named profiles: `sites/<host>/profiles/<name>/`, chosen with `--as <name>` (or `MOODLE_AS`) and remembered per site by `moodle login --as <name>`.
- `--profile <dir>` and `MOODLE_PROFILE` keep working, over all of this.
- `moodle sites`: every site with its profiles, which is the default and whether its session file exists (not whether Moodle still accepts it); `--json` as everywhere.
- `moodle forget <site> [--as <name>]`: deletes that site's folder (or one profile), after saying what it deletes; the default site moves to none.
- A library helper `siteProfileDir(site, { as?, home? })` (main entry): the folder the command uses, so a program can share its sessions; the library still never chooses one by itself.
- Migration: a home in the old place is moved on first run, said once on standard error; nothing else to keep.
- Docs: the command line guide (where things are, several sites and accounts), the glossary (profile, site), an ADR or ADR-012 updated, the README if it names the paths.
- Tests in Docker with a temporary home: login per site, `--as`, `sites`, `forget`, the migration, `MOODLE_DRIVER_HOME`, `siteProfileDir`.

## Acceptance

- On Windows, Linux and macOS, `moodle login --site X` leaves `~/.moodle-driver/sites/<host>/profile/moodle-session.json` and `site.json`, and `config.json` names X as the default.
- `moodle sites` lists every site and profile; `moodle forget` removes one site or profile and nothing else.
- Two accounts on one site work with `--as`, without `--profile`.
- `siteProfileDir()` gives the same folder the command uses; the library's other behavior doesn't change.
