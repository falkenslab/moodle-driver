/**
 * What went wrong, stable across releases: match errors by `code` (or by class), never by message,
 * whose wording may change. Each error class has its own code; `MoodleError` itself takes one
 * of the generic ones.
 */
export type MoodleErrorCode =
  // Generic, for errors with no class of their own.
  | "invalid-input"
  | "not-found"
  | "not-available"
  | "outside-site"
  | "unexpected-page"
  | "logout-failed"
  | "chromium-install-failed"
  | "firefox-install-failed"
  | "background-browser"
  | "browser-busy"
  // One per error class.
  | "moodle-url"
  | "browser-not-found"
  | "browser-downloading"
  | "browser-lost"
  | "profile-path-too-long"
  | "no-display"
  | "not-logged-in"
  | "login-timeout"
  | "login-window-closed"
  | "moodle-service"
  | "form"
  | "activity-settings"
  | "backup"
  | "not-viewable"
  | "book"
  | "not-an-assignment"
  | "grading"
  | "submission"
  | "calendar"
  | "completion"
  | "course"
  | "block"
  | "not-a-forum"
  | "forum"
  | "gradebook"
  | "no-grade-report"
  | "not-an-h5p-activity"
  | "content-bank"
  | "scorm"
  | "bigbluebutton"
  | "bigbluebutton-server"
  | "workshop"
  | "lesson"
  | "message"
  | "no-participants"
  | "enrolment"
  | "question-bank"
  | "report"
  | "quiz"
  | "choice"
  | "survey"
  | "not-a-database"
  | "database"
  | "not-a-glossary"
  | "glossary"
  | "not-a-wiki"
  | "wiki"
  | "wiki-page-locked"
  | "badge"
  | "badges-disabled"
  | "note"
  | "notes-disabled"
  | "external-tool"
  | "competency"
  | "competencies-disabled"
  | "not-an-attendance"
  | "attendance";

/** Every error the driver throws on purpose: one class to catch, a stable `code` to tell them apart. */
export class MoodleError extends Error {
  override name = "MoodleError";
  readonly code: MoodleErrorCode;
  constructor(message: string, code: MoodleErrorCode) {
    super(message);
    this.code = code;
  }
}

/**
 * The browser closed or crashed during a call, or one of its tabs crashed: the person closed the window,
 * or the browser died. The call didn't finish, and what it was sending may or may not have reached
 * Moodle, so a change has to be checked before it's repeated. The next call opens the browser again.
 */
export class BrowserLostError extends MoodleError {
  override name = "BrowserLostError";
  constructor() {
    super("The browser closed or crashed during this call, so it didn't finish. Moodle may or may not have received a change it was making: check before repeating it.", "browser-lost");
  }
}

// Playwright's words for it, the only stable mark: its classes aren't exported, and the errors' `name`
// is plain "Error" (confirmed empirically, playwright-core 1.65, Chromium and Firefox, the process
// killed and the context closed, during a call and after it).
const LOST_BROWSER = /Target page, context or browser has been closed|Request context disposed|Target crashed|Page crashed/;

/**
 * Whether `error` says the browser, or the tab a call worked in, is gone. A browser that couldn't
 * start isn't one: Playwright says the same of a launch, which never had a call to lose.
 */
export function isBrowserLost(error: unknown): boolean {
  if (error instanceof BrowserLostError) return true;
  return error instanceof Error && LOST_BROWSER.test(error.message) && !error.message.startsWith("browserType.");
}
