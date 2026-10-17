// Grades imported from a CSV file as Moodle's CSV import does (grade/import/csv/index.php): the file
// uploaded to its form, Moodle's preview read from the page it answers with, the mapping form under
// it filled and sent.
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { FormError, formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { checkLocalFiles } from "../../core/files.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { GradebookError } from "./gradebook.js";

/** The user field a CSV column identifies people by, as the mapping form's "Map to" offers it. */
export type GradeImportUserField = "id" | "username" | "idnumber" | "email";
const MAP_TO: Record<GradeImportUserField, string> = { id: "userid", username: "username", idnumber: "useridnumber", email: "useremail" };

/** What `importGrades` reads from the file and where it puts each column. */
export interface ImportGradesOptions {
  /** The CSV column (its header) that identifies each person. */
  mapFrom: string;
  /** What that column holds: Moodle's user id, username, ID number or email address. */
  mapTo: GradeImportUserField;
  /**
   * The CSV columns to import, by header: into a grade item (its id, from `gradebookSetup`), or as
   * that item's feedback (`{ feedback: <item id> }`). The file's other columns are ignored.
   */
  columns: Record<string, number | { feedback: number }>;
  /** Only upload the file and give Moodle's preview of it, without importing anything. */
  preview?: boolean;
  /** The file's separator; a comma when left out. */
  separator?: "comma" | "semicolon" | "tab" | "colon";
  /** The file's encoding, one Moodle offers; UTF-8 when left out. */
  encoding?: string;
}

/** The file as Moodle's import reads it: its columns' headers and its rows, as text. */
export interface GradeImportPreview {
  columns: string[];
  rows: string[][];
}

/** What `importGrades` did: imported or only previewed, Moodle's preview, and what else Moodle said. */
export interface ImportGradesResult {
  changed: string;
  imported: boolean;
  preview: GradeImportPreview;
  /** Moodle's other messages after importing (grades for people not enrolled in the course). */
  notices: string[];
}

const refusedMessage = (courseId: number, message: string) =>
  `You can't import grades into course ${courseId} (Moodle says: ${message}): it takes Moodle's capabilities moodle/grade:import and gradeimport/csv:view.`;

/** The notifications in the page's main region, by their kind. */
function notifications(page: Page): Promise<{ success: string[]; danger: string[] }> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(
    page,
    () => {
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ textContent: string | null; querySelectorAll(s: string): ArrayLike<{ remove(): void }>; cloneNode(deep: boolean): unknown }> } }).document;
      const texts = (kind: string) =>
        Array.from(doc.querySelectorAll(`[role="main"] .alert-${kind}`)).map((alert) => {
          const copy = alert.cloneNode(true) as typeof alert;
          for (const extra of Array.from(copy.querySelectorAll("button, .visually-hidden"))) extra.remove();
          return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
        });
      return { success: texts("success"), danger: texts("danger") };
    },
    null,
  );
}

/** Moodle's preview of the uploaded file (the table above the mapping form) and the mapping form's choices. */
export function readImportPreview(page: Page): Promise<{ preview: GradeImportPreview; headers: string[]; targets: string[] }> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(page, () => {
    interface El {
      textContent: string | null;
      value: string;
      querySelectorAll(s: string): ArrayLike<El>;
    }
    const doc = (globalThis as unknown as { document: { querySelector(s: string): El | null; querySelectorAll(s: string): ArrayLike<El> } }).document;
    const table = doc.querySelector('[role="main"] table');
    const text = (el: El) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
    const columns = Array.from(table?.querySelectorAll("thead th") ?? []).map(text);
    const rows = Array.from(table?.querySelectorAll("tbody tr") ?? []).map((row) => Array.from(row.querySelectorAll("td")).map(text));
    // The mapping form: "Map from" lists the file's headers by their index; each column's select offers the items.
    const headers = Array.from(doc.querySelectorAll('form.mform select[name="mapfrom"] option')).map(text);
    const targets = Array.from(doc.querySelectorAll('form.mform select[name="mapping_0"] option')).map((option) => option.value);
    return { preview: { columns, rows }, headers, targets };
  }, null);
}

/**
 * Imports grades from a CSV file into a course's gradebook, as Moodle's CSV import does: the column
 * `mapFrom` identifies each person by `mapTo`, and `columns` says which grade item (or which item's
 * feedback) each other column goes into. With `preview`, the file is only uploaded and Moodle's
 * preview of it returned: its headers and rows as Moodle reads them, nothing imported. Moodle imports
 * all or nothing: a person not found, or a grade it refuses, imports no grade, and its messages
 * come in the `GradebookError`. Throws `GradebookError` too when the file has no such column, when
 * an item can't take imported grades (an activity's, locked, or not in the course), and naming the
 * capabilities when the person can't import grades.
 */
