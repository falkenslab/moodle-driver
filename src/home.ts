// Where the `moodle` command keeps each site's browser profile (ADR-013): `~/.moodle-driver` on every
// system, a folder per site. The library still chooses no folder by itself; a program that wants to
// share the command's sessions asks for one here.
import os from "node:os";
import path from "node:path";
import { MoodleError } from "./core/errors.js";
import { parseSiteUrl } from "./options.js";

/** The command's home when nothing else is given: `~/.moodle-driver`, the same on every system. */
export function defaultHome(home = os.homedir()): string {
  return path.join(home, ".moodle-driver");
}

/** A site's folder name: its host and port, with anything but letters, digits, dots and hyphens as `_` (`localhost:8080` is `localhost_8080`). */
export function siteFolderName(site: string): string {
  return new URL(parseSiteUrl(site)).host.replace(/[^a-z0-9.-]/gi, "_");
}

/** A site's folder in the command's home: its `site.json` and its profiles. */
export function siteDir(site: string, home = defaultHome()): string {
  return path.join(home, "sites", siteFolderName(site));
}

/**
 * The browser profile folder the `moodle` command uses for a site: `sites/<host>/profile`, or
 * `sites/<host>/profiles/<as>` for a named one (another account on the same site). Pass it as
 * `profileDir` to share the command's session; `home` is `~/.moodle-driver` unless given.
 */
export function siteProfileDir(site: string, { as, home = defaultHome() }: { as?: string; home?: string } = {}): string {
  const dir = siteDir(site, home);
  if (as === undefined || as === "default") return path.join(dir, "profile");
  if (!/^[\w.-]+$/.test(as) || as === "." || as === "..") throw new MoodleError(`A profile's name is letters, digits, dots, hyphens and underscores: "${as}".`, "invalid-input");
  return path.join(dir, "profiles", as);
}
