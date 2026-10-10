// The public API of @falkenslab/moodle-driver: everything a program needs to work a Moodle site with
// the person's own session. The primitives the operations are built from are in ./internals.ts
// (`@falkenslab/moodle-driver/internals`); what neither exports is internal.

// The Moodle object, the browser and what a program chooses.
export * from "./client.js";
export * from "./options.js";
export { createBrowserManager, canShowWindow, BrowserNotFoundError, BrowserDownloadingError, NoDisplayError, type BrowserManager, type ContextOptions } from "./browser/manager.js";
export { SESSION_COOKIES_FILE } from "./browser/cookies.js";
export * from "./categories.js";
export * from "./core/errors.js";

// The session and the site.
export { logIn, LoginTimeoutError, LoginWindowClosedError, type LoginResult } from "./core/login.js";
export { logOut, NotLoggedInError } from "./core/session.js";
export { MoodleServiceError } from "./core/ajax.js";
export { FormError, type FieldValue } from "./core/forms.js";
export { findMoodleSite } from "./core/site.js";
export { checkLocalFiles, downloadFile, type DownloadedFile } from "./core/files.js";
export type { MediaItem } from "./core/text.js";
export { publicSiteInfo, courseActivityTypes } from "./areas/site/info.js";
export { userById, siteName, courseRoles, courseAbilities, whoAmI, type User, type Me } from "./areas/site/users.js";

// Courses.
export { listCourses, updateCourse, COURSE_CLASSIFICATIONS, CourseError, type CourseClassification, type Course } from "./areas/courses/list.js";
export {
  courseStructure,
  listAssignments,
  pendingActivities,
  COMPLETION_STATES,
  type CompletionState,
  type CourseActivity,
  type CourseSection,
  type CourseAssignment,
  type PendingActivity,
} from "./areas/courses/structure.js";
export { activitiesOverview, deadlines, courseUpdates, type OverviewField } from "./areas/courses/overview.js";

// Activities: building them and viewing their content.
export {
  createActivity,
  updateActivity,
  editActivity,
  duplicateActivity,
  deleteActivity,
  addSection,
  editSection,
  deleteSection,
  activitySettings,
  ACTIVITY_VISIBILITIES,
  ActivitySettingsError,
  type ActivityVisibility,
  type ActivityFields,
  type CourseChange,
  type FormField,
} from "./areas/activities/build.js";
export { activityContent, CONTENT_TYPES, NotViewableError, type ContentType, type ContentOptions, type ActivityContent } from "./areas/activities/content.js";

// Assignments.
export { NotAnAssignmentError, GradingError, type PluginContent } from "./areas/assignments/grader.js";
export { assignmentSubmissions, gradeSubmission, rubric, grantExtension, type Submission, type GradingCriterion, type GradingDefinition } from "./areas/assignments/grading.js";
export { studentAssignment, saveSubmission, submitForGrading, SubmissionError, type StudentAssignment } from "./areas/assignments/student.js";

// Quizzes and question banks.
export {
  quizInfo,
  startQuizAttempt,
  readAttempt,
  answerQuizQuestions,
  finishQuizAttempt,
  readReview,
  setQuizOverride,
  QuizError,
  type Detail,
  type QuizInfo,
  type QuestionField,
  type Question,
} from "./areas/quizzes/attempts.js";
export { quizResults, type QuizAttemptResult } from "./areas/quizzes/results.js";
export { quizStructure, addQuestionsToQuiz, type QuizSlot } from "./areas/quizzes/structure.js";
export {
  questionBanks,
  questions,
  importQuestions,
  createQuestion,
  QUESTION_TYPES,
  QuestionBankError,
  type QuestionBank,
  type BankQuestion,
  type BankCategory,
  type QuestionType,
  type QuestionInput,
} from "./areas/questions/banks.js";

// Forums, surveys, choices, lessons, H5P.
export { NotAForumError } from "./areas/forums/discussions.js";
export { forumDiscussions, discussion, replyToPost, startDiscussion, setDiscussionState, type ForumDiscussion, type ForumPost, type PostInput } from "./areas/forums/posts.js";
export { getSurvey, submitSurvey, SurveyError, type SurveyType, type SurveyField, type SurveyQuestion } from "./areas/surveys/surveys.js";
export { getChoice, answerChoice, ChoiceError, type Choice } from "./areas/surveys/choice.js";
export { lessonPage, answerLessonPage, LessonError, type LessonField, type LessonPage } from "./areas/lessons/lessons.js";
export { h5pActivity, NotAnH5PActivityError, type H5PAttempt, type H5PActivity } from "./areas/h5p/h5p.js";

// Grades, completion, participants, calendar, messages.
export { myGrades, NoGradeReportError, type GradeRow } from "./areas/grades/user-report.js";
export {
  graderReport,
  gradebookSetup,
  updateGradeItem,
  addGradeCategory,
  GRADE_AGGREGATIONS,
  GradebookError,
  type GradeAggregation,
  type GradeColumn,
  type GraderReport,
  type GradebookCategory,
  type GradebookItem,
} from "./areas/grades/gradebook.js";
export { setCompletion, overrideCompletion, completionReport, CompletionError, type CompletionCell, type CompletionReport } from "./areas/completion/completion.js";
export { participants, participantFilters, groups, NoParticipantsError, type Participant, type CourseGroup } from "./areas/participants/participants.js";
export { upcomingEvents, createEvent, deleteEvent, CalendarError, type CalendarEvent } from "./areas/calendar/calendar.js";
export { notifications, markNotificationsRead, conversations, conversation, sendMessage, MessageError, type Notification, type ConversationSummary } from "./areas/messages/messages.js";
