// The object a program works one Moodle site with: the browser, the site and every function that
// takes them, as methods. The functions stay exported on their own; this only binds them.
import type { BrowserContext, Page } from "playwright-core";
import { createBrowserManager, type BrowserManager } from "./browser.js";
import { parseSiteUrl, type BrowserOptions } from "./options.js";
import { activitySettings, addSection, createActivity, deleteActivity, deleteSection, duplicateActivity, editActivity, editSection, updateActivity } from "./moodle/activities.js";
import { callService, readPageConfig } from "./moodle/ajax.js";
import { assignmentIds, gradingPanelHtml, listParticipants, participantDates, submitGradingForm } from "./moodle/assign.js";
import { createEvent, deleteEvent, upcomingEvents } from "./moodle/calendar.js";
import { answerChoice, getChoice } from "./moodle/choice.js";
import { completionReport, overrideCompletion, setCompletion } from "./moodle/completion.js";
import { activityContent } from "./moodle/content.js";
import { activityDetails, courseState } from "./moodle/course.js";
import { listCourses, updateCourse } from "./moodle/courses.js";
import { courseFormat, editCourse, renameActivity, renameSection } from "./moodle/editor.js";
import { downloadFile } from "./moodle/files.js";
import { openForm } from "./moodle/forms.js";
import { discussionPosts, forumInstanceId, listDiscussions } from "./moodle/forum.js";
import { discussion, forumDiscussions, replyToPost, setDiscussionState, startDiscussion } from "./moodle/forumPosts.js";
import { addGradeCategory, gradebookSetup, graderReport, updateGradeItem } from "./moodle/gradebook.js";
import { myGrades } from "./moodle/grades.js";
import { assignmentSubmissions, gradeSubmission, grantExtension, rubric } from "./moodle/grading.js";
import { h5pActivity } from "./moodle/h5p.js";
import { answerLessonPage, lessonPage } from "./moodle/lesson.js";
import { logIn, readOwnProfile, type LoginResult } from "./moodle/login.js";
import { conversation, conversations, markNotificationsRead, notifications, sendMessage } from "./moodle/messages.js";
import { activitiesOverview, courseUpdates, deadlines } from "./moodle/overview.js";
import { groups, participantFilters, participants } from "./moodle/participants.js";
import { createQuestion, importQuestions, questionBanks, questions } from "./moodle/questionBank.js";
import { answerQuizQuestions, finishAttempt, finishQuizAttempt, quizInfo, readAttempt, readReview, saveAnswers, setQuizOverride, startAttempt, startQuizAttempt } from "./moodle/quiz.js";
import { quizResults } from "./moodle/quizResults.js";
import { addQuestionsToQuiz, quizStructure } from "./moodle/quizStructure.js";
import { logOut, openSitePage } from "./moodle/session.js";
import { courseActivityTypes, publicSiteInfo } from "./moodle/siteInfo.js";
import { courseStructure, listAssignments, pendingActivities } from "./moodle/structure.js";
import { saveSubmission, studentAssignment, submitForGrading } from "./moodle/submission.js";
import { getSurvey, submitSurvey } from "./moodle/survey.js";
import { courseAbilities, courseRoles, siteName, userById, whoAmI } from "./moodle/user.js";

/**
 * Every function that takes the browser context and the site first: each becomes a method of the
 * same name without those two parameters. `callService`, generic, is bound by hand.
 */
