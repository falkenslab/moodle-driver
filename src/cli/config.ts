// What the command remembers between runs: the site last logged in to, and a browser profile per site.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CliConfig {
  site?: string;
  /** The browser profile folder used for each site. */
  profiles?: Record<string, string>;
}

/** The command's folder: `$XDG_CONFIG_HOME/moodle-driver`, `%APPDATA%\moodle-driver` on Windows, else `~/.config/moodle-driver`. */
export function configDir(env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  if (env.XDG_CONFIG_HOME) return path.join(env.XDG_CONFIG_HOME, "moodle-driver");
  if (platform === "win32" && env.APPDATA) return path.join(env.APPDATA, "moodle-driver");
  return path.join(home, ".config", "moodle-driver");
}

export function loadConfig(dir: string): CliConfig {
  try {
    return JSON.parse(readFileSync(path.join(dir, "config.json"), "utf8")) as CliConfig;
  } catch {
    return {};
  }
}

export function saveConfig(dir: string, config: CliConfig): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

/** The profile folder for a site when none was chosen: one per site, under the command's folder. */
export function defaultProfile(dir: string, site: string): string {
  const { host } = new URL(site);
  return path.join(dir, "profiles", host.replace(/[^a-z0-9.-]/gi, "_"));
}
