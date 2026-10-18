// A course's grades as Moodle exports them: the export plugin's form (grade/export/<plugin>/index.php)
// filled and sent as its button does, and the file it answers with saved as a download.
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import { setFields, type FieldValue } from "../../core/forms.js";
import { fileNameFor, freePath, type DownloadedFile } from "../../core/files.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { GradebookError } from "./gradebook.js";

/** The export formats by the export plugin that makes each (Moodle's "Excel spreadsheet" is an .xlsx). */
const PLUGINS = { xlsx: "xls", ods: "ods", csv: "txt", xml: "xml" } as const;
/** A file format `exportGrades` saves grades in (one of `GRADE_EXPORT_FORMATS`). */
export type GradeExportFormat = keyof typeof PLUGINS;
/** The formats grades can be exported in, where the site has their export plugin enabled. */
export const GRADE_EXPORT_FORMATS = Object.keys(PLUGINS) as GradeExportFormat[];

/** How grades are written: the points, the percentage, the letter (several for every format but XML). */
export type GradeExportDisplay = "real" | "percentage" | "letter";
const DISPLAY_CODES: Record<GradeExportDisplay, number> = { real: 1, percentage: 2, letter: 3 };
/** How long Moodle may take to start sending the file (a big course's grades). */
const EXPORT_TIMEOUT = 180_000;

/** What `exportGrades` exports and where it saves it, as the export form chooses. */
export interface ExportGradesOptions {
  format: GradeExportFormat;
  /** The grade items to export (ids from `graderReport` or `gradebookSetup`); all of them when left out. */
  itemIds?: number[];
  /** Only this group's members (a group id from `groups`). */
  groupId?: number;
  /** How grades are written; the site's default when left out. XML takes only one. */
  display?: GradeExportDisplay[];
  /** Include each grade's feedback. */
  feedback?: boolean;
  /** The folder to save the file in (an absolute path); the `Moodle` object's `downloadDir` when left out there. */
  destDir?: string;
}

/**
 * Saves a course's grades into `destDir` as Moodle exports them for a teacher: a spreadsheet
 * (`xlsx`, `ods`), comma-separated text (`csv`) or XML, with the items, group, display and feedback
 * chosen as in the export form. Returns the file as `downloadFile` does (never overwriting one).
 * Throws `GradebookError` when the site has that format's export plugin disabled (naming the ones
 * it has), when an item isn't in the course, or when Moodle refuses the export.
 */
