/**
 * The public API: everything a program needs to work a Moodle site with the person's own session,
 * imported from `@falkenslab/moodle-driver`. Start with `createMoodle`, whose methods are the
 * driver's operations; each is also a function taking the browser's context and the site.
 *
 * The primitives the operations are built from are in `@falkenslab/moodle-driver/internals`; what
 * neither exports is internal.
 *
 * @packageDocumentation
 */

// The Moodle object, the browser and what a program chooses.
export * from "./client.js";
export * from "./options.js";
export { createBrowserManager, canShowWindow, BrowserNotFoundError, BrowserDownloadingError, NoDisplayError, type BrowserManager, type ContextOptions } from "./browser/manager.js";
export { SESSION_COOKIES_FILE } from "./browser/cookies.js";
export { connectBrowserManager, backgroundBrowser, BACKGROUND_FILE, type BackgroundBrowser, type ConnectOptions } from "./browser/background.js";
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
export type { MediaItem, ImageItem } from "./core/text.js";
export type { ListPage, PageOptions, WithLimit, WithoutLimit } from "./core/paging.js";
export { publicSiteInfo, courseActivityTypes } from "./areas/site/info.js";
export { moodleVersion, type MoodleVersion } from "./core/version.js";
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
export { courseBlocks, addBlock, configureBlock, moveBlock, deleteBlock, BlockError, type CourseBlock, type NewBlock, type BlockChanges } from "./areas/courses/blocks.js";
export { resetCourse, type ResetDeletions, type ResetStatus } from "./areas/courses/reset.js";
export { copyCourse, backupCourse, restoreCourse, importActivities, BackupError, type CourseRef, type RestoreWarning } from "./areas/backup/backup.js";
export { backupContents, type BackupContents, type BackupContentsSection, type BackupContentsActivity, type BackupDependency } from "./areas/backup/contents.js";
export { anonymizeBackup, ANONYMOUS, type BackupIdentifier } from "./areas/backup/anonymous.js";

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
export {
  bookChapters,
  addBookChapter,
  editBookChapter,
  moveBookChapter,
  setBookChapterVisible,
  deleteBookChapter,
  BookError,
  type BookChapter,
  type BookChapterChange,
  type BookChapterInput,
} from "./areas/activities/books.js";

// Assignments.
export { NotAnAssignmentError, GradingError, WORKFLOW_STATES, type PluginContent, type WorkflowState } from "./areas/assignments/grader.js";
export { assignmentSubmissions, gradeSubmission, rubric, grantExtension, setWorkflowState, allocateMarker, type Submission, type SubmissionOptions, type GradingCriterion, type GradingDefinition } from "./areas/assignments/grading.js";
export { setGradingDefinition, type GradingDefinitionInput, type RubricDefinitionInput, type GuideDefinitionInput, type SavedGradingDefinition } from "./areas/assignments/definitions.js";
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
export { quizResults, type QuizAttemptResult, type QuizResults, type QuizResultsOptions } from "./areas/quizzes/results.js";
export {
  quizStatistics,
  type QuizStatistics,
  type QuizStatisticsAttempts,
  type QuizStatisticsFigures,
  type QuizStatisticsOptions,
  type QuizSlotStatistics,
  type QuizQuestionStatistics,
  type QuizResponseCount,
} from "./areas/quizzes/statistics.js";
export { questionsToGrade, gradeQuizQuestion, type QuestionToGrade } from "./areas/quizzes/grading.js";
export { quizStructure, addQuestionsToQuiz, editQuizSlot, removeQuizSlot, setQuizPages, addQuizSection, type QuizSlot, type QuizSection, type QuizChange } from "./areas/quizzes/structure.js";
export {
  questionBanks,
  questions,
  importQuestions,
  exportQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestions,
  setQuestionStatus,
  QUESTION_TYPES,
  QuestionBankError,
  type QuestionBank,
  type BankQuestion,
  type BankCategory,
  type BankQuestions,
  type QuestionType,
  type QuestionInput,
  type DropZone,
} from "./areas/questions/banks.js";
export { questionCategories, addQuestionCategory, editQuestionCategory, deleteQuestionCategory, moveQuestions, type QuestionCategory } from "./areas/questions/categories.js";

