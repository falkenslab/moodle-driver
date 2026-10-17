// An assignment's advanced grading definition (a rubric or a marking guide), written through
// Moodle's own pages: the advanced grading page sets the method, its editor form saves the definition.
import type { BrowserContext, Page } from "playwright-core";
import { GradingError, assignmentIds } from "./grader.js";
import type { GradingCriterion } from "./grading.js";
import { openForm, setFields, submitForm } from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { inPage } from "../../core/inPage.js";
import { MoodleError } from "../../core/errors.js";

/** A rubric to define: its criteria, each with two levels at least, in order. */
export interface RubricDefinitionInput {
  method: "rubric";
  /** The rubric's name, as the advanced grading page lists it. */
  name: string;
  /** Its description (HTML), shown to students where Moodle shows it. */
  description?: string;
  criteria: { description: string; levels: { definition: string; score: number }[] }[];
}

/** A marking guide to define: its criteria and, optionally, its frequently used comments. */
export interface GuideDefinitionInput {
  method: "guide";
  /** The guide's name, as the advanced grading page lists it. */
  name: string;
  /** Its description (HTML). */
  description?: string;
  /** `description` is for students and markers, `markers` for markers only. */
  criteria: { shortName: string; description?: string; markers?: string; maxScore: number }[];
  /** The guide's frequently used comments, in order. */
  comments?: string[];
}

/** A grading definition to save with `setGradingDefinition`. */
export type GradingDefinitionInput = RubricDefinitionInput | GuideDefinitionInput;

/** What `setGradingDefinition` returns: the definition as `rubric` reads it, with the ids grading takes. */
export interface SavedGradingDefinition {
  changed: string;
  assignment: { id: number };
  method: "rubric" | "guide";
  criteria: GradingCriterion[];
}

/** The fields of a definition for its editor form, new criteria and levels as `NEWID<n>`, the way its own JavaScript adds them. */
export function definitionFields(definition: GradingDefinitionInput): Record<string, string> {
  const fields: Record<string, string> = {};
  if (definition.method === "rubric") {
    definition.criteria.forEach((criterion, c) => {
      const prefix = `rubric[criteria][NEWID${c + 1}]`;
      fields[`${prefix}[description]`] = criterion.description;
      criterion.levels.forEach((level, l) => {
        fields[`${prefix}[levels][NEWID${l}][definition]`] = level.definition;
        fields[`${prefix}[levels][NEWID${l}][score]`] = String(level.score);
      });
    });
  } else {
    definition.criteria.forEach((criterion, c) => {
      const prefix = `guide[criteria][NEWID${c + 1}]`;
      fields[`${prefix}[shortname]`] = criterion.shortName;
      fields[`${prefix}[description]`] = criterion.description ?? "";
      fields[`${prefix}[descriptionmarkers]`] = criterion.markers ?? "";
      fields[`${prefix}[maxscore]`] = String(criterion.maxScore);
    });
    (definition.comments ?? []).forEach((comment, c) => {
      fields[`guide[comments][NEWID${c + 1}][description]`] = comment;
    });
  }
  return fields;
}

/** Refuses what Moodle's editor would refuse, before anything changes, in the driver's words. */
function checkDefinition(definition: GradingDefinitionInput): void {
  const invalid = (message: string) => new MoodleError(message, "invalid-input");
  if ((definition.method as string) !== "rubric" && (definition.method as string) !== "guide") throw invalid(`"${String(definition.method)}" isn't an advanced grading method: "rubric" or "guide".`);
  if (!definition.name?.trim()) throw invalid("Give the definition a name: Moodle requires one.");
  if (definition.criteria.length === 0) throw invalid("Give the definition one criterion at least.");
  if (definition.method === "rubric") {
    let total = 0;
    for (const [index, criterion] of definition.criteria.entries()) {
      if (!criterion.description.trim()) throw invalid(`Rubric criterion ${index + 1} has no description.`);
      if (criterion.levels.length < 2) throw invalid(`Rubric criterion ${index + 1} has ${criterion.levels.length} level${criterion.levels.length === 1 ? "" : "s"}: Moodle needs two at least.`);
      if (criterion.levels.some((level) => !level.definition.trim())) throw invalid(`A level of rubric criterion ${index + 1} has no definition.`);
      if (criterion.levels.some((level) => !Number.isFinite(level.score))) throw invalid(`A level of rubric criterion ${index + 1} has a score that isn't a number.`);
      total += Math.max(...criterion.levels.map((level) => level.score));
    }
    if (total <= 0) throw invalid("The rubric's highest scores add up to 0: Moodle needs a total above 0.");
  } else {
    for (const [index, criterion] of definition.criteria.entries()) {
      if (!criterion.shortName.trim()) throw invalid(`Guide criterion ${index + 1} has no short name.`);
      if (criterion.shortName.trim().length > 255) throw invalid(`Guide criterion ${index + 1}'s short name is over 255 characters.`);
      if (!Number.isFinite(criterion.maxScore) || criterion.maxScore < 0) throw invalid(`Guide criterion ${index + 1}'s maximum score must be a number, 0 or more.`);
    }
  }
}

