# Reaching what the driver doesn't wrap

Moodle has far more than the driver's areas cover. This page shows a program that calls an AJAX service of Moodle's, reads a page by its structure and fills a form, all with the person's session, and then how to limit what a program (or an agent driving it) may call, for programmers.

**Uses:** [Going lower level](../concepts/low-level.md), [Data categories](../concepts/data-categories.md), [How it works](../concepts/how-it-works.md), [Errors](../concepts/errors.md).

## The program

```ts
import { createMoodle } from "@falkenslab/moodle-driver";
import { readTexts, setFields, submitForm } from "@falkenslab/moodle-driver/internals";

// The fields of core_course_get_recent_courses this program reads; Moodle sends more.
interface RecentCourse {
  id: number;
  fullname: string;
  viewurl: string;
}

await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: `${process.env.HOME}/.moodle-profile`, headless: true, downloadBrowser: true });
await moodle.logIn();

// 1. An AJAX service: only those Moodle opens to AJAX ('ajax' => true in its db/services.php) work.
const recent = await moodle.callService<RecentCourse[]>("core_course_get_recent_courses", { limit: 5 });
for (const course of recent) console.log(`Recently: ${course.fullname} (${course.id})`);

// 2. A page read by structure: the body id names the page, classes name things (not the site's language).
const badges = await moodle.openSitePage("badges/mybadges.php");
try {
  const bodyId = await badges.locator("body").getAttribute("id");
  if (bodyId !== "page-badges-mybadges") throw new Error(`Not the badges page: ${bodyId}`);
  // These selectors are Moodle's badges list: check them against your site's version.
  const names = await readTexts(badges, ".badges .badge-name");
  console.log(`Badges: ${names.join(", ") || "none yet"}`);
} finally {
  await badges.close(); // Pages from openSitePage and openForm are the program's to close.
}

// 3. A form: the person's forum preferences, by the fields' names in Moodle's form.
const form = await moodle.openForm("user/forum.php");
try {
  await setFields(form, { maildigest: "1", autosubscribe: "0" }); // Daily digest; no automatic subscription.
  await submitForm(form, "submitbutton"); // Throws FormError with Moodle's messages if it refuses.
  console.log("Forum preferences saved.");
} finally {
  await form.close();
}
```

## Step by step

1. `moodle.callService<T>(methodname, args)` posts to Moodle's `lib/ajax/service.php` with the person's session and its `sesskey`, as Moodle's own pages do. `T` is what the program expects back: the driver doesn't check it, so declare only the fields you read.
2. `moodle.openSitePage(path)` opens a page of the site in a new tab, as a Playwright `Page`, and throws `NotLoggedInError` if Moodle answers with its login page. The program reads it by structure: the body id (`page-badges-mybadges`) says which page it is, and classes find what's on it, so the program works whatever the site's language. `readTexts` from `/internals` gives elements' text with paragraphs and lists kept.
3. `moodle.openForm(path)` opens a page with a Moodle form and waits for its editors and its dependencies (fields that enable others). `setFields` sets fields by name, one at a time so Moodle's handlers run in between; `submitForm` clicks the named button and reads Moodle's validation messages.
4. Each page is closed in a `finally`: unlike the driver's operations, these give the program a page, and it's the program's.
5. `await using` closes the browser at the end, saving the session.

## What it prints

An example:

```text
Recently: Programming 1 (3)
Recently: Databases (7)
Badges: First submission, Forum regular
Forum preferences saved.
```

## Restricting what may be called

A program that lets someone else choose what to call (an assistant, a script language, a plugin) can allow some kinds of data and refuse the rest. `DATA_CATEGORIES` gives each function's [data categories](../concepts/data-categories.md), and `MOODLE_METHODS` the names of the object's methods that are driver functions.

