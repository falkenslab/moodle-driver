// The object a program works one Moodle site with: the browser, the site and every function that
// takes them, as methods. The functions stay exported on their own; this only binds them.
import type { BrowserContext, Page } from "playwright-core";
import { createBrowserManager, type BrowserManager } from "./browser/manager.js";
import { parseSiteUrl, type BrowserOptions, type Trail } from "./options.js";
import { activitySettings, addSection, createActivity, deleteActivity, deleteSection, duplicateActivity, editActivity, editSection, updateActivity } from "./areas/activities/build.js";
import { callService } from "./core/ajax.js";
import { awardBadge, courseBadges, createBadge, setBadgeCriteria, setBadgeEnabled } from "./areas/badges/badges.js";
import { calendarEvent, createEvent, deleteEvent, updateEvent, upcomingEvents } from "./areas/calendar/calendar.js";
import { answerChoice, choiceResults, getChoice } from "./areas/surveys/choice.js";
import { activityReport, courseLogs, participationReport } from "./areas/reports/reports.js";
import { backupCourse, copyCourse, importActivities, restoreCourse } from "./areas/backup/backup.js";
import { backupContents, type BackupContents } from "./areas/backup/contents.js";
import { anonymizeBackup } from "./areas/backup/anonymous.js";
import { completionReport, overrideCompletion, setCompletion } from "./areas/completion/completion.js";
import { courseCompletionCriteria, courseCompletionStatus, markCourseComplete, setCourseCompletionCriteria } from "./areas/completion/course.js";
import { activityContent, type ActivityContent, type ContentType } from "./areas/activities/content.js";
import { addBookChapter, bookChapters, deleteBookChapter, editBookChapter, moveBookChapter, setBookChapterVisible } from "./areas/activities/books.js";
import { listCourses, updateCourse } from "./areas/courses/list.js";
import { resetCourse } from "./areas/courses/reset.js";
import { downloadFile, type DownloadedFile } from "./core/files.js";
import { openForm } from "./core/forms.js";
import { deletePost, discussion, editPost, forumDiscussions, replyToPost, setDiscussionState, setDiscussionSubscription, startDiscussion } from "./areas/forums/posts.js";
import { addGradeCategory, addGradeItem, deleteGradeCategory, deleteGradeItem, gradebookSetup, graderReport, updateGradeCategory, updateGradeItem } from "./areas/grades/gradebook.js";
import { setGrade } from "./areas/grades/singleview.js";
import { forumGrades, gradeForumUser } from "./areas/forums/grading.js";
import { rate } from "./areas/ratings/ratings.js";
import { assessWorkshopSubmission, setWorkshopPhase, workshopInfo } from "./areas/workshops/workshops.js";
import { allocateRandomly, allocateReviewer, removeReviewer, scheduleAllocation, workshopAllocation } from "./areas/workshops/allocation.js";
import { exportGrades, type ExportGradesOptions } from "./areas/grades/export.js";
import { myGrades } from "./areas/grades/user-report.js";
import { allocateMarker, assignmentSubmissions, gradeSubmission, grantExtension, rubric, setWorkflowState } from "./areas/assignments/grading.js";
import { setGradingDefinition } from "./areas/assignments/definitions.js";
import { h5pActivity } from "./areas/h5p/h5p.js";
import { openScorm, scorm, type OpenedScorm } from "./areas/scorm/scorm.js";
import { answerLessonPage, lessonPage, type LessonPage } from "./areas/lessons/lessons.js";
import { addLessonPage, deleteLessonPage, editLessonPage, lessonPages, moveLessonPage } from "./areas/lessons/pages.js";
import { addDatabaseField, databaseFields, deleteDatabaseField, editDatabaseField } from "./areas/databases/fields.js";
import { applyDatabasePreset, databasePresets, databaseTemplates, setDatabaseTemplate } from "./areas/databases/templates.js";
import { addDatabaseEntry, databaseEntries, deleteDatabaseEntry, editDatabaseEntry, exportDatabaseEntries, importDatabaseEntries, setDatabaseEntryApproved } from "./areas/databases/entries.js";
import { logIn, type LoginResult } from "./core/login.js";
import { conversation, conversations, markNotificationsRead, messageParticipants, notifications, sendMessage } from "./areas/messages/messages.js";
import { activitiesOverview, courseUpdates, deadlines } from "./areas/courses/overview.js";
import { groups, participantFilters, participants } from "./areas/participants/participants.js";
import { createQuestion, deleteQuestions, exportQuestions, importQuestions, questionBanks, questions, setQuestionStatus, updateQuestion } from "./areas/questions/banks.js";
import { addQuestionCategory, deleteQuestionCategory, editQuestionCategory, moveQuestions, questionCategories } from "./areas/questions/categories.js";
import { createGroup, createGrouping, deleteGroup, deleteGrouping, groupings, setGroupMembers, setGroupingGroups, updateGroup } from "./areas/participants/groups.js";
import { enrolmentMethods, setEnrolmentMethod } from "./areas/participants/methods.js";
import { enrolUsers, potentialUsers, setUserRoles, unenrolUser } from "./areas/participants/enrolments.js";
import { answerQuizQuestions, finishQuizAttempt, quizInfo, readAttempt, readReview, setQuizOverride, startQuizAttempt, type Question } from "./areas/quizzes/attempts.js";
import { quizResults } from "./areas/quizzes/results.js";
import { gradeQuizQuestion, questionsToGrade } from "./areas/quizzes/grading.js";
import { addQuestionsToQuiz, addQuizSection, editQuizSlot, quizStructure, removeQuizSlot, setQuizPages } from "./areas/quizzes/structure.js";
import { logOut, openSitePage } from "./core/session.js";
import { courseActivityTypes, publicSiteInfo } from "./areas/site/info.js";
import { courseStructure, listAssignments, pendingActivities } from "./areas/courses/structure.js";
import { saveSubmission, studentAssignment, submitForGrading } from "./areas/assignments/student.js";
import { getSurvey, submitSurvey } from "./areas/surveys/surveys.js";
import { surveyResults } from "./areas/surveys/results.js";
import { courseAbilities, courseRoles, siteName, userById, whoAmI } from "./areas/site/users.js";
import { MoodleError } from "./core/errors.js";
import type { MoodleMethods } from "./moodle-methods.generated.js";