/**
 * The definition in its editor form (`grade/grading/form/<method>/edit.php`), read by the fields'
 * names: a saved criterion or level has its id in them, a new one `NEWID<n>`. Reads only the form,
 * so it creates no submission, unlike a grading panel.
 */
export function readDefinitionEditor(page: Page, method: "rubric" | "guide"): Promise<GradingCriterion[]> {
  // Through inPage: it has a helper function (see the conventions on page.evaluate).
  return inPage(
    page,
    (method) => {
      interface Field {
        name: string;
        value: string;
      }
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<Field> } }).document;
      const fields = Array.from(doc.querySelectorAll(`form.mform [name^="${method}[criteria]["]`));
      const value = (name: string) => (fields.find((field) => field.name === name)?.value ?? "").trim();
      const criteria: GradingCriterion[] = [];
      for (const field of fields) {
        const id = new RegExp(`^${method}\\[criteria\\]\\[(\\d+)\\]\\[${method === "rubric" ? "description" : "shortname"}\\]$`).exec(field.name)?.[1];
        if (!id) continue;
        const prefix = `${method}[criteria][${id}]`;
        if (method === "guide") {
          const details = value(`${prefix}[description]`);
          const markers = value(`${prefix}[descriptionmarkers]`);
          criteria.push({ id: Number(id), description: field.value.trim(), ...(details ? { details } : {}), ...(markers ? { markers } : {}), maxScore: Number(value(`${prefix}[maxscore]`)) });
          continue;
        }
        const levels = fields.flatMap((level) => {
          const levelId = new RegExp(`^${method}\\[criteria\\]\\[${id}\\]\\[levels\\]\\[(\\d+)\\]\\[definition\\]$`).exec(level.name)?.[1];
          return levelId ? [{ id: Number(levelId), definition: level.value.trim(), score: Number(value(`${prefix}[levels][${levelId}][score]`)) }] : [];
        });
        criteria.push({ id: Number(id), description: field.value.trim(), levels });
      }
      return criteria;
    },
    method,
  );
}

/**
 * The advanced grading page of an assignment's submissions: its area id, the sesskey its method
 * selector sends, and the active method ("none" for simple direct grading). Throws `GradingError`
 * when Moodle refuses the page: the person lacks `moodle/grade:managegradingforms`.
 */
