// The methods a browser lost mid-call may run again (#99).

/**
 * The `Moodle` methods that only read, so running one again after the browser is lost can't change
 * anything in Moodle. A list, on purpose: a failure says nothing about what reached the site, and a
 * form sent twice makes two activities. A method belongs here only if nothing it calls sends a form
 * or a service that writes; when in doubt it stays out, and fails with `BrowserLostError`. Left out:
 * reads that walk something (a lesson's page), open it for its owner (a quiz attempt's page), use a
 * form or the editing mode on the way, and downloads, which write a file each time.
 */
export const REPEATABLE_METHODS: ReadonlySet<string> = new Set([
  // Courses and the site.
  "activityReport", "completionReport", "courseAbilities", "courseActivityTypes", "courseCompletionCriteria", "courseCompletionStatus", "courseLogs", "courseRoles", "courseStructure", "courseUpdates", "listCourses", "moodleVersion", "participationReport", "pendingActivities", "siteName", "userById", "whoAmI",
  // Participants.
  "enrolmentMethods", "groupings", "groups", "notes", "participantFilters", "participants", "potentialUsers",
  // Time and messages.
  "calendarEvent", "conversation", "conversations", "deadlines", "notifications", "upcomingEvents",
  // Grades.
  "gradeLetters", "gradebookSetup", "graderReport", "myGrades",
  // Assignments and forums.
  "listAssignments", "rubric", "studentAssignment", "discussion", "forumDiscussions",
  // Other activities.
  "bookChapters", "choiceResults", "getChoice", "getSurvey", "surveyResults", "feedbackItems", "feedbackTemplates", "questionnaireQuestions", "contentBank", "h5pActivity", "h5pContentTypes", "externalTools", "courseBadges", "databaseFields", "databasePresets", "databaseTemplates", "glossaryCategories", "glossaryEntries", "lessonPages", "wikiPage", "wikiPages", "workshopAllocation", "workshopExamples", "workshopInfo", "workshopSubmission",
  // Questions and quizzes.
  "questionBanks", "questionCategories", "questionTypes", "questions", "questionsToGrade", "quizInfo", "quizResults", "quizStatistics", "quizStructure", "readReview",
]);
