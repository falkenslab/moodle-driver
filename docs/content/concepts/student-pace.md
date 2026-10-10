# Working at a student's pace

When a program acts as a student, Moodle records what it does as the student's: page views in the logs, time on the course, completion that depends on viewing. A program that reads a whole book in a second, or answers a quiz the moment it opens, leaves logs no person would. The functions that act as a student take a `trail` option to choose (ADR-005).

## The two trails

```ts
type Trail = "realistic" | "fast";
```

- `"realistic"` (the default): through the real pages, one at a time, waiting what a person would need to read each one (about 240 words a minute, between 3 and 90 seconds a page). Moodle logs views and completion as for a person.
- `"fast"`: no waits, and the quickest path Moodle offers (a book's print view instead of chapter by chapter). For tests, sandboxes, and programs where nobody looks at the logs.

## Where it applies

| Function | Realistic | Fast |
| --- | --- | --- |
| `activityContent()` | A page or label read for as long as its text takes; a book chapter by chapter, following "next" | A page read at once; a book from its print view |
| `answerQuizQuestions()` | Each page of questions read before saving it | Saved at once |
| `answerLessonPage()` | The page read before answering | Answered at once |

## Progress

Waiting can take minutes. These functions take an `onProgress` callback, called every few seconds while they wait, so a program can tell the person, or keep a connection alive (a protocol that times out without activity).

```ts
import { activityContent } from "@falkenslab/moodle-driver";

const book = await activityContent(context, site, 6, "book", {
  trail: "realistic",
  onProgress: (secondsRead) => process.stderr.write(`\rReading... ${secondsRead}s`),
});
console.log(`\n${book.chapters?.length} chapters, ${book.readingSeconds}s`);
```

`answerQuizQuestions` and `answerLessonPage` call `onProgress(elapsed, total)` with the seconds elapsed and the page's total.

## Building your own pace

`readingSeconds(text)` gives the seconds a person would take to read a text, and `pause(seconds, onProgress?)` waits that long reporting progress: the same pieces the driver uses, for a program's own steps.
