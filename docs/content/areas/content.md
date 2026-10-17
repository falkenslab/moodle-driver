# Content

Reading the activities teachers fill with content: a page's or label's text, a book's chapters, a URL resource's target, and the files of a file resource or a folder. It's the student's side (a teacher can read them too): `activityContent` views the activity as a person would, so Moodle logs the view, and with the realistic trail it reads at a person's pace so views and completion look as they would for a person (see [student pace](../concepts/student-pace.md)). The driver doesn't watch, play or transcribe media: it gives a video's URL, and saves files with [downloadFile](files.md). A book's chapters are also listed and written here, the teacher's side (see [A book's chapters](#a-books-chapters)).

**Terms:** [activity](../reference/glossary.md#activity), [module](../reference/glossary.md#module), [course module id](../reference/glossary.md#course-module-id), [trail](../reference/glossary.md#trail).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## activityContent

```ts
function activityContent(context: BrowserContext, siteUrl: string, activity: { id: number; type: string }, options?: ContentOptions): Promise<ActivityContent>;
function activityContent(context: BrowserContext, siteUrl: string, activityId: number, type: ContentType, options?: ContentOptions): Promise<ActivityContent>;

interface ContentOptions {
  trail?: Trail;
  onProgress?: (secondsRead: number) => void;
}

type ContentType = "page" | "book" | "label" | "url" | "resource" | "folder"; // CONTENT_TYPES
type Trail = "realistic" | "fast"; // TRAILS
```

Give it an activity as the [course structure](courses.md) lists it (`{ id, type }` are what it reads), or its id (course module id) and its module. An activity of a module it doesn't read (a quiz, a forum) throws `NotViewableError` before anything is opened. Options:

- `trail`: `"realistic"` (the default) or `"fast"`.
- `onProgress`: called every few seconds while the realistic trail pauses to read, with the seconds read so far in the whole call; useful to keep a caller waiting or show progress.

What it returns depends on the type:

- `activity`: `{ id, type }`, as given.
- `text`: for a page or a label, the content as plain text, with paragraphs, line breaks and list items (as `- ` lines) kept, and scripts and styles left out.
- `chapters`: for a book, `{ title, text }[]` in order, the title taken off the start of the text.
- `media`: for a page, label or book, the videos, audio and players in the content (see below).
- `images`: for a page, label or book with images in its content, each `{ url, alt? }` once; a `pluginfile.php` URL downloads with `downloadFile`.
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

## A book's chapters

`createActivity` makes a book empty and `activityContent` reads its text; these functions list a book's chapters with their ids and write them, as a teacher does in the book itself: its chapter form (`mod/book/edit.php`) and the move, show/hide and delete links of its table of contents. No service lists or writes chapters. Each write returns `{ changed, chapterId, chapters }`: a sentence of what it did, the chapter's id (the new one's, for `addBookChapter`) and the book's chapters afterwards.

```ts
function bookChapters(context: BrowserContext, siteUrl: string, activityId: number, options?: { content?: boolean }): Promise<BookChapter[]>;
function addBookChapter(context: BrowserContext, siteUrl: string, activityId: number, input: BookChapterInput): Promise<BookChapterChange>;
function editBookChapter(
  context: BrowserContext,
  siteUrl: string,
  activityId: number,
  chapterId: number,
  input: { title?: string; content?: string; subchapter?: boolean; embed?: string[] },
): Promise<BookChapterChange>;
function moveBookChapter(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number, options: { direction: "up" | "down" }): Promise<BookChapterChange>;
function setBookChapterVisible(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number, options: { visible: boolean }): Promise<BookChapterChange>;
function deleteBookChapter(context: BrowserContext, siteUrl: string, activityId: number, chapterId: number): Promise<BookChapterChange>;

interface BookChapter {
  id: number;
  title: string;
  subchapter: boolean; // a subchapter of the chapter before it
  hidden: boolean;
  position: number; // its place in the book, from 1, subchapters counted
  content?: string; // with content: the chapter's HTML
  images?: ImageItem[]; // with content: its images, when it has any
}

interface BookChapterInput {
  title: string;
  content: string; // HTML; Moodle requires some
  subchapter?: boolean;
  hidden?: boolean; // shown by default
  afterChapterId?: number; // at the end of the book without it
  embed?: string[]; // local files the content names: <img src="shot.png">
}
```

- `bookChapters` reads the table of contents. A teacher's comes from the chapter form's page, which shows no chapter, so it links every one, hidden ones too; anyone else's from the book's page, without the chapters they can't see. Titles come without the number Moodle puts before them in a numbered book ("1.1. "). With `content`, each chapter's page is opened (Moodle logs a view of it) and its HTML read as the book shows it, with its images' `pluginfile.php` URLs in `images`, to download with `downloadFile`.
- `addBookChapter` adds after `afterChapterId`, or at the end: right after a chapter means before its subchapters, which then belong to the new chapter, as the table of contents' add link does. `subchapter` makes it a subchapter of the chapter before it; `hidden` hides it once saved. `embed` puts local images and files in the content (see [Embedding files in rich text](files.md#embedding-files-in-rich-text)).
- `editBookChapter` changes only what's given; `embed` as in `addBookChapter`. The book's first chapter can't be a subchapter: Moodle freezes the field there.
- `moveBookChapter` moves one place, as the table of contents' arrows: a chapter moves with its subchapters past the whole chapter before or after it, a subchapter alone past one. At the start or the end nothing moves, and `changed` says so.
- `setBookChapterVisible` shows or hides it, only when it isn't so already; a chapter's subchapters are shown or hidden with it, and a subchapter of a hidden chapter stays hidden.
- `deleteBookChapter` deletes it with its files; deleting a chapter deletes its subchapters too.

Errors:

- `BookError` when the activity isn't a book the person can read (the message has Moodle's), when a write comes from someone who can't edit its chapters (a student), when a chapter isn't in the book (the message lists the ones it has), and when the first chapter would be a subchapter.
- A `MoodleError` (`invalid-input`) when a file to embed and the content don't match, before anything is sent.
- `FormError` when Moodle refuses the chapter form (a title or content missing); `NotLoggedInError` without a session.

```ts fragment
const { chapterId } = await moodle.addBookChapter(812, { title: "Loops", content: '<p>How a loop runs:</p><p><img src="loop.png" alt="A loop"></p>', embed: ["/home/ada/loop.png"] });
await moodle.addBookChapter(812, { title: "While loops", content: "<p>Until a condition fails.</p>", subchapter: true, afterChapterId: chapterId });
await moodle.setBookChapterVisible(812, chapterId, { visible: false });
for (const chapter of await moodle.bookChapters(812)) console.log(`${chapter.position}. ${chapter.subchapter ? "  " : ""}${chapter.title}${chapter.hidden ? " (hidden)" : ""}`);
```

## Example

```ts

// `moodle` is the object from createMoodle(), as in the getting-started pages.

const sections = await moodle.courseStructure(3);
const book = sections.flatMap((s) => s.activities).find((a) => a.type === "book" && a.availableToMe);

if (book) {
  const content = await moodle.activityContent(book, {
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

`activityContent` is `course-content`, and so are `bookChapters`, `addBookChapter`, `editBookChapter`, `moveBookChapter`, `setBookChapterVisible` and `deleteBookChapter`. `readTexts`, `readMedia`, `readImages`, `readingSeconds` and `pause` are `none`: they only parse a page or wait. For reading any activity's module, `moduleCategories(module)` returns `course-content` for pages, books, labels, URLs, files and folders. See [data categories](../concepts/data-categories.md).