```ts
import { createMoodle, DATA_CATEGORIES, MOODLE_METHODS, MoodleError, type DataCategory, type Moodle } from "@falkenslab/moodle-driver";

// This program may read and build course content and the person's own data, never others'.
const ALLOWED = new Set<DataCategory>(["none", "own", "course-content", "others-aggregate"]);

/** Why a method can't be called, or undefined when it can. */
function refusal(method: string): string | undefined {
  if (!MOODLE_METHODS.includes(method)) return `${method} isn't one of the driver's methods`;
  const categories = DATA_CATEGORIES[method];
  if (!categories) return `${method} has no data categories`; // Unclassified: refuse, don't guess.
  const denied = categories.filter((category) => !ALLOWED.has(category));
  return denied.length > 0 ? `${method} touches ${denied.join(", ")}` : undefined;
}

/** Calls a method of the object by name, only if all its categories are allowed. */
export async function callAllowed(moodle: Moodle, method: string, args: unknown[]): Promise<unknown> {
  const reason = refusal(method);
  if (reason) throw new MoodleError(`Not allowed: ${reason}.`, "invalid-input");
  const fn = (moodle as unknown as Record<string, (...rest: unknown[]) => Promise<unknown>>)[method]!;
  return fn.apply(moodle, args);
}

// For example, with a name and arguments that came from elsewhere:
await using moodle = createMoodle({ site: "https://campus.example.org/", profileDir: `${process.env.HOME}/.moodle-profile`, headless: true, downloadBrowser: true });
await moodle.logIn();
console.log(await callAllowed(moodle, "courseStructure", [3])); // Allowed: course-content, own.
await callAllowed(moodle, "assignmentSubmissions", [35]).catch((error: Error) => console.error(error.message)); // Refused: others-personal.
```

- The object's own members (`callService`, `tab`, `logIn`…) aren't in `MOODLE_METHODS`, so `callAllowed` refuses them; their categories are in `DATA_CATEGORIES` as `Moodle.callService` and so on, if you want to allow some.
- `callService`, `openSitePage`, `openForm`, `setFields` and the rest of `/internals` are `any`: they reach whatever they're pointed at, so an allow-list without `any` leaves them out.
- A function with several categories is allowed only when all are: `gradeSubmission` (`others-personal`, `others-write`) needs both.

## Variations

- Another service: `core_calendar_get_calendar_upcoming_view`, `core_message_get_unread_conversations_count`, `core_course_get_enrolled_users_by_cmid`… Moodle's API documentation, or the browser's network tab on the page that uses it, gives the name and arguments.
- A page the person should see: `moodle.tab()` gives the working tab, which the person sees when the browser is shown (`setVisible(true)`); leave it open, the driver reuses it.
- Without the object: every primitive is a function of `/internals` that takes the context and the site first, `callService(await moodle.context(), moodle.site, ...)`.
- Per activity: `moduleCategories(module)` tells what reading an activity of that module touches (a page holds only course content, a forum also others' posts).

## When something goes wrong

- `MoodleServiceError` with `servicenotavailable`: the service isn't open to AJAX, even if the mobile app can call it. With `invalidparameter`: the arguments don't match the service's; `nopermissions` or `requireloginerror`: the person can't.
- `NotLoggedInError`: no session, from any of them. Log in again and retry; see [Handling errors and expired sessions](errors-and-sessions.md).
- `FormError`: Moodle refused the form (its messages by field), a field isn't in it, or it's disabled until another one enables it: set the enabling field first, in the same `setFields`.
- A selector that finds nothing: the page changed with Moodle's version or theme. Read structure Moodle keeps (body ids, `data-` attributes, ids) over classes when you can, and `moodleErrorMessage(page)` tells when Moodle answered with an error page instead.

## Data it touches

The services, pages and forms are in the `any` [data category](../concepts/data-categories.md): this program reads the person's own courses and badges and changes their own preferences, but the same calls could reach anything the person can. That's why the allow-list refuses `any` unless a program says so.