/**
 * The functions that take the browser context and the site first, of the high-level API: each becomes
 * a method of the same name without those two parameters. The pieces they're built from (an
 * assignment's ids, its grading panel, a quiz attempt's steps…) stay functions only; the ones that
 * use the object's defaults (`trail`, `downloadDir`…) and `callService`, generic, are bound by hand.
 */
const SITE_FUNCTIONS = {
  courseBadges,
  createBadge,
  setBadgeCriteria,
  setBadgeEnabled,
  awardBadge,
  activitiesOverview,
  addDatabaseEntry,
  addDatabaseField,
  applyDatabasePreset,
  databaseEntries,
  databaseFields,
  databasePresets,
  databaseTemplates,
  deleteDatabaseEntry,
  deleteDatabaseField,
  editDatabaseEntry,
  editDatabaseField,
  setDatabaseEntryApproved,
  setDatabaseTemplate,
  activityReport,
  activitySettings,
  addGradeCategory,
  addGradeItem,
  allocateMarker,
  addQuestionsToQuiz,
  addQuizSection,
  addSection,
  answerChoice,
  addBookChapter,
  backupCourse,
  bookChapters,
  assignmentSubmissions,
  calendarEvent,
  choiceResults,
  completionReport,
  copyCourse,
  conversation,
  conversations,
  courseAbilities,
  courseActivityTypes,
  courseCompletionCriteria,
  courseCompletionStatus,
  courseLogs,
  courseRoles,
  courseStructure,
  courseUpdates,
  createActivity,
  createEvent,
  createQuestion,
  deadlines,
  deleteActivity,
  deleteBookChapter,
  deleteEvent,
  deleteQuestions,
  deleteGradeCategory,
  deleteGradeItem,
  deletePost,
  deleteSection,
  discussion,
  duplicateActivity,
  editActivity,
  editBookChapter,
  editQuizSlot,
  editPost,
  editSection,
  finishQuizAttempt,
  forumDiscussions,
  forumGrades,
  getChoice,
  getSurvey,
  gradeQuizQuestion,
  gradeForumUser,
  gradeSubmission,
  gradebookSetup,
  graderReport,
  grantExtension,
  groups,
  h5pActivity,
  exportDatabaseEntries,
  importActivities,
  importDatabaseEntries,
  scorm,
  importQuestions,
  exportQuestions,
  questionCategories,
  addQuestionCategory,
  editQuestionCategory,
  deleteQuestionCategory,
  moveQuestions,
  lessonPage,
  lessonPages,
  addLessonPage,
  editLessonPage,
  moveLessonPage,
  deleteLessonPage,
  listAssignments,
  listCourses,
  logOut,
  markCourseComplete,
  markNotificationsRead,
  moveBookChapter,
  myGrades,
  notifications,
  openForm,
  openSitePage,
  overrideCompletion,
  participantFilters,
  participants,
  potentialUsers,
  enrolUsers,
  unenrolUser,
  setUserRoles,
  createGroup,
  updateGroup,
  deleteGroup,
  setGroupMembers,
  groupings,
  createGrouping,
  deleteGrouping,
  setGroupingGroups,
  enrolmentMethods,
  setEnrolmentMethod,
  participationReport,
  pendingActivities,
  questionBanks,
  questions,
  questionsToGrade,
  quizInfo,
  quizResults,
  quizStructure,
  rate,
  workshopInfo,
  setWorkshopPhase,
  assessWorkshopSubmission,
  workshopAllocation,
  allocateReviewer,
  removeReviewer,
  allocateRandomly,
  scheduleAllocation,
  readAttempt,
  readReview,
  removeQuizSlot,
  replyToPost,
  resetCourse,
  restoreCourse,
  rubric,
  saveSubmission,
  sendMessage,
  messageParticipants,
  setBookChapterVisible,
  setCompletion,
  setCourseCompletionCriteria,
  setDiscussionState,
  setDiscussionSubscription,
  setGrade,
  setGradingDefinition,
  setQuizOverride,
  setQuizPages,
  setQuestionStatus,
  setWorkflowState,
  siteName,
  startDiscussion,
  startQuizAttempt,
  studentAssignment,
  submitForGrading,
  submitSurvey,
  surveyResults,
  upcomingEvents,
  updateActivity,
  updateCourse,
  updateGradeCategory,
  updateEvent,
  updateGradeItem,
  updateQuestion,
  userById,
  whoAmI,
};

