import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

export type InstallChromium = () => Promise<void>;

/**
 * Starts a process that `killTree` can end with everything it starts: on Linux and macOS as the
 * leader of its own process group; on Windows `taskkill /T` walks the tree, and no console opens.
 */
export function spawnTree(command: string, args: string[]): ChildProcess {
  return spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", windowsHide: true });
}

/** Ends a process started by `spawnTree` and its children, at once; nothing if it's gone. */
export function killTree(pid: number): void {
  try {
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

/**
 * Downloads the Chromium this `playwright-core` expects with its own CLI (ADR-001), into
 * `PLAYWRIGHT_BROWSERS_PATH` when set, else the user's `ms-playwright` cache. The CLI is in
 * `node_modules` because `playwright-core` stays outside the bundle (ADR-005).
 */
export const installChromium: InstallChromium = () =>
  new Promise((resolve, reject) => {
    const cli = path.join(path.dirname(createRequire(import.meta.url).resolve("playwright-core/package.json")), "cli.js");
    // --no-shell: the server launches full Chromium headless too (channel "chromium").
    // --no-remove: the cache is shared, and other installations' browsers aren't ours to remove.
    const child = spawnTree(process.execPath, [cli, "install", "chromium", "--no-shell", "--no-remove", "--no-progress"]);
    // The CLI downloads from a child of its own: when the server exits, the whole tree goes with it,
    // instead of downloading on with nobody to use it (a partial download is started over next time).
    const stop = () => killTree(child.pid!);
    process.on("exit", stop);
    // stdout belongs to the MCP protocol: whatever the installer prints goes to stderr.
    child.stdout!.pipe(process.stderr, { end: false });
    child.stderr!.pipe(process.stderr, { end: false });
    child.on("error", (error) => {
      process.off("exit", stop);
      reject(error);
    });
    child.on("exit", (code) => {
      process.off("exit", stop);
      if (code === 0) resolve();
      else reject(new Error(`Chromium's installer exited with code ${code}`));
    });
  });
