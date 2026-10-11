# The command line

Every operation of the driver is also a command of `moodle`, for trying it, scripting it from a shell, or checking something on a site without writing a program. It comes with the package and needs nothing else.

**Terms:** [site](../reference/glossary.md#site), [profile](../reference/glossary.md#profile), [data category](../reference/glossary.md#data-category), [changed](../reference/glossary.md#changed).

## Install

Everywhere, as a command of your system:

```bash
# Once it's on npm
npm i -g @falkenslab/moodle-driver

# Meanwhile, from a clone
git clone https://github.com/falkenslab/moodle-driver.git
cd moodle-driver && npm install && npm link
```

`npm i -g github:falkenslab/moodle-driver` doesn't work: npm builds a package installed from git with its development dependencies, and a global install puts those in the wrong place (an npm bug, not the driver's). `npm link` from a clone does the same and works.

In a project that already uses the library, it's there too: `npx moodle …` runs it from `node_modules/.bin`, handy to look at what a function returns while you write your program. Without installing anything: `npx -p @falkenslab/moodle-driver moodle …`.

The npm package `moodle-cli` (another project) also installs a command named `moodle`: with both installed globally, npm refuses the second.

## Log in once

```bash
moodle login --site https://campus.example.org/
```

A browser window opens at the site's login page; log in there as you always do (single sign-on and two-factor included). The command remembers the site, and keeps the session in a browser profile of its own, one per site, in `~/.moodle-driver` (see [Where things are](#where-things-are)). From then on, no window and no `--site`:

```bash
moodle who-am-i
moodle list-courses
moodle my-grades 3
```

When Moodle ends the session, a command says `not-logged-in` and `moodle login` opens the window again.

## Commands, arguments and options

A command is a method of the [Moodle object](../concepts/calling-functions.md), in kebab-case or as the method is written: `moodle list-courses` and `moodle listCourses` are the same. Its arguments come in order, and its options as `--name value`:

```bash
moodle course-structure 3 --details
moodle grade-submission 35 7 --grade 8.5 --feedback "<p>Well argued.</p>" --notify
moodle participants 3 --role 5 --inactive-since 2026-10-01
moodle save-submission 45 --files factorial.py,notes.md --online-text "<p>Done.</p>"
moodle call-service core_course_get_recent_courses --limit 5
```

- Numbers, dates (`2026-11-30`, `2026-11-30T18:00:00Z`), lists (`1,2,3`, or the option repeated) and switches (`--notify`, `--no-notify`, or `--notify=false`) are converted as each parameter takes them; a value outside a list of choices says which are valid.
- Local files can be relative: they're taken from the current folder. `download-file` saves into the current folder unless given another.
- An argument that's an object or a list of objects goes as JSON: `moodle answer-choice 40 2,3`, `moodle submit-survey 34 '{"textfield_12":"Clear"}'`.
- `--json '{…}'` gives the whole options object at once, for what flags make awkward.

`moodle help` lists every command with what it does; `moodle help <command>` (or `--help` after it) shows its arguments, options and the data it touches. The [commands reference](../reference/commands.md) has them all.

## What it prints

At a terminal, results come as tables and key-value lines, and writes say first what they changed:

```text
$ moodle list-courses
id  shortname  fullname          category    url                                       visible
--  ---------  ----------------  ----------  ----------------------------------------  -------
3   loops      Loops in Python   Computing   https://campus.example.org/course/view…   true

$ moodle set-completion 42 true
✔ Activity 42 marked done.
```

With `--json`, or when the output goes to a pipe or a file, it prints exactly what the method returns, as JSON:

```bash
moodle deadlines --days 7 --json | jq -r '.[] | "\(.date[0:10]) \(.activity)"'
moodle grader-report 3 > grades.json
```

Errors go to standard error as `code: message` (the [error codes](../concepts/errors.md)), with exit status 1; a command line that doesn't fit exits with 2 and says what would.