export async function importGrades(context: BrowserContext, siteUrl: string, courseId: number, file: string, options: ImportGradesOptions): Promise<ImportGradesResult> {
  const { mapFrom, mapTo, columns, preview = false, separator = "comma", encoding = "UTF-8" } = options;
  if (!MAP_TO[mapTo]) throw new MoodleError(`mapTo is one of ${Object.keys(MAP_TO).join(", ")}; not "${mapTo}".`, "invalid-input");
  if (Object.keys(columns).length === 0) throw new MoodleError("Give columns: the CSV columns to import, and the grade item each goes into.", "invalid-input");
  if (mapFrom in columns) throw new MoodleError(`Column "${mapFrom}" identifies the people: it can't be imported into a grade item too.`, "invalid-input");
  await checkLocalFiles([file]);
  const name = path.basename(file);
  let page: Page;
  try {
    page = await openForm(context, siteUrl, `grade/import/csv/index.php?id=${courseId}`);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const refused = await openSitePage(context, siteUrl, `grade/import/csv/index.php?id=${courseId}`);
    try {
      throw new GradebookError(refusedMessage(courseId, (await moodleErrorMessage(refused)) ?? "the course doesn't exist, or the site has the CSV import disabled"));
    } finally {
      await refused.close().catch(() => undefined);
    }
  }
  try {
    const draft = await formValue(page, "userfile");
    if (!draft) throw new GradebookError(`Course ${courseId}'s grade import has no file to upload to.`);
    await uploadToDraft(page, draft, [file]);
    // The preview shows as many rows as asked: the most Moodle offers, so it's the whole file.
    await setFields(page, { encoding, separator, previewrows: "100000" });
    await submitForm(page, "submitbutton");
    if ((await page.locator('form.mform input[name="_qf__grade_import_mapping_form"]').count()) === 0) {
      const { danger } = await notifications(page);
      throw new GradebookError(`Moodle didn't read ${name} for course ${courseId}: ${danger.join(" ") || (await moodleErrorMessage(page)) || "no reason given"}`);
    }
    const read = await readImportPreview(page);
    const index = (header: string) => read.headers.findIndex((h) => h === header.trim());
    const unknown = [mapFrom, ...Object.keys(columns)].filter((header) => index(header) < 0);
    if (unknown.length > 0) throw new GradebookError(`${name} has no column ${unknown.map((h) => `"${h}"`).join(", ")}; its columns are: ${read.headers.map((h) => `"${h}"`).join(", ")}.`);
    const values: Record<string, FieldValue> = { mapfrom: String(index(mapFrom)), mapto: MAP_TO[mapTo] };
    for (let i = 0; i < read.headers.length; i++) values[`mapping_${i}`] = "0";
    const items = read.targets.filter((value) => /^\d+$/.test(value) && value !== "0");
    for (const [header, target] of Object.entries(columns)) {
      const value = typeof target === "number" ? String(target) : `feedback_${target.feedback}`;
      if (!read.targets.includes(value)) {
        throw new GradebookError(
          `Grade item ${typeof target === "number" ? target : target.feedback} can't take imported grades in course ${courseId} (an activity's or locked item, or not in the course); it takes them into items ${items.join(", ") || "none"}.`,
        );
      }
      values[`mapping_${index(header)}`] = value;
    }
    const rows = read.preview.rows.length;
    if (preview) return { changed: `Nothing imported: Moodle's preview of ${name}, ${rows} row${rows === 1 ? "" : "s"}.`, imported: false, preview: read.preview, notices: [] };
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    const outcome = await notifications(page);
    if (outcome.success.length === 0) {
      throw new GradebookError(`Moodle didn't import ${name} into course ${courseId}: ${outcome.danger.join(" ") || (await moodleErrorMessage(page)) || "no reason given"}`);
    }
    const targets = [...new Set(Object.values(columns).map((t) => (typeof t === "number" ? t : t.feedback)))];
    return {
      changed: `Imported ${name} into course ${courseId}: ${rows} row${rows === 1 ? "" : "s"}, into grade item${targets.length === 1 ? "" : "s"} ${targets.join(", ")}.`,
      imported: true,
      preview: read.preview,
      notices: outcome.success.slice(1),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
