// What the command remembers between runs, in its home (ADR-013): `config.json` with the default site,
// and a folder per site with its `site.json` (its URL and default profile) and its named browser profiles.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultHome, profileName, siteDir, siteProfileDir } from "../home.js";
import { backgroundRunning } from "./background.js";

export interface CliConfig {
  /** The site commands work on when none is given: the last one logged in to. */
  site?: string;
}

export interface SiteRecord {
  /** The site's base URL, as given to `login`. */
  url: string;
  /** The profile commands use on this site unless told: the last one logged in with. */
  default?: string;
  /** A profile folder of the person's own, given to `login --profile`: used when there's no default. */
  profileDir?: string;
}

/** The command's home: `MOODLE_DRIVER_HOME`, else `~/.moodle-driver` on every system. */
export function cliHome(env: NodeJS.ProcessEnv, home = os.homedir()): string {
  return env.MOODLE_DRIVER_HOME || defaultHome(home);
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

/**
 * The profile folder a command uses on a site: `--profile`, else the one named by `--as`, else the
 * site's default, else the folder given to `login --profile`; `undefined` when the site has none yet.
 */
export function profileFor(home: string, site: string, { profile, as }: { profile?: string; as?: string }): { profileDir: string; name?: string } | undefined {
  if (profile) return { profileDir: profile };
  const record = loadSite(home, site);
  const name = as ?? record?.default;
  if (name) return { profileDir: siteProfileDir(site, { as: name, home }), name };
  if (record?.profileDir) return { profileDir: record.profileDir };
  return undefined;
}

/** A folder to log in with before the person's username names it (see `nameProfile`), made now. */
export function pendingProfile(home: string, site: string): string {
  const dir = path.join(siteDir(site, home), "profiles", `.login-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Gives the profile logged in with in `pending` its name: the person's Moodle username. */
export function nameProfile(home: string, site: string, pending: string, username: string): string {
  const name = profileName(username);
  const target = siteProfileDir(site, { as: name, home });
  // The same username is the same account: its older profile gives way to the new session.
  rmSync(target, { recursive: true, force: true });
  renameSync(pending, target);
  return name;
}

export interface SiteProfile {
  site: string;
  /** The profile's name, or `--profile` for a folder of the person's own. */
  profile: string;
  default: boolean;
  /** The session file is there: Moodle may still have ended the session. */
  session: boolean;
  /** A background browser (`moodle open`) is running on the profile. */
  background: boolean;
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
    const profilesDir = path.join(sitesDir, folder, "profiles");
    const names = existsSync(profilesDir) ? readdirSync(profilesDir).filter((name) => !name.startsWith(".")).sort() : [];
    const isDefaultSite = config.site === record.url;
    const row = (profile: string, dir: string, isDefault: boolean): SiteProfile => ({
      site: record.url,
      profile,
      default: isDefaultSite && isDefault,
      session: existsSync(path.join(dir, "moodle-session.json")),
      background: backgroundRunning(dir),
      path: dir,
    });
    for (const name of names) rows.push(row(name, siteProfileDir(record.url, { as: name, home }), record.default === name));
    if (record.profileDir) rows.push(row("--profile", record.profileDir, !record.default));
  }
  return rows;
}

/** Deletes a site's folder, or one of its profiles; says what went. */
export function forgetSite(home: string, site: string, as?: string): string[] {
  const dir = siteDir(site, home);
  if (!existsSync(dir)) return [];
  if (as !== undefined) {
    const profile = siteProfileDir(site, { as, home });
    if (!existsSync(profile)) return [];
    rmSync(profile, { recursive: true, force: true });
    const record = loadSite(home, site);
    if (record?.default === as) saveSite(home, { ...record, default: undefined });
    return [profile];
  }
  // A folder of the person's own (`--profile`) is outside: it stays theirs.
  rmSync(dir, { recursive: true, force: true });
  const config = loadConfig(home);
  if (config.site && siteDir(config.site, home) === dir) saveConfig(home, { ...config, site: undefined });
  return [dir];
}
