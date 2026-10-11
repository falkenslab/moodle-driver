// When an activity or section is available (Moodle's availability tree, the JSON its forms keep in
// `availabilityconditionsjson`) and when an activity counts as complete (its form's completion
// fields), in plain terms: built into Moodle's fields to save, and read back from them.
import type { BrowserContext, Page } from "playwright-core";
import { COMPLETION_STATES, type CompletionState } from "../courses/structure.js";
import { dateSelectorDate, dateSelectorValues, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/**
 * One access condition: a date range (from, until or both), a grade in another activity (`min`, `max`
 * as percentages of its maximum grade), another activity's completion state, or a group's members.
 * Read back, a condition the driver has no terms for (a grouping, a user profile field, a nested set)
 * is `{ type: "other", json }`, Moodle's own; it's written back as given.
 */
export type Restriction =
  | { type: "date"; from?: Date | string; until?: Date | string }
  | { type: "grade"; activityId: number; min?: number; max?: number }
  | { type: "completion"; activityId: number; state: CompletionState }
  | { type: "group"; groupId: number }
  | { type: "other"; json: unknown };

/**
 * When an activity or section is available: `conditions`, all of them met (`match: "all"`, the
 * default) or any; while not met, shown to students greyed out with the conditions (the default) or
 * `hidden` from them. No conditions: always available.
 */
export interface Restrictions {
  conditions: Restriction[];
  match?: "all" | "any";
  hidden?: boolean;
}

/**
 * When an activity counts as complete: not tracked (`"none"`), marked by the student (`"manual"`),
 * or on conditions: viewing it, receiving a grade, a passing grade, submitting it (assignments,
 * choices), with an expected completion date shown to students. Read back, the conditions the
 * driver has no terms for (a forum's number of posts) are left out: `activitySettings`' fields have them.
 */
export type Completion = "none" | "manual" | { view?: boolean; grade?: boolean; passGrade?: boolean; submit?: boolean; expected?: Date | string };

/** Moodle's availability tree, as its forms keep it. */
interface Tree {
  op: "&" | "|" | "!&" | "!|";
  c: Node[];
  showc?: boolean[];
  show?: boolean;
}
type Node = Tree | ({ type: string } & Record<string, unknown>);

function time(value: Date | string, what: string): number {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new MoodleError(`${what} isn't a date: "${String(value)}". Give it as an ISO date (2026-11-30T18:00:00Z).`, "invalid-input");
  return Math.floor(date.getTime() / 1000);
}

/**
 * Moodle's availability JSON for `restrictions`. A grade condition takes the activity's grade item
 * from `gradeItems` (activity id to grade item id, from the gradebook setup).
 */
export function restrictionsJson(restrictions: Restrictions, gradeItems: Map<number, number> = new Map()): string {
  const nodes = restrictions.conditions.map((condition): Node => {
    switch (condition.type) {
      case "date": {
        const dates: Node[] = [];
        if (condition.from !== undefined) dates.push({ type: "date", d: ">=", t: time(condition.from, "A date condition's from") });
        if (condition.until !== undefined) dates.push({ type: "date", d: "<", t: time(condition.until, "A date condition's until") });
        if (dates.length === 0) throw new MoodleError("A date condition needs from, until or both.", "invalid-input");
        // A range is one condition: both dates, whatever the match of the others.
        return dates.length === 1 ? dates[0]! : { op: "&", c: dates };
      }
      case "grade": {
        const id = gradeItems.get(condition.activityId);
        if (id === undefined) throw new MoodleError(`Activity ${condition.activityId} has no grade item in the course's gradebook, so no grade condition can name it.`, "not-found");
        return { type: "grade", id, ...(condition.min !== undefined ? { min: condition.min } : {}), ...(condition.max !== undefined ? { max: condition.max } : {}) };
      }
      case "completion": {
        const e = COMPLETION_STATES.indexOf(condition.state);
        if (e < 0) throw new MoodleError(`A completion condition's state is one of ${COMPLETION_STATES.join(", ")}, not "${String(condition.state)}".`, "invalid-input");
        return { type: "completion", cm: condition.activityId, e };
      }
      case "group":
        return { type: "group", id: condition.groupId };
      case "other":
        return condition.json as Node;
      default:
        throw new MoodleError(`Unknown restriction type "${String((condition as { type: unknown }).type)}": date, grade, completion or group.`, "invalid-input");
    }
  });
  const shown = !restrictions.hidden;
  // As Moodle's own form writes it: one eye per condition for "all", one for the whole set for "any".
  const tree: Tree = restrictions.match === "any" ? { op: "|", c: nodes, show: shown } : { op: "&", c: nodes, showc: nodes.map(() => shown) };
  return JSON.stringify(tree);
}

const iso = (seconds: unknown) => new Date(Number(seconds) * 1000).toISOString();

/** The plain terms of one node of Moodle's tree; a grade item maps back to its activity through `gradeActivities`. */
function restrictionOf(node: Node, gradeActivities: Map<number, number>): Restriction {
  if (typeof (node as Tree).op === "string") {
    // A date range, as restrictionsJson writes it.
    const tree = node as Tree;
    const [a, b] = tree.c as ({ type?: string; d?: string; t?: number } | undefined)[];
    if (tree.op === "&" && tree.c.length === 2 && a?.type === "date" && b?.type === "date" && a.d === ">=" && b.d === "<") return { type: "date", from: iso(a.t), until: iso(b.t) };
    return { type: "other", json: node };
  }
  const leaf = node as { type: string } & Record<string, unknown>;
  switch (leaf.type) {
    case "date":
      return leaf.d === ">=" ? { type: "date", from: iso(leaf.t) } : { type: "date", until: iso(leaf.t) };
    case "grade": {
      const activityId = gradeActivities.get(Number(leaf.id));
      if (activityId === undefined) return { type: "other", json: leaf };
      return { type: "grade", activityId, ...(typeof leaf.min === "number" ? { min: leaf.min } : {}), ...(typeof leaf.max === "number" ? { max: leaf.max } : {}) };
    }
    case "completion": {
      const state = COMPLETION_STATES[Number(leaf.e)];
      return state ? { type: "completion", activityId: Number(leaf.cm), state } : { type: "other", json: leaf };
    }
    case "group":
      return leaf.id !== undefined ? { type: "group", groupId: Number(leaf.id) } : { type: "other", json: leaf };
    default:
      return { type: "other", json: leaf };
  }
}

/** Whether Moodle's availability JSON has a grade condition (reading it back needs the gradebook). */
export function hasGradeCondition(json: string): boolean {
  return /"type"\s*:\s*"grade"/.test(json);
}

/**
 * The restrictions in Moodle's availability JSON, in plain terms; undefined when there are none. A
 * negated set ("must not") has no plain terms: it comes whole as one `other` condition.
 */
export function parseRestrictions(json: string | undefined, gradeActivities: Map<number, number> = new Map()): Restrictions | undefined {
  if (!json || json.trim() === "") return undefined;
  let tree: Tree;
  try {
    tree = JSON.parse(json) as Tree;
  } catch {
    return undefined;
  }
  if (!tree.c || tree.c.length === 0) return undefined;
  // Hidden when its one eye is closed, or every condition's is.
  const hidden = tree.showc ? tree.showc.length > 0 && tree.showc.every((shown) => !shown) : tree.show === false;
  if (tree.op === "!&" || tree.op === "!|") return { conditions: [{ type: "other", json: tree }], hidden };
  return { conditions: tree.c.map((node) => restrictionOf(node, gradeActivities)), match: tree.op === "|" ? "any" : "all", hidden };
}

/**
 * The course's grade items by the activity they belong to, from the gradebook setup page (each item's
 * row links to its activity): Moodle's grade condition names a grade item, not an activity. An
 * activity with several items (a forum's whole-forum grade and ratings) maps to the first.
 */
export async function gradeItemsByActivity(context: BrowserContext, siteUrl: string, courseId: number): Promise<Map<number, number>> {
  const page = await openSitePage(context, siteUrl, `grade/edit/tree/index.php?id=${courseId}`);
  try {
    if ((await page.locator("body#page-grade-edit-tree-index #grade_edit_tree_table").count()) === 0) {
      throw new MoodleError(`Course ${courseId}'s gradebook setup can't be read, and a grade condition needs it: ${(await moodleErrorMessage(page)) ?? "you aren't allowed to manage its grades"}`, "not-available");
    }
    const pairs = await page.evaluate(() => {
      interface El {
        getAttribute(name: string): string | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const found: [number, number][] = [];
      for (const row of Array.from(doc.querySelectorAll("#grade_edit_tree_table tr[data-itemid]"))) {
        const link = Array.from(row.querySelectorAll("a[href]"))
          .map((a) => /\/mod\/[a-z0-9_]+\/view\.php\?(?:.*&)?id=(\d+)/.exec(a.getAttribute("href") ?? "")?.[1])
          .find((id) => id !== undefined);
        if (link) found.push([Number(link), Number(row.getAttribute("data-itemid"))]);
      }
      return found;
    });
    const items = new Map<number, number>();
    for (const [activityId, itemId] of pairs) if (!items.has(activityId)) items.set(activityId, itemId);
    return items;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** The completion conditions in plain terms, by the form field each stands for. */
const COMPLETION_FIELDS = { view: "completionview", grade: "completionusegrade", passGrade: "completionpassgrade", submit: "completionsubmit" } as const;

/** Which of `names` the form in `page` has, as fields a person can see (hidden twins aside). */
function fieldsPresent(page: Page, names: string[]): Promise<string[]> {
  return page.evaluate((names) => {
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ type: string }> } }).document;
    return names.filter((name) => Array.from(doc.querySelectorAll(`form.mform [name="${name}"]`)).some((field) => field.type !== "hidden"));
  }, names);
}