## Global options

| Option | What it does |
| --- | --- |
| `--site <url>` | The Moodle site; or `MOODLE_SITE`; remembered after `moodle login` |
| `--as <name>` | A named profile on the site, for another account; or `MOODLE_AS`; `--as default` is the site's own |
| `--profile <dir>` | A browser profile folder of your own, over everything else; or `MOODLE_PROFILE` |
| `--json` | Print JSON even at a terminal |
| `--show` | Show the browser while the command works (see [The browser](../concepts/browser.md)) |
| `--allow <categories>` | Refuse commands that touch other [data categories](../concepts/data-categories.md): `--allow own,course-content` reads your own data and the courses, nothing about others |
| `--help`, `--version` | Help, and the driver's version |

## Several sites and accounts

Log in to each site once; the last one is the default, and `--site` (or `MOODLE_SITE`) picks another for one command. `moodle login` on a site whose session is still alive opens no window: it only makes that site the default.

```bash
moodle login --site https://campus.uni-a.es/
moodle login --site https://aulavirtual.uni-b.es/
moodle --site https://campus.uni-a.es/ list-courses
```

For another account on the same site (a teacher and a student, say), give it a name: each name is a profile of its own, with its own session. The site remembers the name last logged in with; `--as` (or `MOODLE_AS`) picks another, and `--as default` is the site's own profile.

```bash
moodle login --site https://campus.uni-a.es/ --as student
moodle --as student my-grades 3
moodle --as default who-am-i
```

`moodle sites` lists every site and profile: which is the default and whether it has a session file (Moodle may still have ended the session). `moodle forget <site>` deletes a site with its profiles and sessions, and `moodle forget <site> --as <name>` one profile.

```text
$ moodle sites
site                            profile  default  session  path
------------------------------  -------  -------  -------  -----------------------------------------------------------
https://aulavirtual.uni-b.es/   default  true     true     /home/ada/.moodle-driver/sites/aulavirtual.uni-b.es/profile
https://campus.uni-a.es/        default  false    true     /home/ada/.moodle-driver/sites/campus.uni-a.es/profile
https://campus.uni-a.es/        student  false    true     /home/ada/.moodle-driver/sites/campus.uni-a.es/profiles/student
```

## Where things are

Everything is in `~/.moodle-driver`, the same on Windows, Linux and macOS (`MOODLE_DRIVER_HOME` moves it, for instance to keep it under `~/.config` or on a server's data disk):

```text
~/.moodle-driver/
├── config.json                  the default site
└── sites/<host>/                one folder per site (localhost:8080 is localhost_8080)
    ├── site.json                its URL, and the account it uses unless told
    ├── profile/                 its browser profile, with the session (moodle-session.json)
    └── profiles/<name>/         the profiles of other accounts on it
```

Treat `~/.moodle-driver` as you'd treat a logged-in browser: its profiles hold the sessions. On Linux and macOS its files are readable only by you.

Earlier versions kept these in `~/.config/moodle-driver` (`%APPDATA%\moodle-driver` on Windows); the first run of this one moves them, and says so once.

A program using the library can share the command's sessions: `siteProfileDir(site)` (or `siteProfileDir(site, { as: "student" })`) gives the same folder, to pass as `profileDir`. One browser uses a profile at a time, so not while a command runs on it.

## As a student, as a teacher

```bash
# A student's week
moodle deadlines --days 7
moodle pending-activities 3
moodle activity-content 57 folder --trail fast
moodle download-file https://campus.example.org/pluginfile.php/88/mod_resource/content/1/slides.pdf

# A teacher's morning
moodle assignment-submissions 35 --no-include-content
moodle grade-submission 35 7 --grade 9 --feedback "<p>Great.</p>" --notify
moodle grant-extension 35 7 2026-11-30T23:59:00Z
```

The [examples](../examples/index.md) do these as programs; any of their steps can be tried first as a command.
