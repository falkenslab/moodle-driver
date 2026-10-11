// Building a course: activities through Moodle's own activity form, and the course page's editing
// (rename, show, move, duplicate, delete) through its services. Every change answers with the
// course's structure afterwards, to check it.
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { courseState } from "../courses/state.js";
import { editCourse, renameActivity, renameSection } from "../../core/editor.js";
import { checkLocalFiles } from "../../core/files.js";
import { deleteDraftFile, draftFiles, formValue, openForm, setFields, submitForm, uploadToDraft, type DraftFile, type DraftUpload, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { structureOf, type CourseSection } from "../courses/structure.js";
import { MoodleError } from "../../core/errors.js";
import { completionValues, gradeItemsByActivity, hasGradeCondition, parseRestrictions, readCompletion, restrictionsJson, type Completion, type Restrictions } from "./conditions.js";

/** "stealth": hidden from the course page but available by link, where the site allows it. */
export const ACTIVITY_VISIBILITIES = ["shown", "hidden", "stealth"] as const;
export type ActivityVisibility = (typeof ACTIVITY_VISIBILITIES)[number];

const FORM_VISIBILITY: Record<ActivityVisibility, number> = { shown: 1, hidden: 0, stealth: -1 };
const VISIBILITY_ACTIONS = { shown: "cm_show", hidden: "cm_hide", stealth: "cm_stealth" } as const;

/** The common inputs of an activity's form; anything else goes in `settings` by its form field name. */
export interface ActivityFields {
  name?: string;
  /** The description (HTML), shown on the activity's page. */
  description?: string;
  /** A page's content, or a label's text (HTML). */
  content?: string;
  /** A URL resource's target. */
  url?: string;
  visibility?: ActivityVisibility;
  /** When students can open it (`{ conditions: [] }` removes every restriction). */
  restrictions?: Restrictions;
  /** When it counts as complete. */
  completion?: Completion;
  settings?: Record<string, FieldValue>;
}

/** What a change did, its new id when it created something, and the course afterwards. */
export interface CourseChange {
  changed: string;
  activityId?: number;
  sectionId?: number;
  url?: string;
  /** A file resource's or folder's files after `updateActivity` changed them. */
  files?: DraftFile[];
  sections: CourseSection[];
}

/** The availability field's value for `restrictions`, the gradebook read first when a grade condition needs it. */
async function availabilityValue(context: BrowserContext, siteUrl: string, courseId: number, restrictions: Restrictions): Promise<string> {
  const grades = restrictions.conditions.some((c) => c.type === "grade") ? await gradeItemsByActivity(context, siteUrl, courseId) : undefined;
  // Moodle saves a condition on an id the course doesn't have without a word (a group's, confirmed empirically, 5.2): an activity's is checked here.
  const completions = restrictions.conditions.flatMap((c) => (c.type === "completion" ? [c.activityId] : []));
  if (completions.length > 0) {
    const ids = new Set((await courseState(context, siteUrl, courseId)).cm.map((cm) => Number(cm.id)));
    const unknown = completions.filter((id) => !ids.has(id));
    if (unknown.length > 0) throw new MoodleError(`Course ${courseId} has no activity ${unknown.join(", ")} for a completion condition. Take its id from the course structure.`, "not-found");
  }
  return restrictionsJson(restrictions, grades);
}

/** The form values for an activity's restrictions and completion, refused when the form has no place for them. */
async function conditionValues(context: BrowserContext, siteUrl: string, page: Page, courseId: number, input: ActivityFields): Promise<Record<string, FieldValue>> {
  const values: Record<string, FieldValue> = {};
  if (input.restrictions) {
    if ((await formValue(page, "availabilityconditionsjson")) === undefined) throw new MoodleError("This form has no access restrictions: they're off on the site.", "not-available");
    values.availabilityconditionsjson = await availabilityValue(context, siteUrl, courseId, input.restrictions);
  }
  if (input.completion !== undefined) Object.assign(values, await completionValues(page, input.completion));
  return values;
}

/** The form values the common inputs stand for, given the activity's type, then `extra`, then `settings` (which win). */
function fieldsFor(type: string, input: ActivityFields, extra: Record<string, FieldValue> = {}): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values["introeditor[text]"] = input.description;
  if (input.content !== undefined) {
    // A label's text is its description field; a page has its own content editor.
    if (type === "label") values["introeditor[text]"] = input.content;
    else if (type === "page") values["page[text]"] = input.content;
    else throw new MoodleError(`content is for pages and labels; for a ${type}, use description or settings.`, "invalid-input");
  }
  if (input.url !== undefined) values.externalurl = input.url;
  if (input.visibility !== undefined) values.visible = FORM_VISIBILITY[input.visibility];
  return { ...values, ...extra, ...input.settings };
}

