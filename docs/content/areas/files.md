# Files

Files in both directions: saving a site's files (a resource, a folder's files, a submission, a post's attachment) to a local folder with the person's session, and uploading local files in the forms that take them (a file resource or folder, a submission, a forum post, a question import). Anyone can download what their session can reach; uploading depends on the form, so on who can use it (a teacher creating a resource, a student submitting). The driver never opens or interprets the files: a program gets their paths.

**Terms:** [session](../reference/glossary.md#session), [site](../reference/glossary.md#site).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them; the lower-level primitives are in `@falkenslab/moodle-driver/internals` (see [Going lower level](../concepts/low-level.md)).

## downloadFile

Saves a file of the site into a local folder with the person's session.

```ts
function downloadFile(context: BrowserContext, siteUrl: string, url: string, destDir: string): Promise<DownloadedFile>;

interface DownloadedFile {
  path: string;
  name: string;
  size: number;
  contentType?: string;
}
```

- `url`: an absolute URL of the site, usually a `pluginfile.php` link from another function ([activityContent](content.md)'s `files`, a submission's `files` in [grading](grading.md), `submittedFiles` and `descriptionFiles` in [assignments](assignments.md), a post's attachments in [forums](forums.md)). Media the site serves outside Moodle's path is fine, as long as it's on the same origin.
- `destDir`: an absolute folder, created when it doesn't exist. As a method, `moodle.downloadFile(url, destDir?)` uses the object's `downloadDir` when not given one, and throws without either.

It fetches the file through the browser context's request API, which carries the session's cookies without opening a tab, following up to 5 redirects. The file's name comes from the response's `Content-Disposition` (UTF-8 names included), else from the URL's last segment, reduced to a plain name: never a path, and without characters a file name can't have. It never overwrites: when the name is taken it saves `name (2).ext`, `name (3).ext`… The result has the saved file's `path`, its `name` (as saved), its `size` in bytes and the response's `contentType` (`"application/pdf"`), without parameters.

Errors:

- A `MoodleError` (`outside-site`) when the URL isn't of the site's origin: the session's cookies go nowhere else, so links to other sites (a YouTube video, an external URL resource) can't be downloaded with it.
- A `MoodleError` (`invalid-input`) when `destDir` isn't absolute.
- `NotLoggedInError` when Moodle answers with its login page: the session expired, or the file needs a session the person doesn't have.
- A `MoodleError` (`not-found`) with the HTTP status when Moodle answers with an error (`Moodle answered 404 for ...`): the file doesn't exist, or the person can't see it.

`fileNameFor(url, disposition)` is the naming rule on its own, exported for a program that fetches files itself.

## checkLocalFiles

Checks that local files to upload are given as absolute paths and exist.

```ts
function checkLocalFiles(files: string[]): Promise<void>;
```

It throws a `MoodleError` for the first path that isn't absolute (`invalid-input`: `Give files as absolute paths: "brief.txt".`) or doesn't exist (`not-found`: `There's no file at /home/ada/brief.txt.`). Every function that uploads calls it first, before opening any page, so a wrong path never leaves a half-filled form. A program can call it earlier, to tell the person before starting.

## Uploading in forms

Functions that take local files take them as absolute paths and upload them as the file picker's "Upload a file" does: to the form's draft area through Moodle's upload repository (`repository/repository_ajax.php`), then save the form, which moves them to their place. Nothing else is needed: no web services and no tokens.

| Function | Option | Where the files go |
| --- | --- | --- |
| `createActivity` | `files` | A file resource's or folder's files, or a SCORM's package ([activities](activities.md), [SCORM](scorm.md)). |
| `saveSubmission` | `files` | The person's submission, added to the files already there ([assignments](assignments.md)). |
| `replyToPost`, `startDiscussion` | `files` | The post's attachments ([forums](forums.md)). |
| `importQuestions` | `file` | The GIFT or Moodle XML file to import ([question banks](question-banks.md)). |

What can go wrong, besides `checkLocalFiles`' errors:

- The form has no file area: a `MoodleError` with code `not-available` from `createActivity` (`A url takes no files in its form.`) or the forum functions (`This forum takes no attachments.`), a `SubmissionError` from `saveSubmission` (`Assignment 45 doesn't take file submissions.`).
- The upload fails: a `FormError` whose `fields` hold one `{ field: "files", message }` per file with Moodle's answer, such as a file over the size limit or of a type the activity doesn't accept, or `the site has no upload repository enabled` when the site turned the upload repository off.
- Moodle refuses the form when it's saved: a `FormError` with Moodle's messages by field.

`updateActivity` doesn't change an activity's files: the ones there stay. The low-level `uploadToDraft(page, draftItemId, filePaths)` uploads to any form opened with `openForm`, and `removeFromDraft(page, draftItemId, names)` removes files from it by name (see [low-level access](../concepts/low-level.md)).

## Example

```ts
import { checkLocalFiles } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

// Upload the unit's notes as a folder, hidden until the teacher checks it.
const files = ["/home/ada/unit-4/recursion.pdf", "/home/ada/unit-4/exercises.pdf"];
await checkLocalFiles(files);
const created = await moodle.createActivity({ courseId: 3, sectionId: 21, type: "folder", name: "Unit 4 notes", files });
console.log(created.changed);

// Save the files attached to an assignment's description.
const assignment = await moodle.studentAssignment(45);
for (const file of assignment.descriptionFiles) {
  const saved = await moodle.downloadFile(file.url, "/home/ada/downloads");
  console.log(`${saved.path} (${saved.size} bytes, ${saved.contentType ?? "unknown type"})`);
}
```

## Data categories

`downloadFile` is `course-content` and `others-personal`: the same function saves a course's files and a submission's or a post's, so a program that must not reach others' work checks where the URL came from. `checkLocalFiles` and `fileNameFor` are `none`; `uploadToDraft` and `removeFromDraft` are `any`. The uploading functions are classified by what they do: `createActivity` is `course-content`, `saveSubmission` is `own`, `replyToPost`, `startDiscussion` and `editPost` are `communication` (`editPost` also `others-write`, a moderator's edit), `importQuestions` is `course-content`. See [data categories](../concepts/data-categories.md).
