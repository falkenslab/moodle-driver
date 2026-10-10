# Read a course's content

A program for a student that goes through a course's pages and books as a person would, pausing to read each one, saves their text to disk and marks them done where the activity has manual completion.

**Uses:** [courses](../areas/courses.md), [content](../areas/content.md), [completion](../areas/completion.md); see also [Working at a student's pace](../concepts/student-pace.md).

## The program

```ts
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { CompletionError, createMoodle } from "@falkenslab/moodle-driver";

// The course id, from listCourses(); the texts go to NOTES, one file per activity.
const COURSE_ID = 3;
const NOTES = "/home/ada/notes/programming-101";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  // The default, said for clarity: the real pages one by one, pausing as a reader would.
  trail: "realistic",
  // Called every few seconds during the pauses: one line, rewritten in place.
  onProgress: (seconds) => process.stdout.write(`\r  reading... ${seconds}s`),
});
await moodle.logIn();
await mkdir(NOTES, { recursive: true });

for (const section of await moodle.courseStructure(COURSE_ID)) {
  for (const activity of section.activities) {
    if ((activity.type !== "page" && activity.type !== "book") || !activity.availableToMe) continue;
    // Done already (by hand, or on view): skipped, so running again picks up where it stopped.
    if (activity.completion?.complete) continue;

    console.log(`${section.title} > ${activity.name}`);
    // A page waits as long as its text takes; a book is read chapter by chapter, following "next".
    const content = await moodle.activityContent(activity);
    const text = content.chapters?.map((c) => `# ${c.title}\n\n${c.text}`).join("\n\n") ?? content.text ?? "";
    await writeFile(path.join(NOTES, `${activity.id}.md`), `# ${activity.name}\n\n${text}\n`);
    console.log(`\r  read in ${content.readingSeconds ?? 0}s${content.chapters ? `, ${content.chapters.length} chapters` : ""}`);

    // Only an activity that tracks completion for the person has `completion`.
    if (!activity.completion) continue;
    try {
      const { changed } = await moodle.setCompletion(activity.id, true);
      console.log(`  ${changed}`);
    } catch (error) {
      // Automatic completion (on view, say): Moodle decides, and the reading above is what it counts.
      if (error instanceof CompletionError) console.log("  completes automatically");
      else throw error;
    }
  }
}
```

## Step by step

1. `createMoodle` gets the pace once: `trail: "realistic"` (the default) and an `onProgress` that every reading call uses. See [Working at a student's pace](../concepts/student-pace.md).
2. `logIn()` opens a window the first time for the person to log in.
3. `courseStructure(COURSE_ID)` lists the sections and activities, with the person's completion of each one. Pages and books the person can't open yet (`availableToMe: false`) and the ones already complete are skipped.
4. `activityContent(activity)` takes the activity as the structure gives it. Each page waits as long as a person would take to read it (about 240 words a minute, 3 to 90 seconds a page), so the run takes minutes, and the progress line counts the seconds. Moodle logs the views as a person's.
5. The text (for a book, its chapters with their titles) goes to a Markdown file named by the activity's id.
6. `setCompletion(activity.id, true)` is "Mark as done". Moodle only takes it for manual completion: an activity that completes on its own (on view, grade…) answers with `CompletionError`, and the program moves on.

## What it prints

An example; the course decides the names and the times.

```text
Loops > What is a loop?
  read in 41s
  Activity 52 marked done.
Loops > The loops book
  read in 236s, 5 chapters
  completes automatically
Recursion > Recursion, step by step
  read in 87s
  Activity 61 marked done.
```

## Variations

- Quick, for a sandbox where nobody reads the logs: `trail: "fast"`. A book is read from its print page at once, which may leave completion on viewing every chapter undone.
- Labels too (the texts on the course page itself): add `activity.type === "label"`; they have `text` like a page.
- The videos in the content: `for (const item of content.media ?? []) console.log(item.kind, item.url)`; the driver gives their URLs, it doesn't play them.
- Undo a mark made by mistake: `await moodle.setCompletion(52, false)`.

## When something goes wrong

- `CompletionError` from `setCompletion`: the activity completes automatically, the course doesn't have completion enabled, or the person can't change it. The program reports it and goes on.
- `NotViewableError` from `activityContent`: the page or book can't be viewed now (hidden or restricted since the structure was read).
- `NotLoggedInError`: the session expired, which a long reading run makes more likely. Call `moodle.logIn()` and run again: what's complete is skipped.
- `MoodleServiceError` from `courseStructure` or `setCompletion`: Moodle refused, with its `errorcode` (a course the person isn't enrolled in, say). See [Errors](../concepts/errors.md).

## Data it touches

`courseStructure` is `course-content` and `own`, `activityContent` is `course-content`, and `setCompletion` is `own`. See [data categories](../concepts/data-categories.md).
