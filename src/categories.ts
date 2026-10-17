// What data each public function reads or writes, so a program can decide what to allow (an agent
// that builds content but never reads students' work) without classifying the driver by hand.

/**
 * A kind of data a function reads or writes:
 * - `none`: the session or the site, nothing of anyone's; also functions that only parse what the
 *   caller already fetched (a page, HTML, JSON), whose data belongs to whatever fetched it.
 * - `own`: the person's own data and actions (their courses, attempts, submissions, grades).
 * - `course-content`: what teachers make (structure, activities' content and settings, rubrics' definitions, questions).
 * - `others-aggregate`: counts about others that identify no one ("2 of 4 submitted").
 * - `others-personal`: others' data or work (names, roles, submissions, posts, attempts, responses, grades).
 * - `others-write`: deciding about others (grades, feedback, extensions, overrides, completion).
 * - `communication`: writing to or before others (forum posts, messages).
 * - `any`: generic primitives that reach whatever they're pointed at (services, pages, forms).
 */
export const ALL_DATA_CATEGORIES = ["none", "own", "course-content", "others-aggregate", "others-personal", "others-write", "communication", "any"] as const;
/** One of `ALL_DATA_CATEGORIES`: a kind of data a function reads or writes. */
export type DataCategory = (typeof ALL_DATA_CATEGORIES)[number];

const NONE: readonly DataCategory[] = ["none"];
const OWN: readonly DataCategory[] = ["own"];
const CONTENT: readonly DataCategory[] = ["course-content"];
const PERSONAL: readonly DataCategory[] = ["others-personal"];
const ANY: readonly DataCategory[] = ["any"];

/**
 * The data categories of every function exported from the package, and of the browser manager's
 * methods (`BrowserManager.<method>`) and the Moodle object's own (`Moodle.<method>`; its other methods are
 * the functions of the same name). A function that may touch several kinds lists them all; a
 * program takes the strictest. Functions that read activities of any module answer per module
 * through `moduleCategories()`.
 */
