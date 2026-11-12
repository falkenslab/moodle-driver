// A workshop's assessment form (its aspects, assertions or criteria), read and written through the
// grading strategy's own editing form, mod/workshop/editform.php: the same page for the four
// strategies, each with its fields (`description__idx_<n>_editor`, `grade__idx_<n>`, `weight__idx_<n>`,
// `grade0__idx_<n>`, `levelid__idx_<n>__idy_<m>`…). No AJAX service covers it.
import type { BrowserContext, Page } from "playwright-core";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";
import { FormError, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { WorkshopError, openWorkshop, workshopInfo } from "./workshops.js";
import { readExamples } from "./examples.js";

/** A workshop's grading strategy, by Moodle's name for it: accumulative grading, comments, number of errors, rubric. */
export type WorkshopStrategy = "accumulative" | "comments" | "numerrors" | "rubric";

const STRATEGIES: WorkshopStrategy[] = ["accumulative", "comments", "numerrors", "rubric"];

/** Moodle's names for the strategies and what their form holds, for messages. */
const STRATEGY_NAMES: Record<WorkshopStrategy, { name: string; one: string; many: string }> = {
  accumulative: { name: "Accumulative grading", one: "aspect", many: "aspects" },
  comments: { name: "Comments", one: "aspect", many: "aspects" },
  numerrors: { name: "Number of errors", one: "assertion", many: "assertions" },
  rubric: { name: "Rubric", one: "criterion", many: "criteria" },
};

/** A level of a rubric criterion: the grade it gives (0 to 100, unique in its criterion) and its definition. */
export interface WorkshopRubricLevel {
  grade: number;
  definition: string;
}

/**
 * One aspect, assertion or criterion of the form to set, in the form's order. `description` (HTML)
 * is for every strategy; the rest only for the strategies named, and refused for the others.
 */
export interface WorkshopFormCriterionInput {
  description: string;
  /** Accumulative: the aspect's best grade in points (a whole number, 10 by default), or `scaleId`, a scale of the course's instead. */
  maxGrade?: number;
  scaleId?: number;
  /** Accumulative and number of errors: its weight, 0 to 16 (1 by default). */
  weight?: number;
  /** Number of errors: the words a reviewer chooses between, when the assertion fails and when it holds (Moodle's "No" and "Yes" by default; left as they are when not given). */
  errorWord?: string;
  successWord?: string;
  /** Rubric: its levels, one at least; read back in their grades' order. */
  levels?: WorkshopRubricLevel[];
}

/** A number-of-errors form's grade for a number of errors: `grade` is a percentage of the workshop's grade for submission. */
export interface WorkshopGradeMapping {
  errors: number;
  grade: number;
}

/** An assessment form to set with `setWorkshopForm`: the workshop's strategy, its criteria in order, and what only one strategy has. */
export interface WorkshopFormInput {
  /** The strategy the workshop grades with (its settings choose it): a form for another one is refused. */
  strategy: WorkshopStrategy;
  criteria: WorkshopFormCriterionInput[];
  /**
   * Number of errors: the grade for each number of (weighted) errors, from 1 to the assertions'
   * total weight; one not given gets Moodle's default, a share in proportion. All are cleared when
   * left out.
   */
  gradeMapping?: WorkshopGradeMapping[];
  /** Rubric: how assessors see it, "list" (Moodle's default) or "grid"; left as it is when not given. */
  layout?: "list" | "grid";
  /** Change the form even when assessments made with it exist (their grades stay as they were given). */
  evenIfAssessed?: boolean;
}

/** An aspect, assertion or criterion of a workshop's form as `workshopForm` reads it: its id and what its strategy has. */
export interface WorkshopFormCriterion {
  id: number;
  description: string;
  /** Accumulative: the best grade in points, or the scale it's graded on (its id and name). */
  maxGrade?: number;
  scaleId?: number;
  scale?: string;
  /** Accumulative and number of errors. */
  weight?: number;
  /** Number of errors. */
  errorWord?: string;
  successWord?: string;
  /** Rubric: in their grades' order, each with its id. */
  levels?: (WorkshopRubricLevel & { id: number })[];
}

/** A workshop's assessment form (`workshopForm`): its strategy, its criteria in order, and what only one strategy has. */
export interface WorkshopForm {
  activityId: number;
  strategy: WorkshopStrategy;
  criteria: WorkshopFormCriterion[];
  /** Number of errors: the grades set for numbers of errors (the rest follow Moodle's default). */
  gradeMapping?: WorkshopGradeMapping[];
  /** Rubric. */
  layout?: "list" | "grid";
}

/** One row of the editing form as read in the page: blank rows have no id. */
interface EditRow {
  id: string;
  description: string;
  gradeType?: string;
  gradePoint?: string;
  gradeScale?: string;
  scaleName?: string;
  weight?: string;
  grade0?: string;
  grade1?: string;
  levels: { id: string; grade: string; definition: string }[];
}

/** The editing form, as read in the page. */
interface EditForm {
  strategy: string;
  rows: EditRow[];
  /** The number-of-errors mapping's rows, by number of errors, with the percentage chosen ("" for none). */
  maps: { errors: number; value: string }[];
  layout?: string;
  scales: { id: string; name: string }[];
}

/** The strategy's editing form open in `page`, by its fields' names. */
function readEditForm(page: Page): Promise<EditForm> {
  return inPage(
    page,
    () => {
      interface El {
        name: string;
        value: string;
        checked: boolean;
        text: string;
        selectedIndex: number;
        options: ArrayLike<{ value: string; text: string }>;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const form = doc.querySelector("form.editstrategyform");
      if (!form) return { strategy: "", rows: [], maps: [], scales: [] };
      const field = (name: string) => form.querySelector(`[name="${name}"]`);
      const value = (name: string) => field(name)?.value;
      const rows: EditRow[] = [];
      for (let i = 0; field(`dimensionid__idx_${i}`); i++) {
        const levels: EditRow["levels"] = [];
        for (let j = 0; field(`levelid__idx_${i}__idy_${j}`); j++) {
          levels.push({ id: value(`levelid__idx_${i}__idy_${j}`) ?? "", grade: value(`grade__idx_${i}__idy_${j}`) ?? "", definition: value(`definition__idx_${i}__idy_${j}`) ?? "" });
        }
        const scale = field(`grade__idx_${i}[modgrade_scale]`);
        rows.push({
          id: value(`dimensionid__idx_${i}`) ?? "",
          description: value(`description__idx_${i}_editor[text]`) ?? "",
          gradeType: value(`grade__idx_${i}[modgrade_type]`),
          gradePoint: value(`grade__idx_${i}[modgrade_point]`),
          gradeScale: scale?.value,
          scaleName: scale && scale.selectedIndex >= 0 ? scale.options[scale.selectedIndex]?.text.trim() : undefined,
          weight: value(`weight__idx_${i}`),
          grade0: value(`grade0__idx_${i}`),
          grade1: value(`grade1__idx_${i}`),
          levels,
        });
      }
      const maps: EditForm["maps"] = [];
      for (let e = 1; field(`map__idx_${e}`); e++) maps.push({ errors: e, value: value(`map__idx_${e}`) ?? "" });
      const scaleSelect = field("grade__idx_0[modgrade_scale]");
      const scales = scaleSelect ? Array.from(scaleSelect.options).map((o) => ({ id: o.value, name: o.text.trim() })) : [];
      return { strategy: value("strategy") ?? "", rows, maps, layout: form.querySelector('[name="config_layout"]:checked')?.value, scales };
    },
    undefined,
  );
}

/** The editing form's saved rows as the driver returns them. */
function formFromEditForm(activityId: number, read: EditForm): WorkshopForm {
  const strategy = read.strategy as WorkshopStrategy;
  const criteria = read.rows
    .filter((row) => row.id !== "")
    .map((row): WorkshopFormCriterion => {
      const criterion: WorkshopFormCriterion = { id: Number(row.id), description: row.description.trim() };
      if (strategy === "accumulative") {
        if (row.gradeType === "scale") Object.assign(criterion, { scaleId: Number(row.gradeScale), ...(row.scaleName ? { scale: row.scaleName } : {}) });
        else if (row.gradeType === "point") criterion.maxGrade = Number(row.gradePoint);
      }
      if (strategy === "accumulative" || strategy === "numerrors") criterion.weight = Number(row.weight);
      if (strategy === "numerrors") Object.assign(criterion, { errorWord: row.grade0 ?? "", successWord: row.grade1 ?? "" });
      if (strategy === "rubric") {
        criterion.levels = row.levels
          .filter((level) => level.id !== "")
          .map((level) => ({ id: Number(level.id), grade: Number(level.grade), definition: level.definition.trim() }))
          .sort((a, b) => a.grade - b.grade);
      }
      return criterion;
    });
  return {
    activityId,
    strategy,
    criteria,
    ...(strategy === "numerrors" ? { gradeMapping: read.maps.filter((map) => map.value !== "").map((map) => ({ errors: map.errors, grade: Number(map.value) })) } : {}),
    ...(strategy === "rubric" && (read.layout === "list" || read.layout === "grid") ? { layout: read.layout } : {}),
  };
}

/** Opens the editing form, with `norepeats` rows when given; Moodle's refusal (no `mod/workshop:editdimensions`, not a workshop) as a `WorkshopError`. */
async function openEditForm(context: BrowserContext, siteUrl: string, activityId: number, norepeats?: number): Promise<Page> {
  let page: Page;
  try {
    page = await openForm(context, siteUrl, `mod/workshop/editform.php?cmid=${activityId}${norepeats !== undefined ? `&norepeats=${norepeats}` : ""}`);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const said = error.fields.find((f) => f.field === "moodle")?.message;
    throw new WorkshopError(
      `You can't edit the assessment form of activity ${activityId}${said ? ` (Moodle says: ${said})` : ""}: it takes a workshop (module "workshop") and Moodle's capability mod/workshop:editdimensions, which editing teachers have.`,
    );
  }
  if ((await page.locator("form.editstrategyform").count()) === 0) {
    await page.close().catch(() => undefined);
    throw new WorkshopError(`Activity ${activityId}'s page has no assessment form to edit: it isn't what the driver expects of a workshop's editing form.`);
  }
  return page;
}

/**
 * A workshop's assessment form, as its editing form ("Assessment form" in the workshop's settings)
 * has it: the grading strategy and its aspects (accumulative grading, comments), assertions (number
 * of errors) or criteria (rubric) in order, each with its id and what the strategy gives it (a best
 * grade or scale and a weight; a weight and the two words; levels), the number-of-errors grade
 * mapping and the rubric's layout. Descriptions are HTML, as the editor holds them. Reading the
 * editing form changes nothing. Throws `WorkshopError` when the id isn't a workshop's or the person
 * can't edit its form (Moodle's `mod/workshop:editdimensions`, a teacher's).
 */
export async function workshopForm(context: BrowserContext, siteUrl: string, activityId: number): Promise<WorkshopForm> {
  const page = await openEditForm(context, siteUrl, activityId);
  try {
    return formFromEditForm(activityId, await readEditForm(page));
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Refuses what Moodle's editing form wouldn't take, or what the strategy doesn't have, before anything changes. */
function checkFormInput(input: WorkshopFormInput): void {
  const invalid = (message: string) => new MoodleError(message, "invalid-input");
  const { strategy, criteria } = input;
  if (!STRATEGIES.includes(strategy)) throw invalid(`A workshop's grading strategy is one of ${STRATEGIES.join(", ")}; not "${String(strategy)}".`);
  const what = STRATEGY_NAMES[strategy];
  if (!Array.isArray(criteria) || criteria.length === 0) throw invalid(`Give the form one ${what.one} at least.`);
  const only = (field: string, strategies: WorkshopStrategy[]) => invalid(`"${field}" is for ${strategies.map((s) => STRATEGY_NAMES[s].name).join(" and ")} forms; this one is ${what.name} (${strategy}).`);
  if (input.gradeMapping !== undefined && strategy !== "numerrors") throw only("gradeMapping", ["numerrors"]);
  if (input.layout !== undefined && strategy !== "rubric") throw only("layout", ["rubric"]);
  if (input.layout !== undefined && input.layout !== "list" && input.layout !== "grid") throw invalid(`A rubric's layout is "list" or "grid"; not "${String(input.layout)}".`);
  const whole = (n: unknown, min: number, max: number) => typeof n === "number" && Number.isInteger(n) && n >= min && n <= max;
  criteria.forEach((criterion, index) => {
    const which = `${what.one} ${index + 1}`;
    if (typeof criterion.description !== "string" || !criterion.description.trim()) throw invalid(`The form's ${which} has no description: Moodle would delete it.`);
    if ((criterion.maxGrade !== undefined || criterion.scaleId !== undefined) && strategy !== "accumulative") throw only(criterion.maxGrade !== undefined ? "maxGrade" : "scaleId", ["accumulative"]);
    if (criterion.weight !== undefined && strategy !== "accumulative" && strategy !== "numerrors") throw only("weight", ["accumulative", "numerrors"]);
    if ((criterion.errorWord !== undefined || criterion.successWord !== undefined) && strategy !== "numerrors") throw only(criterion.errorWord !== undefined ? "errorWord" : "successWord", ["numerrors"]);
    if (criterion.levels !== undefined && strategy !== "rubric") throw only("levels", ["rubric"]);
    if (criterion.maxGrade !== undefined && criterion.scaleId !== undefined) throw invalid(`The form's ${which} takes a maximum grade or a scale, not both.`);
    if (criterion.maxGrade !== undefined && !whole(criterion.maxGrade, 1, Number.MAX_SAFE_INTEGER)) throw invalid(`The form's ${which} has a maximum grade that isn't a whole number above 0: Moodle takes whole points.`);
    if (criterion.weight !== undefined && !whole(criterion.weight, 0, 16)) throw invalid(`The form's ${which} has a weight Moodle doesn't offer: a whole number from 0 to 16.`);
    if (strategy === "rubric") {
      const levels = criterion.levels ?? [];
      if (levels.length === 0) throw invalid(`The form's ${which} has no levels: Moodle requires one at least.`);
      if (levels.some((level) => typeof level.definition !== "string" || !level.definition.trim())) throw invalid(`A level of the form's ${which} has no definition: Moodle would delete it.`);
      if (levels.some((level) => !whole(level.grade, 0, 100))) throw invalid(`A level of the form's ${which} has a grade Moodle doesn't offer: a whole number from 0 to 100.`);
      if (new Set(levels.map((level) => level.grade)).size !== levels.length) throw invalid(`The levels of the form's ${which} repeat a grade: Moodle requires them unique within a criterion.`);
    }
  });
  if (strategy === "numerrors") {
    // Moodle keeps a mapping only up to the assertions' total weight.
    const total = criteria.reduce((sum, criterion) => sum + (criterion.weight ?? 1), 0);
    const seen = new Set<number>();
    for (const map of input.gradeMapping ?? []) {
      if (!whole(map.errors, 1, total)) throw invalid(`The grade mapping's numbers of errors go from 1 to ${total} (the assertions' total weight); not ${String(map.errors)}.`);
      if (seen.has(map.errors)) throw invalid(`The grade mapping gives ${map.errors} error${map.errors === 1 ? "" : "s"} twice.`);
      seen.add(map.errors);
      if (!whole(map.grade, 0, 100)) throw invalid(`The grade mapping's grade for ${map.errors} error${map.errors === 1 ? "" : "s"} is a percentage Moodle doesn't offer: a whole number from 0 to 100.`);
    }
  }
}

/**
 * The fields of one pass over the editing form, and whether something didn't fit in it yet: a
 * rubric criterion with more levels than its blank rows, a mapping for more errors than the form
 * offers until the new weights are saved.
 */
function editFormValues(input: WorkshopFormInput, read: EditForm): { values: Record<string, FieldValue>; complete: boolean } {
  const values: Record<string, FieldValue> = {};
  let complete = true;
  read.rows.forEach((row, i) => {
    const criterion = input.criteria[i];
    const description = `description__idx_${i}_editor[text]`;
    if (!criterion) {
      // An empty description is how the form deletes a row (and a rubric criterion's levels with it).
      if (row.id !== "" || row.description.trim() !== "") values[description] = "";
      return;
    }
    values[description] = criterion.description;
    if (input.strategy === "accumulative") {
      if (criterion.scaleId !== undefined) {
        values[`grade__idx_${i}[modgrade_type]`] = "scale";
        values[`grade__idx_${i}[modgrade_scale]`] = String(criterion.scaleId);
      } else {
        values[`grade__idx_${i}[modgrade_type]`] = "point";
        values[`grade__idx_${i}[modgrade_point]`] = String(criterion.maxGrade ?? 10);
      }
    }
    if (input.strategy === "accumulative" || input.strategy === "numerrors") values[`weight__idx_${i}`] = String(criterion.weight ?? 1);
    if (input.strategy === "numerrors") {
      if (criterion.errorWord !== undefined) values[`grade0__idx_${i}`] = criterion.errorWord;
      if (criterion.successWord !== undefined) values[`grade1__idx_${i}`] = criterion.successWord;
    }
    if (input.strategy === "rubric") {
      // Moodle lists a criterion's levels by grade: written in that order, they come back in place.
      const levels = [...(criterion.levels ?? [])].sort((a, b) => a.grade - b.grade);
      row.levels.forEach((level, j) => {
        const wanted = levels[j];
        if (wanted) {
          values[`grade__idx_${i}__idy_${j}`] = String(wanted.grade);
          values[`definition__idx_${i}__idy_${j}`] = wanted.definition;
        } else if (level.id !== "" || level.definition.trim() !== "") {
          values[`definition__idx_${i}__idy_${j}`] = "";
        }
      });
      if (levels.length > row.levels.length) complete = false;
    }
  });
  if (input.criteria.length > read.rows.length) complete = false;
  if (input.strategy === "numerrors") {
    const grades = new Map((input.gradeMapping ?? []).map((map) => [map.errors, map.grade]));
    for (const map of read.maps) values[`map__idx_${map.errors}`] = grades.has(map.errors) ? String(grades.get(map.errors)) : "";
    if ([...grades.keys()].some((errors) => errors > read.maps.length)) complete = false;
  }
  if (input.strategy === "rubric" && input.layout !== undefined) values.config_layout = input.layout;
  return { values, complete };
}

/** How many assessments (and reference assessments of examples) have been made with the workshop's form, as its page shows them to a teacher. */
async function assessmentsMade(context: BrowserContext, siteUrl: string, activityId: number): Promise<number> {
  const info = await workshopInfo(context, siteUrl, activityId);
  let made = info.assessments.filter((assessment) => assessment.grade !== undefined).length;
  // Examples are listed in the setup phase only.
  if (info.phase === "setup") {
    const page = await openWorkshop(context, siteUrl, activityId);
    try {
      made += ((await readExamples(page)) ?? []).filter((example) => example.assessed).length;
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  return made;
}

/** The errors Moodle shows on the editing form after saving, a rubric level's among them (`fgroup_id_error_…`, which `submitForm` doesn't read). */
async function editFormErrors(page: Page): Promise<{ field: string; message: string }[]> {
  return page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ id: string; textContent: string | null }> } }).document;
    return Array.from(doc.querySelectorAll('form.editstrategyform [id^="fgroup_id_error_"], form.editstrategyform [id^="id_error_"]'))
      .map((element) => ({ field: element.id.replace(/^(fgroup_)?id_error_/, ""), message: (element.textContent ?? "").replace(/\s+/g, " ").trim() }))
      .filter((error) => error.message !== "");
  });
}