// Forums, surveys, choices, lessons, H5P.
export { forumGrades, gradeForumUser, type ForumGrade, type ForumGrades } from "./areas/forums/grading.js";
export { rate, type RateableItem } from "./areas/ratings/ratings.js";
export { workshopInfo, setWorkshopPhase, assessWorkshopSubmission, WorkshopError, WORKSHOP_PHASES, type WorkshopPhase, type WorkshopInfo, type WorkshopSubmission, type WorkshopAssessment, type WorkshopCriterion, type WorkshopAssessmentInput } from "./areas/workshops/workshops.js";
export { workshopAllocation, allocateReviewer, removeReviewer, allocateRandomly, scheduleAllocation, type WorkshopAllocation, type WorkshopAllocatedSubmission, type WorkshopReviewer, type WorkshopReviewerChoice, type WorkshopReviewerRemoval, type RandomAllocationSettings, type ScheduledAllocationSettings, type ScheduledAllocation } from "./areas/workshops/allocation.js";
export { workshopSubmission, saveWorkshopSubmission, type WorkshopSubmissionContent, type WorkshopSubmissionRef, type WorkshopSubmissionInput, type WorkshopAttachment } from "./areas/workshops/submissions.js";
export { workshopExamples, addWorkshopExample, editWorkshopExample, deleteWorkshopExample, assessWorkshopExample, type WorkshopExample, type WorkshopExampleInput } from "./areas/workshops/examples.js";
export { calculateWorkshopGrades, overrideWorkshopGrade, type WorkshopComparison, type WorkshopGradeOverride } from "./areas/workshops/evaluation.js";
export { NotAForumError, ForumError } from "./areas/forums/discussions.js";
export { forumDiscussions, discussion, replyToPost, startDiscussion, setDiscussionState, setDiscussionSubscription, editPost, deletePost, type ForumDiscussion, type ForumPost, type DiscussionPosts, type PostInput, type PostChanges } from "./areas/forums/posts.js";
export { getSurvey, submitSurvey, SurveyError, type SurveyType, type SurveyField, type SurveyQuestion } from "./areas/surveys/surveys.js";
export { surveyResults, type SurveyResults, type SurveyResponse, type SurveyResultQuestion, type SurveyOptionCount } from "./areas/surveys/results.js";
export {
  feedbackItems,
  addFeedbackItem,
  editFeedbackItem,
  moveFeedbackItem,
  deleteFeedbackItem,
  feedbackTemplates,
  useFeedbackTemplate,
  saveFeedbackTemplate,
  deleteFeedbackTemplate,
  FEEDBACK_ITEM_TYPES,
  type FeedbackItemType,
  type FeedbackChoiceDisplay,
  type FeedbackInfoKind,
  type FeedbackItemOption,
  type FeedbackItemDefinition,
  type FeedbackItemInput,
  type FeedbackTemplate,
} from "./areas/surveys/items.js";
export { getChoice, answerChoice, choiceResults, ChoiceError, type Choice, type ChoiceResults, type ChoiceRespondent } from "./areas/surveys/choice.js";
export { lessonPage, answerLessonPage, LessonError, type LessonField, type LessonPage } from "./areas/lessons/lessons.js";
export {
  lessonPages,
  addLessonPage,
  editLessonPage,
  moveLessonPage,
  deleteLessonPage,
  LESSON_PAGE_TYPES,
  LESSON_JUMPS,
  type LessonPageType,
  type LessonJump,
  type LessonAnswer,
  type LessonButton,
  type LessonPageDefinition,
  type LessonPageInput,
} from "./areas/lessons/pages.js";
export { h5pActivity, NotAnH5PActivityError, type H5PAttempt, type H5PActivity } from "./areas/h5p/h5p.js";
export { contentBank, uploadToContentBank, renameContent, downloadContent, deleteContent, ContentBankError, type BankContent, type BankContentUpload } from "./areas/h5p/contentbank.js";
export {
  bigBlueButton,
  bigBlueButtonJoinUrl,
  setRecordingPublished,
  deleteRecording,
  BigBlueButtonError,
  BigBlueButtonServerError,
  type BigBlueButtonActivity,
  type BigBlueButtonRecording,
  type BigBlueButtonPlayback,
  type BigBlueButtonStatus,
} from "./areas/bigbluebutton/bigbluebutton.js";
export { scorm, openScorm, ScormError, type ScoStatus, type ScormSco, type ScormActivity, type OpenedScorm } from "./areas/scorm/scorm.js";
export { NotADatabaseError, DatabaseError } from "./areas/databases/database.js";
export { databaseFields, addDatabaseField, editDatabaseField, deleteDatabaseField, DATABASE_FIELD_TYPES, type DatabaseFieldType, type DatabaseField, type DatabaseFieldInput, type DatabaseFieldChanges, type DatabaseFieldOptions } from "./areas/databases/fields.js";
export { databaseTemplates, setDatabaseTemplate, databasePresets, applyDatabasePreset, DATABASE_TEMPLATES, type DatabaseTemplate, type DatabaseTemplates, type DatabasePreset } from "./areas/databases/templates.js";
export { databaseEntries, addDatabaseEntry, editDatabaseEntry, deleteDatabaseEntry, setDatabaseEntryApproved, exportDatabaseEntries, importDatabaseEntries, type DatabaseEntry, type DatabaseEntryField, type DatabaseEntryFile, type DatabaseEntryValue, type DatabaseEntryOptions, type DatabaseEntryInput, type DatabaseEntryValues, type DatabaseExportOptions } from "./areas/databases/entries.js";
export { NotAGlossaryError, GlossaryError } from "./areas/glossaries/glossary.js";
export {
  glossaryEntries,
  addGlossaryEntry,
  editGlossaryEntry,
  deleteGlossaryEntry,
  setGlossaryEntryApproved,
  type GlossaryEntry,
  type GlossaryAttachment,
  type GlossaryEntryOptions,
  type GlossaryEntryInput,
  type GlossaryEntryChanges,
  type GlossaryEntryChange,
} from "./areas/glossaries/entries.js";
export { glossaryCategories, addGlossaryCategory, type GlossaryCategory, type GlossaryCategoryChange } from "./areas/glossaries/categories.js";
export { exportGlossaryEntries, importGlossaryEntries, type GlossaryImport } from "./areas/glossaries/transfer.js";
export {
  wikiPages,
  wikiPage,
  createWikiPage,
  editWikiPage,
  NotAWikiError,
  WikiError,
  WikiPageLockedError,
  type WikiLink,
  type WikiVersion,
  type WikiPageSummary,
  type WikiPage,
  type WikiSubwikiOptions,
  type WikiPagesOptions,
  type WikiPageOptions,
  type WikiPageInput,
  type WikiPageChanges,
  type WikiPageChange,
} from "./areas/wikis/wikis.js";

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
export { importGrades, type ImportGradesOptions, type ImportGradesResult, type GradeImportPreview, type GradeImportUserField } from "./areas/grades/import.js";
export { courseScales, addScale, editScale, gradeLetters, setGradeLetters, type GradeScale, type ScaleFields, type GradeLetter, type GradeLetters } from "./areas/grades/scales.js";
export {
  courseLogs,
  activityReport,
  participationReport,
  LOG_ACTIONS,
  PARTICIPATION_ACTIONS,
  ReportError,
  type LogAction,
  type LogEntry,
  type CourseLogOptions,
  type ActivityViews,
  type ParticipationAction,
  type ActivityParticipant,
} from "./areas/reports/reports.js";
export { setCompletion, overrideCompletion, completionReport, CompletionError, type CompletionCell, type CompletionReport } from "./areas/completion/completion.js";
export {
  courseCompletionCriteria,
  setCourseCompletionCriteria,
  courseCompletionStatus,
  markCourseComplete,
  type CompletionAggregation,
  type CourseCompletionCriteria,
  type CourseCompletionChanges,
  type CourseCriterionType,
  type CourseCriterionStatus,
  type CourseCompletionStatus,
  type CourseCompletionStatusOptions,
} from "./areas/completion/course.js";
export { participants, participantFilters, groups, NoParticipantsError, type Participant, type ParticipantOptions, type CourseGroup } from "./areas/participants/participants.js";
export { createGroup, updateGroup, deleteGroup, setGroupMembers, groupings, createGrouping, deleteGrouping, setGroupingGroups, type GroupSettings, type GroupingSettings, type Grouping } from "./areas/participants/groups.js";
export { autoCreateGroups, importGroups, type AutoCreateGroupsOptions, type AutoGroupsPreview, type AutoGroupsCreated, type PreviewedGroup, type GroupsImport } from "./areas/participants/autogroups.js";
export { enrolmentMethods, setEnrolmentMethod, type EnrolmentMethod, type EnrolmentMethodSettings } from "./areas/participants/methods.js";
export { potentialUsers, enrolUsers, unenrolUser, setUserRoles, EnrolmentError, type PotentialUser } from "./areas/participants/enrolments.js";
export { notes, addNote, editNote, deleteNote, NoteError, NotesDisabledError, type ParticipantNote, type NoteContext, type NoteOptions, type NoteFields, type NoteChange } from "./areas/participants/notes.js";
export { externalTools, addExternalTool, setExternalToolInChooser, deleteExternalTool, externalToolLaunchUrl, ExternalToolError, type ExternalTool, type NewExternalTool } from "./areas/lti/tools.js";
export { competencyFrameworks, courseCompetencies, addCourseCompetency, removeCourseCompetency, setActivityCompetencies, competencyRating, rateCompetency, CompetencyError, CompetenciesDisabledError, type Competency, type CompetencyFramework, type CourseCompetency, type CourseCompetencyChange, type ActivityCompetencyChange, type CompetencyScaleItem, type CompetencyEvidence, type CompetencyRating, type CompetencyRatingInput, type CompetencyRatingChange } from "./areas/competencies/competencies.js";
export { courseBadges, createBadge, setBadgeCriteria, setBadgeEnabled, awardBadge, BadgeError, BadgesDisabledError, type CourseBadge, type BadgeCriteria, type BadgeCriteriaChanges, type NewBadge } from "./areas/badges/badges.js";
export { upcomingEvents, calendarEvent, createEvent, updateEvent, deleteEvent, CalendarError, type CalendarEvent, type EventChanges } from "./areas/calendar/calendar.js";
export { notifications, markNotificationsRead, conversations, conversation, sendMessage, messageParticipants, MessageError, type Notification, type NotificationOptions, type ConversationSummary, type Conversation, type ConversationMessage, type ParticipantSelection } from "./areas/messages/messages.js";
