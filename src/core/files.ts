import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import { NotLoggedInError } from "./session.js";
import { MoodleError } from "./errors.js";

/** Local files given to upload (a submission, an attachment, a resource): absolute, and there. */
export async function checkLocalFiles(files: string[]): Promise<void> {
  for (const file of files) {
    if (!path.isAbsolute(file)) throw new MoodleError(`Give files as absolute paths: "${file}".`, "invalid-input");
    await access(file).catch(() => {
      throw new MoodleError(`There's no file at ${file}.`, "not-found");
    });
  }
}

/** A file name from Content-Disposition, else the URL's last segment; never a path. */
export function fileNameFor(url: URL, disposition: string | undefined): string {
  const encoded = disposition && /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = disposition && /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const raw = encoded ? decodeURIComponent(encoded) : (plain ?? decodeURIComponent(url.pathname.split("/").pop() || "download"));
  // The last segment of whatever path it names, then without characters a file name can't have.
  const name = (raw.split(/[\\/]/).pop() ?? "").replace(/[:*?"<>|]+/g, "_").trim();
  return name === "" || name === "." || name === ".." ? "download" : name;
}

/** `dir/name`, or `dir/name (2).ext`… when it exists: a download never overwrites. */
async function freePath(dir: string, name: string): Promise<string> {
  const { name: stem, ext } = path.parse(name);
  for (let n = 1; ; n++) {
    const candidate = path.join(dir, n === 1 ? name : `${stem} (${n})${ext}`);
    if (!(await access(candidate).then(() => true, () => false))) return candidate;
  }
}

export interface DownloadedFile {
  path: string;
  name: string;
  size: number;
  contentType?: string;
}

/**
 * Saves a file of the site into `destDir` with the person's session, never overwriting. Only URLs of
 * the site's origin: the session's cookies go nowhere else (its media outside Moodle's path included).
 */
export async function downloadFile(context: BrowserContext, siteUrl: string, url: string, destDir: string): Promise<DownloadedFile> {
  const target = new URL(url);
  const origin = new URL(siteUrl).origin;
  if (target.origin !== origin) throw new MoodleError(`Only files of ${origin} can be downloaded with the session; ${target.origin} isn't the site.`, "outside-site");
  if (!path.isAbsolute(destDir)) throw new MoodleError(`Give the destination folder as an absolute path: "${destDir}".`, "invalid-input");
  // The context's request API carries its cookies without opening a tab.
  const response = await context.request.get(target.href, { maxRedirects: 5 });
  const contentType = response.headers()["content-type"]?.split(";")[0]?.trim();
  // A file the session can't reach comes back as the login page.
  if (contentType === "text/html" && new URL(response.url()).pathname.includes("/login/")) throw new NotLoggedInError();
  if (!response.ok()) throw new MoodleError(`Moodle answered ${response.status()} for ${target.pathname}: the file doesn't exist or you can't see it.`, "not-found");
  await mkdir(destDir, { recursive: true });
  const body = await response.body();
  const saved = await freePath(destDir, fileNameFor(target, response.headers()["content-disposition"]));
  await writeFile(saved, body);
  return { path: saved, name: path.basename(saved), size: body.length, contentType };
}
