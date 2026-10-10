# The Moodle object and the functions

There are two ways to call the driver, and they're the same operations:

- **The Moodle object**: `createMoodle()` keeps the site and the browser, and has every operation as a method. The usual way.
- **The functions**: every operation is also an exported function that takes the browser context and the site first. For programs that manage the browser themselves, work several sites, or go [lower level](low-level.md).

```ts
import { createMoodle, listCourses } from "@falkenslab/moodle-driver";

const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });

// The same call, both ways.
const a = await moodle.listCourses("inprogress");
const b = await listCourses(await moodle.context(), moodle.site, "inprogress");
```

## createMoodle

```ts
function createMoodle(options: MoodleDefaults & (({ site: string } & BrowserOptions) | { site: string; browser: BrowserManager })): Moodle;
```

Give it the site and the [browser's options](browser.md) (a new browser manager is made for it), or a browser manager you already have. The site is normalized (`parseSiteUrl`): a trailing slash, no query; something that isn't an http(s) URL throws `MoodleUrlError`. Nothing launches until the first call that needs the browser.

## Defaults

Settings a program would otherwise repeat on every call go to the object once; any call can still give its own.

| Option | Default | Used by |
| --- | --- | --- |
| `trail` | `"realistic"` | `activityContent`, `answerQuizQuestions`, `answerLessonPage`: the [student's pace](student-pace.md) |
| `onProgress(elapsed, total?)` | none | The same three, while they wait at a reader's pace |
| `loginTimeoutMs` | 5 minutes | `logIn()`, how long it waits for the person |
| `downloadDir` | none | `downloadFile(url)` without a folder |

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const moodle = createMoodle({
  site: "https://campus.example.org/",
  profileDir: "/home/ada/.moodle-profile",
  headless: true,
  downloadBrowser: true,
  trail: "fast",
  downloadDir: "/home/ada/moodle-files",
});
await moodle.logIn();
const book = await moodle.activityContent(6, "book"); // fast
const slow = await moodle.activityContent(6, "book", { trail: "realistic" }); // this call only
```

`moodle.defaults` gives them back.

## The object's methods

Every operation whose first parameters are the browser context and the site is a method of the same name without them: `gradeSubmission(context, site, 35, 7, input)` is `moodle.gradeSubmission(35, 7, input)`, with the same options, result and errors. The area pages show the functions' signatures; drop the first two for the method. The lower-level pieces the operations are built from (an assignment's ids and grading panel, a quiz attempt's single steps, the course's raw state, the editor's actions) are functions only, to keep the object to what programs call; see [Going lower level](low-level.md).

The object also has its own:

| Member | What it is |
| --- | --- |
| `site` | The site's base URL, normalized |
| `browser` | The browser manager underneath |
| `context()` | The browser's context, launching it if needed: what the functions take |
| `logIn({ timeoutMs?, onWait? })` | Makes sure there's a session, waiting `loginTimeoutMs` by default; see [Logging in](../getting-started/logging-in.md) |
| `logOut()` | Ends Moodle's session |
| `publicSiteInfo()` | What the site tells anyone before logging in |
| `callService<T>(methodname, args)` | One of Moodle's AJAX services, typed; see [Going lower level](low-level.md) |
| `tab()`, `visible()`, `setVisible(visible)` | The working tab and showing the browser; see [The browser](browser.md) |
| `saveSession()`, `close()` | Saving the session and closing the browser |
| `defaults` | The defaults it was made with |

## Arguments

After the context and the site, every operation takes the ids it works on, then an options object when it has optional settings, with the previous behavior as default.

```ts
const discussions = await moodle.forumDiscussions(37);
await moodle.gradeSubmission(35, 7, { grade: "8.5", feedback: "<p>Well argued.</p>", notify: true });
```

## Ids

Moodle has several kinds of ids, and the driver takes the ones its pages show:

| Id | What it is | Where to get it |
| --- | --- | --- |
| Course id | `course/view.php?id=3` | `listCourses()` |
| Activity id (course module id, "cmid") | `mod/quiz/view.php?id=27` | `courseStructure()`, every activity's `id` |
| Section id | Not its number: a database id | `courseStructure()`, every section's `id` |
| User id | `user/view.php?id=4` | `participants()`, `whoAmI()`, any listing of people |
| Discussion and post ids | `mod/forum/discuss.php?d=4`, `#p8` | `forumDiscussions()`, `discussion()` |
| Attempt id | `mod/quiz/attempt.php?attempt=9` | `startQuizAttempt()`, `quizInfo()`, `quizResults()` |
| Question, category and bank ids | The question bank's | `questionBanks()`, `questions()` |
| Grade item and category ids | The gradebook's | `gradebookSetup()`, `graderReport()` |

Operations on an activity always take its course module id (the `id` in its URL), never its instance id: the driver finds the instance itself when Moodle needs it.

## Results

Results are plain data you can serialize as JSON:

- dates as ISO 8601 strings in UTC (`2026-10-23T12:30:00.000Z`), except where Moodle only shows a date as text (then it comes as shown, in the site's language);
- names and texts decoded, HTML turned into plain text with paragraphs and lists kept where an operation reads content;
- no Playwright objects, nothing to close.

## Writes answer with the state afterwards

Operations that change something return a short `changed` sentence saying what they did, and the state afterwards where it's cheap to read: the course's structure after creating an activity, the grade saved after grading, the choice after answering it, the discussion after pinning it. Check it instead of reading again.

```ts
const result = await moodle.createActivity({ courseId: 3, sectionId: 7, type: "page", name: "Loops", content: "<p>...</p>" });
console.log(result.changed); // Created page 42 "Loops" in section 2.
console.log(result.activityId); // 42
```

Many writes are idempotent where Moodle's are: marking an activity done twice, pinning a pinned discussion, marking notifications read. Others create something each time (a post, an activity, a question).

## One thing at a time

Operations share the browser and the kept service tab. Call them one after another (`await` each) rather than in parallel on the same object: Moodle's session and form tokens are per person, and a site behaves best with one person doing one thing at a time. Several sites, or several people, take one object (and one profile) each.

## Permissions are Moodle's

The driver can do whatever the person can do in Moodle, and nothing more. A student calling a teacher's operation gets Moodle's refusal as an error, usually with Moodle's own message ("Sorry, but you do not currently have permissions to do that (View grader report)"). There's no separate permission model in the driver; a program that wants one can build it on [data categories](data-categories.md).
