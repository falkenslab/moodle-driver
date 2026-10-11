// Where the `moodle` command keeps each site's browser profiles (ADR-013): `~/.moodle-driver` on every
// system, a folder per site, a named profile per account. The library still chooses no folder by
// itself; a program that wants to share the command's sessions asks for one here.
import { readFileSync } from "node:fs";
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

/** A profile's name from a Moodle username: anything but letters, digits, dots, hyphens and underscores as `_`. */
export function profileName(username: string): string {
  const name = username.trim().replace(/[^\w.-]/g, "_").replace(/^\.+/, "");
  return name === "" ? "user" : name;
}

/**
 * The browser profile folder the `moodle` command uses for an account on a site:
 * `sites/<host>/profiles/<as>`. Without `as`, the site's default (the account last logged in with,
 * named in its `site.json`); `MoodleError` with code `not-found` when the command hasn't logged in to
 * the site. Pass it as `profileDir` to share the command's session; `home` is `~/.moodle-driver`
 * unless given.
 */
export function siteProfileDir(site: string, { as, home = defaultHome() }: { as?: string; home?: string } = {}): string {
  if (as === undefined) {
    let record: { default?: string; profileDir?: string } | undefined;
    try {
      record = JSON.parse(readFileSync(path.join(siteDir(site, home), "site.json"), "utf8")) as typeof record;
    } catch {
      // No site.json: the command hasn't logged in to this site.
    }
    if (record?.default) return siteProfileDir(site, { as: record.default, home });
    if (record?.profileDir) return record.profileDir;
    const url = parseSiteUrl(site);
    throw new MoodleError(`There's no profile for ${url} yet: log in with \`moodle login --site ${url}\`, or name one with \`as\`.`, "not-found");
  }
  if (!/^[\w.-]+$/.test(as) || as.startsWith(".")) {
    throw new MoodleError(`A profile's name is letters, digits, dots, hyphens and underscores, not starting with a dot: "${as}".`, "invalid-input");
  }
  return path.join(siteDir(site, home), "profiles", as);
}
