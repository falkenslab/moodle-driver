---
sidebar_label: Overview
---

# Examples

Complete programs for real tasks, each explained step by step, with its code commented where Moodle or the driver does something you wouldn't guess. Copy one, change the site, the profile and the ids, and run it.

Every program starts the same way: a `Moodle` object for the site, created with `await using` so the browser closes when the program ends, and `logIn()`, which opens a window only the first time (see [Logging in](../getting-started/logging-in.md)). The ids come from the site: a course's from `listCourses()`, an activity's from `courseStructure()` (see [Ids](../concepts/calling-functions.md#ids)).

## 🎒 As a student

| Example | What it does |
| --- | --- |
| [A weekly agenda](weekly-agenda.md) | Courses in progress, deadlines of the week, what's pending, unread notifications |
| [Download a course's files](download-course-files.md) | Every file and folder of a course, saved in a folder per section |
| [Read a course's content](read-course-content.md) | Pages and books at a person's pace, marked done where the course asks |
| [Submit an assignment](submit-assignment.md) | Online text and a file, submitted for grading, the statement accepted by the person |
| [Answer a quiz](answer-quiz.md) | An attempt page by page, finished, its review printed |
| [Surveys and choices](surveys-and-choices.md) | A feedback or questionnaire survey, and a choice |

## 🧑‍🏫 As a teacher

| Example | What it does |
| --- | --- |
| [Grade submissions](grade-submissions.md) | Pending submissions graded with feedback, simple or with a rubric |
| [Extensions and overrides](extensions-and-overrides.md) | More time for one student: an assignment extension and a quiz override |
| [Message inactive students](message-inactive-students.md) | Students who haven't come in two weeks, each sent a message |
| [A daily report](daily-report.md) | Notifications, deadlines, what changed in a course, the newest forum discussions |
| [Build a course unit](build-course.md) | A section with pages, a link and an assignment, from an outline in the program |
| [Export grades to CSV](export-grades-csv.md) | The grader report as a spreadsheet |
| [Questions into a quiz](questions-into-quiz.md) | Questions imported into a bank and added to a quiz, a random one too |

## 🛠️ For your program

| Example | What it does |
| --- | --- |
| [Errors and sessions](errors-and-sessions.md) | A program that logs in again when the session ends and reports errors by code |
| [Several sites](several-sites.md) | One object per site and person, and showing the browser while someone watches |
| [Moodle services](moodle-services.md) | What the driver doesn't wrap: Moodle's AJAX services, pages and forms, and limiting what may be called |
| [Testing your program](testing-your-program.md) | Tests against the fake Moodle, without a real site |
