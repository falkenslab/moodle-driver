# Calling functions

Every Moodle function of the driver follows the same conventions, so once you know one you know how to call the rest.

## The signature

```ts
someFunction(context, siteUrl, ...ids, options?)
```

1. `context`: the `BrowserContext` from `browser.context()`.
2. `siteUrl`: the site's base URL with a trailing slash (`parseSiteUrl` or `findMoodleSite` give one).
3. The ids the function works on: a course, an activity, a user, a discussion…
4. An options object, when there are optional settings, with the previous behavior as default.

```ts
const context = await browser.context();
const discussions = await forumDiscussions(context, site, 37);
await gradeSubmission(context, site, 35, 7, { grade: "8.5", feedback: "<p>Well argued.</p>", notify: true });
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

Functions about an activity always take its course module id (the `id` in its URL), never its instance id: the driver finds the instance itself when Moodle needs it.

## Results

Results are plain data you can serialize as JSON:

- dates as ISO 8601 strings in UTC (`2026-10-23T12:30:00.000Z`), except where Moodle only shows a date as text (then it comes as shown, in the site's language);
- names and texts decoded, HTML turned into plain text with paragraphs and lists kept where the function reads content;
- no Playwright objects, nothing to close.

## Writes answer with the state afterwards

Functions that change something return a short `changed` sentence saying what they did, and the state afterwards where it's cheap to read: the course's structure after creating an activity, the grade saved after grading, the choice after answering it, the discussion after pinning it. Check it instead of reading again.

```ts
const result = await createActivity(context, site, { courseId: 3, sectionId: 7, type: "page", name: "Loops", content: "<p>...</p>" });
console.log(result.changed); // Created page 42 "Loops" in section 2.
console.log(result.activityId); // 42
```

Many writes are idempotent where Moodle's are: marking an activity done twice, pinning a pinned discussion, marking notifications read. Others create something each time (a post, an activity, a question).

## One thing at a time

Functions share the browser and the kept service tab. Call them one after another (`await` each) rather than in parallel on the same context: Moodle's session and form tokens are per person, and a site behaves best with one person doing one thing at a time.

## Permissions are Moodle's

The driver can do whatever the person can do in Moodle, and nothing more. A student calling a teacher's function gets Moodle's refusal as an error, usually with Moodle's own message ("Sorry, but you do not currently have permissions to do that (View grader report)"). There's no separate permission model in the driver; a program that wants one can build it on [data categories](data-categories.md).
