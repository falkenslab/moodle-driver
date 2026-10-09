// Helpers for testing programs that use the driver without a real Moodle: a fake site served inside
// a browser context, made-up grading panel HTML, and a browser manager that launches nothing.
// Published as "@falkenslab/moodle-driver/testing".
import type { BrowserManager } from "../browser.js";

export { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "./fakeMoodle.js";
export { PANEL } from "./gradingPanel.js";

/** A browser manager that never launches anything, with these methods instead. */
export function fakeBrowserManager(overrides: Partial<BrowserManager> = {}): BrowserManager {
  return {
    context: () => Promise.reject(new Error("this test opens no browser")),
    openChannel: () => undefined,
    chromiumDownload: () => undefined,
    visible: () => false,
    setVisible: async () => undefined,
    show: async () => undefined,
    tab: () => Promise.reject(new Error("this test opens no browser")),
    saveSession: async () => undefined,
    close: async () => undefined,
    ...overrides,
  };
}