export async function exportGrades(context: BrowserContext, siteUrl: string, courseId: number, options: ExportGradesOptions): Promise<DownloadedFile> {
  const { format, itemIds, groupId, display, feedback, destDir } = options;
  const plugin = PLUGINS[format];
  if (!plugin) throw new MoodleError(`Grades export as ${GRADE_EXPORT_FORMATS.join(", ")}; not "${format}".`, "invalid-input");
  if (!destDir) throw new MoodleError("Give exportGrades a destDir: the folder to save the file in.", "invalid-input");
  if (!path.isAbsolute(destDir)) throw new MoodleError(`Give the destination folder as an absolute path: "${destDir}".`, "invalid-input");
  if (format === "xml" && display !== undefined && display.length !== 1) throw new MoodleError("An XML export writes grades in one way only: give one display.", "invalid-input");
  // `group` is the export page's group selector, as Moodle's own menu sets it.
  const page = await openSitePage(context, siteUrl, `grade/export/${plugin}/index.php?id=${courseId}${groupId !== undefined ? `&group=${groupId}` : ""}`);
  try {
    // The gradebook's navigation menu lists the export plugins the site has enabled, by their URLs.
    const menu = await page.evaluate(() =>
      Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ getAttribute(name: string): string | null }> } }).document.querySelectorAll('[role="option"][data-value*="/grade/export/"]')).map(
        (option) => option.getAttribute("data-value") ?? "",
      ),
    );
    const available = GRADE_EXPORT_FORMATS.filter((f) => menu.some((url) => url.includes(`/grade/export/${PLUGINS[f]}/index.php`)));
    if (menu.length > 0 && !available.includes(format)) {
      throw new GradebookError(`The site doesn't export grades as ${format}; it exports as: ${available.join(", ") || "nothing"}.`);
    }
    if ((await page.locator(`body#page-grade-export-${plugin}-index form.mform`).count()) === 0) {
      const refused = await moodleErrorMessage(page);
      throw new GradebookError(`You can't export course ${courseId}'s grades as ${format}: ${refused ?? "the course doesn't exist, the format's export is disabled on the site, or you aren't allowed"}.`);
    }
    // XML exports only items with an ID number: the others' boxes are frozen unticked.
    const items = await page.evaluate(() =>
      Array.from(
        (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string; disabled: boolean; checked: boolean }> } }).document.querySelectorAll('form.mform input[type="checkbox"][name^="itemids["]'),
      ).map((e) => ({ id: Number(/\[(\d+)\]/.exec(e.name)?.[1]), exportable: !e.disabled || e.checked })),
    );
    const exportable = items.filter((i) => i.exportable).map((i) => i.id);
    if (format === "xml" && exportable.length === 0) {
      throw new GradebookError(`None of course ${courseId}'s grade items has an ID number, and an XML export only takes items with one: set them in the items' settings, or export another format.`);
    }
    const values: Record<string, FieldValue> = {};
    if (itemIds !== undefined) {
      const unknown = itemIds.filter((id) => !items.some((i) => i.id === id));
      if (unknown.length > 0) throw new GradebookError(`Course ${courseId}'s export has no grade item ${unknown.join(", ")}: it offers ${items.map((i) => i.id).join(", ")}.`);
      const frozen = itemIds.filter((id) => !exportable.includes(id));
      if (frozen.length > 0) throw new GradebookError(`Grade item ${frozen.join(", ")} has no ID number, and an XML export only takes items with one.`);
      for (const id of exportable) values[`itemids[${id}]`] = itemIds.includes(id);
    }
    if (display !== undefined) {
      if (format === "xml") values.display = DISPLAY_CODES[display[0]!];
      else for (const d of Object.keys(DISPLAY_CODES) as GradeExportDisplay[]) values[`display[${d}]`] = display.includes(d);
    }
    if (feedback !== undefined) values.export_feedback = feedback;
    if (format === "csv") values.separator = "comma";
    await setFields(page, values);
    // Sent as its button sends it, from the page: Moodle 4.5 puts the button in a sticky footer a
    // theme's own footer or a banner may cover, which a click would wait on forever. A big course's
    // file takes a while; a page instead of a file is Moodle refusing.
    const downloaded = page.waitForEvent("download", { timeout: EXPORT_TIMEOUT });
    const landed = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: EXPORT_TIMEOUT });
    downloaded.catch(() => undefined);
    landed.catch(() => undefined);
    const sent = await page.evaluate(() => {
      const button = (globalThis as unknown as { document: { querySelector(s: string): { form: { requestSubmit(submitter: unknown): void } | null } | null } }).document.querySelector(
        'form.mform [name="submitbutton"]',
      );
      if (!button?.form) return false;
      button.form.requestSubmit(button);
      return true;
    });
    if (!sent) throw new GradebookError(`Course ${courseId}'s export form as ${format} has no button to send it.`);
    // A navigation turned into a download may end as aborted: the download is the answer then.
    const download = await Promise.race([
      downloaded,
      landed.then(
        () => undefined,
        () => downloaded,
      ),
    ]);
    if (!download) {
      const refused = await moodleErrorMessage(page);
      throw new GradebookError(`Moodle answered course ${courseId}'s export as ${format} with a page, not a file: ${refused ?? `see ${page.url()}`}.`);
    }
    const failure = await download.failure();
    if (failure) throw new GradebookError(`Moodle didn't send course ${courseId}'s grades as ${format}: ${failure}.`);
    await mkdir(destDir, { recursive: true });
    const saved = await freePath(destDir, fileNameFor(new URL(download.url()), `attachment; filename="${download.suggestedFilename()}"`));
    await download.saveAs(saved);
    return { path: saved, name: path.basename(saved), size: (await stat(saved)).size };
  } finally {
    await page.close().catch(() => undefined);
  }
}
