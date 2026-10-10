# Build a course unit from an outline

A teacher writes a unit's outline as plain data in the program (a section, its pages, a link, a file and an assignment with a due date) and the program builds it in the course, leaving the assignment hidden until it's ready.

**Uses:** [Activities and sections](../areas/activities.md), [Courses](../areas/courses.md), [Files](../areas/files.md).

## The program

```ts
import { createMoodle, FormError, MoodleError, NotLoggedInError } from "@falkenslab/moodle-driver";

// The course's id, from its address (course/view.php?id=3) or moodle.listCourses().
const COURSE_ID = 3;

// The unit, as plain data: change it and run again to build another unit.
const outline = {
  section: "Unit 4: Recursion",
  pages: [
    { name: "What recursion is", html: "<p>A function that calls itself, with a <strong>base case</strong> that stops it.</p>" },
    { name: "Recursion and the call stack", html: "<p>Each call waits on the stack until the one it made returns.</p>" },
  ],
  link: { name: "Watch the call stack grow", url: "https://pythontutor.com/" },
  slides: { name: "Unit 4 slides", file: "/home/teacher/unit-4/slides.pdf" },
  assignment: {
    name: "Recursive factorial",
    description: "<p>Write <code>factorial(n)</code> recursively and upload your <code>.py</code> file.</p>",
    // In the teacher's time zone in Moodle: the form's date selectors work in it.
    due: { day: 30, month: 11, year: 2026, hour: 23, minute: 55 },
  },
};

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/teacher/.moodle-profile", headless: true, downloadBrowser: true });

try {
  await moodle.logIn();

  // A new section at the end of the course; sectionId is its database id, not its number.
  const section = await moodle.addSection(COURSE_ID, { name: outline.section });
  const sectionId = section.sectionId!;
  const course = { courseId: COURSE_ID, sectionId };

  // createActivity hides what it creates unless told otherwise: these are ready, so they're shown.
  for (const page of outline.pages) {
    const created = await moodle.createActivity({ ...course, type: "page", name: page.name, content: page.html, visibility: "shown" });
    console.log(created.changed);
  }
  console.log((await moodle.createActivity({ ...course, type: "url", name: outline.link.name, url: outline.link.url, visibility: "shown" })).changed);
  // A file resource: the PDF is uploaded to the form's file area before saving.
  console.log((await moodle.createActivity({ ...course, type: "resource", name: outline.slides.name, files: [outline.slides.file], visibility: "shown" })).changed);

  // The assignment stays hidden (the default) until the teacher checks it.
  const { due } = outline.assignment;
  const assignment = await moodle.createActivity({
    ...course,
    type: "assign",
    name: outline.assignment.name,
    description: outline.assignment.description,
    settings: {
      // A date's parts are disabled until its "Enable" checkbox is checked: that one goes first.
      "duedate[enabled]": true,
      "duedate[day]": due.day,
      "duedate[month]": due.month,
      "duedate[year]": due.year,
      "duedate[hour]": due.hour,
      "duedate[minute]": due.minute,
      // Moodle refuses a "Remind me to grade by" date before the due date; this unit doesn't use it.
      "gradingduedate[enabled]": false,
      assignsubmission_file_enabled: true,
      assignsubmission_onlinetext_enabled: false,
    },
  });
  console.log(assignment.changed);

  // Every change returns the course afterwards: no need to read it again.
  const built = assignment.sections.find((s) => s.id === sectionId);
  console.log(`\n${built?.title}`);
  for (const activity of built?.activities ?? []) console.log(`  [${activity.type}] ${activity.name} (${activity.id})${activity.visible ? "" : " - hidden"}`);
} catch (error) {
  if (error instanceof FormError) for (const { field, message } of error.fields) console.error(`${field}: ${message}`);
  else if (error instanceof NotLoggedInError) console.error("No session: run again to log in.");
  else if (error instanceof MoodleError) console.error(`${error.code}: ${error.message}`);
  else throw error;
}
```

## Step by step

1. `COURSE_ID` is the course's id: the `id` in its address, or a course's `id` from `listCourses()`. The outline is ordinary data; the program could as well read it from a JSON or YAML file.
2. `logIn()` opens a window the first time so the teacher logs in themselves; later runs reuse the session kept in the profile and don't show anything.
3. `addSection` adds the section at the end of the course and names it. Its `sectionId` is what `createActivity` takes, not the number the course page shows.
4. Each `createActivity` fills the activity's own form (`course/modedit.php`) and saves it with "Save and return to course", as the teacher would. Activities come out hidden by default, so the pages, the link and the slides ask for `visibility: "shown"`.
5. The slides are a file resource (`type: "resource"`): `files` takes absolute local paths, checked before any page opens, and uploads them to the form's file area.
6. The assignment's options go in `settings` by their names in Moodle's form. The due date's parts are set one at a time in the order given, so `duedate[enabled]` comes first; Moodle reads them in the teacher's time zone in their profile.
7. The assignment is left hidden: the teacher checks it in Moodle and shows it when it's ready (see the variations).
8. The last result's `sections` is the course's structure after the change, the same `CourseSection[]` as `courseStructure()` gives: the program prints the new section from it.

## What it prints

An example run:

```text
Created page 812 "What recursion is" in section 5.
Created page 813 "Recursion and the call stack" in section 5.
Created url 814 "Watch the call stack grow" in section 5.
Created resource 815 "Unit 4 slides" in section 5.
Created assign 816 "Recursive factorial" in section 5.

Unit 4: Recursion
  [page] What recursion is (812)
  [page] Recursion and the call stack (813)
  [url] Watch the call stack grow (814)
  [resource] Unit 4 slides (815)
  [assign] Recursive factorial (816) - hidden
```

## Variations

- Show the assignment once it's checked: `await moodle.editActivity(COURSE_ID, 816, { visibility: "shown" });`.
- Put the unit after another section instead of at the end: `await moodle.addSection(COURSE_ID, { name: outline.section, afterSectionId: 21 })`, with the id from `courseStructure()`.
- Find a setting's form name before using it: `(await moodle.activitySettings(816)).fields` lists every field with its `name`, `label` and whether it's `disabled`; `courseActivityTypes(COURSE_ID)` lists the types the teacher can add.
- Upload several files as one resource the students open as a list: `type: "folder"` with every path in `files`.

## When something goes wrong

- `FormError`: Moodle refused the form (a missing name, a due date before the "allow submissions from" date), a setting's name isn't in the form, or a field is still disabled. Its `fields` hold each field and Moodle's message; set the enabling checkbox first in the same `settings`.
- `MoodleError` with code `not-found`: the course has no section with that id, or a file in `files` doesn't exist; `invalid-input`: a relative path, or `content` for a type other than a page or a label; `not-available`: `files` for a type whose form takes none.
- `MoodleServiceError` from `addSection` (with Moodle's `errorcode`, such as `nopermissions`): the teacher can't edit this course.
- `NotLoggedInError`: the session expired; run again and log in. Activities already created stay in the course, so remove them or the section (`deleteSection`) before running the whole outline again.

## Data it touches

Every function it calls (`addSection`, `createActivity`) is `course-content`: what teachers make, nobody's personal data. See [data categories](../concepts/data-categories.md).
