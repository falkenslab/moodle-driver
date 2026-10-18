// A browser left open for other processes (ADR-014): launched with its debugging connection on a pipe
// only this process holds, and offered to one client at a time through a WebSocket on 127.0.0.1 that
// requires a random token. Chromium's own debugging port has no such check: anything on the machine
// that reached it would drive the browser, logged in to Moodle as the person.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { chromium, type Cookie } from "playwright-core";
import { MoodleError } from "../core/errors.js";
import { SYSTEM_CHANNELS, type Channel } from "../options.js";
import { installBrowser } from "./chromium.js";
import { SESSION_COOKIES_FILE } from "./cookies.js";
import { BrowserNotFoundError, NoDisplayError, canShowWindow } from "./manager.js";

export interface HostOptions {
  /** The browser profile: the person's session (ADR-002). */
  profileDir: string;
  /** A window, or headless. */
  headed?: boolean;
  /**
   * One browser only; else Edge, Chrome, then Chromium (downloaded if missing) as `createBrowserManager` tries them.
   * Not Firefox: the browser is offered over Chromium's debugging protocol.
   */
  channel?: Channel;
}

/** A browser hosted for other processes, and how to reach it. */
export interface BrowserHost {
  /** The WebSocket to connect to (`connectBrowserManager`), on 127.0.0.1. */
  endpoint: string;
  /** What a client sends as `Authorization: Bearer <token>`: nothing without it reaches the browser. */
  token: string;
  /** The browser's process. */
  pid: number;
  channel: Channel;
  headed: boolean;
  /** Settles once the browser is closed: asked to, or the person closed its window. */
  closed: Promise<void>;
  /** Saves the session cookies and closes the browser. */
  close(): Promise<void>;
}

// Playwright's message when a channel isn't installed (as in manager.ts).
const NOT_INSTALLED = /distribution '[^']+' is not (found|supported)|Executable doesn't exist/i;
// A CDP message as large as a full-page screenshot fits; anything larger is refused, not buffered.
const MAX_MESSAGE = 256 * 1024 * 1024;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * The executable and switches Playwright launches a channel with, from a browser server it starts and
 * closes at once (with `--no-startup-window`, no window shows): the same switches as every other launch,
 * without reaching into Playwright's internals.
 */
async function launchCommand(channel: Channel, headed: boolean): Promise<{ executable: string; args: string[] }> {
  const server = await chromium.launchServer({ channel, headless: !headed });
  try {
    const process = server.process();
    const args = process.spawnargs.slice(1).filter((arg) => arg.startsWith("-") && !/^--(user-data-dir|remote-debugging-pipe|remote-debugging-port|no-startup-window)\b/.test(arg));
    return { executable: process.spawnfile, args };
  } finally {
    await server.close();
  }
}

async function findBrowser(options: HostOptions, headed: boolean): Promise<{ channel: Channel; executable: string; args: string[] }> {
  const channels: Channel[] = options.channel ? [options.channel] : [...SYSTEM_CHANNELS, "chromium"];
  for (const channel of channels) {
    try {
      return { channel, ...(await launchCommand(channel, headed)) };
    } catch (error) {
      if (!NOT_INSTALLED.test((error as Error).message ?? "")) throw error;
      if (channel !== "chromium") continue;
      // Opening a browser to keep is worth waiting for the download (ADR-001).
      await installBrowser("chromium");
      return { channel, ...(await launchCommand(channel, headed)) };
    }
  }
  throw new BrowserNotFoundError(`No browser found (tried ${channels.join(", ")}).`);
}

/** Chrome's debugging protocol on the pipe it was given: JSON messages ending in a NUL byte. */
class CdpPipe {
  private chunks: Buffer[] = [];
  constructor(
    private readonly out: Writable,
    input: Readable,
    onMessage: (text: string) => void,
  ) {
    input.on("data", (data: Buffer) => {
      let start = 0;
      for (let end = data.indexOf(0); end >= 0; end = data.indexOf(0, start)) {
        this.chunks.push(data.subarray(start, end));
        onMessage(Buffer.concat(this.chunks).toString("utf8"));
        this.chunks = [];
        start = end + 1;
      }
      if (start < data.length) this.chunks.push(data.subarray(start));
    });
    input.on("error", () => undefined);
    out.on("error", () => undefined);
  }
  send(text: string): void {
    this.out.write(`${text}\0`);
  }
}

