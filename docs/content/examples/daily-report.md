# A daily report

A program for a teacher to run every morning: their unread notifications, the deadlines of the coming week, what changed in a course since yesterday, and the newest discussions of the course's forum with their replies. It only reads; nothing in Moodle changes.

**Uses:** [messages](../areas/messages.md), [overview and deadlines](../areas/overview-and-deadlines.md), [forums](../areas/forums.md).

## The program

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const COURSE_ID = 3; // course/view.php?id=3, or listCourses()
const FORUM_ID = 37; // the forum's activity id: mod/forum/view.php?id=37, or courseStructure(COURSE_ID)
const DAY = 24 * 60 * 60 * 1000;
const yesterday = new Date(Date.now() - DAY);
const short = (text: string) => text.replace(/\s+/g, " ").slice(0, 90);

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
const me = await moodle.logIn();
console.log(`Daily report for ${me.fullName}, ${new Date().toDateString()}`);

// Reading them doesn't mark them read: the bell still shows them in Moodle.
const unread = await moodle.notifications({ unreadOnly: true });
console.log(`\nUnread notifications: ${unread.length}`);
for (const n of unread) console.log(`  [${n.component ?? "site"}] ${n.subject}`);

// The calendar's action events in every course, from today to a week ahead.
console.log("\nDeadlines this week:");
for (const d of await moodle.deadlines({ days: 7, pastDays: 0 })) {
  console.log(`  ${d.date.slice(0, 16)} ${d.course?.shortname ?? ""} ${d.activity}: ${d.action?.name ?? d.event}`);
}

// What Moodle's mobile app asks to know what to refresh: per activity, what changed and how many items.
console.log(`\nChanged in course ${COURSE_ID} since yesterday:`);
for (const update of await moodle.courseUpdates(COURSE_ID, yesterday)) {
  const changes = update.changes.map((c) => (c.items ? `${c.what} (${c.items})` : c.what)).join(", ");
  console.log(`  ${update.name ?? `activity ${update.id}`}: ${changes}`);
}

// The forum's list doesn't come newest first (pinned on top, then by last post): sort by start date.
const discussions = await moodle.forumDiscussions(FORUM_ID);
const newest = discussions.filter((d) => d.started).sort((a, b) => b.started!.localeCompare(a.started!)).slice(0, 3);
console.log("\nNewest forum discussions:");
for (const d of newest) {
  console.log(`  ${d.subject}, by ${d.author} (${d.replies} replies)`);
  // Oldest first: the first post opens the discussion, the rest are the replies.
  const { posts } = await moodle.discussion(d.id);
  for (const post of posts.slice(1)) console.log(`    ${post.author.fullName}: ${short(post.text)}`);
}
```

## Step by step

1. `COURSE_ID` and `FORUM_ID` come from the course's pages (the `id` in each URL) or from `listCourses()` and `courseStructure(COURSE_ID)`. The forum's id is its activity id, not the forum's instance id.
2. `logIn()` returns the person's id and name; the first time it opens a window to log in, then never again while the session lasts. Run from a scheduler (cron, a scheduled task), the session must already be saved in the profile, since nobody is there to log in.
3. `notifications({ unreadOnly: true })` reads the bell's notifications: forum posts, submissions, grades... `component` says what sent each one (`mod_forum`, `mod_assign`) in any language. Reading them doesn't mark them read.
4. `deadlines` reads the calendar's action events in all the teacher's courses, as the dashboard's timeline does. Moodle gives teachers few of them (assignments to grade appear when grading is due), so the list may be short.
5. `courseUpdates` asks Moodle what changed in each activity since yesterday: new submissions, forum posts, grades, settings. The names come from the course's structure.
6. `forumDiscussions` lists the forum's discussions through all its pages; the program sorts them by start date and takes the three newest. `discussion` reads each one's posts, oldest first, so all but the first are replies.

## What it prints

An example run:

```text
Daily report for Ada Teacher, Mon Nov 09 2026

Unread notifications: 2
  [mod_forum] Re: Exercise 3: does the loop end?
  [mod_assign] Alan Turing has submitted an assignment

Deadlines this week:
  2026-11-12T22:59 PROG1 Recursion essay: Grade
  2026-11-13T18:00 PROG1 Unit 4 quiz: Quiz closes

Changed in course 3 since yesterday:
  Recursion essay: submissions (3)
  Course forum: discussions (2)

Newest forum discussions:
  Exercise 3: does the loop end?, by Grace Hopper (2 replies)
    Alan Turing: It ends when i reaches 2, the condition is checked first.
    Grace Hopper: Thanks, I had the condition the other way round.
  Exam dates, by Ada Teacher (0 replies)
```

## Variations

- Several courses: loop over `listCourses("inprogress")` and call `courseUpdates(course.id, yesterday)` for each.
- What needs grading: `activitiesOverview(COURSE_ID, "assign")` gives each assignment's "Needs grading" count in the `alert` of its fields.
- Clear the bell after reading: `await moodle.markNotificationsRead()` marks all of them read, as "Mark all as read" does.
- Only today's discussions: filter by `d.started! >= yesterday.toISOString()` instead of taking the three newest.

## When something goes wrong

- `NotLoggedInError`: the session expired. In a scheduled run there's nobody to log in: run the program once by hand (a window opens), then the schedule goes on working. See [Logging in](../getting-started/logging-in.md).
- `NoDisplayError`: a login window was needed on a machine without a screen; log in once where there is one, with the same profile.
- `MoodleServiceError` from `courseUpdates`: Moodle refused the course (it doesn't exist, or the person isn't in it).
- `NotAForumError`: `FORUM_ID` isn't a forum the teacher can view; take the id from `courseStructure(COURSE_ID)`. See [Errors](../concepts/errors.md).

## Data it touches

`notifications` and `deadlines` are the teacher's own (`own`); `courseUpdates` is `course-content` and `others-aggregate` (counts that identify no one); `forumDiscussions` and `discussion` are `others-personal`, since they hold students' names and posts. It writes nothing and messages no one. See [Data categories](../concepts/data-categories.md).
