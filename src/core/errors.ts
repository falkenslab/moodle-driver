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
  | "background-browser"
  | "browser-busy"
  // One per error class.
  | "moodle-url"
  | "browser-not-found"
  | "browser-downloading"
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
  | "competencies-disabled";

/** Every error the driver throws on purpose: one class to catch, a stable `code` to tell them apart. */
export class MoodleError extends Error {
  override name = "MoodleError";
  readonly code: MoodleErrorCode;
  constructor(message: string, code: MoodleErrorCode) {
    super(message);
    this.code = code;
  }
}