/**
 * Sets a workshop's assessment form, as its editing form does ("Assessment form" in the workshop's
 * settings, then "Save and continue editing"): the aspects, assertions or criteria given, in order,
 * replace those there. Each row keeps its place, so the first ones keep their ids; rows left over are
 * deleted, as Moodle deletes a row whose description is emptied. The form must be for the workshop's
 * grading strategy (chosen in its settings); a rubric's levels are written in their grades' order.
 * Moodle offers a few blank rows at a time (two more aspects, two more levels, a mapping row per
 * error of the saved weights), so the driver saves again until everything fits, as a teacher pressing
 * its "Blanks for 2 more" buttons would (a rubric criterion of seven levels and a mapping set after
 * new weights, confirmed empirically, Moodle 5.2). Moodle itself lets the form change once
 * assessments exist (editform.php has no check, 5.2), and keeps their grades as they were given:
 * the driver refuses then unless `evenIfAssessed`, counting
 * the assessments graded in the workshop's report (in the course's current group) and the reference
 * assessments of its examples. Returns a sentence of what changed and the form as `workshopForm`
 * reads it. Throws `WorkshopError` for a form of another strategy (naming the workshop's), when
 * assessments exist, when the person can't edit the form (`mod/workshop:editdimensions`) or a scale
 * isn't the course's; `MoodleError` (`invalid-input`) for a form Moodle wouldn't take (no
 * description, a rubric level's grade repeated, a weight above 16…), and `FormError` when Moodle
 * refuses it (a maximum grade above the site's).
 */