/**
 * The form values for `completion` in an activity's form, in the order to set them (each enables the
 * next): conditions not given are turned off. Refuses a condition the module's form doesn't have.
 */
export async function completionValues(page: Page, completion: Completion): Promise<Record<string, FieldValue>> {
  const present = new Set(await fieldsPresent(page, ["completion", ...Object.values(COMPLETION_FIELDS), "completionexpected[enabled]"]));
  const module = (await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector('form.mform [name="modulename"]')?.value)) ?? "activity";
  if (!present.has("completion")) throw new MoodleError(`This ${module}'s form has no completion settings: completion tracking is off in the course or on the site.`, "not-available");
  if (completion === "none") return { completion: 0 };
  if (completion === "manual") return { completion: 1 };
  const wanted = { ...completion, grade: completion.grade || completion.passGrade };
  const missing = (Object.keys(COMPLETION_FIELDS) as (keyof typeof COMPLETION_FIELDS)[]).filter((key) => wanted[key] && !present.has(COMPLETION_FIELDS[key]));
  if (missing.length > 0) throw new MoodleError(`This ${module} has no completion condition ${missing.join(", ")}: its form has no such field.`, "invalid-input");
  const values: Record<string, FieldValue> = { completion: 2 };
  if (present.has(COMPLETION_FIELDS.view)) values[COMPLETION_FIELDS.view] = Boolean(wanted.view);
  if (present.has(COMPLETION_FIELDS.submit)) values[COMPLETION_FIELDS.submit] = Boolean(wanted.submit);
  if (present.has(COMPLETION_FIELDS.grade)) values[COMPLETION_FIELDS.grade] = Boolean(wanted.grade);
  // A radio, enabled by the grade condition.
  if (wanted.grade && present.has(COMPLETION_FIELDS.passGrade)) values[COMPLETION_FIELDS.passGrade] = wanted.passGrade ? 1 : 0;
  if (present.has("completionexpected[enabled]")) {
    values["completionexpected[enabled]"] = wanted.expected !== undefined;
    if (wanted.expected !== undefined) {
      const expected = new Date(time(wanted.expected, "completion.expected") * 1000);
      Object.assign(values, await dateSelectorValues(page, "completionexpected", expected));
    }
  }
  return values;
}

