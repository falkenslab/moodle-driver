<div align="center">

<img src="https://raw.githubusercontent.com/falkenslab/moodle-driver/main/docs/static/img/logo.svg" alt="moodle-driver logo: a terminal prompt, >m_" width="112"/>

# moodle-driver

**Everything a person does in Moodle, from your Node.js code.**<br/>
With their own login: no web services, no tokens, no admin.

[![npm](https://img.shields.io/npm/v/@falkenslab/moodle-driver?color=cb3837&logo=npm)](https://www.npmjs.com/package/@falkenslab/moodle-driver)
![Node.js 20+](https://img.shields.io/badge/node-20%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/types-included-3178c6?logo=typescript&logoColor=white)
![Moodle 4.x and 5.x](https://img.shields.io/badge/Moodle-4.x%20%7C%205.x-f98012?logo=moodle&logoColor=white)
[![License: MIT](https://img.shields.io/badge/license-MIT-16a34a)](LICENSE)

**[📖 Documentation](https://falkenslab.github.io/moodle-driver/)** · [📖 Documentación en español](https://falkenslab.github.io/moodle-driver/es/)

<img src="https://raw.githubusercontent.com/falkenslab/moodle-driver/main/docs/static/img/diagrams/at-a-glance.svg" alt="Your program calls moodle-driver, which works Moodle with the person's own login, and gets plain data back" width="900"/>

</div>

moodle-driver is a Node.js library, and a `moodle` command, that works a Moodle site the way a person does: it lists their courses, reads content, submits assignments and answers quizzes as a student, and builds courses, grades with rubrics, runs forums and the gradebook as a teacher. It drives a real browser logged in as that person, calling the same AJAX services and filling the same forms Moodle's own pages use, so it works on any Moodle 4.x or 5.x site with no web service tokens, no administrator and no plugin. Results are plain typed data, and every function declares the kind of data it touches.

## ✨ Why moodle-driver

- 🔑 **The person's own login.** They log in once in a window (SSO and two-factor included); the driver never sees a password.
- 🧩 **No web services.** Many campuses don't enable them. The driver uses the same pages and AJAX services Moodle's own screens use: the services over plain HTTP with the person's session, the browser to log in, fill forms and read pages.
- 🔐 **Moodle decides.** It can do what the person can do, and nothing more: every permission is Moodle's.
- 🌍 **Any language.** Pages are read by structure (ids, data attributes, field names), never by their text.
- 🐢 **At a person's pace** when acting as a student, so Moodle's logs and completion look like a person's; or fast when time matters.
- 🛡️ **Safe to hand to an agent.** Every function declares the data it touches (own, course content, others' work, communication…), so a program can allow only some.
- 📦 **Plain data, typed.** JSON results, ISO dates, long lists a page at a time, errors with stable codes, TypeScript types included.
- 🖥️ **A library and a command.** The same operations from your code or from a terminal.

## 🚀 Quick start

You need Node.js 20+, a Moodle 4.x or 5.x site, and Edge or Chrome (or let it download Chromium). Add it to your project:

```bash
npm install @falkenslab/moodle-driver playwright-core
```

Then, in your program:

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn(); // 🔑 the first time a window opens and the person logs in; afterwards, nothing

for (const course of await moodle.listCourses()) {
  const { pending } = await moodle.pendingActivities(course.id);
  console.log(`📚 ${course.fullname}: ${pending.length} things to do`);
}
```

That's it: no API keys, nothing to ask the administrator. The browser closes by itself at the end of the block. Step by step in [installation](https://falkenslab.github.io/moodle-driver/getting-started/installation) and [your first program](https://falkenslab.github.io/moodle-driver/getting-started/first-program).

<details>
<summary>🖥️ Straight from the terminal, with no code</summary>

Every method is also a command of `moodle`, which comes with the package:

```bash
npm i -g @falkenslab/moodle-driver
moodle login --site https://campus.example.org/   # 🔑 once: a window opens, you log in
moodle list-courses
moodle deadlines --days 7
moodle grade-submission 35 7 --grade 8.5 --feedback "<p>Great work!</p>" --notify
moodle my-grades 3 --json | jq '.[] | select(.grade) | .name'
```

Tables at a terminal, JSON for scripts, errors with their code and an exit status. `moodle help` lists every command, generated from the API so none is missing; `--allow own,course-content` refuses anything touching other people's data. `moodle shell --show` keeps one browser open while you type commands, to watch each act, and `moodle open --show` leaves one open for separate commands from any terminal (reachable only with a token of yours) until `moodle close`. See [the command line](https://falkenslab.github.io/moodle-driver/getting-started/command-line).

</details>

## 🧪 A taste of the code

**🧑‍🎓 A student's week**, deadlines first:

```ts
for (const d of await moodle.deadlines({ days: 7 })) {
  console.log(`${d.date.slice(0, 10)}  ${d.activity}${d.overdue ? "  ⚠️ overdue" : ""}`);
}
```

**👩‍🏫 A teacher grading** what's waiting, with feedback the student gets notified of:

```ts
for (const s of await moodle.assignmentSubmissions(35)) {
  if (s.needsGrading) await moodle.gradeSubmission(35, s.userId, { grade: 8.5, feedback: "<p>Great work!</p>", notify: true });
}
```

**🏗️ Building a course**: every write tells you what it did:

```ts
const { changed } = await moodle.createActivity({ courseId: 3, sectionId: 7, type: "page", name: "Loops", content: "<p>for, while…</p>" });
console.log(changed); // Created page 42 "Loops" in section 2.
```

**🤝 Sharing a unit with another teacher**, anonymous, restored on their site where they want it:

```ts
const { file } = await moodle.backupCourse(3, "/home/ada/catalog", { sections: [12], activities: [57] }); // no names, no origin
const { activities } = await moodle.backupContents(file.path); // what it holds, read locally
await colleague.restoreCourse(file.path, { into: 8, afterSectionId: 30 }); // as new sections after section 30
```

## 📸 See it at work

A real session: the `moodle` command, logged in as a teacher of a Moodle 5.2 site, lists a course's participants and groups and reads a quiz, each in one line.

<div align="center">

<img src="https://raw.githubusercontent.com/falkenslab/moodle-driver/main/docs/static/img/screenshots/moodle-command.png" alt="A terminal running moodle participants, moodle groups and moodle quiz-info against a Moodle site, with the tables they print" width="760"/>

</div>

Complete programs for real tasks, commented, are in the [examples](https://falkenslab.github.io/moodle-driver/examples).

## 🧰 What's inside

| Area | For example |
| --- | --- |
| 📚 Courses and content | Course structure and updates, pages, books, files and folders, H5P and SCORM content |
| 🏗️ Building courses | Sections and activities of any type, settings, restrictions and completion, the course page's blocks, images embedded in rich text, databases' fields, templates and entries, external tools (LTI) |
| 📝 Assignments and grading | Submissions, rubrics and marking guides, the marking workflow, extensions, feedback files |
| ❓ Quizzes and questions | Attempts, results, statistics, manual grading, quiz layout and overrides, question banks with GIFT and Moodle XML import and export, their categories |
| 📊 Gradebook and reports | The grader report, grade items and categories, exports, completion, badges and competencies, activity and participation reports, logs |
| 👥 Participants and groups | Enrolments and their methods, roles, groups and groupings, notes about participants |
| 💬 Forums and messages | Discussions, replies, ratings and subscriptions, workshops, glossary entries and their approval, notifications and conversations |
| 📅 Calendar and to-dos | Events, deadlines, what's pending and what changed, BigBlueButton meetings and their recordings |
| 🔄 Course life cycle | Copies, resets, imports, backups and restores, whole or in part, anonymous for sharing |
| 🧩 For your program | Typed results and errors, data categories, the session's low-level pieces, a fake Moodle for tests |

Every function, by area, is in the [Moodle areas](https://falkenslab.github.io/moodle-driver/areas/courses) guide and the [API reference](https://falkenslab.github.io/moodle-driver/api).

## 📚 Documentation

- 🏁 **[Getting started](https://falkenslab.github.io/moodle-driver/getting-started/installation)**: install, log in, your first program.
- 💡 **[Concepts](https://falkenslab.github.io/moodle-driver/concepts/how-it-works)**: how it works, the browser, errors, pace, data categories.
- 🖥️ **[Command line](https://falkenslab.github.io/moodle-driver/getting-started/command-line)**: the `moodle` command, to log in, run any operation and script it.
- 🗺️ **[Moodle areas](https://falkenslab.github.io/moodle-driver/areas/courses)**: every function, by area: courses, quizzes, grading, forums…
- 📖 **[Examples](https://falkenslab.github.io/moodle-driver/examples)**: complete programs for real tasks, commented.
- 📘 **[Glossary](https://falkenslab.github.io/moodle-driver/reference/glossary)**: Moodle's terms, explained for programmers.
- ⌨️ **[Commands](https://falkenslab.github.io/moodle-driver/reference/commands)**: every command, its arguments and options.
- 🔎 **[API reference](https://falkenslab.github.io/moodle-driver/api)**: generated from the code.

## 🛠️ Developing

```bash
npm install
npm run typecheck && npm run lint
npm run test:docker    # the tests open browsers: always in Docker, never on the desktop
npm run test:sandbox   # every function against a real Moodle (the sandbox), on demand (it takes hours)
npm run build          # dist/, with declarations
npm run docs:check     # every example in the docs compiles against the code
```

More in [development](https://falkenslab.github.io/moodle-driver/reference/development); the design lives in [`.minispec/`](.minispec/) (start with `core/project.md` and the decisions). Extracted from moodle-mcp, its first consumer.

<div align="center">

Made with 💖 by Falken's Lab Team

</div>
