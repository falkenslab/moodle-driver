// The object a program works one Moodle site with: the browser, the site and every function that
// takes them, as methods. The functions stay exported on their own; this only binds them.
import type { BrowserContext, Page } from "playwright-core";
import { createBrowserManager, type BrowserManager } from "./browser/manager.js";
import { parseSiteUrl, type BrowserOptions, type Trail } from "./options.js";
import { activitySettings, addSection, createActivity, deleteActivity, deleteSection, duplicateActivity, editActivity, editSection, updateActivity } from "./areas/activities/build.js";
import { callService } from "./core/ajax.js";
import { createEvent, deleteEvent, upcomingEvents } from "./areas/calendar/calendar.js";
import { answerChoice, getChoice } from "./areas/surveys/choice.js";
import { completionReport, overrideCompletion, setCompletion } from "./areas/completion/completion.js";
import { activityContent, type ActivityContent, type ContentType } from "./areas/activities/content.js";
import { listCourses, updateCourse } from "./areas/courses/list.js";
import { downloadFile, type DownloadedFile } from "./core/files.js";
import { openForm } from "./core/forms.js";
import { discussion, forumDiscussions, replyToPost, setDiscussionState, startDiscussion } from "./areas/forums/posts.js";
import { addGradeCategory, gradebookSetup, graderReport, updateGradeItem } from "./areas/grades/gradebook.js";
import { myGrades } from "./areas/grades/user-report.js";
import { assignmentSubmissions, gradeSubmission, grantExtension, rubric } from "./areas/assignments/grading.js";
import { h5pActivity } from "./areas/h5p/h5p.js";
import { answerLessonPage, lessonPage, type LessonPage } from "./areas/lessons/lessons.js";
import { logIn, type LoginResult } from "./core/login.js";
import { conversation, conversations, markNotificationsRead, notifications, sendMessage } from "./areas/messages/messages.js";
import { activitiesOverview, courseUpdates, deadlines } from "./areas/courses/overview.js";
import { groups, participantFilters, participants } from "./areas/participants/participants.js";
import { createQuestion, importQuestions, questionBanks, questions } from "./areas/questions/banks.js";
import { answerQuizQuestions, finishQuizAttempt, quizInfo, readReview, setQuizOverride, startQuizAttempt, type Question } from "./areas/quizzes/attempts.js";
import { quizResults } from "./areas/quizzes/results.js";
import { addQuestionsToQuiz, quizStructure } from "./areas/quizzes/structure.js";
import { logOut, openSitePage } from "./core/session.js";
import { courseActivityTypes, publicSiteInfo } from "./areas/site/info.js";
import { courseStructure, listAssignments, pendingActivities } from "./areas/courses/structure.js";
import { saveSubmission, studentAssignment, submitForGrading } from "./areas/assignments/student.js";
import { getSurvey, submitSurvey } from "./areas/surveys/surveys.js";
import { courseAbilities, courseRoles, siteName, userById, whoAmI } from "./areas/site/users.js";

/**
 * The functions that take the browser context and the site first, of the high-level API: each becomes
 * a method of the same name without those two parameters. The pieces they're built from (an
 * assignment's ids, its grading panel, a quiz attempt's steps…) stay functions only; the ones that
 * use the object's defaults (`trail`, `downloadDir`…) and `callService`, generic, are bound by hand.
 */
const SITE_FUNCTIONS = {
  activitiesOverview,
  activitySettings,
  addGradeCategory,
  addQuestionsToQuiz,
  addSection,
  answerChoice,
  assignmentSubmissions,
  completionReport,
  conversation,
  conversations,
  courseAbilities,
  courseActivityTypes,
  courseRoles,
  courseStructure,
  courseUpdates,
  createActivity,
  createEvent,
  createQuestion,
  deadlines,
  deleteActivity,
  deleteEvent,
  deleteSection,
  discussion,
  duplicateActivity,
  editActivity,
  editSection,
  finishQuizAttempt,
  forumDiscussions,
  getChoice,
  getSurvey,
  gradeSubmission,
  gradebookSetup,
  graderReport,
  grantExtension,
  groups,
  h5pActivity,
  importQuestions,
  lessonPage,
  listAssignments,
  listCourses,
  logOut,
  markNotificationsRead,
  myGrades,
  notifications,
  openForm,
  openSitePage,
  overrideCompletion,
  participantFilters,
  participants,
  pendingActivities,
  questionBanks,
  questions,
  quizInfo,
  quizResults,
  quizStructure,
  readReview,
  replyToPost,
  rubric,
  saveSubmission,
  sendMessage,
  setCompletion,
  setDiscussionState,
  setQuizOverride,
  siteName,
  startDiscussion,
  startQuizAttempt,
  studentAssignment,
  submitForGrading,
  submitSurvey,
  upcomingEvents,
  updateActivity,
  updateCourse,
  updateGradeItem,
  userById,
  whoAmI,
};

