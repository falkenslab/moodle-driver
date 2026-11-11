import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type BrowserContext, type Page } from "playwright-core";
import { installBrowser, type InstallBrowser } from "./chromium.js";
import { SYSTEM_CHANNELS, type BrowserOptions, type Channel, type DownloadedChannel } from "../options.js";
import { followPages } from "../core/session.js";
import { restoreSessionCookies, saveSessionCookies } from "./cookies.js";
import { MoodleError } from "../core/errors.js";

type LaunchPersistentContext = typeof chromium.launchPersistentContext;

/** Playwright's launcher for the channel: Firefox is a browser type of its own, not a Chromium channel. */
const launchPersistentContext: LaunchPersistentContext = (userDataDir, options) =>
  options?.channel === "firefox" ? firefox.launchPersistentContext(userDataDir, { ...options, channel: undefined }) : chromium.launchPersistentContext(userDataDir, options);

const DOWNLOADED: Record<DownloadedChannel, string> = { chromium: "Chromium", firefox: "Firefox" };
const isDownloaded = (channel: Channel): channel is DownloadedChannel => channel in DOWNLOADED;

/** What `BrowserManager.context()` is asked for. */
export interface ContextOptions {
  /** A visible window, whatever the options say (logging in by hand). */
  headed?: boolean;
}

/** The browser's single persistent context, opened on first use (ADR-002). */
export interface BrowserManager {
  /**
   * The open context, launching it if needed. A headed request relaunches a headless context with
   * a window; a headless request reuses a headed one rather than closing a window the person may be using.
   */
  context(options?: ContextOptions): Promise<BrowserContext>;
  /** The channel of the open context, or `undefined` while none is open. */
  openChannel(): Channel | undefined;
  /** Whether Chromium (or Firefox, when chosen) is being downloaded, or the last download failed (ADR-001). */
  chromiumDownload(): "downloading" | "failed" | undefined;
  /** Whether the browser shows a window now: what `setVisible` asked for, else the options. */
  visible(): boolean;
  /**
   * Shows the browser (relaunching it with a window now, session kept) and follows the pages functions open
   * in it, or hides it (closing the window; the next call runs headless). ADR-007.
   */
  setVisible(visible: boolean): Promise<void>;
  /** While following, brings `url` (a site page) to the front of the window; best effort, never throws. */
  show(url: string): Promise<void>;
  /** The one working tab a program drives itself (ADR-007), the same one following shows; opens the browser if needed. */
  tab(): Promise<Page>;
  /** Saves the session cookies of the open context, if any (ADR-003). */
  saveSession(): Promise<void>;
  close(): Promise<void>;
}

/** No installed browser could be launched, and Chromium (or Firefox) can't be downloaded (ADR-001). */
export class BrowserNotFoundError extends MoodleError {
  override name = "BrowserNotFoundError";
  constructor(message: string) {
    super(message, "browser-not-found");
  }
}

/** No browser yet: Chromium (or Firefox) is downloading in the background, and the call should be retried later. */
export class BrowserDownloadingError extends MoodleError {
  override name = "BrowserDownloadingError";
  constructor(message: string) {
    super(message, "browser-downloading");
  }
}

/**
 * A browser didn't start on Windows and its profile folder's path is long, which may be why: the
 * browser's own files inside the profile go past Windows' limit on paths. Move the profile somewhere
 * with a shorter path. `length` is that path's length, in characters.
 */
export class ProfilePathTooLongError extends MoodleError {
  override name = "ProfilePathTooLongError";
  readonly length: number;
  constructor(length: number) {
    super(`The browser didn't start, and its profile folder's path may be too long for Windows (${length} characters): use a profile folder with a shorter path.`, "profile-path-too-long");
    this.length = length;
  }
}

/** A window was asked for where there's no screen to show it (a container, a server). */
export class NoDisplayError extends MoodleError {
  override name = "NoDisplayError";
  constructor(message: string) {
    super(message, "no-display");
  }
}

/**
 * Whether a window can be shown. On Linux it needs an X or Wayland display; without one (Docker, a
 * server) the driver refuses rather than trying, so it never reaches a display it wasn't given.
 */
export function canShowWindow(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "linux" || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
}

// Playwright's message when a channel isn't installed: "Chromium distribution 'msedge' is not found",
// with " at <path>" only when it knows where to look (playwright-core 1.64).
// Edge and Chrome started on a profile path of 230 characters and not on one of 240, in Windows 11
// with long paths enabled (measured November 2026, playwright-core 1.65). It may differ elsewhere,
// and it only decides what a launch that already failed is called, so the error says "may".
const LONG_PROFILE_PATH = 230;
// What those launches failed with, depending on the length: closed, a profile lock, or no answer.
const FAILED_ON_LONG_PATH = /has been closed|ProcessSingleton|Timeout \d+ms exceeded/;

const NOT_INSTALLED = /distribution '[^']+' is not (found|supported)|Executable doesn't exist/i;

