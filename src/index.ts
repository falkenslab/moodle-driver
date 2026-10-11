// The public API of @falkenslab/moodle-driver: everything a program needs to work a Moodle site with
// the person's own session. The primitives the operations are built from are in ./internals.ts
// (`@falkenslab/moodle-driver/internals`); what neither exports is internal.

// The Moodle object, the browser and what a program chooses.
export * from "./client.js";
export * from "./options.js";
export { createBrowserManager, canShowWindow, BrowserNotFoundError, BrowserDownloadingError, NoDisplayError, type BrowserManager, type ContextOptions } from "./browser/manager.js";
export { SESSION_COOKIES_FILE } from "./browser/cookies.js";
export { siteProfileDir } from "./home.js";
export * from "./categories.js";
export * from "./core/errors.js";

// The session and the site.
export { logIn, LoginTimeoutError, LoginWindowClosedError, type LoginResult } from "./core/login.js";
export { logOut, NotLoggedInError } from "./core/session.js";
export { MoodleServiceError } from "./core/ajax.js";
export { FormError, type FieldValue, type DraftUpload, type DraftFile } from "./core/forms.js";
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
  type FileChanges,
  type FormField,
} from "./areas/activities/build.js";
export type { Restriction, Restrictions, Completion } from "./areas/activities/conditions.js";
export { activityContent, CONTENT_TYPES, NotViewableError, type ContentType, type ContentOptions, type ActivityContent } from "./areas/activities/content.js";

// Assignments.
export { NotAnAssignmentError, GradingError, WORKFLOW_STATES, type PluginContent, type WorkflowState } from "./areas/assignments/grader.js";
export { assignmentSubmissions, gradeSubmission, rubric, grantExtension, setWorkflowState, allocateMarker, type Submission, type GradingCriterion, type GradingDefinition } from "./areas/assignments/grading.js";
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
export { questionsToGrade, gradeQuizQuestion, type QuestionToGrade } from "./areas/quizzes/grading.js";
export { quizStructure, addQuestionsToQuiz, editQuizSlot, removeQuizSlot, setQuizPages, addQuizSection, type QuizSlot, type QuizSection } from "./areas/quizzes/structure.js";
export {
  questionBanks,
  questions,
  importQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestions,
  setQuestionStatus,
  QUESTION_TYPES,
  QuestionBankError,
  type QuestionBank,
  type BankQuestion,
  type BankCategory,
  type QuestionType,
  type QuestionInput,
} from "./areas/questions/banks.js";

// Forums, surveys, choices, lessons, H5P.
export { forumGrades, gradeForumUser, type ForumGrade, type ForumGrades } from "./areas/forums/grading.js";
export { rate, type RateableItem } from "./areas/ratings/ratings.js";
export { NotAForumError, ForumError } from "./areas/forums/discussions.js";
export { forumDiscussions, discussion, replyToPost, startDiscussion, setDiscussionState, editPost, deletePost, type ForumDiscussion, type ForumPost, type PostInput, type PostChanges } from "./areas/forums/posts.js";
export { getSurvey, submitSurvey, SurveyError, type SurveyType, type SurveyField, type SurveyQuestion } from "./areas/surveys/surveys.js";
export { getChoice, answerChoice, ChoiceError, type Choice } from "./areas/surveys/choice.js";
export { lessonPage, answerLessonPage, LessonError, type LessonField, type LessonPage } from "./areas/lessons/lessons.js";
export { h5pActivity, NotAnH5PActivityError, type H5PAttempt, type H5PActivity } from "./areas/h5p/h5p.js";
export { scorm, openScorm, ScormError, type ScoStatus, type ScormSco, type ScormActivity, type OpenedScorm } from "./areas/scorm/scorm.js";

// Grades, completion, participants, calendar, messages.
export { myGrades, NoGradeReportError, type GradeRow } from "./areas/grades/user-report.js";
export {
  graderReport,
  gradebookSetup,
  updateGradeItem,
  addGradeCategory,
  addGradeItem,
  updateGradeCategory,
  deleteGradeCategory,
  deleteGradeItem,
  GRADE_AGGREGATIONS,
  GradebookError,
  type GradeAggregation,
  type GradeColumn,
  type GraderReport,
  type GradebookCategory,
  type GradebookItem,
} from "./areas/grades/gradebook.js";
export { setGrade, type GradebookGrade, type SetGradeOptions } from "./areas/grades/singleview.js";
export { exportGrades, GRADE_EXPORT_FORMATS, type GradeExportFormat, type GradeExportDisplay, type ExportGradesOptions } from "./areas/grades/export.js";
export { setCompletion, overrideCompletion, completionReport, CompletionError, type CompletionCell, type CompletionReport } from "./areas/completion/completion.js";
export { participants, participantFilters, groups, NoParticipantsError, type Participant, type CourseGroup } from "./areas/participants/participants.js";
export { createGroup, updateGroup, deleteGroup, setGroupMembers, groupings, createGrouping, deleteGrouping, setGroupingGroups, type GroupSettings, type GroupingSettings, type Grouping } from "./areas/participants/groups.js";
export { enrolmentMethods, setEnrolmentMethod, type EnrolmentMethod, type EnrolmentMethodSettings } from "./areas/participants/methods.js";
export { potentialUsers, enrolUsers, unenrolUser, setUserRoles, EnrolmentError, type PotentialUser } from "./areas/participants/enrolments.js";
export { upcomingEvents, calendarEvent, createEvent, updateEvent, deleteEvent, CalendarError, type CalendarEvent, type EventChanges } from "./areas/calendar/calendar.js";
export { notifications, markNotificationsRead, conversations, conversation, sendMessage, messageParticipants, MessageError, type Notification, type ConversationSummary, type ParticipantSelection } from "./areas/messages/messages.js";
