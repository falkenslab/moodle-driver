# H5P

H5P activities (module `h5pactivity`): what an activity holds (its H5P content type and version), whether Moodle tracks attempts, and the person's own attempts with their scores. Students read their attempts; a teacher reads the same activity facts, with no attempts (their report lists participants instead). The driver doesn't play H5P content: playing happens in the content's iframes, which a program drives itself in the browser's working tab.

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level pieces the operations are built from are functions only.

Everything is read from Moodle's pages (body ids, data attributes, the player's settings, the report table by position and icon), so it works in any interface language. `h5pActivity` throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## h5pActivity

An H5P activity: its content type, whether attempts are tracked, and the person's attempts with their scores.

```ts
function h5pActivity(context: BrowserContext, siteUrl: string, activityId: number): Promise<H5PActivity>;

interface H5PActivity {
  id: number;
  name: string;
  contentType?: { library: string; version: string };
  tracked: boolean;
  attempts: H5PAttempt[];
}

interface H5PAttempt {
  id?: number;
  number: number;
  score?: number;
  maxScore?: number;
  completed?: boolean;
  passed?: boolean;
}
```

- `id`: the course module id given; `name`: the activity's name.
- `contentType`: the H5P library and its version (`{ library: "H5P.MultiChoice", version: "1.14" }`), read from the player page's H5P settings before any of its scripts run. Missing when the activity has no player (no content uploaded) or the player page can't be read.
- `tracked`: Moodle records attempts and scores for this activity (its "enable attempt tracking" setting); the page links to the attempts report only then.
- `attempts`: the person's own attempts, oldest first; empty when attempts aren't tracked, when the person has none, and for a teacher, whose report lists participants rather than attempts.
- `id`: Moodle's id for the attempt, from its report link; `number`: its number for the person (1, 2...).
- `score` and `maxScore`: the raw score and the maximum, as numbers.
- `completed` and `passed`: from the report's completion and success icons; missing when the row shows no icon.

The activity page, the player page and, when tracked, the attempts report (`mod/h5pactivity/report.php`) are opened; nothing is played, so no attempt is started or recorded. Throws `NotAnH5PActivityError` when the id isn't an H5P activity the person can open.

## Playing H5P content

H5P content runs as JavaScript inside iframes of the activity's page, with as many interactions as content types. The driver gives no function to play it: a program that wants to drives the page itself in the browser's working tab, the same tab the browser shows when it's visible (see [The browser](../concepts/browser.md) and [Low-level access](../concepts/low-level.md)). `BrowserManager.tab()` returns that tab as a Playwright `Page`, opening the browser if needed. Attempts made there are recorded by Moodle as the person's (when tracked), and `h5pActivity` reads them afterwards.

## Example

```ts
import { NotAnH5PActivityError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const activity = await moodle.h5pActivity(38);
  console.log(`${activity.name}: ${activity.contentType?.library ?? "unknown type"} ${activity.contentType?.version ?? ""}`);
  if (!activity.tracked) console.log("Moodle doesn't record attempts here.");
  for (const attempt of activity.attempts) {
    console.log(`Attempt ${attempt.number}: ${attempt.score ?? "-"}/${attempt.maxScore ?? "-"}${attempt.passed ? " (passed)" : ""}`);
  }

  // Playing it is the program's: open the activity in the working tab and drive its iframe.
  const tab = await moodle.tab();
  await tab.goto(new URL(`mod/h5pactivity/view.php?id=${activity.id}`, moodle.site).href);
  await tab.locator("iframe.h5p-player").waitFor();
  const player = tab.frameLocator("iframe.h5p-player");
  // ...click and type in `player` as the content type needs.
} catch (error) {
  if (error instanceof NotAnH5PActivityError) console.error(error.message);
  else throw error;
}
```

The selectors inside the player depend on the content type and its version: read them in the content itself.

## Data categories

- `h5pActivity`: `course-content` and `own` (the content and the person's attempts).
- `readH5PAttempts`, the reader for a report page a program opened itself: `none`.
- `BrowserManager.tab`: `any`, since a program can open anything in it.

See [Data categories](../concepts/data-categories.md).