async function gradingArea(context: BrowserContext, siteUrl: string, activityId: number, contextId: number): Promise<{ page: Page; areaId: number; sesskey: string; method: string }> {
  const page = await openSitePage(context, siteUrl, `grade/grading/manage.php?contextid=${contextId}&component=mod_assign&area=submissions`);
  try {
    // Through inPage: it has a helper function (see the conventions on page.evaluate).
    const selector = await inPage(
      page,
      () => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document;
        const value = (s: string) => doc.querySelector(`#activemethodselector ${s}`)?.value;
        return { areaId: Number(value('[name="areaid"]')), sesskey: value('[name="sesskey"]'), method: value('select[name="setmethod"]') };
      },
      null,
    );
    if (!selector.areaId || !selector.sesskey || !selector.method) {
      const refused = await moodleErrorMessage(page);
      throw new GradingError(
        `You can't manage assignment ${activityId}'s grading forms${refused ? ` (Moodle says: ${refused})` : ""}: it takes Moodle's capability moodle/grade:managegradingforms, which editing teachers have in their courses.`,
      );
    }
    return { page, areaId: selector.areaId, sesskey: selector.sesskey, method: selector.method };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Sets an assignment's advanced grading method (a rubric or a marking guide) and saves its
 * definition through Moodle's editor form, ready for use, as "Define new grading form from scratch"
 * and "Save rubric and make it ready" (or the guide's) do: one is created where there is none, and
 * the one there is replaced (its criteria, levels and comments, so their ids change). Moodle's
 * editor offers to save as a draft only while nothing has been graded with the definition: without
 * that, it would ask to regrade on saving, so the driver refuses with `GradingError` before anything
 * changes (the method too). Returns the definition as `rubric` reads it, read from the editor form,
 * not from a grading panel, so it creates no submission. Throws `GradingError` when the person lacks
 * `moodle/grade:managegradingforms` or Moodle refuses the definition, `NotAnAssignmentError` when
 * the id isn't an assignment they can grade, and `MoodleError` (`invalid-input`) for a definition
 * Moodle's editor wouldn't take (no criteria, a rubric criterion with fewer than two levels…).
 */
export async function setGradingDefinition(context: BrowserContext, siteUrl: string, activityId: number, definition: GradingDefinitionInput): Promise<SavedGradingDefinition> {
  checkDefinition(definition);
  const { method } = definition;
  const ids = await assignmentIds(context, siteUrl, activityId);
  const area = await gradingArea(context, siteUrl, activityId, ids.contextId);
  const editorPath = `grade/grading/form/${method}/edit.php?areaid=${area.areaId}`;
  let replaced: boolean;
  try {
    const editor = await openForm(context, siteUrl, editorPath);
    try {
      // Moodle offers the draft button only while no grade uses the definition (`has_active_instances`).
      if ((await editor.locator(`form.mform [name="save${method}draft"]`).count()) === 0) {
        throw new GradingError(
          `Assignment ${activityId}'s ${method === "rubric" ? "rubric" : "marking guide"} has already been used for grading: Moodle would ask to regrade on changing it. Nothing was changed; change it in Moodle's editor, or delete it first in the assignment's advanced grading page.`,
        );
      }
      replaced = (await readDefinitionEditor(editor, method)).length > 0;
      if (area.method !== method) {
        await area.page.goto(new URL(`grade/grading/manage.php?areaid=${area.areaId}&setmethod=${method}&sesskey=${area.sesskey}`, siteUrl).href, { waitUntil: "domcontentloaded" });
      }
      // The criteria the form has (the saved ones, or the empty one of a new definition) go: what the form doesn't send, Moodle deletes.
      await editor.evaluate(
        ({ method, fields }) => {
          interface El {
            name: string;
            type: string;
            value: string;
            remove(): void;
            appendChild(el: El): void;
          }
          const doc = (globalThis as unknown as { document: { querySelector(s: string): El | null; querySelectorAll(s: string): ArrayLike<El>; createElement(tag: string): El } }).document;
          const form = doc.querySelector("form.mform");
          for (const old of Array.from(doc.querySelectorAll(`form.mform [name^="${method}[criteria]"], form.mform [name^="${method}[comments]"]`))) old.remove();
          for (const [name, value] of Object.entries(fields)) {
            const input = doc.createElement("input");
            input.type = "hidden";
            input.name = name;
            input.value = value;
            form?.appendChild(input);
          }
        },
        { method, fields: definitionFields(definition) },
      );
      await setFields(editor, { name: definition.name, "description_editor[text]": definition.description ?? "" });
      await submitForm(editor, `save${method}`);
      // Saved, Moodle sends the person back to the advanced grading page; refused, it shows the editor again with its reasons.
      if ((await editor.locator(`form.mform [name="save${method}"]`).count()) > 0) {
        const reason = await editor.evaluate(() => {
          const doc = (globalThis as unknown as { document: { querySelector(s: string): { textContent: string | null } | null } }).document;
          return (doc.querySelector("form.mform .alert")?.textContent ?? "").replace(/\s+/g, " ").trim();
        });
        throw new GradingError(`Moodle didn't save assignment ${activityId}'s ${method === "rubric" ? "rubric" : "marking guide"}${reason ? `: ${reason}` : "."}`);
      }
    } finally {
      await editor.close().catch(() => undefined);
    }
  } finally {
    await area.page.close().catch(() => undefined);
  }
  const reread = await openSitePage(context, siteUrl, editorPath);
  let criteria: GradingCriterion[];
  try {
    criteria = await readDefinitionEditor(reread, method);
  } finally {
    await reread.close().catch(() => undefined);
  }
  const what = method === "rubric" ? "rubric" : "marking guide";
  return {
    changed: `${replaced ? "Replaced" : "Defined"} assignment ${activityId}'s ${what} "${definition.name}" (${criteria.length} criteri${criteria.length === 1 ? "on" : "a"}), ready for use${area.method !== method ? `, and set its grading method to ${what}` : ""}.`,
    assignment: { id: activityId },
    method,
    criteria,
  };
}
