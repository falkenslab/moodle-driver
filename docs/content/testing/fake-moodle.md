# Testing with a fake Moodle

A program that uses the driver should be testable without a real Moodle, a real login or a network. `@falkenslab/moodle-driver/testing` has what the driver's own tests use: a fake Moodle served inside a browser context, made-up page fragments, and a browser manager that launches nothing.

```ts
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, ServiceFailure, fakeBrowserManager, PANEL, type FakeMoodleState } from "@falkenslab/moodle-driver/testing";
```

## The fake site

`serveFakeMoodle(context, state)` routes every request to `SITE` (`http://moodle.test/`) inside a Playwright browser context and answers like Moodle would:

- Logged out (no `state.user`), every page is Moodle's login page, as with forced login.
- Logged in, each page is a minimal Moodle page: the body id Moodle gives that path (`/mod/forum/view.php` is `page-mod-forum-view`), `M.cfg` with `wwwroot`, `sesskey`, `userId`, `usertimezone` (`Europe/Madrid`), the user menu's logout link, and the extra HTML of `state.bodies[path]`.
- `lib/ajax/service.php` answers with `state.services[methodname](args)`, or with Moodle's exception format: `servicerequireslogin` without a user, `invalidsesskey` with an old `sesskey`, `invalidrecord` for a service the state doesn't define, and any error code a service throws as `new ServiceFailure(code)`.

```ts
interface FakeMoodleState {
  user?: { id: number; fullName: string };
  sesskey?: string;
  services?: Record<string, (args: Record<string, unknown>) => unknown>;
  bodies?: Record<string, string>;
  bodyClasses?: Record<string, string>;
  pagesServed?: string[];
  serviceCalls?: { methodname: string; args: Record<string, unknown> }[];
}
```

`pagesServed` and `serviceCalls`, when given, collect what was asked, for assertions. `moodlePage({ userId, heading, bodyId, body… })` builds one such page yourself, for routes of your own (a form that posts, a page whose body id isn't its path's).

## A test

```ts
import assert from "node:assert/strict";
import { after, it } from "node:test";
import { listCourses } from "@falkenslab/moodle-driver";
import { SITE, launchTestBrowser, serveFakeMoodle } from "@falkenslab/moodle-driver/testing";

const browser = await launchTestBrowser();
after(() => browser?.close());

it("lists the person's courses", { skip: !browser && "no browser" }, async () => {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, {
    user: { id: 4, fullName: "Ada Lovelace" },
    services: {
      core_course_get_enrolled_courses_by_timeline_classification: () => ({
        courses: [{ id: 3, shortname: "loops", fullname: "Loops &amp; lists", viewurl: `${SITE}course/view.php?id=3`, visible: true }],
      }),
    },
  });
  const courses = await listCourses(context, SITE);
  assert.equal(courses[0]?.fullname, "Loops & lists");
  await context.close();
});
```

`launchTestBrowser()` launches the first headless browser it finds (Edge, Chrome or Playwright's Chromium) and answers `undefined` when there's none, so tests can skip instead of failing.

## Routes of your own

For pages that change with what the program does (a form that posts, a quiz attempt), add a `context.route` after `serveFakeMoodle`: Playwright matches the route registered last first.

```ts
await context.route(`${SITE}mod/choice/view.php**`, (route) => {
  if (route.request().method() === "POST") chosen = new URLSearchParams(route.request().postData() ?? "").get("answer");
  return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId: "page-mod-choice-view", body: choicePage(chosen) }) });
});
```

The driver's own tests (`test/areas/` in the repository) have fakes for every area: forms with their posts, grading panels, quiz attempts, lessons, the gradebook.

## A browser manager that launches nothing

To test a program's own logic around the browser manager (logging in, showing the browser) without a browser, `fakeBrowserManager(overrides)` gives a `BrowserManager` whose methods do nothing, with the ones you pass instead:

```ts
const manager = fakeBrowserManager({ context: async () => context, visible: () => true });
```

It's also how a program built on the Moodle object meets the fake site: give `createMoodle` a fake browser manager whose context is the one the fake Moodle serves.

```ts
import { createMoodle } from "@falkenslab/moodle-driver";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle } from "@falkenslab/moodle-driver/testing";

const browser = await launchTestBrowser();
const context = await browser!.newContext();
await serveFakeMoodle(context, { user: { id: 4, fullName: "Ada Lovelace" }, services: { /* ... */ } });

const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context }) });
const courses = await moodle.listCourses();
```

## Grading panels

`PANEL` is a made-up grader panel (a submission with online text, a file and comments) as `gradingPanelHtml` would return it, for tests of programs that read submissions.

## Running browser tests

Tests that launch browsers open windows on some systems. The driver runs its own only in Docker (`npm run test:docker`), never on the developer's desktop; see [Development](../reference/development.md).