type SiteFunctions = typeof SITE_FUNCTIONS;

/** A function of `(context, siteUrl, ...rest)` as a method of `(...rest)`. */
type Bound<F> = F extends (context: BrowserContext, siteUrl: string, ...rest: infer A) => infer R ? (...rest: A) => R : never;

/** The site functions as methods: what `MoodleMethods`, written out by the generator, must be. */
type BoundMethods = { [K in keyof SiteFunctions]: Bound<SiteFunctions[K]> };

// src/moodle-methods.generated.ts writes each method out with its function's doc comment (for the API
// reference and editors); this fails the build when it no longer matches the functions: the same
// methods, each one usable as its function bound. (One way only: an overloaded function, like
// submitSurvey, is written with all its signatures, where the bound one keeps only the last.)
type Matches<A, B> = [keyof A] extends [keyof B] ? ([keyof B] extends [keyof A] ? ([A] extends [B] ? true : false) : false) : false;
export type { MoodleMethods };
const methodsMatch: Matches<MoodleMethods, BoundMethods> = true;
void methodsMatch;

// Functions bound by hand, with the object's defaults: methods of the same name all the same.
const DEFAULTED = ["activityContent", "answerQuizQuestions", "answerLessonPage", "downloadFile", "exportGrades"] as const;

/** The names of the methods a `Moodle` has from the driver's functions, one per function of that name. */
export const MOODLE_METHODS: readonly string[] = [...Object.keys(SITE_FUNCTIONS), ...DEFAULTED];

/** What the object does when a call doesn't say: every one can still be given per call. */
export interface MoodleDefaults {
  /** How student actions read and answer: "realistic" (the default, at a reader's pace) or "fast" (ADR-005). */
  trail?: Trail;
  /** Called every few seconds while a student action waits at a reader's pace: the seconds elapsed, and the total when known. */
  onProgress?: (elapsedSeconds: number, totalSeconds?: number) => void;
  /** How long `logIn` waits for the person to log in, in milliseconds: five minutes unless given. */
  loginTimeoutMs?: number;
  /** Where `downloadFile` and `exportGrades` save files when not given a folder (an absolute path). */
  downloadDir?: string;
}

