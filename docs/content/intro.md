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
| Courses | List the person's courses, read a course's sections and activities, what's pending, change a course's settings |
| Content | Read pages, books, labels, URLs, files and folders, with their media |
| Building a course | Create, update, move, duplicate and delete activities and sections; read an activity's settings |
| Assignments | Submit as a student; read everyone's submissions, grade (simple, rubrics, marking guides), grant extensions as a teacher |
| Quizzes | Attempt a quiz page by page; read results, the quiz's questions, add questions, set overrides |
| Question banks | List banks and questions, import GIFT or Moodle XML, create single questions |
| Forums | Read discussions and posts, reply, start discussions, pin and lock |
| Surveys and choices | Answer questionnaires, feedback activities and choices |
| Lessons and H5P | Go through a lesson page by page; read an H5P activity's type and attempts |
| Grades | The person's grades, the grader report, the gradebook setup (categories, weights) |
| Completion | Mark activities done, override completion, read the progress report |
| People | Participants with roles and groups, inactivity, groups |
| Overview | The activities overview, deadlines, course updates |
| Calendar and messages | Course events; notifications, conversations, private messages |
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
- [Examples](examples/index.md): complete programs for real tasks, as a student, as a teacher and for your program, commented step by step.
- [Moodle areas](areas/courses.md): one page per area, with every function.
- [Glossary](reference/glossary.md): Moodle's terms (submission, attempt, slot, override…) explained for programmers.
- The API reference, generated from the code, in the top bar.
