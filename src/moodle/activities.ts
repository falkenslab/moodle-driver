// Building a course: activities through Moodle's own activity form, and the course page's editing
// (rename, show, move, duplicate, delete) through its services. Every change answers with the
// course's structure afterwards, to check it.
import type { BrowserContext } from "playwright-core";
import { courseState } from "./course.js";
import { editCourse, renameActivity, renameSection } from "./editor.js";
import { checkLocalFiles } from "./files.js";
import { formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "./forms.js";
import { structureOf, type CourseSection } from "./structure.js";

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
  settings?: Record<string, FieldValue>;
}

/** What a change did, its new id when it created something, and the course afterwards. */
export interface CourseChange {
  changed: string;
  activityId?: number;
  newId?: number;
  url?: string;
  sections: CourseSection[];
}

/** The form values the common inputs stand for, given the activity's type. */
function fieldsFor(type: string, input: ActivityFields): Record<string, FieldValue> {
  const values: Record<string, FieldValue> = {};
  if (input.name !== undefined) values.name = input.name;
  if (input.description !== undefined) values["introeditor[text]"] = input.description;
  if (input.content !== undefined) {
    // A label's text is its description field; a page has its own content editor.
    if (type === "label") values["introeditor[text]"] = input.content;
    else if (type === "page") values["page[text]"] = input.content;
    else throw new Error(`content is for pages and labels; for a ${type}, use description or settings.`);
  }
  if (input.url !== undefined) values.externalurl = input.url;
  if (input.visibility !== undefined) values.visible = FORM_VISIBILITY[input.visibility];
  return { ...values, ...input.settings };
}

async function afterChange(context: BrowserContext, siteUrl: string, courseId: number, changed: string, extra: Partial<CourseChange> = {}): Promise<CourseChange> {
  return { changed, ...extra, sections: structureOf(await courseState(context, siteUrl, courseId)) };
}

/**
 * Creates an activity or resource of any type at the end of a section, through Moodle's own form,
 * hidden from students unless `visibility` says otherwise. `files` are local paths uploaded to a file
 * resource or folder.
 */
export async function createActivity(
  context: BrowserContext,
  siteUrl: string,
  input: ActivityFields & { courseId: number; sectionId: number; type: string; files?: string[] },
): Promise<CourseChange> {
  if (input.files) await checkLocalFiles(input.files);
  const before = await courseState(context, siteUrl, input.courseId);
  const target = before.section.find((s) => Number(s.id) === input.sectionId);
  if (!target) throw new Error(`Course ${input.courseId} has no section ${input.sectionId}. Take its id from the course structure.`);

  const page = await openForm(context, siteUrl, `course/modedit.php?add=${input.type}&course=${input.courseId}&section=${target.number}&return=0`);
  try {
    if (input.files && input.files.length > 0) {
      const draft = await formValue(page, "files");
      if (!draft) throw new Error(`A ${input.type} takes no files in its form.`);
      await uploadToDraft(page, draft, input.files);
    }
    // Hidden unless asked: a teacher publishes after checking.
    await setFields(page, fieldsFor(input.type, { ...input, visibility: input.visibility ?? "hidden" }));
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

/** Changes an existing activity through its form: only what's given changes; files stay as they are. */
export async function updateActivity(context: BrowserContext, siteUrl: string, cmid: number, input: ActivityFields): Promise<CourseChange> {
  const page = await openForm(context, siteUrl, `course/modedit.php?update=${cmid}&return=0`);
  let courseId: number;
  try {
    courseId = Number(await formValue(page, "course"));
    const type = (await formValue(page, "modulename")) ?? "";
    await setFields(page, fieldsFor(type, input));
    await submitForm(page, "submitbutton2");
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await courseState(context, siteUrl, courseId);
  const cm = after.cm.find((c) => Number(c.id) === cmid);
  return { changed: `Updated activity ${cmid}${cm ? ` "${cm.name}"` : ""}.`, activityId: cmid, url: cm?.url, sections: structureOf(after) };
}

/** Renames, shows or hides, or moves an activity (to a section's end, or before another one). */
export async function editActivity(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  cmid: number,
  { name, visibility, sectionId, beforeActivityId }: { name?: string; visibility?: ActivityVisibility; sectionId?: number; beforeActivityId?: number },
): Promise<CourseChange> {
  const done: string[] = [];
  if (name !== undefined) {
    await renameActivity(context, siteUrl, cmid, name);
    done.push(`renamed to "${name}"`);
  }
  if (visibility !== undefined) {
    await editCourse(context, siteUrl, courseId, VISIBILITY_ACTIONS[visibility], [cmid]);
    done.push(`made ${visibility}`);
  }
  if (sectionId !== undefined || beforeActivityId !== undefined) {
    await editCourse(context, siteUrl, courseId, "cm_move", [cmid], { sectionId, activityId: beforeActivityId });
    done.push(beforeActivityId !== undefined ? `moved before activity ${beforeActivityId}` : `moved to the end of section ${sectionId}`);
  }
  return afterChange(context, siteUrl, courseId, done.length > 0 ? `Activity ${cmid} ${done.join(", ")}.` : "Nothing to change.");
}

export async function duplicateActivity(context: BrowserContext, siteUrl: string, courseId: number, cmid: number): Promise<CourseChange> {
  const before = new Set((await courseState(context, siteUrl, courseId)).cm.map((cm) => cm.id));
  await editCourse(context, siteUrl, courseId, "cm_duplicate", [cmid]);
  const copy = (await courseState(context, siteUrl, courseId)).cm.find((cm) => !before.has(cm.id));
  return afterChange(context, siteUrl, courseId, `Activity ${cmid} duplicated${copy ? ` as ${copy.id}` : ""}.`, { newId: copy ? Number(copy.id) : undefined });
}

export async function deleteActivity(context: BrowserContext, siteUrl: string, courseId: number, cmid: number): Promise<CourseChange> {
  await editCourse(context, siteUrl, courseId, "cm_delete", [cmid]);
  return afterChange(context, siteUrl, courseId, `Activity ${cmid} deleted.`);
}

/** Adds a section after another one (at the end without it), named when a name is given. */
export async function addSection(context: BrowserContext, siteUrl: string, courseId: number, { name, afterSectionId }: { name?: string; afterSectionId?: number } = {}): Promise<CourseChange> {
  const before = new Set((await courseState(context, siteUrl, courseId)).section.map((s) => s.id));
  await editCourse(context, siteUrl, courseId, "section_add", [], { sectionId: afterSectionId });
  const added = (await courseState(context, siteUrl, courseId)).section.find((s) => !before.has(s.id));
  if (added && name !== undefined) await renameSection(context, siteUrl, courseId, Number(added.id), name);
  return afterChange(context, siteUrl, courseId, `Section ${added?.id ?? "?"} added${name !== undefined ? ` as "${name}"` : ""}.`, { newId: added ? Number(added.id) : undefined });
}

/** Renames, shows or hides, or moves a section after another one. */
export async function editSection(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  sectionId: number,
  { name, visible, afterSectionId }: { name?: string; visible?: boolean; afterSectionId?: number },
): Promise<CourseChange> {
  const done: string[] = [];
  if (name !== undefined) {
    await renameSection(context, siteUrl, courseId, sectionId, name);
    done.push(`renamed to "${name}"`);
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
