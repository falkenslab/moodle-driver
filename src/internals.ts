/**
 * The primitives the operations are built from, imported from `@falkenslab/moodle-driver/internals`,
 * for a program that goes lower level than them: a service the driver doesn't wrap, a form of its
 * own, a page read by hand. Stable as the main entry is, but closer to Moodle: they take pages and
 * form field names.
 *
 * @packageDocumentation
 */
export { callService, readPageConfig, type PageConfig } from "./core/ajax.js";
export { openSitePage, fetchSitePage, readSessionFacts, htmlSessionFacts, readMoodleConfig, isLoggedIn, pageIsLoggedIn, moodleErrorMessage, type SessionFacts } from "./core/session.js";
export { readOwnProfile } from "./core/login.js";
export { openForm, formValue, setFields, submitForm, uploadToDraft, draftFiles, deleteDraftFile, removeFromDraft, dateSelectorValues, dateSelectorDate, type DraftUpload, type DraftFile } from "./core/forms.js";
export { inPage } from "./core/inPage.js";
export { decodeEntities, readTexts, readMedia, readImages } from "./core/text.js";
export { readingSeconds, pause } from "./core/pace.js";
export { editCourse, renameActivity, renameSection, type EditorAction } from "./core/editor.js";
export { readWwwroot } from "./core/site.js";
export { fileNameFor } from "./core/files.js";
export { courseState, activityDetails, type CourseState, type ActivityDetails } from "./areas/courses/state.js";
