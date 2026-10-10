# Your first program

A complete script that logs in, lists the person's courses, reads one course's structure and what's still pending in it, and prints the latest grades. Save it as `first.mjs` (or `.ts` with `tsx`), set `MOODLE_URL` and run it.

```ts
import { createBrowserManager, courseStructure, listCourses, logIn, myGrades, NotLoggedInError, pendingActivities } from "@falkenslab/moodle-driver";

const site = process.env.MOODLE_URL ?? "https://campus.example.org/";
const browser = createBrowserManager({
  profileDir: `${process.env.HOME}/.my-moodle-profile`,
  headless: true,
  downloadBrowser: true,
});

try {
  // 1. A session: a window the first time, none afterwards.
  const me = await logIn(browser, site, { timeoutMs: 5 * 60_000 });
  console.log(`Hello, ${me.fullName}`);

  // 2. Every function takes the browser context and the site first.
  const context = await browser.context();
  const courses = await listCourses(context, site, "inprogress");
  if (courses.length === 0) throw new Error("No courses in progress.");
  const course = courses[0]!;
  console.log(`\n${course.fullname} (${course.id})`);

  // 3. Sections and activities, with the person's completion.
  const { sections } = await courseStructure(context, site, course.id);
  for (const section of sections) {
    console.log(`  ${section.title}`);
    for (const activity of section.activities) console.log(`    [${activity.type}] ${activity.name}${activity.completion?.complete ? " (done)" : ""}`);
  }

  // 4. What's left to do.
  const { pending } = await pendingActivities(context, site, course.id);
  console.log(`\nPending: ${pending.map((p) => p.name).join(", ") || "nothing"}`);

  // 5. Grades, as the user report shows them.
  const grades = await myGrades(context, site, course.id);
  for (const row of grades.filter((r) => r.kind === "item")) console.log(`  ${row.name}: ${row.grade ?? "-"}`);
} catch (error) {
  if (error instanceof NotLoggedInError) console.error("The session ended: run again to log in.");
  else throw error;
} finally {
  // Saves the session cookies and closes the browser.
  await browser.close();
}
```

## What happens

1. `createBrowserManager` doesn't open anything yet: the browser starts on the first call that needs it, and only once.
2. `logIn` opens a window the first time; the person logs in; the window closes. Next time it returns at once.
3. `browser.context()` gives the Playwright `BrowserContext` of the open browser. Pass it to every function; they open and close their own tabs in it.
4. Results are plain objects: numbers, strings, ISO dates. Nothing to close or dispose of.
5. `browser.close()` saves the session and closes the browser. Always call it, in a `finally`.

## Next steps

- Read [How it works](../concepts/how-it-works.md) to know what the driver does in Moodle on each call.
- Read [Calling functions](../concepts/calling-functions.md) for the conventions every function follows.
- Pick an area: [assignments](../areas/assignments.md), [quizzes](../areas/quizzes.md), [forums](../areas/forums.md), [grading](../areas/grading.md)…
- If your program acts as a student (reading content, answering quizzes), read [Working at a student's pace](../concepts/student-pace.md).
