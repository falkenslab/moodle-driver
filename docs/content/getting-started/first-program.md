# Your first program

A complete script that logs in, lists the person's courses, reads one course's structure and what's still pending in it, and prints its grades. Save it as `first.mjs` (or `.ts` with `tsx`), set `MOODLE_URL` and run it.

```ts
import { createMoodle, NotLoggedInError } from "@falkenslab/moodle-driver";

const moodle = createMoodle({
  site: process.env.MOODLE_URL ?? "https://campus.example.org/",
  profileDir: `${process.env.HOME}/.my-moodle-profile`,
  headless: true,
  downloadBrowser: true,
});

try {
  // 1. A session: a window the first time, none afterwards.
  const me = await moodle.logIn({ timeoutMs: 5 * 60_000 });
  console.log(`Hello, ${me.fullName}`);

  // 2. The person's courses in progress.
  const courses = await moodle.listCourses("inprogress");
  if (courses.length === 0) throw new Error("No courses in progress.");
  const course = courses[0]!;
  console.log(`\n${course.fullname} (${course.id})`);

  // 3. Sections and activities, with the person's completion.
  const { sections } = await moodle.courseStructure(course.id);
  for (const section of sections) {
    console.log(`  ${section.title}`);
    for (const activity of section.activities) console.log(`    [${activity.type}] ${activity.name}${activity.completion?.complete ? " (done)" : ""}`);
  }

  // 4. What's left to do.
  const { pending } = await moodle.pendingActivities(course.id);
  console.log(`\nPending: ${pending.map((p) => p.name).join(", ") || "nothing"}`);

  // 5. Grades, as the user report shows them.
  const grades = await moodle.myGrades(course.id);
  for (const row of grades.filter((r) => r.kind === "item")) console.log(`  ${row.name}: ${row.grade ?? "-"}`);
} catch (error) {
  if (error instanceof NotLoggedInError) console.error("The session ended: run again to log in.");
  else throw error;
} finally {
  // Saves the session cookies and closes the browser.
  await moodle.close();
}
```

## What happens

1. `createMoodle` doesn't open anything yet: the browser starts on the first call that needs it, and only once.
2. `logIn` opens a window the first time; the person logs in; the window closes. Next time it returns at once.
3. Each method works in its own tab of the same browser, with the person's session, and closes it.
4. Results are plain objects: numbers, strings, ISO dates. Nothing to close or dispose of.
5. `close()` saves the session and closes the browser. Always call it, in a `finally`.

## Next steps

- Read [How it works](../concepts/how-it-works.md) to know what the driver does in Moodle on each call.
- Read [The Moodle object and the functions](../concepts/calling-functions.md) for the conventions every operation follows.
- Pick an area: [assignments](../areas/assignments.md), [quizzes](../areas/quizzes.md), [forums](../areas/forums.md), [grading](../areas/grading.md)…
- If your program acts as a student (reading content, answering quizzes), read [Working at a student's pace](../concepts/student-pace.md).