export async function setWorkshopForm(context: BrowserContext, siteUrl: string, activityId: number, input: WorkshopFormInput): Promise<{ changed: string } & WorkshopForm> {
  checkFormInput(input);
  const { strategy, criteria, evenIfAssessed = false } = input;
  let page = await openEditForm(context, siteUrl, activityId);
  try {
    let read = await readEditForm(page);
    if (read.strategy !== strategy) {
      const theirs = STRATEGY_NAMES[read.strategy as WorkshopStrategy];
      throw new WorkshopError(
        `Workshop ${activityId} grades with the ${theirs ? `${theirs.name} strategy ("${read.strategy}")` : `"${read.strategy}" strategy`}, not ${STRATEGY_NAMES[strategy].name} ("${strategy}"): give its form for "${read.strategy}", or change the grading strategy in the workshop's settings first.`,
      );
    }
    const unknownScale = criteria.find((criterion) => criterion.scaleId !== undefined && !read.scales.some((scale) => scale.id === String(criterion.scaleId)));
    if (unknownScale) {
      throw new WorkshopError(`Scale ${unknownScale.scaleId} isn't one workshop ${activityId}'s course can use: ${read.scales.length > 0 ? read.scales.map((scale) => `${scale.id} ("${scale.name}")`).join(", ") : "it has none"}.`);
    }
    const before = read.rows.filter((row) => row.id !== "").length;
    if (!evenIfAssessed && before > 0) {
      const made = await assessmentsMade(context, siteUrl, activityId);
      if (made > 0) {
        throw new WorkshopError(
          `Workshop ${activityId} has ${made} assessment${made === 1 ? "" : "s"} made with its form: Moodle would keep their grades as they were given, on the form as it was. Nothing was changed; set evenIfAssessed to change it anyway.`,
        );
      }
    }
    // Every row there must be in the form, or Moodle wouldn't delete the ones left over. Moodle reads
    // the number of rows from the request (`norepeats`), the query too, and posts it back hidden
    // (confirmed empirically, Moodle 5.2).
    if (read.rows.length < criteria.length) {
      await page.close().catch(() => undefined);
      page = await openEditForm(context, siteUrl, activityId, criteria.length);
      read = await readEditForm(page);
    }
    // Each save offers more blank rows; a rubric with many levels or a long mapping takes a few.
    for (let pass = 1; ; pass++) {
      const { values, complete } = editFormValues(input, read);
      await setFields(page, values, "form.editstrategyform");
      await submitForm(page, "saveandcontinue");
      const errors = await editFormErrors(page);
      if (errors.length > 0) throw new FormError("Moodle refused the assessment form:", errors);
      if ((await page.locator("form.editstrategyform").count()) === 0) throw new WorkshopError(`Moodle didn't come back to workshop ${activityId}'s assessment form after saving it.`);
      read = await readEditForm(page);
      if (complete) break;
      if (pass >= 60) throw new WorkshopError(`Workshop ${activityId}'s assessment form kept offering too few rows: it was saved in part.`);
    }
    const form = formFromEditForm(activityId, read);
    const what = STRATEGY_NAMES[strategy];
    return {
      changed: `${before > 0 ? "Replaced" : "Set"} workshop ${activityId}'s assessment form (${what.name}): ${form.criteria.length} ${form.criteria.length === 1 ? what.one : what.many}.`,
      ...form,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
