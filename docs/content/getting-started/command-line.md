# The command line

Every operation of the driver is also a command of `moodle`, for trying it, scripting it from a shell, or checking something on a site without writing a program. It comes with the package and needs nothing else.

**Terms:** [site](../reference/glossary.md#site), [profile](../reference/glossary.md#profile), [data category](../reference/glossary.md#data-category), [changed](../reference/glossary.md#changed).

## Install

Everywhere, as a command of your system:

```bash
npm i -g @falkenslab/moodle-driver     # once it's on npm
npm i -g github:falkenslab/moodle-driver   # meanwhile, from GitHub
```

In a project that already uses the library, it's there too: `npx moodle …` runs it from `node_modules/.bin`, handy to look at what a function returns while you write your program. Without installing anything: `npx -p @falkenslab/moodle-driver moodle …`.

The npm package `moodle-cli` (another project) also installs a command named `moodle`: with both installed globally, npm refuses the second.

## Log in once

```bash
moodle login --site https://campus.example.org/
```

A browser window opens at the site's login page; log in there as you always do (single sign-on and two-factor included). The command remembers the site, and keeps the session in a browser profile of its own, one per site. From then on, no window and no `--site`:

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
| `--profile <dir>` | The browser profile folder; or `MOODLE_PROFILE`; one per site by default |
| `--json` | Print JSON even at a terminal |
| `--show` | Show the browser while the command works (see [The browser](../concepts/browser.md)) |
| `--allow <categories>` | Refuse commands that touch other [data categories](../concepts/data-categories.md): `--allow own,course-content` reads your own data and the courses, nothing about others |
| `--help`, `--version` | Help, and the driver's version |

The site, the profile of each site and nothing else are kept in `config.json` under `~/.config/moodle-driver/` (`%APPDATA%\moodle-driver\` on Windows, `$XDG_CONFIG_HOME/moodle-driver/` when set); the profiles are under `profiles/` there. Treat the profiles as you'd treat a logged-in browser: they hold the session.

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
