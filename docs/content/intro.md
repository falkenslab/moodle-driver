---
slug: /intro
sidebar_label: Introduction
---

# moodle-driver

`@falkenslab/moodle-driver` is a Node.js library that gives a program full control of a Moodle site as any user, with their own login: no web services, no tokens, no admin. The person logs in once, by hand, in a window the driver opens (Edge, Chrome or Chromium, through [Playwright](https://playwright.dev)) on a profile of its own; from then on the driver works the site with that session, as the person would: it reads courses, content, assignments, quizzes and grades, posts in forums, grades submissions, builds activities and sections, and answers as a student. Every function returns plain data.

![moodle-driver at a glance: your program calls the driver, which works Moodle with the person's own login, and gets plain data back](/img/diagrams/at-a-glance.svg)

![What it can do as a student, as a teacher, and for your program](/img/diagrams/what-it-can-do.svg)

## Why the person's own login

![Two ways to automate Moodle: web services need an administrator and a token; moodle-driver needs the person to log in once](/img/diagrams/no-web-services.svg)

Moodle has a web services API, but using it needs a token, and many institutions don't enable web services for students or teachers, or don't let them create tokens. Single sign-on (SAML, OAuth, CAS) makes it harder still. Logging in, on the other hand, is something every Moodle user already does.

moodle-driver logs in the way the person does, in a browser window, once; it keeps the session in a profile on disk, and then calls the same AJAX services Moodle's own pages call, with that session, or reads and fills the pages and forms themselves where no service helps. It never types, stores or asks for a password.

## What it covers

| Area | What a program can do |
| --- | --- |
| Courses | List the person's courses, read a course's sections and activities, what's pending, change a course's settings, reset it for a new year; add, configure, move and delete the blocks on its page |
| Copy, backup and restore | Copy a course into a new one, back it up (or part of it) to a file, read what a backup holds, make it anonymous to share it, restore a backup where you choose, import activities from another course |
| Content | Read pages, books, labels, URLs, files and folders, with their media |
| Building a course | Create, update, move, duplicate and delete activities and sections; their files, descriptions, access restrictions and completion conditions; read an activity's settings |
| Assignments | Submit as a student; read everyone's submissions, grade (simple, rubrics, marking guides, feedback files, whole groups), the marking workflow and markers, grant extensions as a teacher |
| Quizzes | Attempt a quiz page by page; read results, grade essays by hand; read, add, remove, move and paginate the quiz's questions; set overrides |
| Question banks | List banks and questions, import and export GIFT or Moodle XML, create, edit and delete single questions, organize categories and move questions between them |
| Forums | Read discussions and posts, reply, start discussions, edit and delete posts, pin and lock, grade the forum as a whole, rate posts (and glossary entries, database records) |
| Workshops | Read a workshop's phase, submissions and assessments, switch its phase, allocate reviewers (by hand, at random, scheduled), assess a submission, submit, prepare and assess example submissions, calculate and override the grades |
| Surveys and choices | Answer questionnaires, feedback activities and choices; read everyone's answers, and build a feedback's questions and templates, as a teacher |
| Databases | Give a database activity its fields, templates and presets; read, add, edit, approve and delete its entries, export and import them as CSV |
| Glossaries | Read, add, change and delete entries, approve them, add categories, export and import entries in Moodle's XML |
| Lessons, H5P and SCORM | Go through a lesson page by page; read an H5P activity's type and attempts; read a SCORM's attempts and SCOs, open its player, create one from a package |
| Grades | The person's grades, the grader report and Moodle's grade exports, grading and overriding in the gradebook, the gradebook setup (manual items, categories, weights), CSV imports, scales and grade letters |
| Completion and badges | Mark activities done, override completion, read the progress report; course badges: create them, set their criteria, enable them, award them by hand |
| People | Participants with roles and groups, inactivity; enrol and unenrol, set roles, groups and groupings, enrolment methods; message several at once |
| Logs and reports | A course's logs by user, activity, action and date; the views per activity; who took part in an activity |
| Overview | The activities overview, deadlines, course updates |
| Calendar and messages | Course events (create, change, delete); notifications, conversations, private messages |
| Session and site | Log in by hand, log out, who the person is, the site's public information |

## Who it's for

Programs that work Moodle for a person: an assistant that grades or answers forums for a teacher, a student's study helper, a script that exports or imports activities, a monitoring tool. Its first consumer is moodle-mcp, an MCP server that lets AI agents work Moodle; the driver itself knows nothing about MCP or agents.

## A first look

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

// `await using` closes the browser when the program ends, also on an error.
await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/me/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});

// The first time, a window opens at the login page and waits for the person to log in there.
await moodle.logIn();

const courses = await moodle.listCourses();
for (const course of courses) console.log(course.id, course.fullname);
```

## Where to go next

- [Installation](getting-started/installation.md): requirements and the browser it uses.
- [Logging in](getting-started/logging-in.md): profiles, sessions and windows.
- [Your first program](getting-started/first-program.md): a complete script, step by step.
- [How it works](concepts/how-it-works.md): services, pages and why the driver reads Moodle the way it does.
- [The command line](getting-started/command-line.md): every operation as a `moodle` command, without writing a program.
- [Examples](examples/index.md): complete programs for real tasks, as a student, as a teacher and for your program, commented step by step.
- [Moodle areas](areas/courses.md): one page per area, with every function.
- [Glossary](reference/glossary.md): Moodle's terms (submission, attempt, slot, override…) explained for programmers.
- The API reference, generated from the code, in the top bar.
