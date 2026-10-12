# The Moodle object and the functions

There are two ways to call the driver, and they're the same operations:

**Terms:** [course module id](../reference/glossary.md#course-module-id), [changed](../reference/glossary.md#changed), [site](../reference/glossary.md#site).

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
| `downloadDir` | none | `downloadFile(url)` without a folder, `exportGrades(courseId, options)` without `destDir` |

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

Every operation whose first parameters are the browser context and the site is a method of the same name without them: `gradeSubmission(context, site, 35, 7, input)` is `moodle.gradeSubmission(35, 7, input)`, with the same options, result and errors. The area pages show the functions' signatures; drop the first two for the method. The primitives the operations are built from (Moodle's services, pages and forms, the course's raw state, the editor's actions) are functions in `@falkenslab/moodle-driver/internals`, to keep the main entry and the object to what programs call; see [Going lower level](low-level.md). The areas' own parsers and single steps aren't exported.

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
| `[Symbol.asyncDispose]()` | `close()`, so `await using` closes the browser when the block ends |
| `defaults` | The defaults it was made with |

With `await using` (TypeScript 5.2 or later, on a runtime that has it or through a transpiler), the browser closes on its own when the block ends, also on an error:

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/ada/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn();
console.log(await moodle.listCourses());
// moodle.close() runs here
```

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

Operations on an activity always take its course module id (the `id` in its URL), as a parameter named `activityId` whatever the module (a quiz, a forum, a question bank), never its instance id: the driver finds the instance itself when Moodle needs it.

## Results

Results are plain data you can serialize as JSON:

- dates as ISO 8601 strings in UTC (`2026-10-23T12:30:00.000Z`), except where Moodle only shows a date as text (then it comes as shown, in the site's language);
- names and texts decoded, HTML turned into plain text with paragraphs and lists kept where an operation reads content;
- a thing's own id is `id`, and the ids of others it refers to are `<thing>Id` (`courseId`, `userId`, `activityId`): an attempt is `{ id, userId, … }`, a grade `{ itemId, grade }`;
- no Playwright objects, nothing to close.

## Long lists

Functions whose lists grow without bound on a real site (notifications, conversations and their messages, a forum's discussions and a discussion's posts, an assignment's submissions, a quiz's attempts, a bank's questions, a course's participants and logs) read them a page at a time, all the same way:

- `limit`: how many items to return (1 or more), and `offset`: how many to skip first (0 unless given), counted in the function's own items and in its own order (newest first for notifications and messages, as Moodle lists the rest);
- without `limit`, the function returns everything, as a plain list, as it always did (`offset` alone skips the first ones);
- with `limit`, the list comes as a `ListPage`, `{ items, more }`: the page's items, and whether there are more after them. Ask for the next page with `offset` moved by `limit` until `more` is `false`.

```ts
interface ListPage<T> {
  items: T[];
  more: boolean;
}
```

The types follow the call: TypeScript gives `ListPage<Notification>` for `notifications({ limit: 20 })` and `Notification[]` for `notifications()`. Where the list is part of a larger result, the list itself becomes the page: `discussion(id, { limit })` gives `{ discussion, posts: { items, more } }`.

```ts
let offset = 0;
for (;;) {
  const page = await moodle.notifications({ unreadOnly: true, limit: 20, offset });
  for (const notification of page.items) console.log(notification.subject);
  if (!page.more) break;
  offset += 20;
}
```

A page costs less than the whole list wherever Moodle allows: the driver asks Moodle's service for the page only, or opens only the page of Moodle's own paging that holds it. Where Moodle has no paging (a discussion's posts, a bank's questions within a category), the driver reads the list and cuts it, but still converts only the page's items; each function's section says which. A `limit` below 1 or an `offset` below 0 is a `MoodleError` with the code `invalid-input`. Pages are read when asked: when something is added meanwhile, a later page may repeat an item or miss one.

The `moodle` command takes them as `--limit` and `--offset`, shows a page as its items, and says when there are more.

## Writes answer with the state afterwards

Every operation that changes something returns an object with a short `changed` sentence saying what it did, beside the state afterwards where it's cheap to read: the course's structure after creating an activity, the assignment after submitting, the choice after answering it, the discussion after pinning it, the ids of what it created. Check it instead of reading again.

```ts
const result = await moodle.createActivity({ courseId: 3, sectionId: 7, type: "page", name: "Loops", content: "<p>...</p>" });
console.log(result.changed); // Created page 42 "Loops" in section 2.
console.log(result.activityId); // 42
```

Many writes are idempotent where Moodle's are: marking an activity done twice, pinning a pinned discussion, marking notifications read. Others create something each time (a post, an activity, a question).

## One thing at a time

Operations share the browser and the person's session. Call them one after another (`await` each) rather than in parallel on the same object: Moodle's session and form tokens are per person, and a site behaves best with one person doing one thing at a time. Several sites, or several people, take one object (and one profile) each.

## Permissions are Moodle's

The driver can do whatever the person can do in Moodle, and nothing more. A student calling a teacher's operation gets Moodle's refusal as an error, usually with Moodle's own message ("Sorry, but you do not currently have permissions to do that (View grader report)"). There's no separate permission model in the driver; a program that wants one can build it on [data categories](data-categories.md).