async function afterChange(context: BrowserContext, siteUrl: string, courseId: number, changed: string, extra: Partial<CourseChange> = {}): Promise<CourseChange> {
  return { changed, ...extra, sections: structureOf(await courseState(context, siteUrl, courseId)) };
}

/**
 * Changes to a file resource's or folder's files: `add` local paths (a `DraftUpload` puts one under
 * another name or in a subfolder, `"week1/notes.pdf"`), `remove` files by their path in the activity,
 * or `replace` the whole set. A file added with the name of one already there replaces it.
 */
export interface FileChanges {
  add?: (string | DraftUpload)[];
  remove?: string[];
  replace?: (string | DraftUpload)[];
}

const localPaths = (files: (string | DraftUpload)[] = []) => files.map((file) => (typeof file === "string" ? file : file.from));

/** The form's file area: a SCORM's package, or the files of a resource or folder. */
async function fileArea(page: Page, type: string): Promise<string | undefined> {
  return formValue(page, type === "scorm" ? "packagefile" : "files");
}

/** Applies `changes` to the draft area `draft` and says what was done; refuses a file to remove that isn't there. */
async function changeFiles(page: Page, draft: string, changes: FileChanges): Promise<{ done: string; files: DraftFile[] }> {
  const done: string[] = [];
  const current = await draftFiles(page, draft);
  const removing = changes.replace ? current.map((file) => file.name) : (changes.remove ?? []);
  const missing = removing.filter((name) => !current.some((file) => file.name === name));
  if (missing.length > 0) {
    throw new MoodleError(`The activity has no file ${missing.map((name) => `"${name}"`).join(", ")}; it has ${current.map((file) => `"${file.name}"`).join(", ") || "none"}.`, "not-found");
  }
  for (const name of removing) await deleteDraftFile(page, draft, name);
  if (removing.length > 0) done.push(`removed ${removing.join(", ")}`);
  const adding = changes.replace ?? changes.add ?? [];
  if (adding.length > 0) {
    await uploadToDraft(page, draft, adding, { overwrite: true });
    done.push(`added ${adding.map((file) => (typeof file === "string" ? path.basename(file) : file.to)).join(", ")}`);
  }
  return { done: done.join(" and "), files: await draftFiles(page, draft) };
}

/**
 * Creates an activity or resource of any type at the end of a section, through Moodle's own form,
 * hidden from students unless `visibility` says otherwise. `files` are local paths uploaded to a file
 * resource or folder (a `DraftUpload` puts one in a folder's subfolder); a SCORM (`type: "scorm"`)
 * takes the first as its package.
 */