/** A WebSocket accepted on `socket` (RFC 6455, text messages, no extensions): just what CDP needs. */
function acceptWebSocket(request: IncomingMessage, socket: Socket, head: Buffer, onMessage: (text: string) => void, onClose: () => void) {
  const key = request.headers["sec-websocket-key"];
  const accept = createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
  socket.setNoDelay(true);
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buffer = head;
  let fragments: Buffer[] = [];
  let fragmentsLength = 0;
  let closed = false;

  const frame = (opcode: number, payload: Buffer) => {
    if (closed || socket.destroyed) return;
    const length = payload.length;
    const header = length < 126 ? Buffer.from([0x80 | opcode, length]) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
    if (length >= 126 && length < 65536) {
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else if (length >= 65536) {
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  };
  const close = (code = 1000) => {
    if (closed) return;
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(code);
    frame(0x8, payload);
    closed = true;
    socket.end();
  };
  const parse = () => {
    while (buffer.length >= 2) {
      const fin = (buffer[0]! & 0x80) !== 0;
      const opcode = buffer[0]! & 0x0f;
      // A client masks every frame (RFC 6455 5.1).
      if ((buffer[1]! & 0x80) === 0) return close(1002);
      let length = buffer[1]! & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const big = buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return close(1009);
        length = Number(big);
        offset = 10;
      }
      if (length > MAX_MESSAGE || fragmentsLength + length > MAX_MESSAGE) return close(1009);
      if (buffer.length < offset + 4 + length) return;
      const mask = buffer.subarray(offset, offset + 4);
      const payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + length));
      for (let i = 0; i < payload.length; i++) payload[i]! ^= mask[i & 3]!;
      buffer = buffer.subarray(offset + 4 + length);
      if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
        fragments.push(payload);
        fragmentsLength += payload.length;
        if (fin) {
          const message = Buffer.concat(fragments).toString("utf8");
          fragments = [];
          fragmentsLength = 0;
          onMessage(message);
        }
      } else if (opcode === 0x8) return close();
      else if (opcode === 0x9) frame(0xa, payload);
      else if (opcode !== 0xa) return close(1002);
    }
  };
  socket.on("data", (data: Buffer) => {
    buffer = buffer.length > 0 ? Buffer.concat([buffer, data]) : data;
    parse();
  });
  socket.on("close", onClose);
  socket.on("error", () => socket.destroy());
  if (buffer.length > 0) parse();
  return { send: (text: string) => frame(0x1, Buffer.from(text, "utf8")), close };
}

