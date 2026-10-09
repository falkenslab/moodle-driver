import { MoodleUrlError, parseSiteUrl } from "../options.js";

// The first answer of a site that just started can take long (confirmed empirically, the sandbox).
const TIMEOUT_MS = 60_000;

/** `M.cfg.wwwroot` in a Moodle page, JSON-escaped as Moodle writes it (`"http:\/\/host"`). */
export function readWwwroot(html: string): string | undefined {
  const match = /"wwwroot":"((?:[^"\\]|\\.)*)"/.exec(html);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return undefined;
  }
}

/**
 * The site's base URL for any URL of it (the site, a course, the login page), read from the
 * `M.cfg.wwwroot` Moodle puts in every page; fetched without the browser or any session. Throws
 * `MoodleUrlError` when it can't be reached or isn't a Moodle.
 */
export async function findMoodleSite(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  parseSiteUrl(url); // http(s) and well formed, or MoodleUrlError.
  let html: string;
  try {
    const response = await fetchImpl(url.trim(), { redirect: "follow", signal: AbortSignal.timeout(TIMEOUT_MS) });
    html = await response.text();
  } catch (error) {
    throw new MoodleUrlError(`Couldn't reach ${url}: ${(error as Error).message}. Check the URL and that the site is up.`);
  }
  const wwwroot = readWwwroot(html);
  if (!wwwroot) throw new MoodleUrlError(`${url} doesn't look like a Moodle site (its page has no M.cfg.wwwroot). Check the URL.`);
  return parseSiteUrl(wwwroot);
}
