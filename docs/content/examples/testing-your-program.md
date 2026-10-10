# Testing your program

A program built on the driver has logic of its own (what to count, what to skip, what to report) that deserves tests, and those tests shouldn't need a real Moodle, a login or a network. This page tests one function of a program with `node:test` against the fake Moodle of `@falkenslab/moodle-driver/testing`, for programmers.

**Uses:** [Testing with a fake Moodle](../testing/fake-moodle.md), [The Moodle object and the functions](../concepts/calling-functions.md), [Overview and deadlines](../areas/overview-and-deadlines.md), [Errors](../concepts/errors.md).

## The program

The function under test is `dueByCourse`: what's due in the coming days, counted per course, the courses with overdue work first. It takes a `Moodle` object, so the test can give it one over the fake site. In a program it lives in its own module (`src/agenda.ts`, imported by the test as `../src/agenda.js`); here it's at the top of the test file, so the page shows one complete file. The fake Moodle answers the calendar service the driver's `deadlines()` calls, with events the test makes up.

```ts
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createMoodle, MoodleServiceError, NotLoggedInError, type Moodle } from "@falkenslab/moodle-driver";
import { SITE, ServiceFailure, fakeBrowserManager, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "@falkenslab/moodle-driver/testing";

// The function under test (src/agenda.ts in the program).
export async function dueByCourse(moodle: Moodle, days = 7): Promise<{ course: string; due: number; overdue: number }[]> {
  const byCourse = new Map<string, { course: string; due: number; overdue: number }>();
  for (const deadline of await moodle.deadlines({ days })) {
    const course = deadline.course?.shortname ?? "(site)"; // A site event (no course) still counts.
    const entry = byCourse.get(course) ?? { course, due: 0, overdue: 0 };
    entry.due++;
    if (deadline.overdue) entry.overdue++;
    byCourse.set(course, entry);
  }
  return [...byCourse.values()].sort((a, b) => b.overdue - a.overdue || a.course.localeCompare(b.course));
}

// A headless browser, or undefined where there's none: the tests are skipped then.
const browser = await launchTestBrowser();
after(() => browser?.close());

// A Moodle object over a fake site with this state: no real site, no login, no network.
async function fakeMoodle(state: FakeMoodleState) {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  return createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, close: () => context.close() }) });
}

const ADA = { id: 4, fullName: "Ada Lovelace" };
const tomorrow = Math.floor(Date.now() / 1000) + 86_400;
// A calendar action event as Moodle's service sends it.
const event = (shortname: string, overdue = false) => ({ name: "Essay is due", activityname: "Essay", modulename: "assign", eventtype: "due", timesort: tomorrow, overdue, course: { id: 3, shortname } });

describe("dueByCourse", { skip: !browser && "no browser" }, () => {
  it("counts deadlines per course, those with overdue work first", async () => {
    await using moodle = await fakeMoodle({
      user: ADA,
      services: { core_calendar_get_action_events_by_timesort: () => ({ events: [event("PROG1"), event("DB"), event("DB", true)] }) },
    });
    assert.deepEqual(await dueByCourse(moodle), [
      { course: "DB", due: 2, overdue: 1 },
      { course: "PROG1", due: 1, overdue: 0 },
    ]);
  });

  it("passes on that the session ended", async () => {
    await using moodle = await fakeMoodle({}); // No user: every page is Moodle's login page.
    await assert.rejects(dueByCourse(moodle), NotLoggedInError);
  });

  it("passes on Moodle's refusal", async () => {
    await using moodle = await fakeMoodle({
      user: ADA,
      services: { core_calendar_get_action_events_by_timesort: () => { throw new ServiceFailure("nopermissions"); } },
    });
    await assert.rejects(dueByCourse(moodle), (error) => error instanceof MoodleServiceError && error.errorcode === "nopermissions");
  });
});
```

## Step by step

1. The function takes the `Moodle` object as a parameter instead of creating it: the program passes its real one, the test a fake one. That's the one design choice testing needs.
2. `launchTestBrowser()` launches the first headless browser it finds (Edge, Chrome or Playwright's Chromium), or answers `undefined`; `describe`'s `skip` turns that into skipped tests instead of failures.
3. `serveFakeMoodle(context, state)` answers every request to `SITE` (`http://moodle.test/`) inside that browser context as Moodle would: pages with the session of `state.user`, and `lib/ajax/service.php` with `state.services[methodname](args)`.
4. `fakeBrowserManager({ context, close })` is a browser manager that launches nothing: its context is the faked one, and closing it closes that context. `createMoodle({ site: SITE, browser })` builds the same object the program uses on top of it.
5. Each test sets the course state it needs: events in two courses, no user at all (the session ended), or a service that throws `ServiceFailure("nopermissions")`, which the fake answers in Moodle's exception format.
6. `await using` closes each test's context when the test ends, through the fake manager's `close`.

## Running the tests

With `tsx` as the TypeScript runner:

```text
npx tsx --test "test/**/*.test.ts"
```

The tests open a headless browser. Run them where windows can't bother anyone: in CI, or in a container with a browser (Playwright's Docker images come with one). An example run:

```text
▶ dueByCourse
  ✔ counts deadlines per course, those with overdue work first (412ms)
  ✔ passes on that the session ended (98ms)
  ✔ passes on Moodle's refusal (87ms)
▶ dueByCourse (601ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

On a machine without any browser the three are reported as skipped, with the reason "no browser".

## Variations

- Assert what the program asked: give the state a `serviceCalls: []` array and check the methods and arguments after the call (for example, that it asked for seven days ahead).
- Pages, not services: `state.bodies[path]` adds HTML to a page, and `moodlePage({ userId, bodyId, body })` builds a whole one for a `context.route` of your own (a form that posts); see [Testing with a fake Moodle](../testing/fake-moodle.md).
- Without a browser at all: logic that only uses the browser manager (showing the browser, logging in) can take `fakeBrowserManager({ visible: () => true, ... })` with no context behind it.
- Many tests over the same state: build the object in a `before` and close it in an `after` instead of per test.

## When something goes wrong

- Every test skipped: no browser was found. Install Edge or Chrome, or Playwright's Chromium (`npx playwright-core install chromium`), in the image the tests run in.
- `MoodleServiceError` with `invalidrecord`: the code called a service the state doesn't define. Add it to `state.services`, or check `serviceCalls` to see which one it was.
- A test that hangs or times out: a page the driver waits for isn't faked the way it reads it (a form, an element). The driver's own tests (`test/areas/` in its repository) have fakes for every area to start from.
- Dates that drift: the driver's `deadlines()` asks for a window around now, so make events relative to `Date.now()`, as the test does, not fixed dates.

## Data it touches

Nothing real: the fake site holds only what the test makes up. The function itself reads the person's own deadlines, the `own` [data category](../concepts/data-categories.md).
