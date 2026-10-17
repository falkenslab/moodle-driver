# SCORM

SCORM activities (module `scorm`): what the person sees on the activity's page (attempts allowed and made, the grading method, the grade reported and each attempt's) and its SCOs with the person's status and score; Moodle's player opened on the working tab to do it; and, for a teacher, a SCORM created from a package, and its package replaced. A package is the teacher's own HTML and JavaScript: the driver doesn't do it, and never writes its tracks or a grade. Its result comes only from doing it in the player.

**Terms:** [SCORM](../reference/glossary.md#scorm), [attempt](../reference/glossary.md#attempt), [working tab](../reference/glossary.md#working-tab).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; `openScorm` takes the browser manager instead (`moodle.openScorm(…)`).

Moodle doesn't open its SCORM services to AJAX: everything is read from its pages (body ids, the "Enter" form's fields, the attempt status by line position, the SCOs' status by icon), so it works in any interface language. Both functions throw `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## scorm

A SCORM activity as the person sees it.

```ts
function scorm(context: BrowserContext, siteUrl: string, activityId: number): Promise<ScormActivity>;

interface ScormActivity {
  id: number;
  name: string;
  description?: string;
  attemptsAllowed?: number;
  attemptsMade?: number;
  gradingMethod?: string;
  grade?: string;
  attemptGrades: { attempt: number; grade: string }[];
  scos: ScormSco[];
}

interface ScormSco {
  id: number;
  title: string;
  status?: "not-attempted" | "incomplete" | "completed" | "passed" | "failed" | "browsed" | "suspended";
  score?: number;
}
```

- `id`: the course module id given; `name` and `description` (HTML): the activity's.
- `attemptsAllowed`: missing when unlimited; `attemptsMade`: the person's.
- `gradingMethod`: in the site's words ("Highest attempt"); `grade`: the grade reported to the gradebook, and `attemptGrades` each attempt's, as Moodle shows them ("100%", or a count of SCOs for a SCORM graded by learning objects). No `grade` before the first attempt.
- `scos`: the package's SCOs (the parts the player launches), with the person's `status` and `score` in their last attempt (the first, before any), as the player's table of contents shows them.

The attempt status fields are missing when the activity hides it (its "display attempt status" setting). The activity's page is opened so that Moodle never skips it to the player, and the table of contents is read from Moodle's `prereqs.php`: no attempt is started. Moodle doesn't show the SCORM version on the page; `openScorm` gives it. Throws `ScormError` when the id isn't a SCORM the person can open.

## openScorm

Opens a SCORM in Moodle's player, in normal mode, on the browser's [working tab](../concepts/browser.md#the-working-tab), for the person (or the program driving the tab) to do it there.

```ts
function openScorm(browser: BrowserManager, siteUrl: string, activityId: number, options?: { scoId?: number; newAttempt?: boolean }): Promise<OpenedScorm>;

interface OpenedScorm {
  attempt: number;
  scoId: number;
  version?: "SCORM 1.2" | "SCORM 2004" | "AICC";
  url: string;
}
```

- The last attempt continues, or the first starts; `newAttempt: true` starts a new one when Moodle allows it (it may keep the last one open while it's incomplete). `attempt` is the one Moodle opened.
- At the SCO the "Enter" button opens, or at `scoId` (one of `scorm`'s `scos`).
- Resolves once the SCO has loaded in the player's frame (`#scorm_object`), after Moodle's "loading" page: the tab can be driven from there, or shown to the person.

Opening the player is what starts an attempt in Moodle and marks the activity viewed. Throws `ScormError` when Moodle offers no way in (closed, no attempts left) or doesn't open the player. The `moodle` command has no `open-scorm`: its browser closes when the command ends.

## Creating a SCORM

`createActivity` with `type: "scorm"` takes the package, a `.zip` with its `imsmanifest.xml`, as the first of `files` (see [Activities and sections](activities.md)):

```ts fragment
await moodle.createActivity({ courseId: 3, sectionId: 7, type: "scorm", name: "Check what you know", files: ["/home/ada/scorm/check.zip"], visibility: "shown" });
```

Other settings go in `settings` by their form field names (`maxattempt`, `grademethod`, `whatgrade`, `skipview`…).

## Replacing a SCORM's package

`updateActivity` with `package`, a local `.zip` (absolute path), replaces a SCORM's package in place, in its form's package field: the activity keeps its id, its settings (attempts, grading) and its grade item, so its links and its place in the gradebook stay. The result's `scorm` is the activity as `scorm` reads it afterwards, and `files` its new package:

```ts fragment
const done = await moodle.updateActivity(44, { package: "/home/ada/scorm/check-v2.zip" });
console.log(done.changed); // Updated activity 44 "Check what you know": package replaced by check-v2.zip.
for (const sco of done.scorm?.scos ?? []) console.log(sco.title);
```

What happens to the attempts made doesn't depend on the activity's settings: Moodle matches the new package's SCOs to the old ones by their `identifier` in `imsmanifest.xml`. A SCO the new package keeps (even retitled) keeps its id and everyone's tracks in it; a SCO it no longer has is deleted with its tracks; a new one starts not attempted. Keep the identifiers to keep the attempts.

- A zip Moodle can't read as a package (no `imsmanifest.xml`): `ActivitySettingsError` with Moodle's message, and the activity keeps its old package.
- `package` for an activity that isn't a SCORM, or with `files`: a `MoodleError` (`invalid-input`); for a SCORM taken from a URL rather than uploaded: `not-available`.

## Example

```ts
import { ScormError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const activity = await moodle.scorm(44);
  console.log(`${activity.name}: ${activity.attemptsMade ?? "?"} attempts, grade ${activity.grade ?? "none yet"}`);
  for (const sco of activity.scos) console.log(`  ${sco.title}: ${sco.status ?? "?"}${sco.score !== undefined ? ` (${sco.score})` : ""}`);

  // The player on the working tab: the person does it there, or the program drives the SCO's frame.
  await moodle.setVisible(true);
  const opened = await moodle.openScorm(activity.id);
  console.log(`Attempt ${opened.attempt}, ${opened.version ?? "unknown version"}`);
  const sco = (await moodle.tab()).frameLocator("#scorm_object");
  await sco.locator("body").waitFor();
  // ...click and type in `sco` as the package needs.
} catch (error) {
  if (error instanceof ScormError) console.error(error.message);
  else throw error;
}
```

Once the person leaves the player (or the package finishes), `scorm` reads the new status and grade.

## Data categories

- `scorm`: `course-content` and `own` (the activity and the person's attempts).
- `openScorm`: `own` (the person's attempt).

See [Data categories](../concepts/data-categories.md).