// Moodle pages can take long, above all the first ones after the site starts.
const NAVIGATION_TIMEOUT_MS = 60_000;

interface Open {
  context: BrowserContext;
  channel: Channel;
  headed: boolean;
}

/**
 * A browser manager that launches the browser itself, in the persistent profile of `config`
 * (ADR-002), on first use: nothing opens until a function needs the browser. It tries the
 * installed browsers and, if allowed, downloads Chromium (or Firefox, when chosen) in the background
 * (ADR-001). Its `context()` throws `BrowserNotFoundError` when no browser can be launched,
 * `BrowserDownloadingError` while the browser downloads, `ProfilePathTooLongError` when a long profile
 * path may be why it didn't start on Windows, and `NoDisplayError` for a window without a screen. The other parameters are for tests.
 */
export function createBrowserManager(
  config: BrowserOptions,
  launch: LaunchPersistentContext = launchPersistentContext,
  install: InstallBrowser = installBrowser,
  windowsPossible: () => boolean = canShowWindow,
  platform: NodeJS.Platform = process.platform,
): BrowserManager {
  let open: Open | undefined;
  // What `setVisible` asked for, over the options; following goes with it.
  let shown: boolean | undefined;
  let followTab: Page | undefined;
  // The working tab last given to a program (`tab()`), never closed under it.
  let handedOut: Page | undefined;
  // How many times each browser has gone by itself in this run.
  const crashes = new Map<Channel, number>();
  // The user agent each channel sends with a window, for `userAgent: "browser"` (and whether headless differs).
  const headedAgents = new Map<Channel, { userAgent: string; relaunch: boolean }>();
  // The download runs in the background, outside the queue: it takes minutes, longer than some
  // callers wait, so calls meanwhile answer at once that it's downloading.
  let download: Promise<void> | undefined;
  let downloadFailure: string | undefined;

  function startDownload(browser: DownloadedChannel): BrowserDownloadingError {
    const retry = downloadFailure ? ` The previous download failed (${downloadFailure}); trying again.` : "";
    downloadFailure = undefined;
    download ??= install(browser).then(
      () => {
        download = undefined;
      },
      (error: unknown) => {
        download = undefined;
        downloadFailure = (error as Error).message ?? String(error);
      },
    );
    return downloading(browser, retry);
  }

  function downloading(browser: DownloadedChannel, extra = ""): BrowserDownloadingError {
    const missing = config.channel === browser ? `${DOWNLOADED[browser]} isn't downloaded yet` : "Neither Microsoft Edge nor Google Chrome is available";
    const size = browser === "chromium" ? "about 180 MB, " : "";
    return new BrowserDownloadingError(
      `${missing}, so it's being downloaded (${size}into PLAYWRIGHT_BROWSERS_PATH or the user's ms-playwright cache).${extra} Try again in a minute or two.`,
    );
  }
  // One operation at a time: two launches on the same profile would fail.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Launches one channel with the user agent the options ask for. `"browser"` headless needs the
   * headed one, worked out from the headless one: the first launch of a channel reads it and, when it
   * says `HeadlessChrome`, relaunches with `Chrome` in its place (a persistent context's user agent is
   * fixed at launch). The result is kept per channel, so later launches start with it at once.
   */
  async function launchChannel(channel: Channel, headed: boolean): Promise<BrowserContext> {
    const wanted = config.userAgent;
    if (wanted !== undefined && wanted.trim() === "") throw new MoodleError("The user agent can't be an empty text: leave it out to keep the browser's own.", "invalid-input");
    // A window keeps its own size; a fixed viewport would leave it half empty.
    const options = { channel, headless: !headed, ...(headed ? { viewport: null } : {}) };
    if (wanted === undefined || (wanted === "browser" && (headed || channel === "firefox"))) return launch(config.profileDir, options);
    if (wanted !== "browser") return launch(config.profileDir, { ...options, userAgent: wanted });
    const known = headedAgents.get(channel);
    if (known) return launch(config.profileDir, { ...options, ...(known.relaunch ? { userAgent: known.userAgent } : {}) });
    const context = await launch(config.profileDir, options);
    const page = context.pages()[0] ?? (await context.newPage());
    const own = await page.evaluate(() => (globalThis as unknown as { navigator: { userAgent: string } }).navigator.userAgent);
    const userAgent = own.replace(/\bHeadlessChrome\//, "Chrome/");
    headedAgents.set(channel, { userAgent, relaunch: userAgent !== own });
    if (userAgent === own) return context;
    await context.close();
    return launch(config.profileDir, { ...options, userAgent });
  }

  async function launchFirstAvailable(headed: boolean): Promise<Open> {
    await mkdir(config.profileDir, { recursive: true });
    // A browser that crashed too often goes after the other installed ones, and before a download: it's still there.
    const crashedOut = (channel: Channel) => config.switchAfterCrashes !== undefined && (crashes.get(channel) ?? 0) >= config.switchAfterCrashes;
    const system = [...SYSTEM_CHANNELS.filter((c) => !crashedOut(c)), ...SYSTEM_CHANNELS.filter(crashedOut)];
    const channels: Channel[] = config.channel ? [config.channel] : [...system, ...(config.downloadBrowser ? (["chromium"] as const) : [])];
    const missing: string[] = [];
    for (const channel of channels) {
      if (isDownloaded(channel) && download) throw downloading(channel);
      let context: BrowserContext;
      try {
        context = await launchChannel(channel, headed);
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        if (!NOT_INSTALLED.test(message)) {
          const length = path.resolve(config.profileDir).length;
          if (platform === "win32" && length > LONG_PROFILE_PATH && FAILED_ON_LONG_PATH.test(message)) throw new ProfilePathTooLongError(length);
          throw error;
        }
        if (isDownloaded(channel) && config.downloadBrowser) throw startDownload(channel);
        missing.push(channel);
        continue;
      }
      context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      followPages(context, {
        watching: () => Boolean(shown && open?.context === context && open.headed),
        show: (url) => manager.show(url),
        adopt: async (page) => adopt(context, page),
        tab: () => workTab(context),
      });
      await restoreSessionCookies(context, config.profileDir);
      const opened: Open = { context, channel, headed };
      // The person may close the window: the next call opens the browser again, headless if they had
      // asked to see it (closing it says they're done watching).
      context.on("close", () => {
        if (open !== opened) return;
        open = undefined;
        // With a window it may be the person closing it; without one, nobody but a crash closes it.
        if (!opened.headed) crashes.set(channel, (crashes.get(channel) ?? 0) + 1);
        if (opened.headed && shown) shown = false;
      });
      return opened;
    }
    throw new BrowserNotFoundError(
      config.channel === "firefox"
        ? "Playwright's Firefox isn't downloaded. Allow downloading it (downloadBrowser), or choose another channel."
        : `No browser found (tried ${missing.join(", ")}). Install Microsoft Edge or Google Chrome${config.downloadBrowser ? "" : ", or allow downloading Chromium (downloadBrowser)"}, or choose another channel.`,
    );
  }

  /** The working tab in `context`: the one already in use, else the window's first empty tab, else a new one. */
  async function workTab(context: BrowserContext): Promise<Page> {
    if (!followTab || followTab.isClosed()) followTab = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage());
    return followTab;
  }

  /**
   * A function's tab it's done with becomes the working tab, as it is (#101): the one before closes,
   * unless a program was given it with `tab()` and may still drive it.
   */
  async function adopt(context: BrowserContext, page: Page): Promise<boolean> {
    if (!shown || open?.context !== context || !open.headed || page.isClosed()) return false;
    const previous = followTab;
    followTab = page;
    await page.bringToFront().catch(() => undefined);
    if (previous && previous !== page && previous !== handedOut && !previous.isClosed()) await previous.close().catch(() => undefined);
    return true;
  }

  async function closeOpen(): Promise<void> {
    const current = open;
    open = undefined;
    followTab = undefined;
    if (!current) return;
    await saveSessionCookies(current.context, config.profileDir).catch(() => undefined);
    await current.context.close().catch(() => undefined);
  }

  const manager: BrowserManager = {
    context({ headed = false } = {}) {
      return exclusive(async () => {
        const wantHeaded = headed || (shown ?? !config.headless);
        if (open && (open.headed || !wantHeaded)) return open.context;
        if (wantHeaded && !windowsPossible()) {
          throw new NoDisplayError(
            `There's no screen to show a browser window here (no DISPLAY or WAYLAND_DISPLAY), so ${headed ? "logging in by hand isn't possible" : "a headed browser can't open"}. Run headless with a profile already logged in, or where there's a screen.`,
          );
        }
        await closeOpen();
        open = await launchFirstAvailable(wantHeaded);
        return open.context;
      });
    },
    visible: () => shown ?? !config.headless,
    setVisible: (visible) =>
      exclusive(async () => {
        if (visible && !windowsPossible()) {
          throw new NoDisplayError("There's no screen to show a browser window here (no DISPLAY or WAYLAND_DISPLAY). The browser keeps working headless.");
        }
        shown = visible;
        if (visible && !open?.headed) {
          await closeOpen();
          open = await launchFirstAvailable(true);
        } else if (!visible && open?.headed) {
          await closeOpen();
        }
      }),
    async show(url) {
      const current = open;
      if (!shown || !current?.headed) return;
      try {
        const tab = await workTab(current.context);
        if (tab.url() !== url) await tab.goto(url, { waitUntil: "domcontentloaded" });
        await tab.bringToFront();
      } catch {
        // Following is a courtesy: a page that doesn't load never changes a function's result.
      }
    },
    tab: async () => (handedOut = await workTab(await manager.context())),
    openChannel: () => open?.channel,
    chromiumDownload: () => (download ? "downloading" : downloadFailure ? "failed" : undefined),
    saveSession: () =>
      exclusive(async () => {
        if (open) await saveSessionCookies(open.context, config.profileDir);
      }),
    close: () => exclusive(closeOpen),
  };
  return manager;
}