type SiteFunctions = typeof SITE_FUNCTIONS;

/** A function of `(context, siteUrl, ...rest)` as a method of `(...rest)`. */
type Bound<F> = F extends (context: BrowserContext, siteUrl: string, ...rest: infer A) => infer R ? (...rest: A) => R : never;

/** The methods bound from the site functions, each named and documented as its function. */
export type MoodleMethods = { [K in keyof SiteFunctions]: Bound<SiteFunctions[K]> };

// Functions bound by hand, with the object's defaults: methods of the same name all the same.
const DEFAULTED = ["activityContent", "answerQuizQuestions", "answerLessonPage", "downloadFile"] as const;

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
  /** Where `downloadFile` saves files when not given a folder (an absolute path). */
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
  /** Calls one of Moodle's AJAX services as the logged-in person. */
  callService<T>(methodname: string, args: Record<string, unknown>): Promise<T>;
  /** `activityContent`, at the object's `trail` unless given. */
  activityContent(cmid: number, type: ContentType, options?: PaceOptions<(secondsRead: number) => void>): Promise<ActivityContent>;
  /** `answerQuizQuestions`, at the object's `trail` unless given. */
  answerQuizQuestions(attemptId: number, answers: Parameters<typeof answerQuizQuestions>[3], options?: PaceOptions<(elapsed: number, total: number) => void>): Promise<{ attemptId: number; questions: Question[] }>;
  /** `answerLessonPage`, at the object's `trail` unless given. */
  answerLessonPage(cmid: number, answer: Parameters<typeof answerLessonPage>[3], options?: PaceOptions<(elapsed: number, total: number) => void>): Promise<{ feedback?: LessonPage; page: LessonPage }>;
  /** `downloadFile`, into the object's `downloadDir` unless given a folder. */
  downloadFile(url: string, destDir?: string): Promise<DownloadedFile>;
  /** The working tab a program drives itself (ADR-007). */
  tab(): Promise<Page>;
  /** Whether the browser shows a window now. */
  visible(): boolean;
  /** Shows the browser and follows the pages methods open, or hides it. */
  setVisible(visible: boolean): Promise<void>;
  /** Saves the session cookies of the open browser now. */
  saveSession(): Promise<void>;
  /** Saves the session and closes the browser; the next call opens it again. */
  close(): Promise<void>;
}

/** A site, the browser to work it with (its options for a new browser manager, or one already made), and the object's defaults. */
export type MoodleOptions = MoodleDefaults & (({ site: string } & BrowserOptions) | { site: string; browser: BrowserManager });

const LOGIN_TIMEOUT_MS = 5 * 60_000;

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
    logIn: (loginOptions = {}) => logIn(browser, site, { ...loginOptions, timeoutMs: loginOptions.timeoutMs ?? defaults.loginTimeoutMs ?? LOGIN_TIMEOUT_MS }),
    publicSiteInfo: () => publicSiteInfo(site),
    callService: async <T>(methodname: string, args: Record<string, unknown>) => callService<T>(await browser.context(), site, methodname, args),
    activityContent: async (cmid, type, given) => activityContent(await browser.context(), site, cmid, type, pace(given, onProgress && ((read: number) => onProgress(read)))),
    answerQuizQuestions: async (attemptId, answers, given) => answerQuizQuestions(await browser.context(), site, attemptId, answers, pace(given, onProgress)),
    answerLessonPage: async (cmid, answer, given) => answerLessonPage(await browser.context(), site, cmid, answer, pace(given, onProgress)),
    downloadFile: async (url, destDir) => {
      const folder = destDir ?? defaults.downloadDir;
      if (!folder) throw new Error("Give downloadFile a folder, or createMoodle a downloadDir.");
      return downloadFile(await browser.context(), site, url, folder);
    },
    tab: () => browser.tab(),
    visible: () => browser.visible(),
    setVisible: (visible) => browser.setVisible(visible),
    saveSession: () => browser.saveSession(),
    close: () => browser.close(),
  };
}
