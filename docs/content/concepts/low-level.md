# Going lower level

The areas cover what programs ask most, but Moodle has far more. The pieces the driver is built with are exported too, so a program can reach what isn't covered yet the same way, with the person's session and Moodle's own checks. They're all in the `any` [data category](data-categories.md): they reach whatever they're pointed at.

## Calling a service

```ts
function callService<T>(context: BrowserContext, siteUrl: string, methodname: string, args: Record<string, unknown>): Promise<T>;
```

Calls one of Moodle's AJAX services from the kept logged-in tab, with its `sesskey`, as Moodle's pages do. It throws `NotLoggedInError` when there's no session and `MoodleServiceError` (with `errorcode`) when the service fails. Only services Moodle opens to AJAX work (`'ajax' => true` in their `db/services.php`); others answer `servicenotavailable`, even if the mobile app can use them.

```ts
import { callService } from "@falkenslab/moodle-driver";

const groups = await callService<{ id: number; name: string }[]>(context, site, "core_group_get_course_groups", { courseid: 3 });
```

`readPageConfig(context, siteUrl)` reads the person's id, interface language and time zone from the same tab.

## Opening a page

```ts
function openSitePage(context: BrowserContext, siteUrl: string, path: string, options?: { follow?: boolean }): Promise<Page>;
```

Opens a page of the site (a path relative to it) in a new tab and checks there's a session, throwing `NotLoggedInError` when Moodle answers with its login page. Close the page when done. While the browser is shown on demand, the page is shown afterwards in the working tab (`follow: false` skips it).

Read pages by structure, not by text (see [How it works](how-it-works.md)): the body id names the page (`page-mod-quiz-view`), ids and data attributes name things. `moodleErrorMessage(page)` gives Moodle's message on an error page. `readTexts(page, selector)` gives elements' text with paragraphs and lists, and `readMedia(page, selector)` the media in them.

## Forms

```ts
openForm(context, siteUrl, path): Promise<Page>; // waits for editors and Moodle's form dependencies
formValue(page, name): Promise<string | undefined>; // a hidden field's value
setFields(page, values, formSelector?): Promise<void>; // by field name, in order
uploadToDraft(page, draftItemId, filePaths): Promise<void>; // as the file picker's upload does
submitForm(page, button): Promise<void>; // throws FormError with Moodle's messages
dateSelectorValues(page, name, date); // a date selector's parts, in the person's time zone
dateSelectorDate(page, name); // the date a selector holds
```

- `setFields` sets text inputs and textareas (through TinyMCE where it edits them), selects (several values for a multiple one), checkboxes and radios, one field at a time so Moodle's handlers run in between. It throws `FormError` for fields the form doesn't have and for fields still disabled after the ones before them: Moodle wouldn't send them.
- Date selectors (`duedate[day]`, `[month]`, `[year]`, `[hour]`, `[minute]`) are read in the person's time zone (`M.cfg.usertimezone`): build their values with `dateSelectorValues`, enabling the selector's `[enabled]` checkbox first when it has one.
- `submitForm` waits for the next page and reads Moodle's validation messages by field.

```ts
import { openForm, setFields, submitForm, dateSelectorValues } from "@falkenslab/moodle-driver";

const page = await openForm(context, site, "course/modedit.php?update=35&return=0");
try {
  await setFields(page, { "duedate[enabled]": true, ...(await dateSelectorValues(page, "duedate", new Date("2026-11-02T22:59:00Z"))) });
  await submitForm(page, "submitbutton2");
} finally {
  await page.close();
}
```

## The course editor

`editCourse(context, siteUrl, courseId, action, ids, target?)` runs one of the course page's editing actions (`cm_hide`, `cm_move`, `section_add`…) through its service, as the editor does; `renameActivity` and `renameSection` use the in-place editors. The [activities](../areas/activities.md) functions are built on them.

## Running code in a page

Playwright's `page.evaluate` sends a function's source to the page. Under some TypeScript runners (tsx, esbuild's `keepNames`) named functions inside it get wrapped in a `__name` helper the page doesn't have, and fail. `inPage(page, fn, arg)` defines that helper first: use it for page code with helper functions, or keep to anonymous callbacks.

## Driving the browser yourself

`browser.tab()` gives the working tab, logged in, for anything better done by hand with Playwright (see [The browser](browser.md)).
