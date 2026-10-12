# Going lower level

The areas cover what programs ask most, but Moodle has far more. The primitives the driver is built with have their own entry point, `@falkenslab/moodle-driver/internals`, so a program can reach what isn't covered yet the same way, with the person's session and Moodle's own checks. Most are in the `any` [data category](data-categories.md): they reach whatever they're pointed at.

**Terms:** [internals](../reference/glossary.md#internals), [ajax service](../reference/glossary.md#ajax-service), [sesskey](../reference/glossary.md#sesskey).

```ts
import { callService, openSitePage, setFields, submitForm } from "@falkenslab/moodle-driver/internals";
```

They follow the same versioning as the main entry, but they're closer to Moodle: they take pages, form names and service names, so a change in Moodle shows through them sooner. The areas' own parsers and single steps (a quiz attempt's pages, an assignment's grading panel) aren't exported at all: they change with the pages they read.

## Calling a service

```ts
function callService<T>(context: BrowserContext, siteUrl: string, methodname: string, args: Record<string, unknown>): Promise<T>;
```

Also a method of the object: `moodle.callService<T>(methodname, args)`. Calls one of Moodle's AJAX services with the person's session and its `sesskey`, as Moodle's pages do, over HTTP without a tab. It throws `NotLoggedInError` when there's no session and `MoodleServiceError` (with `errorcode`) when the service fails. Only services Moodle opens to AJAX work (`'ajax' => true` in their `db/services.php`); others answer `servicenotavailable`, even if the mobile app can use them.

```ts
const groups = await moodle.callService<{ id: number; name: string }[]>("core_group_get_course_groups", { courseid: 3 });
```

`readPageConfig(context, siteUrl)` reads the person's id, interface language and time zone from a page's `M.cfg`; `readOwnProfile(context, siteUrl)` the person's id and name from their profile page.

## Opening a page

```ts
function openSitePage(context: BrowserContext, siteUrl: string, path: string, options?: { follow?: boolean }): Promise<Page>;
```

Opens a page of the site (a path relative to it) in a new tab and checks there's a session, throwing `NotLoggedInError` when Moodle answers with its login page. Close the page when done. It's also a method, `moodle.openSitePage(path)`, like `moodle.openForm(path)`. While the browser is shown on demand, the page is shown afterwards in the working tab (`follow: false` skips it).

Read pages by structure, not by text (see [How it works](how-it-works.md)): the body id names the page (`page-mod-quiz-view`), ids and data attributes name things. `moodleErrorMessage(page)` gives Moodle's message on an error page; `readSessionFacts(page)` and `pageIsLoggedIn(page, siteUrl)` tell whether a page has a user logged in, and `isLoggedIn(url, siteUrl, facts)` decides it from a page's final URL and those facts (for HTML fetched without a tab, `htmlSessionFacts(html)` gives them). `readTexts(page, selector)` gives elements' text with paragraphs and lists, `readMedia(page, selector)` the media in them, and `readImages(page, selector)` their images, one list per element.

To read a page's HTML without a tab, `fetchSitePage(context, siteUrl, path)` gives its final URL and HTML over HTTP with the profile's session, and throws `NotLoggedInError` when Moodle answers with its login page; `readMoodleConfig(html)` parses its `M.cfg`, and `htmlSessionFacts(html)` tells whether someone is logged in. Moodle's server takes most of a page's time, so it's lighter rather than much faster (ADR-011).

## Forms

```ts
openForm(context, siteUrl, path): Promise<Page>; // waits for editors and Moodle's form dependencies
formValue(page, name): Promise<string | undefined>; // a hidden field's value
setFields(page, values, formSelector?): Promise<void>; // by field name, in order
uploadToDraft(page, draftItemId, filePaths, { overwrite }?): Promise<string[]>; // as the file picker's upload does; the files' draft URLs
draftFiles(page, draftItemId): Promise<DraftFile[]>; // the files in a draft area, subfolders included
deleteDraftFile(page, draftItemId, name): Promise<void>; // as the file manager's delete does
removeFromDraft(page, draftItemId, names): Promise<void>; // several, by path, refusing any the area doesn't have
submitForm(page, button): Promise<void>; // throws FormError with Moodle's messages
dateSelectorValues(page, name, date, timeZone?); // a date selector's parts, in the person's time zone (the page's, or the one given)
dateSelectorDate(page, name); // the date a selector holds
```

- `setFields` sets text inputs and textareas (through TinyMCE where it edits them), selects (several values for a multiple one), checkboxes and radios, one field at a time so Moodle's handlers run in between. It throws `FormError` for fields the form doesn't have and for fields still disabled after the ones before them: Moodle wouldn't send them.
- Date selectors (`duedate[day]`, `[month]`, `[year]`, `[hour]`, `[minute]`) are read in the person's time zone (`M.cfg.usertimezone`): build their values with `dateSelectorValues`, enabling the selector's `[enabled]` checkbox first when it has one.
- `submitForm` waits for the next page and reads Moodle's validation messages by field.
- A draft area holds a file area's files while its form is open (the files field's value is its id). `uploadToDraft` takes local paths, or `{ from, to }` to name a file in the area or put it in a subfolder (`to: "week1/notes.pdf"`, the folders created first); with `overwrite: true` a file of the same name is replaced, otherwise Moodle keeps both and renames the new one. It returns each file's draft URL (`draftfile.php/<user context>/user/draft/<item>/<name>`), what an editor writes into its HTML for a file in its own draft area (`<editor>[itemid]`). `draftFiles` and `deleteDraftFile` name files by their path in the area, through the file manager's `repository/draftfiles_ajax.php`. Nothing changes in the activity until the form is saved.

```ts
import { setFields, submitForm, dateSelectorValues } from "@falkenslab/moodle-driver/internals";

const page = await moodle.openForm("course/modedit.php?update=35&return=0");
try {
  await setFields(page, { "duedate[enabled]": true, ...(await dateSelectorValues(page, "duedate", new Date("2026-11-02T22:59:00Z"))) });
  await submitForm(page, "submitbutton2");
} finally {
  await page.close();
}
```

## The course editor

`editCourse(context, siteUrl, courseId, action, ids, target?)` runs one of the course page's editing actions (`cm_hide`, `cm_move`, `section_add`…) through its service, as the editor does; `renameActivity` and `renameSection` use the in-place editors. The [activities](../areas/activities.md) functions are built on them.

`courseState(context, siteUrl, courseId)` gives `core_courseformat_get_state` parsed, with Moodle's own field names, and `activityDetails(context, siteUrl, courseId, state)` the dates and restrictions the course page shows, by activity: what `courseStructure` is made of (see [Courses](../areas/courses.md)).

## Running code in a page

Playwright's `page.evaluate` sends a function's source to the page. Under some TypeScript runners (tsx, esbuild's `keepNames`) named functions inside it get wrapped in a `__name` helper the page doesn't have, and fail. `inPage(page, fn, arg)` defines that helper first: use it for page code with helper functions, or keep to anonymous callbacks.

## Text and pace

`decodeEntities(text)` decodes the entities Moodle's `format_string` writes; `readingSeconds(text)` is the time a person needs to read a text, and `pause(seconds, onProgress?)` waits it (see [Student pace](student-pace.md)). `readWwwroot(html)` finds a site's base URL in one of its pages, and `fileNameFor(url, disposition)` is the name `downloadFile` saves a file with.

## Driving the browser yourself

`moodle.tab()` gives the working tab, logged in, for anything better done by hand with Playwright (see [The browser](browser.md)).
