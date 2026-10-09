import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Cookie } from "playwright-core";

/**
 * Chromium drops session cookies (no expiry) when a persistent profile closes, and Moodle's
 * `MoodleSession` is one (confirmed empirically, Edge and playwright-core 1.64, Moodle 5.2): the
 * profile alone would forget the login on every restart. They are kept in this file inside the
 * profile, as sensitive as the profile itself (ADR-007).
 */
export const SESSION_COOKIES_FILE = "moodle-mcp-session-cookies.json";

export async function saveSessionCookies(context: BrowserContext, profileDir: string): Promise<void> {
  const sessionCookies = (await context.cookies()).filter((cookie) => cookie.expires === -1);
  await writeFile(path.join(profileDir, SESSION_COOKIES_FILE), JSON.stringify(sessionCookies), { mode: 0o600 });
}

/** Puts back the session cookies saved last time; a missing or unreadable file means none. */
export async function restoreSessionCookies(context: BrowserContext, profileDir: string): Promise<void> {
  let cookies: Cookie[];
  try {
    cookies = JSON.parse(await readFile(path.join(profileDir, SESSION_COOKIES_FILE), "utf8")) as Cookie[];
  } catch {
    return;
  }
  if (!Array.isArray(cookies) || cookies.length === 0) return;
  // Cookies the browser kept itself are newer than the file's.
  const kept = new Set((await context.cookies()).map((c) => `${c.name}|${c.domain}|${c.path}`));
  const missing = cookies.filter((c) => !kept.has(`${c.name}|${c.domain}|${c.path}`));
  if (missing.length > 0) await context.addCookies(missing).catch(() => undefined);
}
