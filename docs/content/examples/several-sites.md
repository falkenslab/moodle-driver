# Working several sites

A person often has more than one Moodle: a school's and a university's, or a teacher's account and a test student's on the same site. This page shows a program that works each one with its own `Moodle` object and profile, one after the other, and lets the person watch the browser if they want, for programmers.

**Uses:** [The Moodle object and the functions](../concepts/calling-functions.md), [The browser](../concepts/browser.md), [Logging in](../getting-started/logging-in.md), [Overview and deadlines](../areas/overview-and-deadlines.md).

## The program

```ts
import { homedir } from "node:os";
import path from "node:path";
import { canShowWindow, createMoodle, type Moodle } from "@falkenslab/moodle-driver";

// One profile per site and per person: each folder holds that person's session on that site.
const profiles = path.join(homedir(), ".config", "week-ahead");
const ACCOUNTS = [
  { label: "School", site: "https://campus.school.example/", profileDir: path.join(profiles, "school-ada") },
  { label: "University", site: "https://moodle.uni.example/", profileDir: path.join(profiles, "uni-ada") },
  // The same site again as another person: another object, another profile.
  { label: "University (test student)", site: "https://moodle.uni.example/", profileDir: path.join(profiles, "uni-student") },
];

// `--watch` shows the browser while the program works, when there's a screen to show it on.
const watch = process.argv.includes("--watch") && canShowWindow();

async function weekAhead(moodle: Moodle): Promise<string[]> {
  const items = await moodle.deadlines({ days: 7, pastDays: 0 });
  return items.map((item) => `${item.date.slice(0, 10)}  ${item.course?.shortname ?? "-"}  ${item.activity}${item.overdue ? " (overdue)" : ""}`);
}

for (const account of ACCOUNTS) {
  // A block per account: `await using` closes this browser before the next one opens.
  await using moodle = createMoodle({ site: account.site, profileDir: account.profileDir, headless: true, downloadBrowser: true });

  // A login window only for an account whose profile has no session yet.
  const me = await moodle.logIn();
  if (watch) await moodle.setVisible(true); // Relaunches with a window, session kept; pages opened next are shown.

  console.log(`\n${account.label}: ${me.fullName}`);
  const lines = await weekAhead(moodle);
  console.log(lines.length > 0 ? lines.join("\n") : "Nothing due this week.");

  if (watch) await moodle.setVisible(false); // Back to headless; close() would also do.
}
```

## Step by step

1. Each account gets its own profile folder. A profile is one browser's cookies and storage: one session for one person on one site. Two people on the same site need two profiles, as the third entry shows.
2. The loop body is a block, so `await using` disposes of the object at the end of each iteration: the browser saves that account's session and closes before the next account's opens.
3. `moodle.logIn()` answers at once for an account already logged in. The first time, it opens a window for that site, the person logs in, and the window closes.
4. With `--watch`, `setVisible(true)` relaunches the browser with a window, keeping the session, and from then on the pages the methods open are shown in one working tab, one after another, so the person sees what the program does. `canShowWindow()` keeps it off where there's no screen.
5. `deadlines()` reads the calendar's action events of the next seven days for that account. Results are plain data; nothing has to be closed.
6. `setVisible(false)` closes the window; the browser runs headless again on the next call, or closes with the block.

## What it prints

An example, with made-up sites and courses:

```text
School: Ada Lovelace
2026-10-12  MATH3  Fractions worksheet
2026-10-15  HIST3  Essay: the Industrial Revolution

University: Ada Lovelace
2026-10-11  PROG1  Loops exercises (overdue)

University (test student): Test Student
Nothing due this week.
```

## Variations

- In parallel: two objects with two profiles may run at the same time (`await Promise.all(ACCOUNTS.map(...))`), each with its own browser. Never two objects on the same profile folder at once: a browser locks its profile.
- Not on one object: calls on the same object share the browser and Moodle's session and form tokens, and Moodle behaves best with one person doing one thing at a time. `await` each call; don't `Promise.all` calls on one object.
- Keeping all browsers open: create the objects once, outside the loop, and close them at the end (one `await using` each, in the same block). Each open browser costs memory.
- Showing only when needed: keep the browser hidden and call `setVisible(true)` only when the person should look (a page asks something only they can answer), then `moodle.tab()` gives the tab they see.

## When something goes wrong

- `NotLoggedInError` on one account: that site's session ended. Call `logIn()` for that object and retry; the other accounts aren't affected. See [Handling errors and expired sessions](errors-and-sessions.md).
- `NoDisplayError` from `logIn()` or `setVisible(true)`: no screen (a server, a container). Log in where there is one with the same profile folders and copy them over.
- `MoodleUrlError` from `createMoodle`: a site URL that isn't http(s). `findMoodleSite(url)` finds a site's base URL from any page of it.
- A browser that won't launch because the profile is in use: another object, or another program, has that profile open. Close it first.

## Data it touches

The person's own deadlines on each site: the `own` [data category](../concepts/data-categories.md). Logging in and showing the browser touch nothing of anyone's (`none`).
