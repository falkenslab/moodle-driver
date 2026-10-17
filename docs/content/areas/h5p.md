# H5P

H5P activities (module `h5pactivity`): what an activity holds (its H5P content type and version), whether Moodle tracks attempts, and the person's own attempts with their scores. Students read their attempts; a teacher reads the same activity facts, with no attempts (their report lists participants instead). The driver doesn't play H5P content: playing happens in the content's iframes, which a program drives itself in the browser's working tab. A course's content bank, where teachers keep H5P content to reuse, is listed, uploaded to, renamed, downloaded and deleted too.

**Terms:** [h5p](../reference/glossary.md#h5p), [attempt](../reference/glossary.md#attempt), [content bank](../reference/glossary.md#content-bank).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

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
- `tracked`: Moodle records attempts and scores for this activity (its "enable attempt tracking" setting): the page links to the attempts report only then, and a student's page only once they have an attempt, so without the link the report itself is opened to tell (Moodle answers it with an error when attempts aren't tracked, or when the activity doesn't let students review them).
- `attempts`: the person's own attempts, oldest first; empty when attempts aren't tracked, when the person has none, and for a teacher, whose report lists participants rather than attempts.
- `id`: Moodle's id for the attempt, from its report link; `number`: its number for the person (1, 2...).
- `score` and `maxScore`: the raw score and the maximum, as numbers.
- `completed` and `passed`: from the report's completion and success icons; missing when the row shows no icon.

The activity page, the player page and the attempts report (`mod/h5pactivity/report.php`) are opened; nothing is played, so no attempt is started or recorded. Throws `NotAnH5PActivityError` when the id isn't an H5P activity the person can open.

## Playing H5P content

H5P content runs as JavaScript inside iframes of the activity's page, with as many interactions as content types. The driver gives no function to play it: a program that wants to drives the page itself in the browser's working tab, the same tab the browser shows when it's visible (see [The browser](../concepts/browser.md) and [Low-level access](../concepts/low-level.md)). `BrowserManager.tab()` returns that tab as a Playwright `Page`, opening the browser if needed. Attempts made there are recorded by Moodle as the person's (when tracked), and `h5pActivity` reads them afterwards.

## The content bank

A course's content bank keeps H5P content apart from its activities, for teachers to reuse. Each content has an id of its own, not a course module id. Opening a course's bank takes Moodle's capability `moodle/contentbank:access`, which teachers have and students don't; every function throws `ContentBankError` naming the capability Moodle wants when it refuses, or saying there's no such content.

```ts
function contentBank(context: BrowserContext, siteUrl: string, courseId: number): Promise<BankContent[]>;
function uploadToContentBank(context: BrowserContext, siteUrl: string, courseId: number, file: string): Promise<BankContentUpload>;
function renameContent(context: BrowserContext, siteUrl: string, contentId: number, name: string): Promise<{ changed: string; contentId: number; name: string }>;
function downloadContent(context: BrowserContext, siteUrl: string, contentId: number, destDir: string): Promise<DownloadedFile>;
function deleteContent(context: BrowserContext, siteUrl: string, contentId: number): Promise<{ changed: string; contentId: number }>;

interface BankContent {
  id: number;
  name: string;
  type: string;
  contentType?: { library: string; version: string };
  authorName: string;
  modified?: string;
  size: number;
  uses: number;
  unlisted: boolean;
  fileUrl?: string;
}

interface BankContentUpload {
  changed: string;
  content: BankContent;
}
```

- `contentBank`: the course's contents, as its bank page (`contentbank/index.php`) lists them, with each content's page (`contentbank/view.php`) read for its file: one request per content, which Moodle logs as a view. `type` is Moodle's content type, from the file's extension (`"h5p"`, the only one Moodle has); `contentType` the H5P library and its version, from the content's icon (missing when the library has none); `authorName` who uploaded it; `modified` when it last changed (Moodle shows no creation date); `size` in bytes; `uses` how many activities use its file; `unlisted` whether it's kept out of the list for those who can't see unlisted content; `fileUrl` the content's file (`pluginfile.php/<context>/contentbank/public/<id>/<file>`). An unlisted content's `name` has Moodle's "(Unlisted)" added for those who can't rename it.
- `uploadToContentBank`: uploads a local `.h5p` package, as the bank's "Upload" button does (its upload form, a draft area), and gives the new content, named after the file. It takes `moodle/contentbank:upload` and `contenttype/h5p:upload`. A file of a type the bank doesn't take is refused before anything is sent (`MoodleError`, `invalid-input`); a package Moodle refuses gives Moodle's error code. Moodle deploys a package when it's first shown: one needing H5P libraries the site doesn't have shows only to whoever may install them (`moodle/h5p:updatelibraries`, the admin).
- `renameContent`: the content's new name (`core_contentbank_rename_content`); its file keeps its name. Moodle stores it as plain text, and `name` is what the content's page shows afterwards. It takes `moodle/contentbank:manageowncontent` for the person's own content, `manageanycontent` for anyone's; an empty name is `invalid-input`.
- `downloadContent`: saves the content's file into `destDir` from its page's "Download" link, never overwriting, as `downloadFile` does (which can save `fileUrl` too). It takes `moodle/contentbank:downloadcontent`.
- `deleteContent`: deletes the content (`core_contentbank_delete_content`), even when activities use it, as the page does once it has warned. It takes `moodle/contentbank:deleteowncontent` for the person's own content, `deleteanycontent` for anyone's.

An H5P activity is created from a local package (`createActivity` with `type: "h5pactivity"`): to make one from a content of the bank, download it first and give the file. The activity then has its own copy, not a link to the bank's.

```ts
import { tmpdir } from "node:os";
import { ContentBankError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  const { content } = await moodle.uploadToContentBank(12, "/home/me/quiz.h5p");
  await moodle.renameContent(content.id, "Week 1 check");
  for (const item of await moodle.contentBank(12)) {
    console.log(`${item.id} ${item.name} (${item.contentType?.library ?? item.type}), used ${item.uses} times`);
  }
  // A copy of it as an activity, in the section whose id is 3.
  const saved = await moodle.downloadContent(content.id, tmpdir());
  await moodle.createActivity({ courseId: 12, sectionId: 3, type: "h5pactivity", name: "Week 1 check", files: [saved.path] });
  await moodle.deleteContent(content.id);
} catch (error) {
  if (error instanceof ContentBankError) console.error(error.message);
  else throw error;
}
```

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
- `contentBank`, `uploadToContentBank`, `renameContent`, `downloadContent`, `deleteContent`: `course-content` (what teachers keep in the bank, with its author's name).
- `BrowserManager.tab`: `any`, since a program can open anything in it.

See [Data categories](../concepts/data-categories.md).
