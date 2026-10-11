// What the command remembers between runs, in its home (ADR-013): `config.json` with the default site,
// and a folder per site with its `site.json` and its browser profiles.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_PROFILE, defaultHome, siteDir, siteProfileDir } from "../home.js";

export interface CliConfig {
  /** The site commands work on when none is given: the last one logged in to. */
  site?: string;
}

export interface SiteRecord {
  /** The site's base URL, as given to `login`. */
  url: string;
  /** The named profile commands use on this site unless told (`login --as`). */
  as?: string;
  /** A profile folder of the person's own for the site's default account, given to `login --profile`. */
  profileDir?: string;
}

/** The command's home: `MOODLE_DRIVER_HOME`, else `~/.moodle-driver` on every system. */
export function cliHome(env: NodeJS.ProcessEnv, home = os.homedir()): string {
  return env.MOODLE_DRIVER_HOME || defaultHome(home);
}

/** Where the command kept its files before 0.3 (`~/.config/moodle-driver`, `%APPDATA%\moodle-driver`). */
export function legacyHome(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "moodle-driver");
  if (platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "moodle-driver");
  return path.join(home, ".config", "moodle-driver");
}

function readJson<T>(file: string): T | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export const loadConfig = (home: string): CliConfig => readJson<CliConfig>(path.join(home, "config.json")) ?? {};
export const saveConfig = (home: string, config: CliConfig) => writeJson(path.join(home, "config.json"), config);
export const loadSite = (home: string, site: string): SiteRecord | undefined => readJson<SiteRecord>(path.join(siteDir(site, home), "site.json"));
export const saveSite = (home: string, record: SiteRecord) => writeJson(path.join(siteDir(record.url, home), "site.json"), record);

/** The profile folder a command uses on a site: `--profile`, else the named one, else the site's own. */
export function profileFor(home: string, site: string, { profile, as }: { profile?: string; as?: string }): { profileDir: string; as?: string } {
  if (profile) return { profileDir: profile };
  const record = loadSite(home, site);
  const name = as ?? record?.as ?? DEFAULT_PROFILE;
  // The default account's profile is the folder given to `login --profile`, when one was.
  if (name === DEFAULT_PROFILE && record?.profileDir) return { profileDir: record.profileDir, as: name };
  return { profileDir: siteProfileDir(site, { as: name, home }), as: name };
}

export interface SiteProfile {
  site: string;
  /** "default" for the site's own profile, else the named one's name. */
  profile: string;
  default: boolean;
  /** The session file is there: Moodle may still have ended the session. */
  session: boolean;
  path: string;
}

/** Every site in the home with each of its profiles. */
export function listSites(home: string): SiteProfile[] {
  const config = loadConfig(home);
  const sitesDir = path.join(home, "sites");
  if (!existsSync(sitesDir)) return [];
  const rows: SiteProfile[] = [];
  for (const folder of readdirSync(sitesDir).sort()) {
    const record = readJson<SiteRecord>(path.join(sitesDir, folder, "site.json"));
    if (!record) continue;
    const names = new Set(existsSync(path.join(sitesDir, folder, "profiles")) ? readdirSync(path.join(sitesDir, folder, "profiles")) : []);
    if (record.profileDir) names.add(DEFAULT_PROFILE);
    for (const profile of [...names].sort((a, b) => (a === DEFAULT_PROFILE ? -1 : b === DEFAULT_PROFILE ? 1 : a < b ? -1 : 1))) {
      const dir = profile === DEFAULT_PROFILE && record.profileDir ? record.profileDir : siteProfileDir(record.url, { as: profile, home });
      rows.push({
        site: record.url,
        profile,
        default: config.site === record.url && (record.as ?? DEFAULT_PROFILE) === profile,
        session: existsSync(path.join(dir, "moodle-session.json")),
        path: dir,
      });
    }
  }
  return rows;
}

/** Deletes a site's folder, or one of its named profiles; says what went. */
export function forgetSite(home: string, site: string, as?: string): string[] {
  const dir = siteDir(site, home);
  if (!existsSync(dir)) return [];
  if (as !== undefined) {
    const record = loadSite(home, site);
    // A folder of the person's own is theirs: forgetting the account only stops using it.
    if (as === DEFAULT_PROFILE && record?.profileDir) {
      saveSite(home, { ...record, profileDir: undefined, as: record.as === as ? undefined : record.as });
      return [record.profileDir];
    }
    const profile = siteProfileDir(site, { as, home });
    if (!existsSync(profile)) return [];
    rmSync(profile, { recursive: true, force: true });
    if (record?.as === as) saveSite(home, { ...record, as: undefined });
    return [profile];
  }
  rmSync(dir, { recursive: true, force: true });
  const config = loadConfig(home);
  if (config.site && siteDir(config.site, home) === dir) saveConfig(home, { ...config, site: undefined });
  return [dir];
}

// Moves a folder, across disks too.
function move(from: string, to: string): void {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch {
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** Profiles kept as `sites/<host>/profile` by an early build of 0.3 move to `profiles/default`. */
export function tidy(home: string): void {
  const sitesDir = path.join(home, "sites");
  if (!existsSync(sitesDir)) return;
  for (const folder of readdirSync(sitesDir)) {
    const old = path.join(sitesDir, folder, "profile");
    const now = path.join(sitesDir, folder, "profiles", DEFAULT_PROFILE);
    if (existsSync(old) && !existsSync(now)) move(old, now);
  }
}

/**
 * Moves what an older version kept in `legacy` (`config.json` with `site` and `profiles`, and
 * `profiles/<host>`) into `home`, once: only when `home` doesn't exist yet. Returns what to tell the person.
 */
export function migrate(home: string, legacy: string): string | undefined {
  if (existsSync(home) || path.resolve(home) === path.resolve(legacy)) return undefined;
  const old = readJson<{ site?: string; profiles?: Record<string, string> }>(path.join(legacy, "config.json"));
  if (!old) return undefined;
  for (const [site, dir] of Object.entries(old.profiles ?? {})) {
    const own = path.resolve(dir).startsWith(path.resolve(legacy, "profiles"));
    if (own && existsSync(dir)) move(dir, siteProfileDir(site, { home }));
    saveSite(home, own ? { url: site } : { url: site, profileDir: dir });
  }
  saveConfig(home, { site: old.site });
  rmSync(path.join(legacy, "config.json"), { force: true });
  try {
    rmdirSync(path.join(legacy, "profiles"));
  } catch {
    // Not empty (a profile nobody listed): left where it was.
  }
  try {
    rmdirSync(legacy);
  } catch {
    // Something else is in it: left as it is.
  }
  return `Moved moodle's sites and sessions from ${legacy} to ${home}.`;
}
