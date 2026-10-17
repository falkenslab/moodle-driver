// A course's scales, as its scales page lists them (grade/edit/scale/index.php) and its form adds and
// edits them (grade/edit/scale/edit.php); and its grade letters, as the letters page's form shows and
// sets them (grade/edit/letter/index.php, by the course's context id).
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { FormError, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { fetchSitePage, moodleErrorMessage, openSitePage, readMoodleConfig } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";
import { GradebookError } from "./gradebook.js";

/** A scale a course's grades can use: the course's own, or one of the site's (standard scales). */
export interface GradeScale {
  id: number;
  name: string;
  /** Its values, from the lowest to the highest. */
  items: string[];
  /** Whether something grades with it (an item, an activity, an outcome): its items can't change then. */
  used: boolean;
  /** One of the site's standard scales, not the course's own. */
  site: boolean;
}

/** Opens a gradebook form, or throws `GradebookError` with Moodle's reason and what it takes. */
async function openGradeForm(context: BrowserContext, siteUrl: string, pathAndQuery: string, refused: (message: string) => string): Promise<Page> {
  try {
    return await openForm(context, siteUrl, pathAndQuery);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const page = await openSitePage(context, siteUrl, pathAndQuery);
    try {
      throw new GradebookError(refused((await moodleErrorMessage(page)) ?? "the page has no form"));
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

const scalesRefused = (courseId: number) => (message: string) => `You can't manage course ${courseId}'s scales (Moodle says: ${message}): it takes Moodle's capability moodle/course:managescales.`;

/** The scales page's rows: the course's table has the class scaletable (Moodle's site table hasn't), each row its name, values, "used" cell and links. */
export function readScalesPage(page: Page): Promise<{ site: boolean; name: string; items: string[]; usedText: string; editId?: number; deletable: boolean }[]> {
  return page.evaluate(() => {
    interface El {
      className: string;
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
      cloneNode(deep: boolean): El;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    const rows = [];
    for (const table of Array.from(doc.querySelectorAll('[role="main"] table'))) {
      // Moodle overwrites the course table's class with the site's when both show; only the course's has scaletable.
      const site = !/\bscaletable\b/.test(table.className);
      for (const row of Array.from(table.querySelectorAll("tbody tr"))) {
        const cells = Array.from(row.querySelectorAll("td"));
        const options = cells[0]?.querySelector(".scale_options");
        if (!cells[0] || !options) continue;
        const nameCell = cells[0].cloneNode(true);
        for (const extra of Array.from(nameCell.querySelectorAll(".scale_options"))) extra.remove();
        const edit = /[?&]id=(\d+)/.exec(row.querySelector('a[href*="edit.php"]')?.getAttribute("href") ?? "")?.[1];
        rows.push({
          site,
          name: (nameCell.textContent ?? "").replace(/\s+/g, " ").trim(),
          items: (options.textContent ?? "").split(",").map((item) => item.replace(/\s+/g, " ").trim()),
          usedText: (cells[1]?.textContent ?? "").replace(/\s+/g, " ").trim(),
          ...(edit ? { editId: Number(edit) } : {}),
          deletable: row.querySelector('a[href*="action=delete"]') !== null,
        });
      }
    }
    return rows;
  });
}

/** The scale ids the gradebook's item form offers (`scaleid`), in Moodle's order: the course's, then the site's. */
async function offeredScaleIds(context: BrowserContext, siteUrl: string, courseId: number): Promise<number[]> {
  const rendered = await callService<{ html: string }>(context, siteUrl, "core_form_dynamic_form", { form: "core_grades\\form\\add_item", formdata: `courseid=${courseId}` });
  const select = /<select[^>]*name="scaleid"[^>]*>([\s\S]*?)<\/select>/.exec(rendered.html)?.[1] ?? "";
  return [...select.matchAll(/<option[^>]*value="(\d+)"/g)].map((m) => Number(m[1])).filter((id) => id !== 0);
}

/**
 * A course's scales: its own, and the site's standard scales (`site`), with their values and whether
 * something grades with them. Throws `GradebookError` naming the capability when the person can't
 * manage the course's scales.
 */
export async function courseScales(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeScale[]> {
  const page = await openSitePage(context, siteUrl, `grade/edit/scale/index.php?id=${courseId}`);
  let rows: Awaited<ReturnType<typeof readScalesPage>>;
  try {
    const refused = await moodleErrorMessage(page);
    if (refused !== undefined || (await page.locator("body#page-grade-edit-scale-index").count()) === 0) {
      throw new GradebookError(scalesRefused(courseId)(refused ?? "the course doesn't exist"));
    }
    rows = await readScalesPage(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  // The site's scales have no links for someone who can't manage the site's: their ids come from the
  // item form, which lists the same scales in the same order (both fetch the course's, then the site's).
  const local = rows.filter((row) => !row.site);
  const site = rows.filter((row) => row.site);
  const offered = site.some((row) => row.editId === undefined) ? await offeredScaleIds(context, siteUrl, courseId) : [];
  // A course scale shows its delete link only while unused; a site scale without links says it in words, Moodle's "Yes".
  const yes = rows.some((row) => row.site && row.editId === undefined) ? await callService<string>(context, siteUrl, "core_get_string", { stringid: "yes", component: "moodle" }) : "";
  return rows.map((row) => {
    const position = site.indexOf(row);
    const id = row.editId ?? (row.site ? offered[local.length + position] : undefined);
    if (id === undefined) throw new GradebookError(`Course ${courseId}'s scales page doesn't say which scale "${row.name}" is.`);
    return { id, name: row.name, items: row.items, used: row.editId !== undefined ? !row.deletable : row.usedText === yes, site: row.site };
  });
}

/** What a scale is made of, as `addScale` and `editScale` write it. */
export interface ScaleFields {
  name?: string;
  /** Its values, from the lowest to the highest (no commas inside: Moodle separates them with commas). */
  items?: string[];
  /** Its description (HTML). */
  description?: string;
}

function scaleValues({ name, items, description }: ScaleFields): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  if (name !== undefined) {
    if (name.trim() === "") throw new MoodleError("Give the scale a name.", "invalid-input");
    values.name = name;
  }
  if (items !== undefined) {
    if (items.length === 0 || items.some((item) => item.trim() === "")) throw new MoodleError("Give the scale its values, none of them empty.", "invalid-input");
    const comma = items.find((item) => item.includes(","));
    if (comma !== undefined) throw new MoodleError(`A scale's value can't have a comma: Moodle separates them with commas ("${comma}").`, "invalid-input");
    values.scale = items.map((item) => item.trim()).join(",");
  }
  if (description !== undefined) values["description_editor[text]"] = description;
  return values;
}

/**
 * Adds a scale to a course (its own, not the site's): its name and values from the lowest to the
 * highest. Returns it as `courseScales` reads it. Throws `GradebookError` with Moodle's reason when
 * it refuses (the course already has a scale with these values), and naming the capability when the
 * person can't manage the course's scales.
 */
export async function addScale(context: BrowserContext, siteUrl: string, courseId: number, fields: ScaleFields & { name: string; items: string[] }): Promise<{ changed: string; scale?: GradeScale }> {
  if (fields.name === undefined || fields.items === undefined) throw new MoodleError("Give the scale a name and its items.", "invalid-input");
  const values = scaleValues(fields);
  const before = new Set((await courseScales(context, siteUrl, courseId)).map((s) => s.id));
  const page = await openGradeForm(context, siteUrl, `grade/edit/scale/edit.php?courseid=${courseId}`, scalesRefused(courseId));
  try {
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } catch (error) {
    if (error instanceof FormError) throw new GradebookError(`Moodle refused the scale: ${error.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}.`);
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
  const scale = (await courseScales(context, siteUrl, courseId)).find((s) => !before.has(s.id));
  return { changed: `Scale ${scale?.id ?? "?"} "${fields.name}" added to course ${courseId}.`, scale };
}

/**
 * Changes a scale of the course: its name, values or description. A scale something grades with
 * keeps its values (Moodle freezes them): changing them throws `GradebookError`, its name and
 * description still change. A site scale is changed only by someone who can manage the site's
 * scales. Returns the scale afterwards.
 */
export async function editScale(context: BrowserContext, siteUrl: string, courseId: number, scaleId: number, fields: ScaleFields): Promise<{ changed: string; scale?: GradeScale }> {
  const values = scaleValues(fields);
  if (Object.keys(values).length === 0) throw new MoodleError("Give the scale's name, items or description to change.", "invalid-input");
  const current = (await courseScales(context, siteUrl, courseId)).find((s) => s.id === scaleId);
  if (!current) throw new GradebookError(`Course ${courseId} has no scale ${scaleId}: check the id in courseScales.`);
  if (fields.items !== undefined && current.used && fields.items.join(",") !== current.items.join(",")) {
    throw new GradebookError(`Scale ${scaleId} "${current.name}" is in use: Moodle doesn't change the values of a scale something grades with. Add a new scale instead.`);
  }
  const page = await openGradeForm(context, siteUrl, `grade/edit/scale/edit.php?courseid=${courseId}&id=${scaleId}`, (message) =>
    current.site
      ? `You can't edit site scale ${scaleId} (Moodle says: ${message}): it takes Moodle's capability moodle/course:managescales on the whole site.`
      : scalesRefused(courseId)(message),
  );
  try {
    // A used scale's values come frozen, without their field.
    if (values.scale !== undefined && (await page.locator('form.mform textarea[name="scale"]').count()) === 0) delete values.scale;
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } catch (error) {
    if (error instanceof FormError) throw new GradebookError(`Moodle refused the scale: ${error.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}.`);
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
  const scale = (await courseScales(context, siteUrl, courseId)).find((s) => s.id === scaleId);
  const done = [fields.name !== undefined && `renamed "${fields.name}"`, fields.items !== undefined && `values ${fields.items.join(", ")}`, fields.description !== undefined && "description changed"].filter(Boolean);
  return { changed: `Scale ${scaleId} ${done.join(", ")}.`, scale };
}

/** A grade letter: shown for a grade from `minGrade` percent up to the next letter's. */
export interface GradeLetter {
  letter: string;
  /** Its lower boundary, in percent (0 to 100). */
  minGrade: number;
}

/** A course's grade letters: its own when `overridden`, else the site's defaults. */
export interface GradeLetters {
  overridden: boolean;
  /** From the highest boundary to the lowest. */
  letters: GradeLetter[];
}

/** The course's context id, which the letters page goes by (`M.cfg.contextid` on its page). */
async function courseContextId(context: BrowserContext, siteUrl: string, courseId: number): Promise<number> {
  const { html } = await fetchSitePage(context, siteUrl, `course/view.php?id=${courseId}`, { follow: false });
  const id = Number(readMoodleConfig(html)?.contextid);
  if (!id || !new RegExp(`<body\\b[^>]*\\bclass="[^"]*\\bcourse-${courseId}\\b`).test(html)) throw new GradebookError(`Course ${courseId} doesn't exist, or you can't open it.`);
  return id;
}

const lettersRefused = (courseId: number) => (message: string) => `You can't manage course ${courseId}'s grade letters (Moodle says: ${message}): it takes Moodle's capability moodle/grade:manageletters.`;

/** The letters form's override box and its rows (letter, boundary), the empty ones left out. */
export function readLettersForm(page: Page): Promise<GradeLetters> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { checked: boolean; value: string } | null } }).document;
    const letters: { letter: string; minGrade: number }[] = [];
    for (let i = 0; doc.querySelector(`form.mform [name="gradeletter[${i}]"]`); i++) {
      const letter = doc.querySelector(`form.mform [name="gradeletter[${i}]"]`)!.value.trim();
      const boundary = (doc.querySelector(`form.mform [name="gradeboundary[${i}]"]`)?.value ?? "").trim().replace(",", ".");
      if (letter !== "" && boundary !== "") letters.push({ letter, minGrade: Number(boundary) });
    }
    return { overridden: doc.querySelector('form.mform input[type="checkbox"][name="override"]')?.checked ?? false, letters };
  });
}

async function openLetters(context: BrowserContext, siteUrl: string, courseId: number, rows?: number): Promise<Page> {
  const contextId = await courseContextId(context, siteUrl, courseId);
  // The form has as many rows as asked for (repeat_elements reads gradeentrycount from the request).
  return openGradeForm(context, siteUrl, `grade/edit/letter/index.php?id=${contextId}&edit=1${rows ? `&gradeentrycount=${rows}` : ""}`, lettersRefused(courseId));
}

/**
 * A course's grade letters, from the highest boundary to the lowest: its own when `overridden`, the
 * site's defaults otherwise. Throws `GradebookError` naming the capability when the person can't
 * manage them.
 */
export async function gradeLetters(context: BrowserContext, siteUrl: string, courseId: number): Promise<GradeLetters> {
  const page = await openLetters(context, siteUrl, courseId);
  try {
    const read = await readLettersForm(page);
    return { overridden: read.overridden, letters: read.letters.sort((a, b) => b.minGrade - a.minGrade) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * Sets a course's own grade letters (overriding the site's), each from its `minGrade` percent; `null`
 * goes back to the site's defaults. Returns the letters afterwards.
 */
export async function setGradeLetters(context: BrowserContext, siteUrl: string, courseId: number, letters: GradeLetter[] | null): Promise<{ changed: string } & GradeLetters> {
  if (letters !== null) {
    if (letters.length === 0) throw new MoodleError("Give at least one grade letter, or null for the site's defaults.", "invalid-input");
    for (const { letter, minGrade } of letters) {
      if (typeof letter !== "string" || letter.trim() === "") throw new MoodleError("Every grade letter needs its letter.", "invalid-input");
      if (!Number.isFinite(minGrade) || minGrade < 0 || minGrade > 100) throw new MoodleError(`Grade letter "${letter}"'s minGrade is a percent from 0 to 100, not ${minGrade}.`, "invalid-input");
    }
    if (new Set(letters.map((l) => l.minGrade)).size !== letters.length) throw new MoodleError("Two grade letters have the same minGrade.", "invalid-input");
  }
  const current = await gradeLetters(context, siteUrl, courseId);
  const page = await openLetters(context, siteUrl, courseId, Math.max(letters?.length ?? 0, current.letters.length));
  try {
    const values: Record<string, FieldValue> = { override: letters !== null };
    if (letters !== null) {
      const sorted = [...letters].sort((a, b) => b.minGrade - a.minGrade);
      const rows = Math.max(sorted.length, current.letters.length);
      // Every row is written: a row left empty is one Moodle drops.
      for (let i = 0; i < rows; i++) {
        values[`gradeletter[${i}]`] = sorted[i]?.letter.trim() ?? "";
        values[`gradeboundary[${i}]`] = sorted[i] !== undefined ? String(sorted[i]!.minGrade) : "";
      }
    }
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } catch (error) {
    if (error instanceof FormError) throw new GradebookError(`Moodle refused the grade letters: ${error.fields.map((f) => `${f.field}: ${f.message}`).join("; ")}.`);
    throw error;
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await gradeLetters(context, siteUrl, courseId);
  return {
    changed: letters === null ? `Course ${courseId}'s grade letters are the site's defaults again.` : `Course ${courseId}'s grade letters set: ${after.letters.map((l) => `${l.letter} from ${l.minGrade}%`).join(", ")}.`,
    ...after,
  };
}
