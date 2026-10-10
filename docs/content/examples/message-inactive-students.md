# Message inactive students

A program for a teacher that finds the students who haven't opened a course in a number of days and sends each of them a private message, then prints a summary. By default it only lists them: it sends when run with `--send`.

**Uses:** [participants](../areas/participants.md), [messages](../areas/messages.md).

## The program

```ts
import { createMoodle, MessageError } from "@falkenslab/moodle-driver";

const COURSE_ID = 3; // course/view.php?id=3, or listCourses()
const STUDENT_ROLE_ID = 5; // Student on a default site: the program checks it against the course's roles
const DAYS = 14;
// A dry run unless asked: messages can't be taken back.
const send = process.argv.includes("--send");

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();

// Role names are in the site's language; the id is what filters, so check it's a role of this course.
const { roles } = await moodle.participantFilters(COURSE_ID);
const role = roles.find((r) => r.id === STUDENT_ROLE_ID);
if (!role) throw new Error(`No role ${STUDENT_ROLE_ID} in course ${COURSE_ID}; its roles: ${roles.map((r) => `${r.id} ${r.name}`).join(", ")}`);

// The participants page's "Inactive for more than" filter, combined with the role.
const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);
const inactive = await moodle.participants(COURSE_ID, { role: role.id, inactiveSince: since });
console.log(`${inactive.length} ${role.name} participants haven't accessed course ${COURSE_ID} in ${DAYS} days.`);

const courseUrl = new URL(`course/view.php?id=${COURSE_ID}`, moodle.site).href;
const sent: string[] = [];
const failed: string[] = [];
for (const student of inactive) {
  if (!send) {
    console.log(`  would message ${student.fullName} (${student.userId})`);
    continue;
  }
  const text = `<p>Hello ${student.fullName},</p><p>We haven't seen you in the course for a while. The latest materials are at <a href="${courseUrl}">${courseUrl}</a>. Write to me if anything is getting in the way.</p>`;
  try {
    // A private message, as the messaging drawer sends it: it shows in the conversation at once.
    await moodle.sendMessage(student.userId, text);
    sent.push(student.fullName);
  } catch (error) {
    // Moodle didn't deliver it (the student blocks messages, say): note it and go on.
    if (error instanceof MessageError) failed.push(`${student.fullName}: ${error.message}`);
    else throw error;
  }
}

if (send) {
  console.log(`Sent ${sent.length}, failed ${failed.length}.`);
  for (const line of failed) console.log(`  ${line}`);
} else {
  console.log("Dry run: nothing sent. Run with --send to send the messages.");
}
```

## Step by step

1. `COURSE_ID` is the course's id (its URL, or `listCourses()`). `STUDENT_ROLE_ID` is the Student role's id: 5 on a default site, but sites can differ, so the program checks it against the roles `participantFilters` reads from the course's participants page. The roles' names come in the site's language ("Student", "Estudiante"), which is why the program filters by id and only prints the name.
2. `logIn()` returns at once with a saved session, or opens a window for the teacher to log in the first time.
3. `participants` with `role` and `inactiveSince` asks Moodle's participants table for those with that role who haven't accessed the course since the date, as the page's "Inactive for more than" filter does.
4. Without `--send`, the program prints who would get a message and stops there: run it like that first and read the list.
5. With `--send`, `sendMessage` sends each student a private message from the teacher. It appears at once in the student's messages drawer, and Moodle notifies them as their notification preferences say (a popup, an email). Each message is a separate conversation with that student.
6. A message Moodle doesn't deliver throws `MessageError` with Moodle's reason; the program collects those and goes on with the rest, then prints the summary.

## What it prints

An example dry run, then the real one:

```text
3 Student participants haven't accessed course 3 in 14 days.
  would message Alan Turing (9)
  would message Grace Hopper (12)
  would message Edsger Dijkstra (15)
Dry run: nothing sent. Run with --send to send the messages.
```

```text
3 Student participants haven't accessed course 3 in 14 days.
Sent 2, failed 1.
  Edsger Dijkstra: Moodle didn't send the message to user 15: The user you are trying to message has blocked you.
```

## Variations

- Only one group: add `group` from `participantFilters(COURSE_ID).groups` or `groups(COURSE_ID)`: `participants(COURSE_ID, { role: role.id, group: 21, inactiveSince: since })`.
- Students who never came at all are in the same list; to tell them apart the program would need last access dates, which the driver deliberately leaves out of participants.
- Use the first name: Moodle gives the full name only; a program that wants the first name splits it itself, knowing it may get it wrong for some names.
- Let the teacher pick the role: print `roles` and take the id from the command line instead of a constant.

## When something goes wrong

- `NoParticipantsError`: the teacher can't see the course's participants, or the course doesn't exist. Check `COURSE_ID`.
- `MessageError`: Moodle didn't deliver one message, with its reason (the student blocks messages from non-contacts, or messaging is off on the site). Also before sending, when a message is empty.
- `NotLoggedInError`: the session expired; run again to log in. See [Errors](../concepts/errors.md).

## Data it touches

`participants` is `others-personal` and `participantFilters` `course-content`; `sendMessage` is `communication`: the program writes to other people in the teacher's name, which is why it runs dry unless told otherwise. See [Data categories](../concepts/data-categories.md).
