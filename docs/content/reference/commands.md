# Commands

Every method of the `Moodle` object as a command of `moodle`, generated from the driver's types: the same names (also in kebab-case), arguments and options. See [The command line](../getting-started/command-line.md) for installing it, logging in and the global options.

## activitiesOverview

Moodle 5's activities overview of a course for one type ("resource" for every resource type): per activity, the columns its overview page shows the person (due dates, submissions, what needs grading, their own grade…). Without a type, every type in the course's state: "resource" first, which brings pages, books, files, folders and links at once, then each type still missing.

```bash
moodle activities-overview <courseId> [type]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `type` (optional) | `string` |  |

## activityContent

Reads a page's or label's text, a book's chapters, a URL resource's target, or a file resource's or folder's files. With the realistic trail, page by page at a reader's pace, calling `onProgress` with the seconds read so far while it pauses. Takes an activity as the course structure gives it (`{ id, type }`), or its id and module.

```bash
moodle activity-content <activityId> <type> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `type` | `"url" \| "page" \| "book" \| "label" \| "resource" \| "folder"` |  |
| `--trail` | `"realistic" \| "fast"` |  |

## activitySettings

An activity's settings as its form holds them, without submitting it: its module, name and description, and every field by the name `updateActivity` takes in `settings`. Teachers only.

```bash
moodle activity-settings <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## addGradeCategory

Adds a grade category (at the course's top level, or inside `parentId`); returns it as the setup shows it.

```bash
moodle add-grade-category <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--name` (required) | `string` |  |
| `--aggregation` | `"mean" \| "median" \| "lowest" \| "highest" \| "mode" \| "weighted-mean" \| "simple-weighted-mean" \| "mean-with-extra-credits" \| "natural"` |  |
| `--parent-id` | `number` |  |

## addQuestionsToQuiz

Adds bank questions to a quiz by id, and random questions from a bank category, at the end or on a page, as the edit page's bank actions post them. Returns the quiz's structure afterwards. A quiz already attempted can't change its questions: Moodle refuses, and so does this.

```bash
moodle add-questions-to-quiz <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--question-ids` | `number[]` |  |
| `--random` | `{ categoryId: number; count: number; includeSubcategories?: boolean; }` |  |
| `--page` | `number` |  |

## addSection

Adds a section after another one (at the end without it), named when a name is given.

```bash
moodle add-section <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--name` | `string` |  |
| `--after-section-id` | `number` |  |

## answerChoice

Answers a choice with one option (several where it allows them) by id, as "Save my choice" does; returns the choice afterwards.

```bash
moodle answer-choice <activityId> <optionIds>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `optionIds` | `number[]` |  |

## answerLessonPage

Answers the page the person is on: a content page's button (its label or position), or a question's fields by name. Returns Moodle's feedback when it gives one, and the page that follows, going on past the feedback as its "Continue" does; reaching the end ends the attempt. With the realistic trail it first takes the time a reader needs for the page (ADR-005).

```bash
moodle answer-lesson-page <activityId> <answer> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `answer` | `{ button?: string \| number; responses?: Record<string, string>; }` |  |
| `--trail` | `"realistic" \| "fast"` |  |

## answerQuizQuestions

Saves answers in an attempt in progress without finishing it, and gives its questions afterwards. With the realistic trail, it first takes the time a reader needs for the questions and their options (ADR-005), calling `onProgress` with the seconds elapsed and the total.

```bash
moodle answer-quiz-questions <attemptId> <answers> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |
| `answers` | `{ slot: number; responses: Record<string, string>; }[]` |  |
| `--trail` | `"realistic" \| "fast"` |  |

## assignmentSubmissions

Every participant's submission to an assignment, with its content and the feedback files they have unless `includeContent` is false (both come from each participant's grading panel).

```bash
moodle assignment-submissions <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--include-content` | `boolean` |  |

## callService

Calls one of Moodle's AJAX services as the logged-in person.

```bash
moodle call-service <methodname> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `methodname` | `string` |  |
| `--<name> <value>` | | Any other field of `args` |

## completionReport

A course's progress report: every participant's completion of every activity that tracks it, page by page, in one group when given. People come as user id and full name only.

```bash
moodle completion-report <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--group` | `number` |  |

## conversation

A conversation's messages, oldest first, as text, and its members as `conversations()` gives them: everyone but the person, whether they wrote in it or not (the person alone in their own conversation).

```bash
moodle conversation <conversationId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `conversationId` | `number` |  |

