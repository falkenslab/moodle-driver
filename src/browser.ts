import { mkdir } from "node:fs/promises";
import { chromium, type BrowserContext, type Page } from "playwright-core";
import { installChromium, type InstallChromium } from "./chromiumInstaller.js";
import { SYSTEM_CHANNELS, type BrowserOptions, type Channel } from "./options.js";
import { followPages } from "./moodle/session.js";
import { restoreSessionCookies, saveSessionCookies } from "./sessionCookies.js";

type LaunchPersistentContext = typeof chromium.launchPersistentContext;

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
  /** Whether Chromium is being downloaded, or the last download failed (ADR-001). */
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

/** No installed browser could be launched, and Chromium can't be downloaded (ADR-001). */
export class BrowserNotFoundError extends Error {
  override name = "BrowserNotFoundError";
}

/** No browser yet: Chromium is downloading in the background, and the call should be retried later. */
export class BrowserDownloadingError extends Error {
  override name = "BrowserDownloadingError";
}

/** A window was asked for where there's no screen to show it (a container, a server). */
export class NoDisplayError extends Error {
  override name = "NoDisplayError";
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
const NOT_INSTALLED = /distribution '[^']+' is not (found|supported)|Executable doesn't exist/i;

// Moodle pages can take long, above all the first ones after the site starts.
const NAVIGATION_TIMEOUT_MS = 60_000;

interface Open {
  context: BrowserContext;
  channel: Channel;
  headed: boolean;
}

export function createBrowserManager(
  config: BrowserOptions,
  launch: LaunchPersistentContext = chromium.launchPersistentContext.bind(chromium),
  install: InstallChromium = installChromium,
  windowsPossible: () => boolean = canShowWindow,
): BrowserManager {
  let open: Open | undefined;
  // What `setVisible` asked for, over the options; following goes with it.
  let shown: boolean | undefined;
  let followTab: Page | undefined;
  // The download runs in the background, outside the queue: it takes minutes, longer than some
  // callers wait, so calls meanwhile answer at once that it's downloading.
  let download: Promise<void> | undefined;
  let downloadFailure: string | undefined;

  function startDownload(): BrowserDownloadingError {
    const retry = downloadFailure ? ` The previous download failed (${downloadFailure}); trying again.` : "";
    downloadFailure = undefined;
    download ??= install().then(
      () => {
        download = undefined;
      },
      (error: unknown) => {
        download = undefined;
        downloadFailure = (error as Error).message ?? String(error);
      },
    );
    return downloading(retry);
  }

  function downloading(extra = ""): BrowserDownloadingError {
    return new BrowserDownloadingError(
      `${config.channel === "chromium" ? "Chromium isn't downloaded yet" : "Neither Microsoft Edge nor Google Chrome is available"}, so it's being downloaded (about 180 MB, into PLAYWRIGHT_BROWSERS_PATH or the user's ms-playwright cache).${extra} Try again in a minute or two.`,
    );
  }
  // One operation at a time: two launches on the same profile would fail.
  let queue: Promise<unknown> = Promise.resolve();
  function exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  }

  async function launchFirstAvailable(headed: boolean): Promise<Open> {
    await mkdir(config.profileDir, { recursive: true });
    const channels: Channel[] = config.channel ? [config.channel] : [...SYSTEM_CHANNELS, ...(config.downloadBrowser ? (["chromium"] as const) : [])];
    const missing: string[] = [];
    for (const channel of channels) {
      if (channel === "chromium" && download) throw downloading();
      let context: BrowserContext;
      try {
        // A window keeps its own size; a fixed viewport would leave it half empty.
        context = await launch(config.profileDir, { channel, headless: !headed, ...(headed ? { viewport: null } : {}) });
      } catch (error) {
        const message = (error as Error).message ?? String(error);
        if (!NOT_INSTALLED.test(message)) throw error;
        if (channel === "chromium" && config.downloadBrowser) throw startDownload();
        missing.push(channel);
        continue;
      }
      context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
      followPages(context, (url) => manager.show(url));
      await restoreSessionCookies(context, config.profileDir);
      const opened: Open = { context, channel, headed };
      // The person may close the window: the next call opens the browser again, headless if they had
      // asked to see it (closing it says they're done watching).
      context.on("close", () => {
        if (open !== opened) return;
        open = undefined;
        if (opened.headed && shown) shown = false;
      });
      return opened;
    }
    throw new BrowserNotFoundError(
      `No browser found (tried ${missing.join(", ")}). Install Microsoft Edge or Google Chrome${config.downloadBrowser ? "" : ", or allow downloading Chromium (downloadBrowser)"}, or choose another channel.`,
    );
  }

  /** The working tab in `context`: the one already in use, else the window's first empty tab, else a new one. */
  async function workTab(context: BrowserContext): Promise<Page> {
    if (!followTab || followTab.isClosed()) followTab = context.pages().find((p) => p.url() === "about:blank") ?? (await context.newPage());
    return followTab;
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
    tab: async () => workTab(await manager.context()),
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
