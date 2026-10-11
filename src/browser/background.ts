// Working on a browser another process keeps open (ADR-014): where to find it, from the file it leaves
// in its profile, and a browser manager that connects to it instead of launching one.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { MoodleError } from "../core/errors.js";
import { followPages } from "../core/session.js";
import type { Channel } from "../options.js";
import { saveSessionCookies } from "./cookies.js";
import { NoDisplayError, type BrowserManager } from "./manager.js";

/** The file a background browser leaves in its profile: where it is and its token, readable only by the person. */
export const BACKGROUND_FILE = ".browser.json";

/** A browser kept open by another process, as its profile's `.browser.json` says. */
export interface BackgroundBrowser {
  /** The WebSocket to connect to, on 127.0.0.1. */
  endpoint: string;
  /** Sent as `Authorization: Bearer <token>`: without it the browser refuses the connection. */
  token: string;
  /** The process holding the browser. */
  pid: number;
  channel: Channel;
  /** Whether it shows a window. */
  headed: boolean;
}

/** The background browser `connectBrowserManager` connects to (`endpoint` and `token` as `backgroundBrowser` gives them), and how to use it. */
export interface ConnectOptions {
  endpoint: string;
  token: string;
  /** Whether the browser shows a window: the pages functions open are then followed in it (ADR-007). */
  headed?: boolean;
  channel?: Channel;
  /** The browser's profile, to save the session cookies in when disconnecting (ADR-003). */
  profileDir?: string;
}

const NAVIGATION_TIMEOUT_MS = 60_000;

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it's there, someone else's.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Asks the background browser how it is: `undefined` when nothing answers on its port. */
function status(endpoint: string, token: string): Promise<{ busy: boolean } | undefined> {
  const url = new URL("/status", endpoint.replace(/^ws/, "http"));
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { authorization: `Bearer ${token}` }, timeout: 5000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => (body += chunk));
      response.on("end", () => (response.statusCode === 200 ? resolve(JSON.parse(body) as { busy: boolean }) : resolve(undefined)));
    });
    req.on("timeout", () => req.destroy(new MoodleError("The background browser doesn't answer.", "background-browser")));
    req.on("error", (error: NodeJS.ErrnoException) => (error.code === "ECONNREFUSED" ? resolve(undefined) : reject(error)));
    req.end();
  });
}

/**
 * The browser another process keeps open on `profileDir` (the `moodle open` command's), or `undefined`
 * when there's none. A `.browser.json` left by a process that's gone is removed.
 */
export async function backgroundBrowser(profileDir: string): Promise<BackgroundBrowser | undefined> {
  const file = path.join(profileDir, BACKGROUND_FILE);
  let found: BackgroundBrowser;
  try {
    found = JSON.parse(readFileSync(file, "utf8")) as BackgroundBrowser;
  } catch {
    return undefined;
  }
  if (typeof found.pid === "number" && alive(found.pid) && (await status(found.endpoint, found.token))) return found;
  rmSync(file, { force: true });
  return undefined;
}

/**
 * Asks the background browser on `profileDir` to save the session and close, and waits until it has;
 * `false` when there's none.
 */
export async function closeBackgroundBrowser(profileDir: string, timeoutMs = 20_000): Promise<boolean> {
  const found = await backgroundBrowser(profileDir);
  if (!found) return false;
  await new Promise<void>((resolve, reject) => {
    const req = request(new URL("/close", found.endpoint.replace(/^ws/, "http")), { method: "POST", headers: { authorization: `Bearer ${found.token}` } }, (response) => {
      response.resume();
      response.on("end", resolve);
    });
    req.on("error", reject);
    req.end();
  });
  const until = Date.now() + timeoutMs;
  // The process removes its file once the browser is closed and the session saved.
  const file = path.join(profileDir, BACKGROUND_FILE);
  while (existsSync(file) && alive(found.pid) && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
  rmSync(file, { force: true });
  return true;
}

/**
 * A browser manager on a browser another process keeps open (`backgroundBrowser`), for a program to
 * share it: it connects on first use, works in the browser's own context, and `close()` only
 * disconnects, leaving the browser open. With a window, the pages functions open are followed in its
 * first tab (ADR-007); it can't add or remove a window from a browser it didn't launch.
 */
export function connectBrowserManager(options: ConnectOptions): BrowserManager {
  const headed = options.headed ?? false;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let following = headed;
  let connecting: Promise<BrowserContext> | undefined;

  async function connect(): Promise<BrowserContext> {
    if (context && browser?.isConnected()) return context;
    connecting ??= (async () => {
      try {
        browser = await chromium.connectOverCDP(options.endpoint, { headers: { authorization: `Bearer ${options.token}` } });
      } catch (error) {
        throw new MoodleError(`Can't connect to the browser at ${options.endpoint}: ${(error as Error).message.split("\n")[0]}`, "background-browser");
      }
      const opened = browser.contexts()[0];
      if (!opened) throw new MoodleError("The browser connected to has no context to work in.", "background-browser");
      opened.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      followPages(opened, (url) => manager.show(url));
      browser.on("disconnected", () => {
        browser = undefined;
        context = undefined;
      });
      context = opened;
      return opened;
    })().finally(() => (connecting = undefined));
    return connecting;
  }

  /** The window's tab: the first one the browser has, else a new one. */
  async function workTab(current: BrowserContext): Promise<Page> {
    return current.pages().find((p) => !p.isClosed()) ?? (await current.newPage());
  }

  const manager: BrowserManager = {
    async context({ headed: wantHeaded = false } = {}) {
      if (wantHeaded && !headed) throw new NoDisplayError("The browser connected to was opened without a window, so it can't show one (to log in, say).");
      return connect();
    },
    openChannel: () => (context ? options.channel : undefined),
    chromiumDownload: () => undefined,
    visible: () => headed && following,
    async setVisible(visible) {
      if (visible && !headed) throw new NoDisplayError("The browser connected to was opened without a window: it can't show one now.");
      following = visible;
    },
    async show(url) {
      if (!following || !headed || !context) return;
      try {
        const tab = await workTab(context);
        if (tab.url() !== url) await tab.goto(url, { waitUntil: "domcontentloaded" });
        await tab.bringToFront();
      } catch {
        // Following is a courtesy: a page that doesn't load never changes a function's result.
      }
    },
    tab: async () => workTab(await connect()),
    async saveSession() {
      if (context && options.profileDir) await saveSessionCookies(context, options.profileDir);
    },
    async close() {
      const current = browser;
      await manager.saveSession().catch(() => undefined);
      browser = undefined;
      context = undefined;
      // Disconnects: the browser and its window stay open for the next one.
      await current?.close().catch(() => undefined);
    },
  };
  return manager;
}
