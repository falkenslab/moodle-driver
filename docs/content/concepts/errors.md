# Errors

Errors a program can act on have their own class, and their messages speak Moodle's terms: the module, the course structure, logging in again. They never name a program's own tools or settings, so a program can show them as they are or explain them in its own words.

They never carry the person's session either, so they can be logged as they are: when a request to Moodle times out, Playwright's message lists the request's headers, and the driver replaces the session cookie and the `sesskey` in it with `[redacted]`.

**Terms:** [error code](../reference/glossary.md#error-code).

## Catching them

Every error the driver throws on purpose is a `MoodleError`, or one of its subclasses, with a stable `code` and `name` set to its class name. Match by class, `name` or `code`, never by message: the wording may change in any release. `error.name` and `error.code` also work across bundles.

```ts
import { NotLoggedInError, MoodleServiceError, FormError } from "@falkenslab/moodle-driver";

try {
  await moodle.gradeSubmission(35, 7, { grade: "150" });
} catch (error) {
  if (error instanceof NotLoggedInError) {
    // The session ended: moodle.logIn() again (a window opens), then retry.
  } else if (error instanceof FormError) {
    for (const { field, message } of error.fields) console.error(`${field}: ${message}`);
  } else if (error instanceof MoodleServiceError) {
    console.error(error.methodname, error.errorcode, error.message);
  } else {
    throw error;
  }
}
```

Errors with no class of their own are `MoodleError` with a generic code:

| Code | When |
| --- | --- |
| `invalid-input` | An argument can't work: a relative path, an empty message, `content` for a module that has none, `downloadFile` with no folder |
| `not-found` | What was named isn't there: a section of the course, a local file, a site file (Moodle answered 404) |
| `not-available` | The activity doesn't have it: an assignment without feedback comments, a forum without attachments, a module without files |
| `outside-site` | A file to download isn't on the site |
| `unexpected-page` | A page doesn't have what the driver reads from it |
| `logout-failed` | Moodle didn't end the session |
| `chromium-install-failed` | Playwright's installer failed |
| `background-browser` | A background browser (`moodle open`) didn't start, doesn't answer, or closed while in use |
| `browser-busy` | Another command is working on the background browser of the profile: try again when it ends |

```ts
import { MoodleError } from "@falkenslab/moodle-driver";

try {
  await moodle.downloadFile("https://campus.example.org/pluginfile.php/1/x.pdf", "/home/ada/files");
} catch (error) {
  if (error instanceof MoodleError && error.code === "not-found") console.error("Gone, or not visible to you.");
  else throw error;
}
```

Each class's code is its name in kebab case without `Error` (`NotLoggedInError` is `not-logged-in`, `SurveyError` is `survey`); the type `MoodleErrorCode` lists them all.

## The session and the browser

| Error | When |
| --- | --- |
| `NotLoggedInError` | There's no Moodle session, or it expired. Any function that reads the site throws it. Log in again with `logIn()`. |
| `LoginTimeoutError` | `logIn()` waited `timeoutMs` and nobody logged in; the window was closed. |
| `LoginWindowClosedError` | The person closed the login window before logging in. |
| `NoDisplayError` | A window was needed (logging in, `setVisible(true)`) where there's no screen. |
| `BrowserNotFoundError` | No installed browser could be launched, and downloading Chromium isn't allowed. |
| `BrowserDownloadingError` | Chromium is downloading in the background: try again in a minute or two. |
| `MoodleUrlError` | A site URL isn't a URL, isn't http(s), or isn't a Moodle site. |

## Generic Moodle errors

| Error | When | What it carries |
| --- | --- | --- |
| `MoodleServiceError` | A Moodle AJAX service answered with an exception the driver doesn't translate | `methodname`, `errorcode` (Moodle's, e.g. `nopermissions`, `invalidrecord`), Moodle's message |
| `FormError` | Moodle refused a form (its validation messages by field), a field to set isn't in the form, or it's disabled until another field enables it | `fields: { field, message }[]` |

A `FormError` for a disabled field happens where Moodle wouldn't save it: for example an assignment's maximum grade once grades exist, until `grade[modgrade_rescalegrades]` is chosen. Set the enabling field first, in the same call.

## Area errors

Each area has its own class for what's specific to it: the id isn't that kind of activity, the person can't do that now, Moodle refused the action. Their messages say what to do.

| Error | Area |
| --- | --- |
| `NotViewableError` | [Content](../areas/content.md): the activity isn't of the type asked, or can't be viewed |
| `BookError` | [Content](../areas/content.md#a-books-chapters): not a book the person can read or edit, or the chapter isn't in it |
| `ActivitySettingsError` | [Activities](../areas/activities.md): no settings form to read |
| `CourseError` | [Courses](../areas/courses.md): the course's settings can't be changed, or it can't be reset |
| `BackupError` | [Copy, backup and restore](../areas/copy-backup-restore.md): Moodle refused, or didn't finish in time |
| `SubmissionError` | [Assignments](../areas/assignments.md): nothing to submit, can't edit the submission… |
| `NotAnAssignmentError`, `GradingError` | [Grading](../areas/grading.md): not an assignment the person can grade; Moodle didn't save the grade |
| `WorkshopError` | [Grading](../areas/grading.md#workshopinfo): not a workshop; Moodle refused to switch its phase or offers no assessment; the person can't allocate (`mod/workshop:allocate`) or the reviewer isn't one Moodle offers; Moodle doesn't take a submission now, or the person lacks `mod/workshop:submit`, `mod/workshop:manageexamples` or `mod/workshop:overridegrades`; grades calculated or overridden outside the evaluation phase |
| `QuizError` | [Quizzes](../areas/quizzes.md): attempts, reviews, results, overrides, structure |
| `QuestionBankError` | [Question banks](../areas/question-banks.md) |
| `NotAForumError`, `ForumError` | [Forums](../areas/forums.md) |
| `SurveyError`, `ChoiceError` | [Surveys and choices](../areas/surveys-and-choices.md) |
| `LessonError` | [Lessons](../areas/lessons.md) |
| `NotAnH5PActivityError` | [H5P](../areas/h5p.md) |
| `ScormError` | [SCORM](../areas/scorm.md) |
| `NotADatabaseError`, `DatabaseError` | [Databases](../areas/databases.md): not a database; the person can't manage it, or Moodle refused a field, template or preset, or an entry, its approval, its deletion, an export or an import |
| `NotAGlossaryError`, `GlossaryError` | [Glossaries](../areas/glossaries.md): not a glossary; a missing glossary capability (named), someone else's entry, the editing time over, no such entry |
| `NoGradeReportError`, `GradebookError` | [Grades and gradebook](../areas/grades-and-gradebook.md) |
| `CompletionError` | [Completion](../areas/completion.md) |
| `BadgeError`, `BadgesDisabledError` | [Badges](../areas/badges.md): a missing badge capability (named), a criterion Moodle doesn't offer; a site with badges off |
| `NoParticipantsError`, `EnrolmentError` | [Participants](../areas/participants.md): can't see the participants; Moodle refused to enrol, unenrol or give a role |
| `ReportError` | [Logs and reports](../areas/logs-and-reports.md): the person can't see the report, or the activity isn't the course's |
| `CalendarError` | [Calendar](../areas/calendar.md) |
| `MessageError` | [Messages](../areas/messages.md) |

## Moodle's own messages

When Moodle refuses with an error page (no permission, no such record), the driver includes Moodle's message, in the site's language, after its own explanation: "You can't see course 3's grader report: Sorry, but you do not currently have permissions to do that (View grader report)". `moodleErrorMessage(page)` reads that message from a page of your own.
