# Download a course's files

A program for a student that saves every file of a course (file resources and the files in folders) to a local folder, one subfolder per section, to keep or read offline.

**Uses:** [courses](../areas/courses.md), [content](../areas/content.md), [files](../areas/files.md).

## The program

```ts
import path from "node:path";
import { createMoodle, MoodleError } from "@falkenslab/moodle-driver";

// The course id, from listCourses() (the id in course/view.php?id=3).
const COURSE_ID = 3;
// Where the files go, as an absolute path: one subfolder per section.
const ROOT = "/home/ada/moodle-files/programming-101";

await using moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  // Reading a file's link isn't reading: no pauses needed, and a folder is read from its tree at once.
  trail: "fast",
  // What downloadFile(url) uses when given no folder; here, the root the section folders go in.
  downloadDir: ROOT,
});
await moodle.logIn();

// "03 Recursion": the number first, so folders sort as the course does; no characters a folder name can't have.
const folderFor = (number: number, title: string) => `${String(number).padStart(2, "0")} ${title.replace(/[\\/:*?"<>|.]+/g, "_").trim()}`;

let count = 0;
for (const section of await moodle.courseStructure(COURSE_ID)) {
  // File resources ("resource") and folders; restricted ones can't be opened yet.
  const withFiles = section.activities.filter((a) => (a.type === "resource" || a.type === "folder") && a.availableToMe);
  if (withFiles.length === 0) continue;
  const dir = path.join(moodle.defaults.downloadDir ?? ROOT, folderFor(section.number, section.title));
  console.log(`${section.title}/`);

  for (const activity of withFiles) {
    // The links only (pluginfile.php URLs): nothing is downloaded yet, but Moodle logs the view.
    const { files = [] } = await moodle.activityContent(activity);
    for (const file of files) {
      try {
        // Fetched with the session's cookies, without opening a tab; an existing name becomes "name (2).ext".
        const saved = await moodle.downloadFile(file.url, dir);
        console.log(`  ${saved.name} (${Math.round(saved.size / 1024)} KB)`);
        count++;
      } catch (error) {
        // A file removed or hidden since the folder was read: skip it and go on.
        if (error instanceof MoodleError && error.code === "not-found") console.log(`  ${file.name}: not available`);
        else throw error;
      }
    }
  }
}
console.log(`\n${count} files saved in ${ROOT}`);
```

## Step by step

1. `createMoodle` takes `trail: "fast"` and `downloadDir` once, as defaults for every call (see [Defaults](../concepts/calling-functions.md#defaults)). The fast trail fits here: there's no text to read, only links.
2. `logIn()` opens a window the first time for the person to log in, and answers at once afterwards.
3. `courseStructure(COURSE_ID)` gives the course's sections in order, each with its activities. `COURSE_ID` comes from `listCourses()`; each activity's `id` and `type` come from here.
4. For each file resource or folder the person can open, `activityContent(activity)` returns `files`: their names and `pluginfile.php` links. A file resource has one; a folder has the files its tree shows, all in one list.
5. `downloadFile(url, dir)` saves each one in the section's folder, creating it when needed. It names the file as Moodle sends it and never overwrites.

## What it prints

An example; the titles and names are the course's.

```text
General/
  Syllabus.pdf (182 KB)
01 Getting started/
  Installing Python.pdf (640 KB)
02 Loops/
  Loops slides.pdf (1204 KB)
  exercises.zip (36 KB)
  solutions.zip: not available
03 Recursion/
  Recursion notes.pdf (512 KB)

5 files saved in /home/ada/moodle-files/programming-101
```

## Variations

- Every file in one folder, no subfolders: `await moodle.downloadFile(file.url)` saves into the object's `downloadDir`.
- The files attached to assignments' descriptions too: for activities of type `"assign"`, `(await moodle.studentAssignment(activity.id)).descriptionFiles` has the same `{ name, url }` links.
- Every course in progress: loop over `await moodle.listCourses("inprogress")` and use each course's `shortname` as the root's subfolder.
- Leave a realistic trail in the logs instead (a person opening each resource): drop `trail: "fast"`. Files and folders aren't paused anyway, so it only matters if the program also reads pages.

## When something goes wrong

- `NotLoggedInError`: the session expired, or a file's URL answered with the login page. Call `moodle.logIn()` and run again; files already saved are kept, and saved again as "name (2)" unless the program skips them.
- `MoodleError` with code `not-found`: Moodle answered with an error status for that file (removed, or hidden from the person). The program skips it.
- `MoodleError` with code `outside-site`: the URL isn't on the site. It doesn't happen with `files` from a resource or folder, which are `pluginfile.php` links; it does with a URL resource's target.
- `NotViewableError` from `activityContent`: the activity can't be viewed as that type (it was changed, or the person lost access). See [Errors](../concepts/errors.md).

## Data it touches

`courseStructure` is `course-content` and `own`, `activityContent` is `course-content`, and `downloadFile` is `course-content` and `others-personal` (the same function saves others' submissions; here every URL comes from the course's resources). See [data categories](../concepts/data-categories.md).
