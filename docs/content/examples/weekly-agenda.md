# A weekly agenda

A program for a student that prints their week at a glance: the courses in progress, what's due in the next 7 days (with overdue work flagged), what's still pending in each course and how many notifications are unread.

**Uses:** [courses](../areas/courses.md), [overview and deadlines](../areas/overview-and-deadlines.md), [messages](../areas/messages.md).

## The program

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
});

// A window opens the first time for the person to log in; later runs reuse the saved session.
const me = await moodle.logIn();
console.log(`Agenda for ${me.fullName}\n`);

// "inprogress" filters by the courses' dates, as the dashboard's course overview does.
const courses = await moodle.listCourses("inprogress");
console.log(`Courses in progress (${courses.length}):`);
for (const course of courses) {
  // progress is only there when the course tracks completion.
  const progress = course.progress !== undefined ? ` - ${Math.round(course.progress)}% done` : "";
  console.log(`  ${course.shortname}  ${course.fullname}${progress}`);
}

// The calendar's action events in every course: 7 days ahead, and 7 back so work still undone shows as overdue.
// An event Moodle considers done (an assignment submitted) is no longer an action event.
const deadlines = await moodle.deadlines({ days: 7, pastDays: 7 });
console.log(`\nDeadlines:`);
for (const deadline of deadlines) {
  const when = new Date(deadline.date).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const flag = deadline.overdue ? "OVERDUE " : "";
  console.log(`  ${flag}${when}  [${deadline.course?.shortname ?? "?"}] ${deadline.activity}: ${deadline.action?.name ?? deadline.event}`);
}
if (deadlines.length === 0) console.log("  Nothing due.");

// Pending work per course: incomplete activities, or graded ones without a grade where completion isn't tracked.
// It reads the course page and the grade report, so it takes a few seconds per course.
console.log(`\nPending:`);
for (const course of courses) {
  const { pending } = await moodle.pendingActivities(course.id);
  if (pending.length === 0) continue;
  console.log(`  ${course.shortname} (${pending.length})`);
  for (const activity of pending) {
    const locked = activity.availableToMe ? "" : " (not available yet)";
    console.log(`    [${activity.type}] ${activity.name}${locked}`);
  }
}

const unread = await moodle.notifications({ unreadOnly: true });
console.log(`\nUnread notifications: ${unread.length}`);
// The browser closes here: `await using` calls moodle.close(), which also saves the session.
```

## Step by step

1. `createMoodle` only records the site and the browser's options; nothing opens until the first call that needs the browser. `await using` closes the browser when the program ends, also on an error.
2. `logIn()` answers at once when the profile has a session. The first time, it opens a browser window at the site's login page and waits (five minutes by default) while the person logs in there; the driver never sees the password.
3. `listCourses("inprogress")` gives the courses whose dates include today. Each course's `id` is what the other course functions take.
4. `deadlines({ days: 7, pastDays: 7 })` reads the same action events as the dashboard's timeline, in every course at once. Each one has its ISO `date`, whether it's `overdue`, its course and what the person can do about it (`action.name`, such as "Add submission").
5. `pendingActivities(course.id)` lists, per course, what the person still has to do. It opens the course page and the grade report, so this is the slowest part.
6. `notifications({ unreadOnly: true })` reads the notification popover's list; its length is the badge's number.

## What it prints

An example; the names, dates and texts come from the site, in its language.

```text
Agenda for Ada Lovelace

Courses in progress (3):
  PROG101  Programming 101 - 45% done
  MATH110  Discrete Mathematics - 70% done
  HIST205  History of Computing

Deadlines:
  OVERDUE Wed 7 Oct, 23:59  [MATH110] Set 3: Add submission
  Mon 12 Oct, 09:00  [PROG101] Quiz 2: Attempt quiz now
  Fri 16 Oct, 23:59  [PROG101] Recursion exercises: Add submission

Pending:
  PROG101 (3)
    [quiz] Quiz 2
    [assign] Recursion exercises
    [page] Further reading (not available yet)
  MATH110 (1)
    [assign] Set 3

Unread notifications: 4
```

## Variations

- One course only: `moodle.deadlines({ courseId: 3, days: 7 })`.
- Only what's still ahead, without the overdue: `pastDays: 0`.
- Show the unread notifications themselves: `for (const n of unread) console.log(n.subject, n.url ?? "")`, and mark them read afterwards with `await moodle.markNotificationsRead()`.
- On a Moodle 5 site, `moodle.activitiesOverview(course.id, "assign")` adds the due dates and submission state the course's "Activities" page shows.

## When something goes wrong

- `LoginTimeoutError` or `LoginWindowClosedError` from `logIn()`: nobody logged in within the time, or the window was closed. Run it again.
- `NoDisplayError`: a login window was needed on a machine without a screen. Log in once where there is one, with the same profile.
- `NotLoggedInError` from any later call: Moodle ended the session meanwhile. Call `moodle.logIn()` again and repeat the call.
- `MoodleServiceError` from `listCourses` or `deadlines`: the service failed; `error.errorcode` has Moodle's reason. See [Errors](../concepts/errors.md).

## Data it touches

Everything here is the person's own (`own`): `listCourses`, `deadlines`, `pendingActivities` and `notifications`; `logIn` is `none`. See [data categories](../concepts/data-categories.md).