## conversations

The person's conversations, latest first, with their last message as text.

```bash
moodle conversations
```

## courseAbilities

What the person can do in a course, asked of read-only services that need the capability: the activity types they can add (none without `moodle/course:manageactivities`) and the grader report's users (`nopermissions` without `gradereport/grader:view`). Nothing is changed.

```bash
moodle course-abilities <courseId> <sectionId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `sectionId` | `number` |  |

## courseActivityTypes

The activity and resource types the person can add to a course: none when they can't edit it.

```bash
moodle course-activity-types <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## courseRoles

A user's roles in a course, from their profile there: role links carry the role id in any language.

```bash
moodle course-roles <userId> <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `userId` | `number` |  |
| `courseId` | `number` |  |

## courseStructure

A course's sections and activities; with `details`, each activity's dates and restriction from the course page (slower).

```bash
moodle course-structure <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--details` | `boolean` |  |

## courseUpdates

What changed in a course's activities since a date, with their names from the course's state.

```bash
moodle course-updates <courseId> <since>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `since` | `Date` |  |

## createActivity

Creates an activity or resource of any type at the end of a section, through Moodle's own form, hidden from students unless `visibility` says otherwise. `files` are local paths uploaded to a file resource or folder; a SCORM (`type: "scorm"`) takes the first as its package.

```bash
moodle create-activity <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `input` | `ActivityFields & { courseId: number; sectionId: number; type: string; files?: string[]; }` |  |

## createEvent

Creates a course event, through the calendar's own form: its start, and its duration and description when given. Returns it as the calendar has it.

```bash
moodle create-event --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `--course-id` (required) | `number` |  |
| `--name` (required) | `string` |  |
| `--start` (required) | `Date` |  |
| `--duration-minutes` | `number` |  |
| `--description` | `string` |  |

## createQuestion

Creates one question in a bank through its type's edit form; returns its id. Imports are the way for several; this is for one-offs.

```bash
moodle create-question <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--type` (required) | `"multichoice" \| "truefalse" \| "shortanswer" \| "numerical" \| "essay"` |  |
| `--name` (required) | `string` |  |
| `--text` (required) | `string` | The question's text (HTML). |
| `--answers` | `{ text: string; fraction: number; feedback?: string; tolerance?: number; }[]` | Multichoice, short answer and numerical answers: a fraction of the mark (1 right, 0 wrong, negatives for penalties), the nearest one Moodle offers. |
| `--correct` | `boolean` | True/false: the right answer. |
| `--category-id` | `number` |  |
| `--default-mark` | `number` |  |
| `--fields` | `Record<string, FieldValue>` | Any other field of the type's form, by name. |

## deadlines

What the person has to do by a date (calendar action events: submit, attempt, grade…), from the last `pastDays` to `days` ahead, in one course or all. Teachers' grading counts come from the activities overview instead: Moodle gives them few action events.

```bash
moodle deadlines [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--course-id` | `number` |  |
| `--days` | `number` |  |
| `--past-days` | `number` |  |

## deleteActivity

Deletes an activity, with its participants' data (submissions, posts, attempts); gives the course afterwards.

```bash
moodle delete-activity <courseId> <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |

## deleteEvent

Deletes a calendar event the person can manage.

```bash
moodle delete-event <eventId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `eventId` | `number` |  |

## deleteSection

Deletes a section and every activity in it, with their participants' data.

```bash
moodle delete-section <courseId> <sectionId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `sectionId` | `number` |  |

## discussion

A discussion's posts, oldest first, with their messages as text.

```bash
moodle discussion <discussionId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `discussionId` | `number` |  |

## downloadFile

Saves a file of the site into `destDir` with the person's session, never overwriting. Only URLs of the site's origin: the session's cookies go nowhere else (its media outside Moodle's path included).

```bash
moodle download-file <url> [destDir]
```

| Argument | Type | Description |
| --- | --- | --- |
| `url` | `string` |  |
| `destDir` (optional) | `string` |  |

## duplicateActivity

Duplicates an activity as the course page's "Duplicate" does (right after it, named with "(copy)"); gives the copy's id and the course afterwards.