/** A student action's pace for one call, over the object's defaults. */
type PaceOptions<P> = { trail?: Trail; onProgress?: P };

/**
 * One Moodle site worked through one browser: the driver's operations as methods, without the
 * browser context and the site the functions take first (`moodle.listCourses()` is
 * `listCourses(context, site)`), plus the session and the browser. The pieces the operations are
 * built from stay functions only.
 */
export interface Moodle extends MoodleMethods {
  /** The site's base URL, normalized (a trailing slash). */
  readonly site: string;
  /** The browser manager underneath, for what the methods don't cover. */
  readonly browser: BrowserManager;
  /** The defaults the object was made with. */
  readonly defaults: Readonly<MoodleDefaults>;
  /** The browser's context, launching it if needed: what the functions take. */
  context(): Promise<BrowserContext>;
  /** Makes sure there's a session: at once if there is one, else a window where the person logs in (`loginTimeoutMs` by default). */
  logIn(options?: { timeoutMs?: number; onWait?: (elapsedMs: number) => void }): Promise<LoginResult>;
  /** What the site tells anyone before logging in, without the browser. */
  publicSiteInfo(): ReturnType<typeof publicSiteInfo>;
  /** What a backup file (`.mbz`) holds and what its activities refer to outside it, read on this computer without the browser or a session (`backupContents`). */
  backupContents(file: string): Promise<BackupContents>;
  /** A copy of a backup file that names no one and no site, written on this computer without the browser or a session (`anonymizeBackup`). */
  anonymizeBackup(file: string, destFile: string): ReturnType<typeof anonymizeBackup>;
  /** Calls one of Moodle's AJAX services as the logged-in person. */
  callService<T>(methodname: string, args: Record<string, unknown>): Promise<T>;
  /** `activityContent`, at the object's `trail` unless given. */
  activityContent(activity: { id: number; type: string }, options?: PaceOptions<(secondsRead: number) => void>): Promise<ActivityContent>;
  activityContent(activityId: number, type: ContentType, options?: PaceOptions<(secondsRead: number) => void>): Promise<ActivityContent>;
  /** `answerQuizQuestions`, at the object's `trail` unless given. */
  answerQuizQuestions(attemptId: number, answers: Parameters<typeof answerQuizQuestions>[3], options?: PaceOptions<(elapsed: number, total: number) => void>): Promise<{ changed: string; attemptId: number; questions: Question[] }>;
  /** `answerLessonPage`, at the object's `trail` unless given. */
  answerLessonPage(activityId: number, answer: Parameters<typeof answerLessonPage>[3], options?: PaceOptions<(elapsed: number, total: number) => void>): Promise<{ changed: string; feedback?: LessonPage; page: LessonPage }>;
  /** `downloadFile`, into the object's `downloadDir` unless given a folder. */
  downloadFile(url: string, destDir?: string): Promise<DownloadedFile>;
  /** `exportGrades`, into the object's `downloadDir` unless given a folder. */
  exportGrades(courseId: number, options: ExportGradesOptions): Promise<DownloadedFile>;
  /** The working tab a program drives itself (ADR-007). */
  tab(): Promise<Page>;
  /** `openScorm`: a SCORM's player, on the working tab. */
  openScorm(activityId: number, options?: { scoId?: number; newAttempt?: boolean }): Promise<OpenedScorm>;
  /** Whether the browser shows a window now. */
  visible(): boolean;
  /** Shows the browser and follows the pages methods open, or hides it. */
  setVisible(visible: boolean): Promise<void>;
  /** Saves the session cookies of the open browser now. */
  saveSession(): Promise<void>;
  /** Saves the session and closes the browser; the next call opens it again. */
  close(): Promise<void>;
  /** `close()`, so `await using moodle = createMoodle(…)` closes the browser when the block ends. */
  [Symbol.asyncDispose](): Promise<void>;
}

