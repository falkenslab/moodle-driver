# Export the grader report to CSV

A teacher saves everyone's grades in a course to a CSV file: one row per student, one column per grade item named as the gradebook names it, with the category and course totals.

**Uses:** [Grades and gradebook](../areas/grades-and-gradebook.md), [Participants](../areas/participants.md).

## The program

```ts
import { writeFileSync } from "node:fs";
import { createMoodle, GradebookError, NotLoggedInError } from "@falkenslab/moodle-driver";

// The course's id, from its address (course/view.php?id=3) or moodle.listCourses().
const COURSE_ID = 3;
// One group's students only (an id from moodle.groups(COURSE_ID)), or undefined for the report as it opens.
const GROUP_ID: number | undefined = undefined;
const OUTPUT = "/home/teacher/grades/course-3.csv";

// RFC 4180: a cell with a comma, a quote or a line break goes in quotes, its quotes doubled.
function cell(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });

try {
  await moodle.logIn();

  // Every page of the grader report, read until no new students come.
  const report = await moodle.graderReport(COURSE_ID, { group: GROUP_ID });

  // Columns come in the report's order: items, then each category's total, then the course total.
  const header = ["User id", "Full name", ...report.columns.map((c) => c.name)];
  const lines = [header.map(cell).join(",")];
  for (const row of report.rows) {
    // A grade refers to its column by itemId; a cell without a grade ("-") has no grade field.
    const byItem = new Map(row.grades.map((g) => [g.itemId, g.grade]));
    const grades = report.columns.map((c) => byItem.get(c.id) ?? "");
    lines.push([row.userId, row.fullName, ...grades].map(cell).join(","));
  }

  // CRLF line ends, as RFC 4180 and spreadsheets expect.
  writeFileSync(OUTPUT, lines.join("\r\n") + "\r\n", "utf8");
  console.log(`${report.rows.length} students, ${report.columns.length} grade columns -> ${OUTPUT}`);
} catch (error) {
  // GradebookError carries Moodle's reason: no permission, no such course, or grades being recalculated.
  if (error instanceof GradebookError) console.error(error.message);
  else if (error instanceof NotLoggedInError) console.error("No session: run again to log in.");
  else throw error;
}
```

## Step by step

1. `COURSE_ID` is the course's id; `GROUP_ID`, when given, is a group's id from `groups()` or `participantFilters()`.
2. `logIn()` opens a window the first time for the teacher to log in; later runs reuse the session without showing anything.
3. `graderReport` opens the course's grader report (`grade/report/grader/index.php`) and reads every page of it. It reads the table by its structure, so the site's language doesn't matter, and gives grades as the text Moodle shows ("8.00", "80.00 %", "B+"): the course's grade display settings decide their format.
4. The header takes each column's `name` as the report shows it ("Recursive factorial", "Labs total", "Course total"). A column's `kind` tells an item (`"item"`) from a category total (`"category"`) and the course total (`"course"`).
5. Each student's grades are matched to the columns by `itemId`, so a cell with no grade becomes an empty CSV cell instead of shifting the row.
6. `cell` quotes what needs quoting: names with commas ("Ruiz, Ana"), quotes, or grades formatted with a decimal comma ("8,50") in a site in Spanish.
7. The file is written with `node:fs`; the browser closes when the program ends, thanks to `await using`.

## What it prints

An example run:

```text
24 students, 7 grade columns -> /home/teacher/grades/course-3.csv
```

And the start of the file:

```text
User id,Full name,Quiz 1,Recursive factorial,Lab 1,Lab 2,Labs total,Course total
41,Ada Byron,8.00,9.50,10.00,7.00,17.00,34.50
42,"Ruiz, Ana",6.50,,9.00,8.00,17.00,23.50
```

## Variations

- Only the items, without totals: `report.columns.filter((c) => c.kind === "item")` before building the header and the rows.
- One file per group, for each group's tutor: loop over `await moodle.groups(COURSE_ID)` and call `graderReport(COURSE_ID, { group: group.id })` with a file named after `group.name`.
- For Excel, which reads a plain UTF-8 file as the system's code page, start the file with a byte order mark: `writeFileSync(OUTPUT, "﻿" + lines.join("\r\n"), "utf8")`.
- Add the activity's id to the header (`${c.name} (${c.activityId})`) when two items share a name, or to join the file with other data by activity.

## When something goes wrong

- `GradebookError`: Moodle refused the report (the person can't view the grader report, or the course doesn't exist), with Moodle's reason in the message. It also comes while Moodle is recalculating the course's grades after a change (the report shows a progress bar): wait a moment and run again.
- `NotLoggedInError`: the session expired; run again and log in.
- A Node.js error from `writeFileSync` (`ENOENT`) when the output folder doesn't exist: create it first with `mkdirSync(dir, { recursive: true })`.

## Data it touches

`graderReport` is `others-personal`: everyone's names and grades, which the CSV file then holds too; so is `groups`, where a group's id comes from. See [data categories](../concepts/data-categories.md).