/** An activity's completion in plain terms, from its form; undefined when the form has no completion settings. */
export async function readCompletion(page: Page): Promise<Completion | undefined> {
  const read = await inPage(page, (fields) => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string; checked: boolean } | null } }).document;
    const radio = doc.querySelector('form.mform input[type="radio"][name="completion"]:checked');
    if (!radio) return undefined;
    const on = (name: string) => doc.querySelector(`form.mform input[type="checkbox"][name="${name}"]`)?.checked ?? false;
    const pass = doc.querySelector(`form.mform input[type="radio"][name="${fields.passGrade}"]:checked`)?.value === "1";
    return { mode: radio.value, view: on(fields.view), grade: on(fields.grade), passGrade: pass, submit: on(fields.submit) };
  }, COMPLETION_FIELDS as Record<keyof typeof COMPLETION_FIELDS, string>);
  if (!read) return undefined;
  if (read.mode === "0") return "none";
  if (read.mode === "1") return "manual";
  const expected = await dateSelectorDate(page, "completionexpected");
  return {
    ...(read.view ? { view: true } : {}),
    ...(read.grade ? { grade: true } : {}),
    ...(read.grade && read.passGrade ? { passGrade: true } : {}),
    ...(read.submit ? { submit: true } : {}),
    ...(expected ? { expected: expected.toISOString() } : {}),
  };
}
