# The command line

Every operation of the driver is also a command of `moodle`, for trying it, scripting it from a shell, or checking something on a site without writing a program. It comes with the package and needs nothing else.

**Terms:** [site](../reference/glossary.md#site), [profile](../reference/glossary.md#profile), [data category](../reference/glossary.md#data-category), [changed](../reference/glossary.md#changed).

## Install

Everywhere, as a command of your system:

```bash
npm i -g @falkenslab/moodle-driver

# Or from a clone, to follow main
git clone https://github.com/falkenslab/moodle-driver.git
cd moodle-driver && npm install && npm link
```

`npm i -g github:falkenslab/moodle-driver` doesn't work: npm builds a package installed from git with its development dependencies, and a global install puts those in the wrong place (an npm bug, not the driver's). `npm link` from a clone builds it where it is. npm 11 may warn about the package's scripts (`install-scripts`): nothing needs to run, the command works as is.

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
| `--as <name>` | The profile on the site, by name; or `MOODLE_AS`; the site's default unless told |
| `--profile <dir>` | A browser profile folder of your own, over everything else; or `MOODLE_PROFILE` |
| `--json` | Print JSON even at a terminal |
| `--show` | Show the browser while the command works (see [The browser](../concepts/browser.md)) |
| `--allow <categories>` | Refuse commands that touch other [data categories](../concepts/data-categories.md): `--allow own,course-content` reads your own data and the courses, nothing about others |
| `--help`, `--version` | Help, and the driver's version |

## An interactive session

Each `moodle …` opens the browser, works and closes it, so with `--show` the window lives only while that command runs. `moodle shell` keeps one browser open while you type commands one after another, each as `moodle <command>` would run it, without the `moodle` in front:

```text
$ moodle shell --show
moodle campus.example.org a.martin> list-courses
id  shortname  fullname          …
3   loops      Loops in Python   …
moodle campus.example.org a.martin> course-structure 3
…
moodle campus.example.org a.martin> activity-settings 57
…
moodle campus.example.org a.martin> exit
```

- It takes the global options (`--site`, `--as`, `--profile`, `--show`, `--allow`, `--json`), which hold for every line; a line can still add its own, as `list-courses --json`.
- With `--show` the window opens at once and stays open; every page a command opens comes to the front of its tab (see [The browser](../concepts/browser.md)). Commands that only call Moodle's services, as `list-courses` and `course-structure`, open no page. `show` and `hide` open and close the window during the session.
- A failing command prints its error and the session goes on. `exit`, `quit` or Ctrl+D leave, closing the browser and saving the session; Ctrl+C clears the line being typed. The exit status is 0.
- `help` lists the commands, and `help <command>` explains one. Tab completes command names and a command's options; the lines typed are kept in `~/.moodle-driver/history` for the arrow keys.
- `sites`, `forget` and `login` work inside. `login --as <name>` goes on with the profile logged in with, and `use <site>` (or `use --as <name>`) works on another site or profile; either closes the browser and opens it on the new profile.
- Lines are split as a shell splits them: quotes keep spaces and JSON together (`submit-survey 34 '{"textfield_12":"Clear"}'`), and a backslash only escapes a space, a quote or another backslash, so Windows paths go as typed.