/** Whether the token in `Authorization: Bearer …` is `token`, compared in constant time. */
function hasToken(request: IncomingMessage, token: string): boolean {
  const given = /^Bearer (\S+)$/.exec(request.headers.authorization ?? "")?.[1];
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A cookie as CDP's `Storage.getCookies` gives it. */
interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Launches a browser on `profileDir` and offers it to other processes (`connectBrowserManager`): one
 * at a time, each with the token, on 127.0.0.1 only. Restores the session cookies (ADR-003) and saves
 * them after every client and when it closes. Throws `NoDisplayError` for a window where there's no screen.
 */
export async function hostBrowser(options: HostOptions): Promise<BrowserHost> {
  const headed = options.headed ?? false;
  if (options.channel === "firefox") throw new MoodleError("A background browser is Edge, Chrome or Chromium: it's offered over Chromium's debugging protocol, which Firefox doesn't speak.", "invalid-input");
  if (headed && !canShowWindow()) throw new NoDisplayError("There's no screen to show a browser window here (no DISPLAY or WAYLAND_DISPLAY).");
  const { channel, executable, args } = await findBrowser(options, headed);
  // Chrome reads commands from fd 3 and writes to fd 4 (--remote-debugging-pipe); its own output is of no use here.
  const child: ChildProcess = spawn(executable, [...args, `--user-data-dir=${options.profileDir}`, "--remote-debugging-pipe", "about:blank"], {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
  const killOnExit = () => child.kill();
  process.on("exit", killOnExit);

  type Pending = { own: true; resolve: (value: unknown) => void; reject: (error: Error) => void } | { own: false; client: Client; id: number };
  type Client = ReturnType<typeof acceptWebSocket>;
  const pending = new Map<number, Pending>();
  let nextId = 0;
  let client: Client | undefined;
  // The sessions a client attached to targets: detached when it leaves, so the next one starts clean.
  const sessions = new Set<string>();

  const pipe = new CdpPipe(child.stdio[3] as Writable, child.stdio[4] as Readable, (text) => {
    let message: { id?: number; method?: string; params?: { sessionId?: string }; result?: unknown; error?: { message: string } };
    try {
      message = JSON.parse(text) as typeof message;
    } catch {
      return;
    }
    if (typeof message.id === "number") {
      const waiting = pending.get(message.id);
      pending.delete(message.id);
      if (!waiting) return;
      if (waiting.own) {
        if (message.error) waiting.reject(new MoodleError(message.error.message, "background-browser"));
        else waiting.resolve(message.result);
      } else if (waiting.client === client) client.send(JSON.stringify({ ...message, id: waiting.id }));
      return;
    }
    if (message.method === "Target.attachedToTarget" && message.params?.sessionId) sessions.add(message.params.sessionId);
    if (message.method === "Target.detachedFromTarget" && message.params?.sessionId) sessions.delete(message.params.sessionId);
    client?.send(text);
  });

  const call = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { own: true, resolve: resolve as (value: unknown) => void, reject });
      pipe.send(JSON.stringify({ id, method, params }));
    });
  const timeout = <T>(promise: Promise<T>, ms: number, what: string) =>
    Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new MoodleError(`The browser didn't ${what} in ${ms / 1000} s.`, "background-browser")), ms).unref())]);

  async function saveCookies(): Promise<void> {
    const { cookies } = await call<{ cookies: CdpCookie[] }>("Storage.getCookies");
    const session: Cookie[] = cookies.filter((c) => c.session).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: -1, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite ?? "Lax" }));
    await writeFile(path.join(options.profileDir, SESSION_COOKIES_FILE), JSON.stringify(session), { mode: 0o600 });
  }

  async function restoreCookies(): Promise<void> {
    let saved: Cookie[];
    try {
      saved = JSON.parse(await readFile(path.join(options.profileDir, SESSION_COOKIES_FILE), "utf8")) as Cookie[];
    } catch {
      return;
    }
    if (!Array.isArray(saved) || saved.length === 0) return;
    // Cookies the browser kept itself are newer than the file's.
    const { cookies } = await call<{ cookies: CdpCookie[] }>("Storage.getCookies");
    const kept = new Set(cookies.map((c) => `${c.name}|${c.domain}|${c.path}`));
    const missing = saved.filter((c) => !kept.has(`${c.name}|${c.domain}|${c.path}`)).map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
    if (missing.length > 0) await call("Storage.setCookies", { cookies: missing }).catch(() => undefined);
  }

  /** What a client left behind: its sessions attached, auto-attaching, its downloads folder. */
  function cleanUp(): void {
    for (const sessionId of sessions) call("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    sessions.clear();
    call("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => undefined);
    call("Target.setDiscoverTargets", { discover: false }).catch(() => undefined);
    call("Browser.setDownloadBehavior", { behavior: "default" }).catch(() => undefined);
    saveCookies().catch(() => undefined);
  }

  try {
    await timeout(Promise.race([call("Browser.getVersion"), exited.then(() => Promise.reject(new MoodleError("The browser closed as it started: is another browser using this profile?", "background-browser")))]), 30_000, "start");
    await restoreCookies();
  } catch (error) {
    child.kill();
    process.off("exit", killOnExit);
    throw error;
  }

  const token = randomBytes(32).toString("base64url");
  let closing: Promise<void> | undefined;
  const server = createServer();
  // Only this machine, and only a client that isn't a web page: a page always sends Origin, and a
  // name other than 127.0.0.1 in Host would be DNS rebinding.
  const allowed = (request: IncomingMessage) => request.headers.origin === undefined && request.headers.host === host && hasToken(request, token);
  server.on("request", (request: IncomingMessage, response: ServerResponse) => {
    if (!allowed(request)) return void response.writeHead(401).end();
    if (request.method === "GET" && request.url === "/status") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ pid: child.pid, channel, headed, busy: client !== undefined }));
    } else if (request.method === "POST" && request.url === "/close") {
      response.writeHead(200).end();
      void browserHost.close();
    } else response.writeHead(404).end();
  });
  server.on("upgrade", (request: IncomingMessage, socket: Socket, head: Buffer) => {
    const refuse = (status: string) => socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    if (!allowed(request)) return refuse("401 Unauthorized");
    if (request.url !== "/devtools/browser" || request.headers.upgrade?.toLowerCase() !== "websocket" || !request.headers["sec-websocket-key"]) return refuse("400 Bad Request");
    if (client || closing) return refuse("409 Conflict");
    const accepted: Client = acceptWebSocket(
      request,
      socket,
      head,
      (text) => {
        let message: { id?: unknown };
        try {
          message = JSON.parse(text) as typeof message;
        } catch {
          return;
        }
        if (typeof message.id !== "number") return;
        // The browser outlives its clients: one closing it only disconnects (the host closes it, asked to).
        if ((message as { method?: string }).method === "Browser.close") {
          accepted.send(JSON.stringify({ id: message.id, result: {} }));
          accepted.close();
          return;
        }
        // Every client numbers its commands from 1: the browser sees ids of this process's own.
        const id = ++nextId;
        pending.set(id, { own: false, client: accepted, id: message.id });
        pipe.send(JSON.stringify({ ...message, id }));
      },
      () => {
        if (client !== accepted) return;
        client = undefined;
        if (!closing) cleanUp();
      },
    );
    client = accepted;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const host = `127.0.0.1:${port}`;

  const closed = exited.then(() => {
    process.off("exit", killOnExit);
    client?.close(1001);
    client = undefined;
    for (const waiting of pending.values()) if (waiting.own) waiting.reject(new MoodleError("The browser closed.", "background-browser"));
    pending.clear();
    server.close();
    server.closeAllConnections();
  });

  const browserHost: BrowserHost = {
    endpoint: `ws://${host}/devtools/browser`,
    token,
    pid: child.pid!,
    channel,
    headed,
    closed,
    close() {
      closing ??= (async () => {
        client?.close(1001);
        await timeout(saveCookies(), 10_000, "give its cookies").catch(() => undefined);
        await timeout(call("Browser.close"), 10_000, "close").catch(() => child.kill());
        await timeout(exited, 10_000, "exit").catch(() => child.kill("SIGKILL"));
        await closed;
      })();
      return closing;
    },
  };
  return browserHost;
}