const SITE_FUNCTIONS = {
  activitiesOverview,
  activityContent,
  activityDetails,
  activitySettings,
  addGradeCategory,
  addQuestionsToQuiz,
  addSection,
  answerChoice,
  answerLessonPage,
  answerQuizQuestions,
  assignmentIds,
  assignmentSubmissions,
  completionReport,
  conversation,
  conversations,
  courseAbilities,
  courseActivityTypes,
  courseFormat,
  courseRoles,
  courseState,
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
  discussionPosts,
  downloadFile,
  duplicateActivity,
  editActivity,
  editCourse,
  editSection,
  finishAttempt,
  finishQuizAttempt,
  forumDiscussions,
  forumInstanceId,
  getChoice,
  getSurvey,
  gradeSubmission,
  gradebookSetup,
  graderReport,
  gradingPanelHtml,
  grantExtension,
  groups,
  h5pActivity,
  importQuestions,
  lessonPage,
  listAssignments,
  listCourses,
  listDiscussions,
  listParticipants,
  logOut,
  markNotificationsRead,
  myGrades,
  notifications,
  openForm,
  openSitePage,
  overrideCompletion,
  participantDates,
  participantFilters,
  participants,
  pendingActivities,
  questionBanks,
  questions,
  quizInfo,
  quizResults,
  quizStructure,
  readAttempt,
  readOwnProfile,
  readPageConfig,
  readReview,
  renameActivity,
  renameSection,
  replyToPost,
  rubric,
  saveAnswers,
  saveSubmission,
  sendMessage,
  setCompletion,
  setDiscussionState,
  setQuizOverride,
  siteName,
  startAttempt,
  startDiscussion,
  startQuizAttempt,
  studentAssignment,
  submitForGrading,
  submitGradingForm,
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

/** The names of the methods a `Moodle` has from the site functions, one per function of that name. */
export const MOODLE_METHODS = Object.keys(SITE_FUNCTIONS) as (keyof SiteFunctions)[];

/**
 * One Moodle site worked through one browser: every function of the driver that takes the browser
 * context and the site, as a method without them (`moodle.listCourses()` is
 * `listCourses(context, site)`), plus the session and the browser.
 */
export interface Moodle extends MoodleMethods {
  /** The site's base URL, normalized (a trailing slash). */
  readonly site: string;
  /** The browser manager underneath, for what the methods don't cover. */
  readonly browser: BrowserManager;
  /** The browser's context, launching it if needed: what the functions take. */
  context(): Promise<BrowserContext>;
  /** Makes sure there's a session: at once if there is one, else a window where the person logs in. */
  logIn(options: { timeoutMs: number; onWait?: (elapsedMs: number) => void }): Promise<LoginResult>;
  /** What the site tells anyone before logging in, without the browser. */
  publicSiteInfo(): ReturnType<typeof publicSiteInfo>;
  /** Calls one of Moodle's AJAX services as the logged-in person. */
  callService<T>(methodname: string, args: Record<string, unknown>): Promise<T>;
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

/** A site and the browser to work it with: its options (a new browser manager), or one already made. */
export type MoodleOptions = ({ site: string } & BrowserOptions) | { site: string; browser: BrowserManager };

/**
 * Works one Moodle site through a browser: give the site and the browser's options (or a browser
 * manager), then call the driver's functions as methods.
 *
 * ```ts
 * const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/me/.moodle-profile", headless: true, downloadBrowser: true });
 * await moodle.logIn({ timeoutMs: 300_000 });
 * const courses = await moodle.listCourses();
 * await moodle.close();
 * ```
 */
export function createMoodle(options: MoodleOptions): Moodle {
  const site = parseSiteUrl(options.site);
  const browser = "browser" in options ? options.browser : createBrowserManager(options);
  const bound: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  for (const [name, fn] of Object.entries(SITE_FUNCTIONS)) {
    const call = fn as (context: BrowserContext, siteUrl: string, ...rest: unknown[]) => Promise<unknown>;
    bound[name] = async (...args: unknown[]) => call(await browser.context(), site, ...args);
  }
  return {
    ...(bound as unknown as MoodleMethods),
    site,
    browser,
    context: () => browser.context(),
    logIn: (loginOptions) => logIn(browser, site, loginOptions),
    publicSiteInfo: () => publicSiteInfo(site),
    callService: async <T>(methodname: string, args: Record<string, unknown>) => callService<T>(await browser.context(), site, methodname, args),
    tab: () => browser.tab(),
    visible: () => browser.visible(),
    setVisible: (visible) => browser.setVisible(visible),
    saveSession: () => browser.saveSession(),
    close: () => browser.close(),
  };
}