```bash
moodle duplicate-activity <courseId> <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |

## editActivity

Renames, shows or hides, or moves an activity (to a section's end, or before another one).

```bash
moodle edit-activity <courseId> <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `activityId` | `number` |  |
| `--name` | `string` |  |
| `--visibility` | `"shown" \| "hidden" \| "stealth"` |  |
| `--section-id` | `number` |  |
| `--before-activity-id` | `number` |  |

## editSection

Renames, shows or hides, or moves a section after another one.

```bash
moodle edit-section <courseId> <sectionId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `sectionId` | `number` |  |
| `--name` | `string` |  |
| `--visible` | `boolean` |  |
| `--after-section-id` | `number` |  |

## finishQuizAttempt

Submits an attempt for grading, and gives its review when the quiz shows it.

```bash
moodle finish-quiz-attempt <attemptId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |

## forumDiscussions

A forum's discussions, as its page lists them: who started each, replies, last post.

```bash
moodle forum-discussions <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## getChoice

A choice: its options, whether it can be answered or changed, and the person's answer.

```bash
moodle get-choice <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## getSurvey

A survey (questionnaire or feedback): whether it can be answered, its intro and messages, and its questions page by page. Its module is found when not given.

```bash
moodle get-survey <activityId> [type]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `type` (optional) | `SurveyType` |  |

## gradeSubmission

Grades a participant as the grader does: a grade (simple grading), a rubric's level per criterion or a marking guide's score per criterion (by their ids, from `rubric()`), remarks per criterion, feedback comments (HTML), feedback files (local paths that replace the ones the participant has; `[]` removes them), whether to notify, and any other grading field by name. Returns the grade saved and the gradebook's grade, the total Moodle computes for a rubric or a guide, and the feedback files after saving when they were given. Throws `GradingError` when Moodle refuses the grade, or when files are given to an assignment without feedback files.

```bash
moodle grade-submission <activityId> <userId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `--grade` | `string \| number` |  |
| `--rubric` | `Record<number, number>` | Criterion id → level id. |
| `--guide` | `Record<number, number>` | Criterion id → score. |
| `--remarks` | `Record<number, string>` | Criterion id → remark, for a rubric or a guide. |
| `--feedback` | `string` |  |
| `--feedback-files` | `string[]` | Local paths (absolute): the participant's feedback files afterwards. |
| `--notify` | `boolean` |  |
| `--fields` | `Record<string, FieldValue>` |  |

## gradebookSetup

A course's gradebook setup: its categories (aggregation, weights) and grade items (category, maximum, weight).

```bash
moodle gradebook-setup <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## graderReport

Everyone's grades in a course as the grader report shows them, page by page, in one group when given. People come as user id and full name only.

```bash
moodle grader-report <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--group` | `number` |  |

## grantExtension

Grants participants an extension until a date, through the assignment's extension form (several at once as its bulk action does). Moodle refuses a date before the assignment's due date.

```bash
moodle grant-extension <activityId> <userIds> <until>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userIds` | `number[]` |  |
| `until` | `Date` |  |

## groups

A course's groups the person can see, with their members' user ids.

```bash
moodle groups <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## h5pActivity

An H5P activity: its content type, whether attempts are tracked, and the person's attempts with their scores.

```bash
moodle h5p-activity <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## importQuestions

Imports questions into a bank from a GIFT or Moodle XML file (a local path) or text, through the bank's import form; returns the questions created. A file Moodle can't parse comes back as a `QuestionBankError` with its messages, and nothing is imported.

```bash
moodle import-questions <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--format` (required) | `"gift" \| "xml"` |  |
| `--file` | `string` |  |
| `--text` | `string` |  |
| `--category-id` | `number` |  |

## lessonPage

The lesson page the person is on (starting the lesson the first time).

```bash
moodle lesson-page <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## listAssignments

The course's assignments, in the course's order, with the section each is in.

