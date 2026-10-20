import { MoodleError } from "./core/errors.js";
// What a program using the driver chooses: the browser, its profile, the site, how student actions
// look in Moodle's logs. Plain values: the driver reads no environment or arguments of its own.

/** Installed browsers tried in this order when no channel is chosen (ADR-001). */
export const SYSTEM_CHANNELS = ["msedge", "chrome"] as const;
/**
 * Every channel: the system browsers, and Playwright's own builds of Chromium and Firefox (downloaded
 * when missing). Firefox is only launched when chosen: Playwright drives its own build, never the
 * system's Firefox.
 */
export const CHANNELS = [...SYSTEM_CHANNELS, "chromium", "firefox"] as const;
/** A browser the driver can launch: Microsoft Edge, Google Chrome, or Playwright's Chromium or Firefox. */
export type Channel = (typeof CHANNELS)[number];
/** The channels Playwright downloads itself, rather than finding them installed (ADR-001). */
export type DownloadedChannel = Exclude<Channel, (typeof SYSTEM_CHANNELS)[number]>;

/** How student actions view and do things: through the real pages at a person's pace, or fast (ADR-005). */
export const TRAILS = ["realistic", "fast"] as const;
/** One of `TRAILS`: how a student action leaves its trail in Moodle's logs (ADR-005). */
export type Trail = (typeof TRAILS)[number];

/**
 * The browser's options. The driver reads them each time it launches, so a program may change them
 * between launches (a `configure` in an MCP server) on the same object.
 */
export interface BrowserOptions {
  /** The persistent profile folder where the person logs in (ADR-002). */
  profileDir: string;
  /**
   * One channel, or undefined for Edge, then Chrome, then (with `downloadBrowser`) Chromium. Firefox
   * keeps its own kind of profile: give it a profile folder of its own.
   */
  channel?: Channel;
  /** Without a window, unless a window is asked for (logging in) or shown on demand. */
  headless: boolean;
  /** Download Playwright's Chromium (or Firefox, when chosen) when no installed browser works. */
  downloadBrowser: boolean;
}

/** A site URL that isn't one. */
export class MoodleUrlError extends MoodleError {
  override name = "MoodleUrlError";
  constructor(message: string) {
    super(message, "moodle-url");
  }
}

/** A Moodle site's base URL, normalized: http(s), no query or fragment, a trailing slash. */
export function parseSiteUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new MoodleUrlError(`The Moodle URL isn't a valid URL: "${value}".`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MoodleUrlError(`The Moodle URL must be http or https, not "${value}".`);
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}