Lines can also come from a file or a pipe (`moodle shell < monday.txt`): no prompt then, and the session ends with the input. With a [background browser](#watching-separate-commands-act) open on the profile, the shell works in it, one line at a time.

## Watching separate commands act

`moodle open` leaves a browser open in the background on the profile, and every command on that profile, from any terminal or script, works in it instead of launching its own; `moodle close` closes it and saves the session. With `--show` it has a window, where each command's pages come to the front of its first tab:

```bash
moodle open --show                 # a window opens, and stays
moodle list-courses                # from any terminal: no browser launched
moodle activity-settings 57        # its form shows in the window
moodle close
```

- Commands take turns: one works on the background browser at a time, and another waits a few seconds, then says `browser-busy`.
- `moodle sites` says which profiles have one running (`background`). Without one, every command launches its own browser, as always.
- If its process is gone (the computer restarted, or you closed the window), the next command notices, removes what it left and launches its own.

### Its security

A browser that other programs can drive is, while it runs, as powerful as your logged-in session. So the command doesn't open Chromium's own debugging port, which any program on the computer could use without asking. The browser talks only to the command's background process, over a pipe; that process accepts connections on 127.0.0.1 only (never from the network), and only with a random token it writes, with the address, in the profile's `.browser.json`, readable only by you (on Linux and macOS; on Windows, your user folder already is). It refuses web pages outright. A program of yours can share the browser with `backgroundBrowser(profileDir)` and `connectBrowserManager()` (see [The browser](../concepts/browser.md#a-browser-left-open-in-the-background)). `moodle close` when you're done.

## Several sites and accounts

Log in to each site once; the last one is the default, and `--site` (or `MOODLE_SITE`) picks another for one command. `moodle login` on a site whose session is still alive opens no window: it only makes that site the default.

```bash
moodle login --site https://campus.uni-a.es/
moodle login --site https://aulavirtual.uni-b.es/
moodle --site https://campus.uni-a.es/ list-courses
```

Every account on a site has a profile of its own, with its own session, and a name: the first login names it after the person's Moodle username (`profiles/a.martin/`). The profile last logged in with is the site's default, named in its `site.json`. For another account on the same site (a teacher and a student, say), log in again with a name of your choice; `--as` (or `MOODLE_AS`) picks one for a command.

```bash
moodle login --site https://campus.uni-a.es/            # profile "a.martin", the default
moodle login --site https://campus.uni-a.es/ --as student   # profile "student", now the default
moodle --as a.martin who-am-i
moodle login --as a.martin                               # back to a.martin as the default
```

`moodle sites` lists every site and profile: which is the default and whether it has a session file (Moodle may still have ended the session), and whether a background browser runs on it. Forgetting a profile closes its background browser first. `moodle forget <site>` deletes a site with its profiles and sessions, and `moodle forget <site> --as <name>` one profile; forgetting the default leaves the site without one until the next `login` (or an `--as`).

```text
$ moodle sites
site                            profile   default  session  background  path
------------------------------  --------  -------  -------  ----------  --------------------------------------------------------------
https://aulavirtual.uni-b.es/   ada       true     true     false       /home/ada/.moodle-driver/sites/aulavirtual.uni-b.es/profiles/ada
https://campus.uni-a.es/        a.martin  false    true     true        /home/ada/.moodle-driver/sites/campus.uni-a.es/profiles/a.martin
https://campus.uni-a.es/        student   false    true     false       /home/ada/.moodle-driver/sites/campus.uni-a.es/profiles/student
```

## Where things are

Everything is in `~/.moodle-driver`, the same on Windows, Linux and macOS (`MOODLE_DRIVER_HOME` moves it, for instance to keep it under `~/.config` or on a server's data disk):

```text
~/.moodle-driver/
├── config.json                  the default site
├── history                      the lines typed in `moodle shell`
└── sites/<host>/                one folder per site (localhost:8080 is localhost_8080)
    ├── site.json                its URL, and its default profile by name
    └── profiles/<name>/         one browser profile per account, with its session (moodle-session.json),
                                 named after the Moodle username or by --as;
                                 .browser.json while `moodle open` keeps a browser on it,
                                 .browser.lock while a command works on that browser
```

Treat `~/.moodle-driver` as you'd treat a logged-in browser: its profiles hold the sessions. On Linux and macOS its files are readable only by you.

A program using the library can share the command's sessions: `siteProfileDir(site)` gives the site's default profile (or `siteProfileDir(site, { as: "student" })` a named one), to pass as `profileDir`. One browser uses a profile at a time, so not while a command runs on it.

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