export async function createActivity(
  context: BrowserContext,
  siteUrl: string,
  input: ActivityFields & { courseId: number; sectionId: number; type: string; files?: (string | DraftUpload)[] },
): Promise<CourseChange> {
  if (input.files) await checkLocalFiles(localPaths(input.files));
  const before = await courseState(context, siteUrl, input.courseId);
  const target = before.section.find((s) => Number(s.id) === input.sectionId);
  if (!target) throw new MoodleError(`Course ${input.courseId} has no section ${input.sectionId}. Take its id from the course structure.`, "not-found");

  const page = await openForm(context, siteUrl, `course/modedit.php?add=${input.type}&course=${input.courseId}&section=${target.number}&return=0`);
  try {
    if (input.files && input.files.length > 0) {
      // A SCORM takes one package, in a field of its own.
      const scorm = input.type === "scorm";
      const draft = await fileArea(page, input.type);
      if (!draft) throw new MoodleError(`A ${input.type} takes no files in its form.`, "not-available");
      await uploadToDraft(page, draft, scorm ? input.files.slice(0, 1) : input.files);
    }
    // Hidden unless asked: a teacher publishes after checking.
    await setFields(page, fieldsFor(input.type, { ...input, visibility: input.visibility ?? "hidden" }, await conditionValues(context, siteUrl, page, input.courseId, input)));
    await submitForm(page, "submitbutton2");
  } finally {
    await page.close().catch(() => undefined);
  }

  const after = await courseState(context, siteUrl, input.courseId);
  const created = after.cm.find((cm) => !before.cm.some((old) => old.id === cm.id));
  return {
    changed: created ? `Created ${input.type} ${created.id} "${created.name}" in section ${target.number}.` : `The form was saved, but no new activity appears in course ${input.courseId}.`,
    activityId: created ? Number(created.id) : undefined,
    url: created?.url,
    sections: structureOf(after),
  };
}

/**
 * Changes an existing activity through its form: only what's given changes. A file resource's or
 * folder's files stay as they are unless `files` says what to add, remove or replace.
 */
