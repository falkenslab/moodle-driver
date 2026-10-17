// A glossary's entries to and from Moodle's XML: exported as the export page's button does (the file
// it posts to is the glossary's pluginfile export.xml), imported through the import form (a file
// picker, the destination, whether categories come too) into the same glossary.
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright-core";
import { MoodleError } from "../../core/errors.js";
import { checkLocalFiles, fileNameFor, freePath, type DownloadedFile } from "../../core/files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft } from "../../core/forms.js";
import { openSitePage } from "../../core/session.js";
import { GlossaryError, failOnRefusal, openGlossaryPage } from "./glossary.js";

const EXPORT = "exporting entries takes Moodle's capability mod/glossary:export, which teachers have";
const IMPORT = "importing entries takes Moodle's capability mod/glossary:import, which teachers have";

/**
 * Saves a glossary's approved entries into `destDir` as Moodle's XML (`export.xml`, with their
 * aliases, categories and files; Moodle leaves the waiting ones out, confirmed on 5.2), as the
 * glossary's "Export entries" does; the file imports into a glossary with `importGlossaryEntries`.
 * Returns the file as `downloadFile` does (never overwriting one). Throws `GlossaryError` when the person can't export the glossary (mod/glossary:export).
 */
export async function exportGlossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, { destDir }: { destDir: string }): Promise<DownloadedFile> {
  if (!destDir || !path.isAbsolute(destDir)) throw new MoodleError(`Give the destination folder as an absolute path: "${destDir ?? ""}".`, "invalid-input");
  const page = await openGlossaryPage(context, siteUrl, activityId, `export.php?id=${activityId}`, `You can't export glossary ${activityId}'s entries`, EXPORT);
  try {
    // The export button's form posts to the glossary's export file, which Moodle sends as a download.
    const button = page.locator('form[action*="/mod_glossary/export/"] [type="submit"]');
    if ((await button.count()) === 0) throw new GlossaryError(`Glossary ${activityId}'s export page has no export button.`);
    const [download] = await Promise.all([page.waitForEvent("download"), button.first().click({ noWaitAfter: true })]);
    const failure = await download.failure();
    if (failure) throw new GlossaryError(`Moodle didn't send glossary ${activityId}'s entries: ${failure}.`);
    await mkdir(destDir, { recursive: true });
    const saved = await freePath(destDir, fileNameFor(new URL(download.url()), `attachment; filename="${download.suggestedFilename()}"`));
    await download.saveAs(saved);
    return { path: saved, name: path.basename(saved), size: (await stat(saved)).size, contentType: "text/xml" };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** What importing entries did: how many the file had, how many came in, and how many Moodle rejected (duplicates, or with no concept or definition). */
export interface GlossaryImport {
  changed: string;
  total: number;
  imported: number;
  rejected: number;
  /** With `categories`, how many categories Moodle added for the entries. */
  categoriesAdded?: number;
}

/**
 * Imports the entries of a glossary's XML (as `exportGlossaryEntries` saves it) into this glossary,
 * through its import form, as the teacher's own entries, approved. With `categories`, the entries'
 * categories come too, added when the glossary lacks them. Moodle rejects an entry whose concept is
 * already there (when the glossary takes no duplicates) or that has no concept or definition. Throws
 * `GlossaryError` when the person can't import (mod/glossary:import) or Moodle can't read the file.
 */
export async function importGlossaryEntries(context: BrowserContext, siteUrl: string, activityId: number, file: string, { categories = false }: { categories?: boolean } = {}): Promise<GlossaryImport> {
  await checkLocalFiles([file]);
  const refused = `You can't import entries into glossary ${activityId}`;
  let page;
  try {
    page = await openForm(context, siteUrl, `mod/glossary/import.php?id=${activityId}`);
  } catch (error) {
    if (!(error instanceof MoodleError && error.code === "form")) throw error;
    const errorPage = await openSitePage(context, siteUrl, `mod/glossary/import.php?id=${activityId}`);
    try {
      await failOnRefusal(errorPage, activityId, refused, IMPORT);
    } finally {
      await errorPage.close().catch(() => undefined);
    }
    throw new GlossaryError(`${refused}: its import form isn't there.`);
  }
  try {
    const draft = await formValue(page, "file");
    if (!draft) throw new GlossaryError(`Glossary ${activityId}'s import form has no file to choose.`);
    await uploadToDraft(page, draft, [file]);
    await setFields(page, { dest: "current", catsincl: categories });
    await submitForm(page, "submitbutton");
    // The report's first table: total, imported (with the rejected in brackets), and categories; by position.
    const rows = await page.evaluate(() => {
      const table = (globalThis as unknown as { document: { querySelector(s: string): { rows: ArrayLike<{ cells: ArrayLike<{ textContent: string | null }> }> } | null } }).document.querySelector("table.glossaryimportexport");
      return Array.from(table?.rows ?? []).map((row) => Number(/\d+/.exec(Array.from(row.cells)[1]?.textContent ?? "")?.[0] ?? Number.NaN));
    });
    if (rows.length < 2 || rows.slice(0, 2).some((n) => Number.isNaN(n))) throw new GlossaryError(`Moodle couldn't import ${path.basename(file)} into glossary ${activityId}: it isn't a glossary's XML export.`);
    const [total, imported] = rows as [number, number];
    const added = categories ? rows[2] : undefined;
    const rejected = total - imported;
    return {
      changed: `Imported ${imported} of ${total} entries into glossary ${activityId}${rejected > 0 ? ` (${rejected} rejected)` : ""}${added !== undefined ? `, ${added} new categories` : ""}.`,
      total,
      imported,
      rejected,
      ...(added !== undefined ? { categoriesAdded: added } : {}),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