```bash
moodle list-assignments <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## listCourses

The courses the person is enrolled in, as teacher or student.

```bash
moodle list-courses [classification]
```

| Argument | Type | Description |
| --- | --- | --- |
| `classification` (optional) | `"all" \| "inprogress" \| "future" \| "past"` |  |

## logIn

Makes sure there's a session: at once if there is one, else a window where the person logs in (`loginTimeoutMs` by default).

```bash
moodle log-in [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--timeout-ms` | `number` |  |

## logOut

Logs the person out of Moodle through the user menu's logout link (it carries the sesskey; without one Moodle asks to confirm, and the confirmation is accepted). Returns false when nobody was logged in. Only Moodle's session ends: a single sign-on provider may keep its own.

```bash
moodle log-out
```

## markNotificationsRead

Marks all the person's notifications read, as the popover's "Mark all as read" does; doing it twice changes nothing.

```bash
moodle mark-notifications-read
```

## myGrades

The person's own grade report for a course.

```bash
moodle my-grades <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## notifications

The person's notifications, newest first, only the unread ones when asked.

```bash
moodle notifications [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--unread-only` | `boolean` |  |

## overrideCompletion

Sets someone's completion of an activity as a teacher does from the progress report; returns the state saved.

```bash
moodle override-completion <activityId> <userId> <state>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `state` | `"incomplete" \| "complete" \| "complete-pass" \| "complete-fail"` |  |

## participantFilters

The roles and groups the participants page filters by in a course (its filters' options), as the person may use them: every group, or only their own in a course with separate groups. "No roles" and "no group" left out.

```bash
moodle participant-filters <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## participants

A course's participants with their roles and groups, as the participants page lists them: only those with a role (its id), in a group, or (`inactiveSince`) who haven't accessed the course since that date, when asked. Each role and group is a filter of its own, so ids come in any language.

```bash
moodle participants <courseId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--role` | `number` |  |
| `--group` | `number` |  |
| `--inactive-since` | `Date` |  |

## pendingActivities

What the person still has to do in a course: activities whose completion is tracked and not complete or, where completion isn't tracked, graded activities without a grade yet.

```bash
moodle pending-activities <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## publicSiteInfo

What the site tells anyone before logging in, without the browser.

```bash
moodle public-site-info
```

## questionBanks

A course's question banks: its shared ones and the activities' own, as the banks page lists them.

```bash
moodle question-banks <courseId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |

## questions

A bank's categories and every question in them, category by category.

```bash
moodle questions <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## quizInfo

A quiz's page as the person sees it: its description and dates, the person's attempts with their summary, and whether they can start one.

```bash
moodle quiz-info <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## quizResults

A quiz's attempts as its grades report shows them: per attempt the user, state, dates, grade and the mark per question; with `responses`, also the answer per question from the responses report. Every page of the report.

```bash
moodle quiz-results <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--responses` | `boolean` |  |

## quizStructure

A quiz's questions as its edit page lists them: slots with their page, question, type, name and mark.

```bash
moodle quiz-structure <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## readAttempt

Every question of an attempt, page by page, with the page each is on.

```bash
moodle read-attempt <attemptId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |

## readReview

A finished attempt's review, as far as the quiz's review options let the person see it.

```bash
moodle read-review <attemptId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `attemptId` | `number` |  |

## replyToPost

Replies to a post; returns the new post's id and its discussion's.

```bash
moodle reply-to-post <postId> <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `postId` | `number` |  |
| `input` | `PostInput & { subject?: string; }` |  |

## rubric

An assignment's grading method and, for a rubric or a marking guide, its criteria with the ids `gradeSubmission` takes: read from the grader's panel for its first participant.

```bash
moodle rubric <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## saveSubmission

Saves the submission's online text and adds files, as "Save changes" on the edit page does; gives the assignment afterwards.

```bash
moodle save-submission <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--online-text` | `string` |  |
| `--files` | `string[]` |  |

## scorm

A SCORM activity as the person sees it: its attempts (allowed and made), the grading method, the grade reported and each attempt's, and its SCOs with the person's status and score in the last attempt. Moodle doesn't show a SCORM's version on its page: `openScorm` tells it.

```bash
moodle scorm <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## sendMessage

Sends a private message to a user, as the messaging drawer does; returns the message and its conversation.

```bash
moodle send-message <userId> <text>
```

| Argument | Type | Description |
| --- | --- | --- |
| `userId` | `number` |  |
| `text` | `string` |  |

## setCompletion

Marks the person's own completion of an activity with manual completion, done or not, as its "Mark as done" button does; doing it twice changes nothing. An activity that completes on its own gives a `CompletionError`.

```bash
moodle set-completion <activityId> <done>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `done` | `boolean` |  |

## setDiscussionState

Pins or unpins, locks or unlocks a discussion, as the discussion list's menu does; what's already so is left alone. Returns the discussion as the forum lists it afterwards.

```bash
moodle set-discussion-state <activityId> <discussionId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `discussionId` | `number` |  |
| `--pinned` | `boolean` |  |
| `--locked` | `boolean` |  |

## setQuizOverride

Sets a user override on a quiz, through its override form: other opening and closing dates, a time limit in minutes, or a number of attempts (0 unlimited); what isn't given stays the quiz's.

```bash
moodle set-quiz-override <activityId> <userId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `userId` | `number` |  |
| `--open` | `Date` |  |
| `--close` | `Date` |  |
| `--time-limit-minutes` | `number` |  |
| `--attempts` | `number` |  |

## siteName

The site's name, from its public settings; `undefined` where the mobile app support is off.

```bash
moodle site-name
```

## startDiscussion

Starts a discussion in a forum; returns its id.

```bash
moodle start-discussion <activityId> <input>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `input` | `PostInput & { subject: string; }` |  |

## startQuizAttempt

Starts an attempt, or continues the one in progress, and gives its questions.

```bash
moodle start-quiz-attempt <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## studentAssignment

An assignment as the student sees it: its description and files, dates, the submission's status and files, the feedback, and whether it can be edited or submitted now.

```bash
moodle student-assignment <activityId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |

## submitForGrading

Submits the saved submission for grading, accepting the site's statement when it asks for one (`acceptStatement`, once the person agrees; a bare boolean as before 0.2 too); gives the assignment afterwards.

```bash
moodle submit-for-grading <activityId> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--accept-statement` | `boolean` |  |

## submitSurvey

Fills the survey page by page with `responses` (field name → value) and submits it on the last page. Every name is checked against the form first, so nothing is sent with a wrong one.

```bash
moodle submit-survey <activityId> <responses> [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `responses` | `Record<string, string>` |  |
| `--type` | `SurveyType` |  |

## upcomingEvents

The person's upcoming events, as the calendar's "Upcoming events" view lists them, in one course or all.

```bash
moodle upcoming-events [--options]
```

| Argument | Type | Description |
| --- | --- | --- |
| `--course-id` | `number` |  |

## updateActivity

Changes an existing activity through its form: only what's given changes; files stay as they are.

```bash
moodle update-activity <activityId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `activityId` | `number` |  |
| `--name` | `string` |  |
| `--description` | `string` | The description (HTML), shown on the activity's page. |
| `--content` | `string` | A page's content, or a label's text (HTML). |
| `--url` | `string` | A URL resource's target. |
| `--visibility` | `"shown" \| "hidden" \| "stealth"` |  |
| `--settings` | `Record<string, FieldValue>` |  |

## updateCourse

Changes a course's full name, short name, summary (HTML) or any other setting by its form field name, through the course's settings form; returns the course as `listCourses` gives it. Moodle's refusals (a short name already taken) come back as `FormError` by field.

```bash
moodle update-course <courseId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `--full-name` | `string` |  |
| `--short-name` | `string` |  |
| `--summary` | `string` |  |
| `--settings` | `Record<string, FieldValue>` |  |

## updateGradeItem

Changes a grade item: moves it into a category, sets its weight (percent, overriding Natural's automatic one), or its maximum grade (a manual item's; an activity's is set in the activity). Returns the item afterwards.

```bash
moodle update-grade-item <courseId> <itemId> --options
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` | `number` |  |
| `itemId` | `number` |  |
| `--category` | `number` |  |
| `--weight` | `number` |  |
| `--max-grade` | `number` |  |

## userById

A user by id, or `undefined` when Moodle gives nobody (no such user, or not one the person may see).

```bash
moodle user-by-id <userId>
```

| Argument | Type | Description |
| --- | --- | --- |
| `userId` | `number` |  |

## whoAmI

Who the logged-in person is; with `courseId`, also their roles and abilities in that course.

```bash
moodle who-am-i [courseId]
```

| Argument | Type | Description |
| --- | --- | --- |
| `courseId` (optional) | `number` |  |