export const DATA_CATEGORIES: Readonly<Record<string, readonly DataCategory[]>> = {
  // The browser and the session.
  createBrowserManager: NONE,
  connectBrowserManager: NONE,
  backgroundBrowser: NONE,
  // The Moodle object: its bound methods are classified as their functions, of the same name.
  createMoodle: NONE,
  "Moodle.context": NONE,
  "Moodle.logIn": NONE,
  "Moodle.publicSiteInfo": NONE,
  "Moodle.backupContents": CONTENT,
  "Moodle.anonymizeBackup": CONTENT,
  "Moodle.callService": ANY,
  "Moodle.openScorm": OWN,
  "Moodle.tab": ANY,
  "Moodle.visible": NONE,
  "Moodle.setVisible": NONE,
  "Moodle.saveSession": NONE,
  "Moodle.close": NONE,
  // The context is what every function takes: what's done with it is classified by those functions.
  "BrowserManager.context": NONE,
  "BrowserManager.openChannel": NONE,
  "BrowserManager.chromiumDownload": NONE,
  "BrowserManager.visible": NONE,
  "BrowserManager.setVisible": NONE,
  "BrowserManager.show": NONE,
  "BrowserManager.tab": ANY,
  "BrowserManager.saveSession": NONE,
  "BrowserManager.close": NONE,
  canShowWindow: NONE,
  parseSiteUrl: NONE,
  siteProfileDir: NONE,
  findMoodleSite: NONE,
  readWwwroot: NONE,
  publicSiteInfo: NONE,
  siteName: NONE,
  logIn: NONE,
  logOut: NONE,
  readSessionFacts: NONE,
  htmlSessionFacts: NONE,
  readMoodleConfig: NONE,
  isLoggedIn: NONE,
  pageIsLoggedIn: NONE,
  dateSelectorValues: NONE,
  dateSelectorDate: NONE,
  moodleErrorMessage: NONE,
  moduleCategories: NONE,

  // Generic primitives.
  callService: ANY,
  openSitePage: ANY,
  fetchSitePage: ANY,
  inPage: ANY,
  openForm: ANY,
  formValue: ANY,
  setFields: ANY,
  uploadToDraft: ANY,
  draftFiles: ANY,
  deleteDraftFile: ANY,
  removeFromDraft: ANY,
  submitForm: ANY,
  editCourse: ANY,

  // Parsing and pacing helpers: nothing fetched.
  decodeEntities: NONE,
  readTexts: NONE,
  readMedia: NONE,
  readImages: NONE,
  readingSeconds: NONE,
  pause: NONE,
  checkLocalFiles: NONE,
  fileNameFor: NONE,

  // The person.
  readOwnProfile: OWN,
  readPageConfig: OWN,
  whoAmI: OWN,
  courseAbilities: OWN,
  listCourses: OWN,
  updateCourse: CONTENT,
  // Copies, backups and restores carry the course's content, and its people's data when asked (withUsers).
  copyCourse: ["course-content", "others-personal"],
  backupCourse: ["course-content", "others-personal"],
  restoreCourse: ["course-content", "others-personal"],
  importActivities: CONTENT,
  // A local file: what teachers made, as a backup holds it (with people's data only when it does).
  backupContents: CONTENT,
  // A local file written: a backup without its metadata about people (never with people's data).
  anonymizeBackup: CONTENT,
  // Resetting deletes the course's people's work and enrolments: deciding about others.
  resetCourse: ["course-content", "others-write"],
  myGrades: OWN,
  deadlines: OWN,
  pendingActivities: OWN,
  userById: PERSONAL,
  courseRoles: PERSONAL,

  // Courses and their content. The course's state carries the person's own completion.
  courseState: ["course-content", "own"],
  courseStructure: ["course-content", "own"],
  activityDetails: CONTENT,
  courseActivityTypes: CONTENT,
  listAssignments: CONTENT,
  activityContent: CONTENT,
  bookChapters: CONTENT,
  addBookChapter: CONTENT,
  editBookChapter: CONTENT,
  moveBookChapter: CONTENT,
  setBookChapterVisible: CONTENT,
  deleteBookChapter: CONTENT,
  createActivity: CONTENT,
  activitySettings: CONTENT,
  updateActivity: CONTENT,
  editActivity: CONTENT,
  duplicateActivity: CONTENT,
  deleteActivity: CONTENT,
  addSection: CONTENT,
  editSection: CONTENT,
  deleteSection: CONTENT,
  renameActivity: CONTENT,
  renameSection: CONTENT,
  activitiesOverview: ["course-content", "own", "others-aggregate"],
  courseUpdates: ["course-content", "others-aggregate"],
  // Course files, or others' (a submission's, a post's attachment): a program checks the URL.
  downloadFile: ["course-content", "others-personal"],

  // Assignments.
  // With group submissions, the group's members too.
  studentAssignment: ["course-content", "own"],
  saveSubmission: OWN,
  submitForGrading: OWN,
  assignmentSubmissions: PERSONAL,
  gradeSubmission: ["others-personal", "others-write"],
  rubric: CONTENT,
  setGradingDefinition: CONTENT,
  grantExtension: ["others-write"],
  setWorkflowState: ["others-write"],
  allocateMarker: ["others-write"],

  // Quizzes: a teacher may review someone else's attempt.
  quizInfo: ["course-content", "own"],
  startQuizAttempt: OWN,
  readAttempt: OWN,
  answerQuizQuestions: OWN,
  finishQuizAttempt: OWN,
  readReview: ["own", "others-personal"],
  setQuizOverride: ["others-write"],
  quizResults: PERSONAL,
  questionsToGrade: PERSONAL,
  gradeQuizQuestion: ["others-personal", "others-write"],
  quizStructure: CONTENT,
  addQuestionsToQuiz: CONTENT,
  // A new maximum mark regrades the attempts already made.
  editQuizSlot: ["course-content", "others-write"],
  removeQuizSlot: CONTENT,
  setQuizPages: CONTENT,
  addQuizSection: CONTENT,

  // Forums.
  forumDiscussions: PERSONAL,
  discussion: PERSONAL,
  replyToPost: ["communication"],
  startDiscussion: ["communication"],
  setDiscussionState: ["others-personal", "communication"],
  // The person's own subscription; the discussion it returns names who started it.
  setDiscussionSubscription: ["own", "others-personal"],
  // Editing or deleting one's own posts is communication; a moderator's, someone else's, is writing about others.
  editPost: ["communication", "others-write"],
  deletePost: ["communication", "others-write"],

  // Surveys.
  getSurvey: ["course-content", "own"],
  submitSurvey: OWN,

  // Participants and groups.
  participants: PERSONAL,
  groups: PERSONAL,
  participantFilters: ["course-content"],
  potentialUsers: PERSONAL,
  enrolUsers: ["others-personal", "others-write"],
  unenrolUser: ["others-personal", "others-write"],
  setUserRoles: ["others-personal", "others-write"],
  createGroup: CONTENT,
  updateGroup: CONTENT,
  deleteGroup: CONTENT,
  setGroupMembers: ["others-personal", "others-write"],
  groupings: CONTENT,
  createGrouping: CONTENT,
  deleteGrouping: CONTENT,
  setGroupingGroups: CONTENT,
  enrolmentMethods: CONTENT,
  setEnrolmentMethod: CONTENT,

  // Completion: the person's own, deciding someone else's, everyone's report.
  setCompletion: OWN,
  overrideCompletion: ["others-write"],
  completionReport: PERSONAL,

  // Reports on what people did: the logs and each one's participation; the views per activity identify no one.
  courseLogs: PERSONAL,
  participationReport: PERSONAL,
  activityReport: ["course-content", "others-aggregate"],

  // The gradebook: everyone's grades, and its setup (course content).
  graderReport: PERSONAL,
  gradebookSetup: CONTENT,
  updateGradeItem: CONTENT,
  addGradeCategory: CONTENT,
  addGradeItem: CONTENT,
  updateGradeCategory: CONTENT,
  deleteGradeCategory: CONTENT,
  // Deleting a manual item deletes its grades too.
  deleteGradeItem: ["course-content", "others-write"],
  // Grading in the gradebook: reads the grade it changes.
  setGrade: ["others-personal", "others-write"],
  // Whole-forum grading: everyone's forum grade, and giving one.
  forumGrades: PERSONAL,
  gradeForumUser: ["others-personal", "others-write"],
  // Rating someone's post, entry or record: a judgement of their work.
  rate: ["others-write"],
  // Workshops: everyone's submissions and assessments; switching the phase opens or closes their work; assessing judges it.
  workshopInfo: PERSONAL,
  setWorkshopPhase: ["others-write"],
  assessWorkshopSubmission: ["others-personal", "others-write"],
  // Allocating decides who assesses whose work, and reads who submitted and who reviews.
  workshopAllocation: PERSONAL,
  allocateReviewer: ["others-personal", "others-write"],
  removeReviewer: ["others-personal", "others-write"],
  allocateRandomly: ["others-personal", "others-write"],
  scheduleAllocation: ["others-write"],
  // Everyone's grades, as Moodle exports them.
  exportGrades: PERSONAL,

  // Question banks: what teachers write.
  questionBanks: CONTENT,
  questions: CONTENT,
  importQuestions: CONTENT,
  exportQuestions: CONTENT,
  questionCategories: CONTENT,
  addQuestionCategory: CONTENT,
  editQuestionCategory: CONTENT,
  deleteQuestionCategory: CONTENT,
  moveQuestions: CONTENT,
  createQuestion: CONTENT,
  updateQuestion: CONTENT,
  deleteQuestions: CONTENT,
  setQuestionStatus: CONTENT,

  // Messaging: the person's own notifications; conversations hold others' messages; sending is communication.
  notifications: OWN,
  markNotificationsRead: OWN,
  conversations: PERSONAL,
  conversation: PERSONAL,
  sendMessage: ["communication"],
  messageParticipants: ["communication"],

  // Badges: what teachers set up, and how many have one; enabling awards it to whoever meets its criteria, awarding by hand decides about someone.
  courseBadges: ["course-content", "own", "others-aggregate"],
  createBadge: CONTENT,
  setBadgeCriteria: CONTENT,
  setBadgeEnabled: ["course-content", "others-write"],
  awardBadge: ["others-write"],

  // The calendar: the person's upcoming events; course events are what teachers set.
  upcomingEvents: ["own", "course-content"],
  calendarEvent: ["own", "course-content"],
  createEvent: CONTENT,
  updateEvent: CONTENT,
  deleteEvent: CONTENT,

  // H5P: the content (course content) and the person's own attempts.
  h5pActivity: ["course-content", "own"],
  scorm: ["course-content", "own"],
  openScorm: OWN,

  // Lessons: the person going through one.
  lessonPage: ["course-content", "own"],
  answerLessonPage: OWN,
  // Lessons: their teacher building the pages.
  lessonPages: CONTENT,
  addLessonPage: CONTENT,
  editLessonPage: CONTENT,
  moveLessonPage: CONTENT,
  deleteLessonPage: CONTENT,

  // Databases: their fields, templates and presets, what teachers make.
  databaseFields: CONTENT,
  addDatabaseField: CONTENT,
  editDatabaseField: CONTENT,
  deleteDatabaseField: CONTENT,
  databaseTemplates: CONTENT,
  setDatabaseTemplate: CONTENT,
  databasePresets: CONTENT,
  applyDatabasePreset: CONTENT,

  // Choices: the person's own answer.
  getChoice: ["course-content", "own"],
  answerChoice: OWN,
};

// Modules whose activities hold only what teachers made: nobody else's work or responses.
const CONTENT_MODULES = new Set(["page", "book", "label", "url", "resource", "folder", "imscp", "subsection", "qbank"]);
// Modules that also hold participants' work or responses (forum posts, glossary entries, attempts…).
const PARTICIPANT_MODULES = new Set([
  "assign",
  "quiz",
  "feedback",
  "questionnaire",
  "choice",
  "lesson",
  "h5pactivity",
  "scorm",
  "survey",
  "lti",
  "bigbluebuttonbn",
  "forum",
  "glossary",
  "wiki",
  "data",
  "workshop",
  "chat",
]);

/**
 * The data a teacher reads when reading an activity of `module` with everything in it: course
 * content alone for what teachers make (pages, books, files…), also others' personal data where
 * participants leave work or responses. An unknown module (a plugin) could hold anything: `any`.
 */
export function moduleCategories(module: string): readonly DataCategory[] {
  if (CONTENT_MODULES.has(module)) return CONTENT;
  if (PARTICIPANT_MODULES.has(module)) return ["course-content", "others-personal"];
  return ANY;
}
