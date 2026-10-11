// `moodle open` and `moodle close`: a browser left open in the background on a profile, which every
// command on that profile connects to instead of launching its own (ADR-014). The process holding it
// is this same program, started detached with `__background`.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BACKGROUND_FILE, backgroundBrowser, type BackgroundBrowser } from "../browser/background.js";
import { hostBrowser } from "../browser/host.js";
import { MoodleError } from "../core/errors.js";

/** The lock a command holds while it works on a background browser: one at a time. */
export const LOCK_FILE = ".browser.lock";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Whether a background browser seems to run on `profileDir`, without asking it (for `moodle sites`). */
export function backgroundRunning(profileDir: string): boolean {
  try {
    const { pid } = JSON.parse(readFileSync(path.join(profileDir, BACKGROUND_FILE), "utf8")) as { pid: number };
    return isAlive(pid);
  } catch {
    return false;
  }
}

/**
 * Takes the profile's lock, waiting up to `waitMs` for another command to finish; gives the function
 * that releases it. A lock whose process is gone is taken over.
 */
export async function lockBackground(profileDir: string, waitMs = 5000): Promise<() => void> {
  const file = path.join(profileDir, LOCK_FILE);
  const until = Date.now() + waitMs;
  for (;;) {
    try {
      writeFileSync(file, String(process.pid), { flag: "wx", mode: 0o600 });
      return () => {
        try {
          if (readFileSync(file, "utf8") === String(process.pid)) rmSync(file, { force: true });
        } catch {
          // Already gone.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    let holder: number;
    try {
      holder = Number(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    if (!holder || !isAlive(holder)) {
      rmSync(file, { force: true });
      continue;
    }
    if (Date.now() >= until) throw new MoodleError("Another command is working on the background browser of this profile: try again when it ends.", "browser-busy");
    await sleep(100);
  }
}

/**
 * Hosts a browser on `profileDir` from this process and writes its `.browser.json` (readable only by
 * the person); resolves once commands can connect, with a promise that settles when it's closed (asked
 * to with `moodle close`, or the person closed its window), the file removed.
 */
export async function hostBackground(profileDir: string, headed: boolean): Promise<{ closed: Promise<void> }> {
  const host = await hostBrowser({ profileDir, headed });
  const file = path.join(profileDir, BACKGROUND_FILE);
  const record: BackgroundBrowser = { endpoint: host.endpoint, token: host.token, pid: process.pid, channel: host.channel, headed };
  // Written whole, then renamed: a command never reads half a file.
  const partial = `${file}.${process.pid}`;
  writeFileSync(partial, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(partial, file);
  const stop = () => void host.close();
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, stop);
  const closed = host.closed.then(() => {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.off(signal, stop);
    try {
      if ((JSON.parse(readFileSync(file, "utf8")) as BackgroundBrowser).token === host.token) rmSync(file, { force: true });
    } catch {
      // Already gone.
    }
  });
  return { closed };
}

/**
 * How `moodle open` starts the background process: this program (`script`) again, detached, with
 * `__background`; waits until it answers, or says why it couldn't start (from its log, next to `.browser.json`).
 */
export function spawnBackground(script: string) {
  return async (profileDir: string, headed: boolean): Promise<void> => {
    mkdirSync(profileDir, { recursive: true });
    const log = path.join(profileDir, ".browser.log");
    const fd = openSync(log, "w", 0o600);
    const child = spawn(process.execPath, [...process.execArgv, script, "__background", profileDir, ...(headed ? ["--show"] : [])], { detached: true, stdio: ["ignore", fd, fd], windowsHide: true });
    closeSync(fd);
    let exited = false;
    child.once("exit", () => (exited = true));
    child.unref();
    const until = Date.now() + 180_000;
    while (Date.now() < until) {
      if (await backgroundBrowser(profileDir)) return;
      if (exited) {
        const why = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).slice(-3).join("\n");
        throw new MoodleError(`The background browser didn't start${why ? `: ${why}` : "."}`, "background-browser");
      }
      await sleep(200);
    }
    throw new MoodleError("The background browser didn't start in 3 minutes.", "background-browser");
  };
}
