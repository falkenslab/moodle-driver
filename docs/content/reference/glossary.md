# Glossary

The guides and the API use Moodle's terms as Moodle's code names them, which can differ from what its interface shows a person (the code's "assign" is the interface's "Assignment", a quiz's "slot" has no name on screen at all). The second part explains the driver's own terms: how it keeps the browser, the session and the person's pace.

## Moodle terms

### Activity

Anything a teacher adds to a course section: an assignment, a quiz, a forum, but also a page, a file or a label (Moodle's interface separates "activities" from "resources"; its code, and the driver, calls them all activities). Each one is an instance of a [module](#module) placed in the course as a course module, identified by its [course module id](#course-module-id). The driver lists them with `courseStructure` (each section's `activities`, as `CourseActivity` with `id`, `name` and `type`) and builds them with `createActivity`, `updateActivity`, `editActivity`, `duplicateActivity` and `deleteActivity`; see [Courses](../areas/courses.md) and [Activities and sections](../areas/activities.md).

### AJAX service

A function of Moodle's web services that its own pages call from JavaScript through `lib/ajax/service.php`, with the page's [sesskey](#sesskey), answering JSON; only those declared for AJAX (`'ajax' => true`) work from a browser, others answer `servicenotavailable`. The driver calls them over HTTP with the person's session and its sesskey, without a tab, wherever one does the job, and gives a program the same door with `callService` (also `moodle.callService`); a failure comes as `MoodleServiceError` with Moodle's `errorcode`. See [How it works](../concepts/how-it-works.md) and [Going lower level](../concepts/low-level.md).
`moodle.callService("core_group_get_course_groups", { courseid: 3 })`

### Assignment

The activity where students hand in work for a teacher to grade: module `assign` in Moodle's code and URLs (`mod/assign/view.php`), "Assignment" in the interface. The student's side is `studentAssignment`, `saveSubmission` and `submitForGrading` ([Assignments](../areas/assignments.md)); the teacher's is `assignmentSubmissions`, `gradeSubmission`, `rubric`, `grantExtension`, `setWorkflowState` and `allocateMarker` ([Grading](../areas/grading.md)); `listAssignments` lists a course's ([Courses](../areas/courses.md)). An id that isn't an assignment throws `SubmissionError` or `NotAnAssignmentError`.

### Attempt

One go at a quiz, from starting it to submitting it, with its answers, marks and grade; Moodle numbers attempts per person and identifies each by an attempt id (`mod/quiz/attempt.php?attempt=9`). The driver starts or continues one with `startQuizAttempt` (which returns `attemptId`), reads and answers it with `readAttempt` and `answerQuizQuestions`, finishes it with `finishQuizAttempt`, and lists everyone's with `quizResults` (`QuizAttemptResult`, with `id` and `userId`); `quizInfo` gives the person's own as `attempts`. H5P activities have attempts too (`h5pActivity`, `H5PAttempt`). See [Quizzes](../areas/quizzes.md) and [H5P](../areas/h5p.md).

### Backup

A course, or part of one (its content, and its people's data when asked), saved as a `.mbz` file (a gzipped archive of XML files and the content's files), which Moodle can restore into a new course or an existing one; a course copy and an import are a backup restored at once, without a file. Moodle makes them through wizards, and may make backups, restores and copies later, in its scheduled tasks (cron). The driver makes them with `backupCourse`, `restoreCourse`, `copyCourse` and `importActivities`, waiting for Moodle up to a timeout. An anonymous backup (`anonymizeBackup`, by default for part of a course) names no one and no site: no user ids or authors, a neutral original site and course. See [Copy, backup and restore](../areas/copy-backup-restore.md).

### Badge

A course's (or the site's) award a person earns, shown with its image on their profile: Moodle issues it when its criteria are met (completing activities or the course, a teacher awarding it by hand…), once it's enabled. While enabled its criteria can't change, and once someone has it Moodle locks it. The driver works course badges: `courseBadges` reads them (`CourseBadge`), `createBadge` makes one, `setBadgeCriteria` sets what earns it, `setBadgeEnabled` enables or disables it and `awardBadge` awards it by hand. See [Badges](../areas/badges.md).

### Calendar event

An entry in Moodle's calendar: a course, group, user or site event, or one an activity creates for its dates (an assignment's due date, a quiz's close). The driver reads them as `CalendarEvent` (`id`, `type`, `start`, `courseId`, and for an activity's event `activity: { type, instance }`, with the [instance id](#instance-id)) with `upcomingEvents` (one with `calendarEvent`), creates course events with `createEvent`, changes one with `updateEvent` and removes one with `deleteEvent`; `deadlines` reads what the person has to do by a date from the same calendar. See [Calendar](../areas/calendar.md) and [Overview and deadlines](../areas/overview-and-deadlines.md).

### Choice

The activity where participants pick one or several options a teacher offers (module `choice`, "Choice" in the interface), often for a quick poll or sign-up with limited places. The driver reads it with `getChoice` (`Choice`, with `options[].id`, `selected`, `full`, `multiple`, `canAnswer`, `canChange`) and answers with `answerChoice`, which takes option ids; its errors are `ChoiceError`. See [Surveys and choices](../areas/surveys-and-choices.md).

### Completion

Moodle's activity completion: whether each participant has done each activity, marked by hand (manual) or by Moodle when a condition is met (automatic), in one of four states the driver names `incomplete`, `complete`, `complete-pass` and `complete-fail` (`COMPLETION_STATES`, `CompletionState`). The person's own comes with `courseStructure` (each activity's `completion`), `setCompletion` marks it, `overrideCompletion` sets someone else's as a teacher, and `completionReport` reads the progress report ("Activity completion" in the interface), each cell with `state`, `tracking` and `overridden`. An activity's rules are its `completion` in `createActivity`, `updateActivity` and `activitySettings`. See [Completion](../areas/completion.md).

### Conversation

A thread of private messages in Moodle's messaging: between two people (`private`), a course group's (`group`), or the person's notes to themselves (`self`). The driver lists the person's with `conversations` (`ConversationSummary`, with `id`, `type`, `members` and `unread`), reads one with `conversation(conversationId)`, and sends a private message with `sendMessage`, which returns `messageId` and `conversationId`. See [Messages](../areas/messages.md).

### Course module id

The id of an activity in its course, the `id` in the activity's URL (`mod/quiz/view.php?id=27`), often written "cmid" in Moodle's code; the driver calls it the activity id. Every activity function takes it as a parameter named `activityId`, whatever the module, and results give it as `id` for the activity itself (`CourseActivity.id`) and `activityId` where they refer to one (`GradeRow.activityId`, `CompletionCell.activityId`); it is never the [instance id](#instance-id). See [the Moodle object and the functions](../concepts/calling-functions.md#ids).
`moodle.quizInfo(27)`

### Database

An activity, module `data`, where participants add entries with the fields a teacher defines (short text, dropdown list, date, image…), listed, shown and searched through its templates; a preset gives it fields and templates at once. The driver reads and writes its fields with `databaseFields`, `addDatabaseField`, `editDatabaseField` and `deleteDatabaseField`, its templates with `databaseTemplates` and `setDatabaseTemplate`, and gives it one of the site's presets with `databasePresets` and `applyDatabasePreset`; its entries are read with `databaseEntries`, written with `addDatabaseEntry`, `editDatabaseEntry` and `deleteDatabaseEntry`, approved with `setDatabaseEntryApproved`, moved as CSV with `exportDatabaseEntries` and `importDatabaseEntries`, and rated with `rate`. See [Databases](../areas/databases.md).

### Extension

More time for one participant to submit an assignment, past its due date and cut-off: "Grant extension" in the grading table. The driver grants it to one or several participants with `grantExtension(activityId, userIds, until)`, and `assignmentSubmissions` reports it per participant as `extensionGranted` and `extensionDueDate`. For a quiz, the equivalent is an [override](#override). See [Grading](../areas/grading.md).

### Feedback

See [survey](#survey): Moodle's `feedback` module is a survey activity, not the feedback comments a teacher writes when grading (those are `gradeSubmission`'s `feedback` input, see [grading method](#grading-method)). Files a teacher attaches to that feedback (a corrected PDF, an audio comment) are an assignment's feedback files: `gradeSubmission`'s `feedbackFiles`, read by the student in `studentAssignment` and by the teacher in `assignmentSubmissions` ([Grading](../areas/grading.md)).

### Grade category

A group of grade items in the gradebook that combines its children's grades into a total, with an aggregation method (natural, mean, highest…); the course itself is the top category. The driver reads them with `gradebookSetup` (`GradebookCategory`, with `id`, `itemId` for its total's grade item, `parentId`, `aggregation`, `weight`), creates one with `addGradeCategory` (`aggregation` one of `GRADE_AGGREGATIONS`), changes or deletes one with `updateGradeCategory` and `deleteGradeCategory`, and moves items into one with `updateGradeItem`; `myGrades` rows of `kind` `"category"` and `"categoryTotal"` show them. See [Grades and gradebook](../areas/grades-and-gradebook.md).

### Grade item

One column of the gradebook: an activity's grade, a manual item, or a category's or the course's total. The driver reads them with `gradebookSetup` (`GradebookItem`, with `id`, `categoryId`, `maxGrade`, `weight`, `weightOverridden`), changes one with `updateGradeItem(courseId, itemId, changes)`, adds and deletes manual ones with `addGradeItem` and `deleteGradeItem`, grades a person in one with `setGrade` (an activity's grade is overridden), and `graderReport` gives one `GradeColumn` per item and each grade as `{ itemId, grade }`. See [Grades and gradebook](../areas/grades-and-gradebook.md).

### Gradebook

A course's grades and how they're built: its [grade items](#grade-item) and [grade categories](#grade-category), shown as reports ("Grades" in the interface: the user report a participant sees, the grader report a teacher sees, and "Gradebook setup"). The driver reads the user report with `myGrades` (`GradeRow`), everyone's with `graderReport`, the setup with `gradebookSetup`, grades in it with `setGrade`, and changes it with `addGradeItem`, `updateGradeItem`, `deleteGradeItem`, `addGradeCategory`, `updateGradeCategory` and `deleteGradeCategory`; the errors are `NoGradeReportError` and `GradebookError`. See [Grades and gradebook](../areas/grades-and-gradebook.md).

### Grading method

How an assignment is graded: simple direct grading (a number or a [scale](#scale)), or one of the advanced methods, a rubric (criteria, each with levels worth a score) or a marking guide (criteria, each scored up to a maximum, with remarks). Moodle's code calls the marking guide `guide`. The driver reads the method and its criteria with `rubric`, whose `method` is `"simple"`, `"rubric"` or `"guide"` and whose `criteria` are `GradingCriterion` (`id`, `levels`, `maxScore`); `gradeSubmission` takes `grade`, `rubric` (criterion id to level id) or `guide` (criterion id to score), with `remarks` and `feedback`. See [Grading](../areas/grading.md).
`moodle.gradeSubmission(45, 7, { guide: { 12: 8 }, remarks: { 12: "Clear." } })`

### Group

A set of participants within a course, used to separate or filter them (a group's own forum discussions, a grader report per group). The driver lists them with `groups` (`CourseGroup`, with `id`, `name`, `members`), gives each participant's `groups` with `participants`, and takes a group id as the `group` option of `participants`, `graderReport` and `completionReport`. See [Participants](../areas/participants.md). An assignment with group submissions takes one submission per group: `assignmentSubmissions` gives each participant's `group`, `gradeSubmission`'s `applyToGroup` grades the whole group, and `studentAssignment` gives the student's `group` ([Grading](../areas/grading.md)).

### H5P

Interactive content (quizzes, presentations, interactive videos…) built from H5P libraries; in a course it's an H5P activity, module `h5pactivity`, which can track attempts and scores. The driver reads it with `h5pActivity` (`H5PActivity`, with `contentType`, `tracked` and the person's `attempts`); playing the content is left to the program, in the [working tab](#working-tab). See [H5P](../areas/h5p.md).

### Instance id

The id of an activity in its module's own table (the quiz's id among quizzes, the forum's among forums), which some of Moodle's services and pages want; the [course module id](#course-module-id) is a different number. The driver never asks for it: it takes the course module id and finds the instance itself. It shows in a few results, named for what it is: a calendar event's `activity.instance` and a forum discussion's `forumInstanceId`. See [Calendar](../areas/calendar.md) and [Forums](../areas/forums.md).

### Lesson page

One page of a lesson activity (module `lesson`): a content page with buttons that jump elsewhere, or a question page with a form, after which Moodle may show feedback; Moodle keeps which page the person is on. The driver reads the current one with `lessonPage` (`LessonPage`, with `kind` `"content"`, `"question"`, `"feedback"` or `"end"`, `pageId`, `buttons[].jumpTo`, `fields`) and answers it with `answerLessonPage`, which returns the `page` that follows. Its teacher builds the pages with `addLessonPage`, `editLessonPage`, `moveLessonPage` and `deleteLessonPage`, and reads them with `lessonPages` (`LessonPageDefinition`: a `type` of `LESSON_PAGE_TYPES`, its `buttons` or `answers`, each with a `jumpTo`: a page id or one of Moodle's jumps by name, `LESSON_JUMPS`). See [Lessons](../areas/lessons.md).

### Log

Moodle's record of every event in a course: who did what, when, where, and about whom ("Course module viewed", "Submission graded"), kept by its log store and read by teachers in the logs, activity and participation reports. The driver reads them with `courseLogs` (`LogEntry`, with `time`, `userId`, `relatedUserId`, `activityId`, `event`, `description`), the views per activity with `activityReport`, and who took part in an activity with `participationReport`. Acting at a person's pace (the [trail](#trail)) keeps the log looking like a person's. See [Logs and reports](../areas/logs-and-reports.md).

### Marking workflow

An assignment setting ("Use marking workflow") under which a grade goes through states before students see it: not marked, in marking, marking completed, in review, ready for release, released; markers can be allocated to submissions ("Use marking allocation"). The driver names the states as Moodle's code does (`WorkflowState`: `"notmarked"`, `"inmarking"`, `"readyforreview"`, `"inreview"`, `"readyforrelease"`, `"released"`), gives each submission's `workflowState` and `markers` in `assignmentSubmissions`, sets one with `gradeSubmission`'s `workflowState`, several with `setWorkflowState` (which releases), and allocates markers with `allocateMarker`. See [Grading](../areas/grading.md).

### Module

The kind of an activity, by its plugin's name in Moodle's code and URLs: `assign` (Assignment), `quiz`, `forum`, `page`, `resource` (File), `url`, `h5pactivity`, `qbank` (a shared question bank)… The driver gives it as the activity's `type` (`CourseActivity.type`, `activityType` in grade rows, `activity.type` in calendar events) and takes it as `createActivity`'s `type`; `courseActivityTypes` lists those the person can add, and `moduleCategories` tells what reading one touches. See [Courses](../areas/courses.md) and [Activities and sections](../areas/activities.md).

### Notification

A message Moodle sends the person on its own (a new forum post, a graded submission, a due date), shown under the bell in the interface, apart from [conversations](#conversation). The driver reads them with `notifications` (`Notification`, with `id`, `subject`, `text`, `fromUserId`, `read`, `url`, `component`, `eventType`), optionally `unreadOnly`, and marks them all read with `markNotificationsRead`. See [Messages](../areas/messages.md).

### Override

A quiz's different settings for one person: other open and close dates, a time limit or a number of attempts ("User overrides" in the quiz's settings). The driver sets one with `setQuizOverride(activityId, userId, { open, close, timeLimitMinutes, attempts })`. Moodle's completion can be overridden too, a teacher's decision recorded as such: `overrideCompletion`, and `overridden` in the [completion](#completion) report. See [Quizzes](../areas/quizzes.md).

### Participant

Someone enrolled in a course, with one or more roles (student, teacher…) and possibly groups. The driver lists them with `participants` (`Participant`, with `userId`, `fullName`, `roles`, `groups`), filtered by role, group or inactivity, and `participantFilters` gives the course's roles and groups to filter by; listings of people across the driver give them by `userId` and `fullName`. See [Participants](../areas/participants.md).

### Question bank

Where a course keeps its questions for quizzes. Since Moodle 5 a shared bank is an activity of its own (module `qbank`), and each quiz has a private bank. The driver lists a course's with `questionBanks` (`QuestionBank`, whose `id` is the bank's course module id, with `type` and `shared`), reads one with `questions`, adds to it with `importQuestions` (GIFT or Moodle XML) and `createQuestion`, and changes it with `updateQuestion` (a new version), `setQuestionStatus` and `deleteQuestions` (a question in use is hidden instead); `addQuestionsToQuiz` puts its questions in a quiz. See [Question banks](../areas/question-banks.md).

### Question category

A folder of questions inside a [question bank](#question-bank); each bank has a "Top" category holding no questions, then a default one. The driver gives a bank's categories with `questions` (`BankCategory`, with `id` and `name`) and each question's `categoryId`; `importQuestions` and `createQuestion` take a `categoryId`, and `addQuestionsToQuiz` draws random questions from one with `random: { categoryId, count }`. See [Question banks](../areas/question-banks.md).

### Quiz

The activity of questions a participant answers in [attempts](#attempt), graded automatically where it can be (module `quiz`). The driver covers the student's side (`quizInfo`, `startQuizAttempt`, `readAttempt`, `answerQuizQuestions`, `finishQuizAttempt`, `readReview`) and the teacher's (`quizResults`, `questionsToGrade`, `gradeQuizQuestion`, `quizStructure`, `addQuestionsToQuiz`, `editQuizSlot`, `removeQuizSlot`, `setQuizPages`, `addQuizSection`, `setQuizOverride`); its errors are `QuizError`. See [Quizzes](../areas/quizzes.md).

### Rating

A participant's judgement of another's forum post, glossary entry or database record, on a scale or out of points, when the activity uses ratings; the activity aggregates them (average, count, maximum…) into a grade item of its own. Separately, a forum can be graded as a whole ("Whole forum grading"), one grade per person. The driver rates with `rate(item, rating)`, and reads and gives whole-forum grades with `forumGrades` and `gradeForumUser`. See [Grading](../areas/grading.md#rate).

### Review

The page of a finished [attempt](#attempt) that shows its summary and questions with their state, mark, feedback and right answer, as far as the quiz's review options allow ("Review" in the interface). The driver reads it with `readReview(attemptId)` (`summary` and `questions`, with the teacher's `comment` on a question graded by hand), and `finishQuizAttempt` returns it as `review` when the quiz shows it right away. See [Quizzes](../areas/quizzes.md).

### Role

What a person may do in a context, a course for most: student, teacher (Moodle's `editingteacher`), non-editing teacher, manager. Roles have ids that vary by site (5 is Student on a default one). The driver gives a participant's `roles` as `{ id, name }` in `participants`, a user's in a course with `courseRoles`, the person's with `whoAmI(courseId)` (`course.roles`), and the course's to filter by with `participantFilters`; `courseAbilities` answers what the person can do (`canEdit`, `canGrade`). See [Participants](../areas/participants.md) and [Users and the site](../areas/users-and-site.md).

### Scale

A list of words used as grades instead of numbers ("Not yet, Competent, Excellent"), set as an activity's grade type. In the driver, an assignment graded with a scale has `method: "simple"` in `rubric`, and `gradeSubmission`'s `grade` takes the scale item's value. See [Grading](../areas/grading.md).

### SCORM

A standard for e-learning packages: a `.zip` of HTML and JavaScript with an `imsmanifest.xml`, whose parts (SCOs) report to Moodle through the SCORM API (status, score) while the person does them in Moodle's player; in a course it's a SCORM activity, module `scorm`, with attempts and a grade. The driver reads it with `scorm` (`ScormActivity`, with the attempts, `grade` and `scos` with their `status`), opens the player in the [working tab](#working-tab) with `openScorm`, and creates one with `createActivity({ type: "scorm", files: [package] })`; it never reports results for the person. See [SCORM](../areas/scorm.md).

### Section

A part of a course page holding activities: a topic or a week depending on the course format, with section 0 being the general one at the top; a subsection is a section inside another. A section has an id (a database id) and a number (its position), and the driver always takes the id: `CourseSection` in `courseStructure` has `id`, `number`, `title`, `parentSectionId` and `activities`; `createActivity` takes `sectionId`, and `addSection`, `editSection` and `deleteSection` work them. See [Courses](../areas/courses.md) and [Activities and sections](../areas/activities.md).

### Sesskey

The token Moodle gives each session (`M.cfg.sesskey` in its pages) and expects with every action that changes something and every AJAX call, to tell the person's own requests from forged ones. A program never handles it: the driver reads it once from a logged-in page and sends it with every service call, and an `invalidsesskey` answer makes it read it again. See [How it works](../concepts/how-it-works.md).

### Slot

A question's place in a quiz, numbered from 1 in the quiz's order; the interface shows question numbers instead, which skip descriptions. In an attempt, answers are given by slot: `Question.slot` in `startQuizAttempt`, `readAttempt` and `readReview`, and `answerQuizQuestions` takes `{ slot, responses }[]`, with field names such as `q9:1_answer` (`q<usage>:<slot>_<name>`); `quizStructure` lists a quiz's slots as `QuizSlot` (`id`, `slot`, `page`, `questionId`, `type`, `mark`) and its sections (a heading before a group of pages, whose questions may be shuffled), `editQuizSlot` and `removeQuizSlot` take a slot, and `quizResults` gives each attempt's marks per slot. See [Quizzes](../areas/quizzes.md).
`moodle.answerQuizQuestions(9, [{ slot: 1, responses: { "q9:1_answer": "1" } }])`

### Submission

A participant's work for an assignment: online text, files or both, in one of Moodle's states, `new` (nothing yet), `draft` (saved, not submitted), `submitted` (for grading) or `reopened` (a teacher opened it for another try). The student saves it with `saveSubmission` and submits it with `submitForGrading`, and `studentAssignment` gives its `submissionState`; the teacher reads everyone's with `assignmentSubmissions` (`Submission`, with `userId`, `status`, which is `"none"` without one, `needsGrading` and `content`). Its errors are `SubmissionError`. See [Assignments](../areas/assignments.md) and [Grading](../areas/grading.md).

### Survey

An activity that asks participants questions without grading them. The driver answers two modules: Moodle's own `feedback` ("Feedback" in the interface) and the `questionnaire` plugin; Moodle's older `survey` module, with fixed instruments, isn't covered. It reads one with `getSurvey` (`SurveyQuestion`, with `page`, `required` and `fields`) and answers with `submitSurvey`, both taking the module as a `SurveyType`; its errors are `SurveyError`. See [Surveys and choices](../areas/surveys-and-choices.md).

### Workshop

A peer assessment activity, module `workshop`, that goes through five phases a teacher switches: setup, submission (participants submit their work), assessment (reviewers assess the submissions allocated to them through the workshop's assessment form, whose grading strategy is accumulative grading, comments, number of errors or a rubric), grading evaluation (Moodle calculates a grade for each submission and one for each reviewer's assessing) and closed. The driver reads the phase and the report of submissions and assessments with `workshopInfo`, switches phases with `setWorkshopPhase`, reads and sets who assesses whom (the allocation) with `workshopAllocation`, `allocateReviewer`, `removeReviewer`, `allocateRandomly` and `scheduleAllocation`, assesses a submission with `assessWorkshopSubmission`, reads and saves a participant's submission with `workshopSubmission` and `saveWorkshopSubmission`, prepares example submissions (which participants practise assessing against the teacher's reference assessment) with `workshopExamples`, `addWorkshopExample`, `editWorkshopExample`, `deleteWorkshopExample` and `assessWorkshopExample`, and calculates and overrides the grades with `calculateWorkshopGrades` and `overrideWorkshopGrade`; its errors are `WorkshopError`. See [Grading](../areas/grading.md#workshopinfo).

## Driver terms

### Background browser

A browser `moodle open` leaves open on a [profile](#profile), which every command on that profile (and `moodle shell`, and a program through `backgroundBrowser` and `connectBrowserManager`) works in instead of launching its own, one at a time, until `moodle close`. It's reached on 127.0.0.1 with a token from the profile's `.browser.json`. See [The command line](../getting-started/command-line.md#watching-separate-commands-act) and [The browser](../concepts/browser.md#a-browser-left-open-in-the-background).

### Changed

The short sentence every write returns as `changed`, saying what it did (`Created page 42 "Loops" in section 2.`), beside the state afterwards where it's cheap to read (the course's `sections`, the `assignment`, the `choice`) and the ids of what it created (`activityId`, `attemptId`, `messageId`). A program can show it as it is or check the state instead of reading again. See [the Moodle object and the functions](../concepts/calling-functions.md#writes-answer-with-the-state-afterwards).
`const { changed, activityId } = await moodle.createActivity(…)`

### Data category

The kind of data a function reads or writes, declared for every public function so a program can allow some kinds and refuse the rest: `none`, `own`, `course-content`, `others-aggregate`, `others-personal`, `others-write`, `communication` or `any` (`DataCategory`, `ALL_DATA_CATEGORIES`). `DATA_CATEGORIES` gives each function's, and `moduleCategories(module)` what reading an activity of a module touches. See [Data categories](../concepts/data-categories.md).
`DATA_CATEGORIES.gradeSubmission // ["others-personal", "others-write"]`

### Error code

The stable `code` every error the driver throws on purpose carries: `MoodleError` is the base class, each subclass has its own code (its name in kebab case without `Error`, `not-logged-in` for `NotLoggedInError`), and errors with no class of their own use a generic one (`invalid-input`, `not-found`, `not-available`…), all listed by the type `MoodleErrorCode`. Match errors by class, `name` or `code`, never by message. See [Errors](../concepts/errors.md).
`error instanceof MoodleError && error.code === "not-found"`

### Internals

The entry point `@falkenslab/moodle-driver/internals`, with the primitives the operations are built from: `callService`, `openSitePage`, `openForm`, `setFields`, `submitForm`, `inPage`, `courseState`, `editCourse` and others. They follow the same versioning as the main entry but are closer to Moodle, taking pages, form names and service names. See [Going lower level](../concepts/low-level.md).

### Profile

The browser's persistent user-data folder (`profileDir`), where it keeps the person's cookies and storage, so the session survives between runs; the driver also writes Moodle's session cookies there (`SESSION_COOKIES_FILE`). One per person and site, used by one browser at a time, and as sensitive as a password. The `moodle` command keeps one per site and account in `~/.moodle-driver/sites/<host>/`, and `siteProfileDir(site, { as })` gives the same folder to a program. See [Logging in](../getting-started/logging-in.md), [The browser](../concepts/browser.md) and [The command line](../getting-started/command-line.md#where-things-are).

### Session

The person's logged-in Moodle session, made when they log in by hand in the window `logIn` opens (`LoginResult`, with `status`, `userId`, `fullName`) and kept in the [profile](#profile); `logOut` ends it. Every function works with it, and one that finds none, or an expired one, throws `NotLoggedInError`: log in again and retry. See [Logging in](../getting-started/logging-in.md).

### Shown on demand

The browser runs headless and shows a window only when asked: `setVisible(true)` relaunches it with a window (the session kept), and from then on the pages functions open follow one another in its [working tab](#working-tab), so a person can watch or step in; `setVisible(false)` hides it, `visible()` tells, and `canShowWindow()` says whether there's a screen at all (`NoDisplayError` otherwise). See [The browser](../concepts/browser.md#showing-the-browser).

### Site

The Moodle installation the driver works on, given by its base URL (the `site` option of `createMoodle`, `siteUrl` in the functions), normalized to end in `/` by `parseSiteUrl`; `findMoodleSite` finds it from any of its pages, and `publicSiteInfo` reads what it tells anyone before logging in. An invalid one throws `MoodleUrlError`. See [Users and the site](../areas/users-and-site.md).

### Trail

How the functions that act as a student view and do things, chosen with the `trail` option (`Trail`, `TRAILS`): `"realistic"`, the default, goes through the real pages at a person's reading pace, so Moodle's logs and completion look as they would for a person; `"fast"` doesn't wait and takes the quickest path. `activityContent`, `answerQuizQuestions` and `answerLessonPage` take it, with an `onProgress` callback while they wait, and `createMoodle({ trail })` sets it for every call. See [Working at a student's pace](../concepts/student-pace.md).
`moodle.activityContent(6, "book", { trail: "fast" })`

### Working tab

The one tab of the browser a program can drive itself, a logged-in Playwright `Page` given by `moodle.tab()` (or `BrowserManager.tab()`), for what no function covers, such as playing H5P content. It's the same tab the browser follows pages in while [shown](#shown-on-demand), so the person sees what happens there; leave it open, the driver reuses it. See [The browser](../concepts/browser.md#the-working-tab).
