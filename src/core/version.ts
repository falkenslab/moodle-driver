// Which Moodle a site runs, found once per browser context, and the refusal of a function the site's
// Moodle is too old for.
import type { BrowserContext } from "playwright-core";
import { MoodleError } from "./errors.js";
import { siteFetch } from "./http.js";

/** The Moodle a site runs: its branch ("4.5", "5.2"…, or "unknown"), and its release when the site tells it. */
export interface MoodleVersion {
  /** "4.5", "5.0", "5.1", "5.2"…; "unknown" when the site doesn't tell, never guessed as the newest. */
  branch: string;
  /** The full release, as Moodle names it ("4.5.15 (Build: 20261005)"), when the site shows it. */
  release?: string;
}

const UNKNOWN: MoodleVersion = { branch: "unknown" };

// One answer per context and site: the version doesn't change while a program runs.
const versions = new WeakMap<BrowserContext, Map<string, Promise<MoodleVersion>>>();

/** The static file a component has on every site where it's installed, so its presence tells the version. */
const exists = async (context: BrowserContext, siteUrl: string, component: string) =>
  (await siteFetch(context, new URL(`${component}/pix/monologo.svg`, siteUrl).href)).status === 200;

async function detect(context: BrowserContext, siteUrl: string): Promise<{ version: MoodleVersion; sure: boolean }> {
  try {
    // LTI 1.3's platform configuration, public and present since Moodle 3.10, names the release in
    // `version` (confirmed empirically on Moodle 4.5.15 and 5.2.4, logged out).
    const response = await siteFetch(context, new URL("mod/lti/openid-configuration.php", siteUrl).href);
    if (response.status === 200) {
      const config = JSON.parse(response.body) as Record<string, { version?: unknown } | undefined>;
      const release = config["https://purl.imsglobal.org/spec/lti-platform-configuration"]?.version;
      const match = typeof release === "string" ? /^(\d+)\.(\d+)/.exec(release) : null;
      if (match) return { version: { branch: `${match[1]}.${match[2]}`, release: release as string }, sure: true };
    }
  } catch {
    // Not JSON (a site that hides it behind its login page): what the site has, then.
  }
  try {
    // Question banks became activities in 5.0, subsections came in 4.5. Telling 5.x branches apart
    // this way would take one probe per branch, so a 5.x site that hides its release stays unknown.
    if (await exists(context, siteUrl, "mod/qbank")) return { version: UNKNOWN, sure: true };
    if (await exists(context, siteUrl, "mod/subsection")) return { version: { branch: "4.5" }, sure: true };
    return { version: UNKNOWN, sure: true };
  } catch {
    // The site didn't answer: asked again next time.
    return { version: UNKNOWN, sure: false };
  }
}

/**
 * The Moodle the site runs: its branch, found by what the site offers (LTI's public platform
 * configuration names the release; otherwise which modules exist), and the release when the site
 * tells it. Needs no login, nor administrator rights. Asked once per browser context.
 */
export async function moodleVersion(context: BrowserContext, siteUrl: string): Promise<MoodleVersion> {
  let bySite = versions.get(context);
  if (!bySite) versions.set(context, (bySite = new Map()));
  const key = new URL(siteUrl).href;
  let version = bySite.get(key);
  if (!version) {
    version = detect(context, siteUrl).then(({ version, sure }) => {
      if (!sure) bySite.delete(key);
      return version;
    });
    bySite.set(key, version);
  }
  return { ...(await version) };
}

/** -1, 0 or 1 as branch `a` is older than, the same as, or newer than `b` ("4.5" < "5.0" < "5.10"). */
export function compareBranches(a: string, b: string): number {
  const [aMajor = 0, aMinor = 0] = a.split(".").map(Number);
  const [bMajor = 0, bMinor = 0] = b.split(".").map(Number);
  return Math.sign(aMajor - bMajor || aMinor - bMinor);
}

/**
 * Refuses `functionName` with `MoodleError` (`not-available`) when the site runs a Moodle older than
 * `minimum`, before anything is opened. A site whose version is unknown is let through.
 */
export async function requireMoodle(context: BrowserContext, siteUrl: string, minimum: string, functionName: string): Promise<void> {
  const { branch } = await moodleVersion(context, siteUrl);
  if (branch !== "unknown" && compareBranches(branch, minimum) < 0) {
    throw new MoodleError(`${functionName} needs Moodle ${minimum} or later; this site runs ${branch}.`, "not-available");
  }
}