/** A site, the browser to work it with (its options for a new browser manager, or one already made), and the object's defaults. */
export type MoodleOptions = MoodleDefaults & (({ site: string } & BrowserOptions) | { site: string; browser: BrowserManager });


/**
 * Works one Moodle site through a browser: give the site and the browser's options (or a browser
 * manager), and optionally the defaults its calls use; then call the driver's operations as methods.
 *
 * ```ts
 * const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/me/.moodle-profile", headless: true, downloadBrowser: true, trail: "fast" });
 * await moodle.logIn();
 * const courses = await moodle.listCourses();
 * await moodle.close();
 * ```
 */
export function createMoodle(options: MoodleOptions): Moodle {
  const site = parseSiteUrl(options.site);
  const browser = "browser" in options ? options.browser : createBrowserManager(options);
  const defaults: MoodleDefaults = { trail: options.trail, onProgress: options.onProgress, loginTimeoutMs: options.loginTimeoutMs, downloadDir: options.downloadDir };
  const bound: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(SITE_FUNCTIONS)) {
    const call = fn as (context: BrowserContext, siteUrl: string, ...rest: unknown[]) => Promise<unknown>;
    bound[name] = async (...args: unknown[]) => call(await browser.context(), site, ...args);
  }
  // Only what's set: an undefined option would hide the function's own default.
  const pace = <P>(given: PaceOptions<P> = {}, progress?: P) => ({
    ...(given.trail ?? defaults.trail ? { trail: given.trail ?? defaults.trail } : {}),
    ...(given.onProgress ?? progress ? { onProgress: given.onProgress ?? progress } : {}),
  });
  const onProgress = defaults.onProgress;
  return {
    ...(bound as unknown as MoodleMethods),
    site,
    browser,
    defaults,
    context: () => browser.context(),
    logIn: (loginOptions = {}) => logIn(browser, site, { ...loginOptions, timeoutMs: loginOptions.timeoutMs ?? defaults.loginTimeoutMs }),
    publicSiteInfo: () => publicSiteInfo(site),
    backupContents: (file) => backupContents(file),
    anonymizeBackup: (file, destFile) => anonymizeBackup(file, destFile),
    callService: async <T>(methodname: string, args: Record<string, unknown>) => callService<T>(await browser.context(), site, methodname, args),
    activityContent: async (
      activityOrId: { id: number; type: string } | number,
      typeOrOptions?: ContentType | PaceOptions<(secondsRead: number) => void>,
      given?: PaceOptions<(secondsRead: number) => void>,
    ) => {
      const context = await browser.context();
      const progress = onProgress && ((read: number) => onProgress(read));
      if (typeof activityOrId === "number") return activityContent(context, site, activityOrId, typeOrOptions as ContentType, pace(given, progress));
      return activityContent(context, site, activityOrId, pace(typeOrOptions as PaceOptions<(secondsRead: number) => void> | undefined, progress));
    },
    answerQuizQuestions: async (attemptId, answers, given) => answerQuizQuestions(await browser.context(), site, attemptId, answers, pace(given, onProgress)),
    answerLessonPage: async (activityId, answer, given) => answerLessonPage(await browser.context(), site, activityId, answer, pace(given, onProgress)),
    downloadFile: async (url, destDir) => {
      const folder = destDir ?? defaults.downloadDir;
      if (!folder) throw new MoodleError("Give downloadFile a folder, or createMoodle a downloadDir.", "invalid-input");
      return downloadFile(await browser.context(), site, url, folder);
    },
    exportGrades: async (courseId, exportOptions) => {
      const folder = exportOptions.destDir ?? defaults.downloadDir;
      if (!folder) throw new MoodleError("Give exportGrades a destDir, or createMoodle a downloadDir.", "invalid-input");
      return exportGrades(await browser.context(), site, courseId, { ...exportOptions, destDir: folder });
    },
    tab: () => browser.tab(),
    openScorm: (activityId, scormOptions) => openScorm(browser, site, activityId, scormOptions),
    visible: () => browser.visible(),
    setVisible: (visible) => browser.setVisible(visible),
    saveSession: () => browser.saveSession(),
    close: () => browser.close(),
    [Symbol.asyncDispose]: () => browser.close(),
  };
}
