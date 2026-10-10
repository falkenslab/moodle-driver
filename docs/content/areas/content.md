# Content

Reading the activities teachers fill with content: a page's or label's text, a book's chapters, a URL resource's target, and the files of a file resource or a folder. It's the student's side (a teacher can read them too): `activityContent` views the activity as a person would, so Moodle logs the view, and with the realistic trail it reads at a person's pace so views and completion look as they would for a person (see [student pace](../concepts/student-pace.md)). The driver doesn't watch, play or transcribe media: it gives a video's URL, and saves files with [downloadFile](files.md).

The signatures below are the functions'; each is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

## activityContent

```ts
function activityContent(
  context: BrowserContext,
  siteUrl: string,
  cmid: number,
  type: ContentType,
  options?: { trail?: Trail; onProgress?: (secondsRead: number) => void },
): Promise<ActivityContent>;

type ContentType = "page" | "book" | "label" | "url" | "resource" | "folder"; // CONTENT_TYPES
type Trail = "realistic" | "fast"; // TRAILS
```

`cmid` is the activity's course module id and `type` its module, both from the [course structure](courses.md) (`activity.id` and `activity.type`). Options:

- `trail`: `"realistic"` (the default) or `"fast"`.
- `onProgress`: called every few seconds while the realistic trail pauses to read, with the seconds read so far in the whole call; useful to keep a caller waiting or show progress.

What it returns depends on the type:

- `activity`: `{ id, type }`, as given.
- `text`: for a page or a label, the content as plain text, with paragraphs, line breaks and list items (as `- ` lines) kept, and scripts and styles left out.
- `chapters`: for a book, `{ title, text }[]` in order, the title taken off the start of the text.
- `media`: for a page, label or book, the videos, audio and players in the content (see below).
- `url`: for a URL resource, its target.
- `files`: for a file resource or a folder, `{ name, url }[]`; each `url` is a `pluginfile.php` link to pass to `downloadFile`.
- `trail`: the trail used.
- `readingSeconds`: with the realistic trail, the time spent reading (absent when nothing was paused).

### What each type does

- Page: opens `mod/page/view.php` and reads its content box.
- Label: opens `mod/label/view.php` and reads the label as the course page shows it.
- Book, realistic trail: opens the book and follows its "next" link chapter by chapter, pausing on each, as a reader does (at most 200 chapters, so a broken link can't loop).
- Book, fast trail: reads every chapter at once from the book's print page (`mod/book/tool/print/index.php`), without pausing; the same video in several chapters is listed once.
- URL: opens the resource with `forceview=1`, which logs the view and shows the link instead of leaving the site, and reads the link.
- File resource: opens it with `forceview=1` and reads the file's link rather than downloading it.
- Folder: reads the links to its files from the folder's tree.

### Pace

With the realistic trail, each page, label or chapter waits as long as a person would take to read it: about 240 words a minute (4 words a second), at least 3 and at most 90 seconds per page. `readingSeconds(text)` gives that time for a text and `pause(seconds, onProgress)` waits it; both are exported. URL resources, files and folders aren't paused. With the fast trail nothing waits, which may leave the activity incomplete where completion depends on viewing it for a while or on every chapter.

### Media

Each `MediaItem` is `{ kind, url, title? }`, with `kind` one of `"video"`, `"audio"`, `"youtube"`, `"vimeo"` or `"embed"`. It's found in `<video>` and `<audio>` elements and their sources, players in iframes (an iframe that isn't YouTube or Vimeo is an `"embed"`), video.js sources in `data-setup` (Moodle's media filter turns a YouTube link into one), and plain links to media files (by extension: `.mp4`, `.webm`, `.mp3`, `.ogg`…). YouTube URLs come back as `https://www.youtube.com/watch?v=<id>` links whatever form the page used (embed, short link, Shorts). Each URL appears once; `blob:` and `data:` URLs are left out. `readMedia(page, selector)` is exported for a program reading media from a page of its own.

### Errors

- `NotViewableError` when the page doesn't show what the type should: the activity is of another type, or the person can't view it. The message points to the course structure for the right id and module.
- `NotLoggedInError` without a session.

## Example

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const { sections } = await moodle.courseStructure(3);
const book = sections.flatMap((s) => s.activities).find((a) => a.type === "book" && a.availableToMe);

if (book) {
  const content = await moodle.activityContent(book.id, "book", {
    trail: "realistic",
    onProgress: (seconds) => console.log(`Reading... ${seconds} s`),
  });
  for (const chapter of content.chapters ?? []) console.log(`# ${chapter.title}\n${chapter.text}\n`);
  for (const item of content.media ?? []) console.log(`${item.kind}: ${item.url}`);
  console.log(`Read in ${content.readingSeconds ?? 0} seconds`);
}

// A folder's files, fetched without pauses and saved with the session.
const folder = await moodle.activityContent(57, "folder", { trail: "fast" });
for (const file of folder.files ?? []) {
  const saved = await moodle.downloadFile(file.url, "/home/ada/course-3");
  console.log(`${saved.name}: ${saved.size} bytes`);
}
```

## Data categories

`activityContent` is `course-content`. `readTexts`, `readMedia`, `readingSeconds` and `pause` are `none`: they only parse a page or wait. For reading any activity's module, `moduleCategories(module)` returns `course-content` for pages, books, labels, URLs, files and folders. See [data categories](../concepts/data-categories.md).