export async function updateActivity(context: BrowserContext, siteUrl: string, activityId: number, input: ActivityFields & { files?: FileChanges }): Promise<CourseChange> {
  const { files, ...fields } = input;
  if (files?.replace && (files.add || files.remove)) throw new MoodleError("Give files.replace alone, or files.add and files.remove.", "invalid-input");
  if (files) await checkLocalFiles([...localPaths(files.add), ...localPaths(files.replace)]);
  const page = await openForm(context, siteUrl, `course/modedit.php?update=${activityId}&return=0`);
  let courseId: number;
  let filesDone: { done: string; files: DraftFile[] } | undefined;
  try {
    courseId = Number(await formValue(page, "course"));
    const type = (await formValue(page, "modulename")) ?? "";
    if (files) {
      const draft = await fileArea(page, type);
      if (!draft) throw new MoodleError(`A ${type} has no files in its form.`, "not-available");
      filesDone = await changeFiles(page, draft, files);
    }
    await setFields(page, fieldsFor(type, fields, await conditionValues(context, siteUrl, page, courseId, fields)));
    await submitForm(page, "submitbutton2");
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await courseState(context, siteUrl, courseId);
  const cm = after.cm.find((c) => Number(c.id) === activityId);
  const done = filesDone?.done ? `: ${filesDone.done}` : "";
  return { changed: `Updated activity ${activityId}${cm ? ` "${cm.name}"` : ""}${done}.`, activityId: activityId, url: cm?.url, files: filesDone?.files, sections: structureOf(after) };
}

/** Renames, shows or hides, or moves an activity (to a section's end, or before another one). */
export async function editActivity(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  activityId: number,
  { name, visibility, sectionId, beforeActivityId }: { name?: string; visibility?: ActivityVisibility; sectionId?: number; beforeActivityId?: number },
): Promise<CourseChange> {
  const done: string[] = [];
  if (name !== undefined) {
    await renameActivity(context, siteUrl, activityId, name);
    done.push(`renamed to "${name}"`);
  }
  if (visibility !== undefined) {
    await editCourse(context, siteUrl, courseId, VISIBILITY_ACTIONS[visibility], [activityId]);
    done.push(`made ${visibility}`);
  }
  if (sectionId !== undefined || beforeActivityId !== undefined) {
    await editCourse(context, siteUrl, courseId, "cm_move", [activityId], { sectionId, activityId: beforeActivityId });
    done.push(beforeActivityId !== undefined ? `moved before activity ${beforeActivityId}` : `moved to the end of section ${sectionId}`);
  }
  return afterChange(context, siteUrl, courseId, done.length > 0 ? `Activity ${activityId} ${done.join(", ")}.` : "Nothing to change.");
}

/** Duplicates an activity as the course page's "Duplicate" does (right after it, named with "(copy)"); gives the copy's id and the course afterwards. */
export async function duplicateActivity(context: BrowserContext, siteUrl: string, courseId: number, activityId: number): Promise<CourseChange> {
  const before = new Set((await courseState(context, siteUrl, courseId)).cm.map((cm) => cm.id));
  await editCourse(context, siteUrl, courseId, "cm_duplicate", [activityId]);
  const copy = (await courseState(context, siteUrl, courseId)).cm.find((cm) => !before.has(cm.id));
  return afterChange(context, siteUrl, courseId, `Activity ${activityId} duplicated${copy ? ` as ${copy.id}` : ""}.`, { activityId: copy ? Number(copy.id) : undefined });
}

/** Deletes an activity, with its participants' data (submissions, posts, attempts); gives the course afterwards. */
export async function deleteActivity(context: BrowserContext, siteUrl: string, courseId: number, activityId: number): Promise<CourseChange> {
  await editCourse(context, siteUrl, courseId, "cm_delete", [activityId]);
  return afterChange(context, siteUrl, courseId, `Activity ${activityId} deleted.`);
}

/**
 * Saves fields of a section's own form (`course/editsection.php`): its description, its access
 * restrictions. No service changes them (`core_course_edit_section` only shows, hides and moves).
 */
async function saveSectionForm(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number, values: Record<string, FieldValue>): Promise<void> {
  const page = await openForm(context, siteUrl, `course/editsection.php?id=${sectionId}`);
  try {
    // The form edits any section by its id: one of another course is refused, as the course editor's service does.
    if (Number(await formValue(page, "course")) !== courseId) throw new MoodleError(`Course ${courseId} has no section ${sectionId}. Take its id from the course structure.`, "not-found");
    await setFields(page, values);
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Adds a section after another one (at the end without it), named when a name is given, with a description (HTML) when `summary` is. */
export async function addSection(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  { name, afterSectionId, summary }: { name?: string; afterSectionId?: number; summary?: string } = {},
): Promise<CourseChange> {
  const before = new Set((await courseState(context, siteUrl, courseId)).section.map((s) => s.id));
  await editCourse(context, siteUrl, courseId, "section_add", [], { sectionId: afterSectionId });
  const added = (await courseState(context, siteUrl, courseId)).section.find((s) => !before.has(s.id));
  if (added && name !== undefined) await renameSection(context, siteUrl, courseId, Number(added.id), name);
  if (added && summary !== undefined) await saveSectionForm(context, siteUrl, courseId, Number(added.id), { "summary_editor[text]": summary });
  const extras = `${name !== undefined ? ` as "${name}"` : ""}${summary !== undefined ? " with a description" : ""}`;
  return afterChange(context, siteUrl, courseId, `Section ${added?.id ?? "?"} added${extras}.`, { sectionId: added ? Number(added.id) : undefined });
}

/**
 * Renames, shows or hides, describes (`summary`, HTML), restricts (`restrictions`; `{ conditions: [] }`
 * removes them) or moves a section after another one.
 */
export async function editSection(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  sectionId: number,
  { name, visible, summary, restrictions, afterSectionId }: { name?: string; visible?: boolean; summary?: string; restrictions?: Restrictions; afterSectionId?: number },
): Promise<CourseChange> {
  const done: string[] = [];
  if (name !== undefined) {
    await renameSection(context, siteUrl, courseId, sectionId, name);
    done.push(`renamed to "${name}"`);
  }
  if (summary !== undefined || restrictions !== undefined) {
    // One save of the section's form for both.
    const values: Record<string, FieldValue> = {};
    if (summary !== undefined) values["summary_editor[text]"] = summary;
    if (restrictions !== undefined) values.availabilityconditionsjson = await availabilityValue(context, siteUrl, courseId, restrictions);
    await saveSectionForm(context, siteUrl, courseId, sectionId, values);
    if (summary !== undefined) done.push(summary === "" ? "description removed" : "description set");
    if (restrictions !== undefined) done.push(restrictions.conditions.length === 0 ? "restrictions removed" : "restrictions set");
  }
  if (visible !== undefined) {
    await editCourse(context, siteUrl, courseId, visible ? "section_show" : "section_hide", [sectionId]);
    done.push(visible ? "shown" : "hidden");
  }
  if (afterSectionId !== undefined) {
    await editCourse(context, siteUrl, courseId, "section_move_after", [sectionId], { sectionId: afterSectionId });
    done.push(`moved after section ${afterSectionId}`);
  }
  return afterChange(context, siteUrl, courseId, done.length > 0 ? `Section ${sectionId} ${done.join(", ")}.` : "Nothing to change.");
}

/** Deletes a section and every activity in it, with their participants' data. */
export async function deleteSection(context: BrowserContext, siteUrl: string, courseId: number, sectionId: number): Promise<CourseChange> {
  await editCourse(context, siteUrl, courseId, "section_delete", [sectionId]);
  return afterChange(context, siteUrl, courseId, `Section ${sectionId} deleted, with its activities.`);
}

/** One field of a Moodle form, as it is now: its name (what `settings` takes), label, value and options. */
export interface FormField {
  name: string;
  type: "text" | "textarea" | "select" | "checkbox" | "radio" | "number" | "date" | "other";
  label?: string;
  /** Text, the selected option (several for a multiple select), the checked radio's value. */
  value?: string | string[];
  checked?: boolean;
  options?: { value: string; label: string }[];
  /** Disabled until another field enables it; Moodle doesn't save it as it is. */
  disabled?: boolean;
}

/** The fields of a Moodle form in `page`, internal ones (sesskey, ids, buttons) left out, editors' HTML included. */
export function readFormFields(page: Page): Promise<FormField[]> {
  return inPage(
    page,
    () => {
      interface El {
        id: string;
        name: string;
        type: string;
        value: string;
        checked: boolean;
        disabled: boolean;
        multiple: boolean;
        tagName: string;
        textContent: string | null;
        options: ArrayLike<{ value: string; text: string; selected: boolean }>;
        closest(s: string): El | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      // A field's label: its own <label for>, or its row's (a date selector's parts, a radio group).
      const labelOf = (field: El) => {
        const own = field.id ? doc.querySelector(`label[for="${field.id}"]`) : null;
        const row = field.closest(".fitem")?.querySelector(".col-form-label label, .col-form-label p, legend");
        return clean(own?.textContent) || clean(row?.textContent) || undefined;
      };
      const fields: FormField[] = [];
      const internal = /^(sesskey|_qf__|mform_isexpanded_|mform_showmore_|course$|coursemodule$|section$|module$|modulename$|instance$|add$|update$|return$|sr$|beforemod$)/;
      for (const field of Array.from(doc.querySelectorAll("form.mform [name]"))) {
        const name = field.name;
        if (!name || internal.test(name) || ["hidden", "submit", "button", "fieldset"].includes(field.type) || field.tagName === "FIELDSET") continue;
        if (field.type === "radio") {
          let group = fields.find((f) => f.name === name);
          if (!group) {
            group = { name, type: "radio", label: clean(field.closest(".fitem")?.querySelector(".col-form-label, legend")?.textContent) || undefined, options: [] };
            fields.push(group);
          }
          group.options!.push({ value: field.value, label: clean((doc.querySelector(`label[for="${field.id}"]`) ?? field.closest("label"))?.textContent) || field.value });
          if (field.checked) group.value = field.value;
        } else if (field.type === "checkbox") {
          fields.push({ name, type: "checkbox", label: labelOf(field), value: field.value, checked: field.checked });
        } else if (field.tagName === "SELECT") {
          const options = Array.from(field.options);
          const selected = options.filter((o) => o.selected).map((o) => o.value);
          // A date selector's parts (duedate[day]…) are numbers, named by their row ("Due date (day)").
          const part = /\[(day|month|year|hour|minute)\]$/.exec(name)?.[1];
          if (part) {
            // The group's label is id_<group>_label (id_duedate_label for duedate[day]).
            const row = clean(doc.querySelector(`#id_${name.slice(0, name.indexOf("["))}_label`)?.textContent);
            fields.push({ name, type: "date", label: row ? `${row} (${part})` : part, value: selected[0] });
          } else {
            fields.push({ name, type: "select", label: labelOf(field), value: field.multiple ? selected : selected[0], options: options.map((o) => ({ value: o.value, label: clean(o.text) })) });
          }
        } else {
          const type = field.tagName === "TEXTAREA" ? "textarea" : field.type === "number" ? "number" : field.type === "text" || field.type === "url" || field.type === "email" ? "text" : "other";
          fields.push({ name, type, label: labelOf(field), value: field.value });
        }
      }
      // Moodle disables fields until another enables them (a date until its "enable", a maximum grade until rescaling is chosen).
      for (const f of fields) {
        const elements = Array.from(doc.querySelectorAll(`form.mform [name="${f.name}"]`)).filter((e) => e.type !== "hidden");
        if (elements.length > 0 && elements.every((e) => e.disabled)) f.disabled = true;
        // No label, no key: plain data for the program.
        for (const key of Object.keys(f) as (keyof FormField)[]) if (f[key] === undefined) delete f[key];
      }
      return fields;
    },
    null,
  );
}

/** Nobody can see that activity's settings: not an activity, or not the person's to edit. */
export class ActivitySettingsError extends MoodleError {
  override name = "ActivitySettingsError";
  constructor(message: string) {
    super(message, "activity-settings");
  }
}

/**
 * An activity's settings as its form holds them, without submitting it: its module, name and
 * description, every field by the name `updateActivity` takes in `settings`, the files of a
 * resource, folder or SCORM, and its restrictions and completion in plain terms. Teachers only.
 */
export async function activitySettings(context: BrowserContext, siteUrl: string, activityId: number) {
  const page = await openSitePage(context, siteUrl, `course/modedit.php?update=${activityId}&return=0`);
  try {
    if ((await page.locator("form.mform").count()) === 0) {
      throw new ActivitySettingsError(`You can't see activity ${activityId}'s settings: ${(await moodleErrorMessage(page)) ?? "it doesn't exist, or you can't edit it"}`);
    }
    await page.waitForLoadState("load");
    const fields = await readFormFields(page);
    const value = (name: string) => fields.find((f) => f.name === name)?.value as string | undefined;
    const module = (await formValue(page, "modulename")) ?? "";
    const draft = await fileArea(page, module);
    const courseId = Number(await formValue(page, "course"));
    const availability = value("availabilityconditionsjson");
    // A grade condition names a grade item: its activity comes from the gradebook, when the person can read it.
    const gradeActivities =
      availability && hasGradeCondition(availability)
        ? new Map([...(await gradeItemsByActivity(context, siteUrl, courseId).catch(() => new Map<number, number>()))].map(([activityId, itemId]) => [itemId, activityId]))
        : undefined;
    return {
      id: activityId,
      module,
      courseId,
      name: value("name") ?? "",
      description: value("introeditor[text]") ?? "",
      fields,
      /** A file resource's, folder's or SCORM's files, by their path in it, as `updateActivity`'s `files.remove` takes them. */
      files: draft ? await draftFiles(page, draft) : undefined,
      /** When students can open it, in the terms `updateActivity` takes; undefined without restrictions. */
      restrictions: parseRestrictions(availability, gradeActivities),
      /** When it counts as complete, in the terms `updateActivity` takes; undefined when completion is off. */
      completion: await readCompletion(page),
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
