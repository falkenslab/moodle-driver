// Copying, backing up, restoring and importing courses. Copying goes through Moodle's copy service;
// backups, restores and imports through their page wizards, stage by stage, as a person would. Moodle
// runs copies, and backups and restores when the site makes them asynchronous, in its scheduled tasks
// (cron): the driver waits for them, up to a timeout.
import { rm } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright-core";
import { MoodleServiceError, callService } from "../../core/ajax.js";
import { dateSelectorValues, openForm, setFields, submitForm, uploadToDraft, formValue, type FieldValue } from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { checkLocalFiles, downloadFile, type DownloadedFile } from "../../core/files.js";
import { MoodleError } from "../../core/errors.js";
import { decodeEntities } from "../../core/text.js";
import { editCourse, renameSection } from "../../core/editor.js";
import { courseDetails, courseState, type CourseState } from "../courses/state.js";
import { courseActivityTypes } from "../site/info.js";
import { addSection, editSection } from "../activities/build.js";
import { BackupError } from "./errors.js";
import { archiveKind, branchOfNumber, branchOfRelease, readBackupInfo, type BackupInfo } from "./mbz.js";
import { conditionsOf, readBackupContents, type BackupContents } from "./contents.js";

export { BackupError };

/** A course as a copy, restore or import leaves it. */
export interface CourseRef {
  id: number;
  fullName: string;
  shortName: string;
  categoryId?: number;
  url: string;
}

/** How long the driver waits for Moodle's background tasks unless told: ten minutes. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_MS = 3000;
// Moodle's backup controller statuses (backup::STATUS_*).
const FINISHED_ERR = 900;
const FINISHED_OK = 1000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Asks `progress` until Moodle says the operation finished; throws `BackupError` when it failed or the time ran out. */
async function waitFor(what: string, timeoutMs: number, progress: () => Promise<number | undefined>): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const status = await progress();
    if (status === FINISHED_OK) return;
    if (status === FINISHED_ERR) throw new BackupError(`Moodle couldn't finish the ${what}: it ended with an error (its details are in the site's logs and on the restore page).`);
    if (Date.now() > deadline) {
      throw new BackupError(
        `Moodle hasn't finished the ${what} after ${Math.round(timeoutMs / 1000)} seconds: the site runs it in its scheduled tasks (cron), which may be slow or not running. It goes on in the background.`,
      );
    }
    await pause(POLL_MS);
  }
}

/** Waits for an asynchronous backup or restore (`core_backup_get_async_backup_progress`). */
function waitForAsync(context: BrowserContext, siteUrl: string, what: string, backupId: string, contextId: number, timeoutMs: number): Promise<void> {
  return waitFor(what, timeoutMs, async () => {
    const [progress] = await callService<{ status: number }[]>(context, siteUrl, "core_backup_get_async_backup_progress", { backupids: [backupId], contextid: contextId });
    return progress?.status;
  });
}

/** A course found by its short name among those the person can see (`core_course_search_courses`). */
async function courseByShortName(context: BrowserContext, siteUrl: string, shortName: string): Promise<CourseRef | undefined> {
  const { courses } = await callService<{ courses: { id: number; fullname: string; shortname: string; categoryid?: number }[] }>(context, siteUrl, "core_course_search_courses", {
    criterianame: "search",
    criteriavalue: shortName,
    page: 0,
    perpage: 50,
  });
  const found = courses.find((course) => decodeEntities(course.shortname) === shortName);
  return found ? toRef(siteUrl, found) : undefined;
}

function toRef(siteUrl: string, raw: { id: number; fullname: string; shortname: string; categoryid?: number }): CourseRef {
  return {
    id: raw.id,
    fullName: decodeEntities(raw.fullname),
    shortName: decodeEntities(raw.shortname),
    ...(raw.categoryid ? { categoryId: raw.categoryid } : {}),
    url: new URL(`course/view.php?id=${raw.id}`, siteUrl).href,
  };
}

/** Opens a wizard's page; a page without its form becomes `BackupError` with `refusal` and Moodle's own message. */
async function openWizard(context: BrowserContext, siteUrl: string, path: string, formMarker: string, refusal: string): Promise<Page> {
  const page = await openSitePage(context, siteUrl, path);
  try {
    if ((await page.locator(`form.mform [name="${formMarker}"]`).count()) === 0) {
      const moodle = await moodleErrorMessage(page);
      throw new BackupError(`${refusal}${moodle ? `: ${moodle}` : "."}`);
    }
    await page.close();
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
  // Opened again as a form: its editors and dependencies ready.
  return openForm(context, siteUrl, path);
}

/** The course context id a wizard's page works in (`M.cfg.contextid`). */
const pageContextId = (page: Page) => page.evaluate(() => Number((globalThis as unknown as { M?: { cfg?: { contextid?: number } } }).M?.cfg?.contextid ?? 0));

/** The backup id of an asynchronous operation's progress bar on a wizard's last page, when Moodle made it asynchronous. */
const asyncBackupId = async (page: Page) => (await page.locator("[data-backupid]").first().getAttribute("data-backupid").catch(() => null)) ?? undefined;

/**
 * Copies a course into a new one, as Moodle's "Copy course" does: its content (and its people's
 * data and enrolments, `withUsers`), under a new full and short name, in a category (the course's
 * unless given), with new dates. Goes through Moodle's copy service, then waits for the copy, which
 * Moodle makes in its scheduled tasks, up to `timeoutMs` (ten minutes). Needs the rights to back
 * up, restore and create courses (`moodle/backup:backupcourse`, `moodle/restore:restorecourse`,
 * `moodle/course:create`); without them, `BackupError` says so.
 */
export async function copyCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  {
    fullName,
    shortName,
    categoryId,
    start,
    end,
    withUsers = false,
    visible,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: { fullName: string; shortName: string; categoryId?: number; start?: Date; end?: Date; withUsers?: boolean; visible?: boolean; timeoutMs?: number },
): Promise<{ changed: string; course: CourseRef }> {
  if (!fullName.trim() || !shortName.trim()) throw new MoodleError("A copy needs a full name and a short name.", "invalid-input");
  const page = await openWizard(
    context,
    siteUrl,
    `backup/copy.php?id=${courseId}`,
    "_qf__core_backup_output_copy_form",
    `You can't copy course ${courseId}: Moodle asks for the rights to back up, restore and create courses (moodle/backup:backupcourse, moodle/restore:restorecourse, moodle/course:create)`,
  );
  let formData: string;
  try {
    const values: Record<string, FieldValue> = { fullname: fullName, shortname: shortName };
    if (categoryId !== undefined) values.category = String(categoryId);
    if (visible !== undefined) values.visible = visible ? "1" : "0";
    if (start) Object.assign(values, await dateSelectorValues(page, "startdate", start));
    if (end) Object.assign(values, { "enddate[enabled]": true }, await dateSelectorValues(page, "enddate", end));
    values.userdata = withUsers ? "1" : "0";
    await setFields(page, values);
    // With users, everyone's enrolments are kept (each role's checkbox).
    if (withUsers) {
      const roles = await page.evaluate(() =>
        Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string }> } }).document.querySelectorAll('form.mform input[type="checkbox"][name^="role_"]')).map((box) => box.name),
      );
      if (roles.length > 0) await setFields(page, Object.fromEntries(roles.map((name) => [name, true])));
    }
    // The form as Moodle's own page sends it to the service: urlencoded, without its buttons.
    formData = await page.evaluate(() => {
      const g = globalThis as unknown as {
        document: { querySelector(s: string): unknown };
        FormData: new (form: unknown) => Iterable<[string, unknown]>;
        URLSearchParams: new (init: [string, string][]) => { toString(): string };
      };
      const entries = Array.from(new g.FormData(g.document.querySelector("form.mform"))).filter((entry): entry is [string, string] => typeof entry[1] === "string");
      return new g.URLSearchParams(entries).toString();
    });
  } finally {
    await page.close().catch(() => undefined);
  }
  let ids: { backupid: string; restoreid: string };
  try {
    ids = JSON.parse(await callService<string>(context, siteUrl, "core_backup_submit_copy_form", { jsonformdata: JSON.stringify(formData) })) as { backupid: string; restoreid: string };
  } catch (error) {
    if (error instanceof MoodleServiceError && error.errorcode === "copyformfail") {
      throw new BackupError(`Moodle refused the copy's settings: the short name "${shortName}" may be taken already, or the end date is before the start.`);
    }
    throw error;
  }
  await waitFor("copy", timeoutMs, async () => {
    const [progress] = await callService<{ status: number }[]>(context, siteUrl, "core_backup_get_copy_progress", { copies: [{ backupid: ids.backupid, restoreid: ids.restoreid, operation: "backup" }] });
    return progress?.status;
  });
  const course = await courseByShortName(context, siteUrl, shortName);
  if (!course) throw new BackupError(`Moodle finished the copy, but no course with short name "${shortName}" is visible to you.`);
  return { changed: `Course ${courseId} copied into course ${course.id} "${course.fullName}".`, course };
}

/**
 * The backup's root settings a selection turns off: people's data (users, their roles, comments,
 * completion, logs, grade history, xAPI states), and what belongs to the course rather than to its
 * sections and activities (blocks, filters, badges, course events, groups, competencies, custom
 * fields, the content bank, legacy files), which a restore would add to the course restored into.
 */
const SELECTION_OFF = ["users", "anonymize", "role_assignments", "comments", "userscompletion", "logs", "grade_histories", "xapistate", "badges", "blocks", "filters", "calendarevents", "groups", "competencies", "customfield", "contentbankcontent", "legacyfiles"];
/** The root settings that carry people's data, checked off in a selection's file afterwards. */
const PERSONAL_SETTINGS = ["users", "role_assignments", "comments", "userscompletion", "logs", "grade_histories", "xapistate"];

/** The schema stage's checkboxes: `setting_section_section_<id>_included` and `setting_activity_<module>_<cmid>_included`. */
async function schemaBoxes(page: Page): Promise<{ sections: Map<number, string>; activities: Map<number, string> }> {
  const names = await page.evaluate(() =>
    Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string }> } }).document.querySelectorAll('form.mform input[type="checkbox"][name$="_included"]')).map((box) => box.name),
  );
  const sections = new Map<number, string>();
  const activities = new Map<number, string>();
  for (const name of names) {
    const section = /^setting_section_section_(\d+)_included$/.exec(name);
    const activity = /^setting_activity_[a-z0-9]+_(\d+)_included$/.exec(name);
    if (section) sections.set(Number(section[1]), name);
    else if (activity) activities.set(Number(activity[1]), name);
  }
  return { sections, activities };
}

/**
 * What a selection takes, as the schema stage ticks it: the sections chosen whole with every module
 * in them (a subsection's content with it), the activities chosen alone, and the section of each,
 * which Moodle needs ticked for its activities (with only those in it).
 */
export function selectionOf(
  state: Pick<CourseState, "cm">,
  { sections = [], activities = [] }: { sections?: number[]; activities?: number[] },
): { sectionIds: Set<number>; activityIds: Set<number> } {
  const whole = new Set(sections);
  const chosen = new Set(activities);
  for (let grew = true; grew; ) {
    grew = false;
    for (const cm of state.cm) {
      const id = Number(cm.id);
      if (whole.has(Number(cm.sectionid)) && !chosen.has(id)) {
        chosen.add(id);
        grew = true;
      }
      const delegated = Number(cm.delegatesectionid);
      if (chosen.has(id) && delegated && !whole.has(delegated)) {
        whole.add(delegated);
        grew = true;
      }
    }
  }
  const sectionIds = new Set(whole);
  for (const cm of state.cm) if (chosen.has(Number(cm.id))) sectionIds.add(Number(cm.sectionid));
  return { sectionIds, activityIds: chosen };
}

/**
 * Backs a course up to a `.mbz` file, through Moodle's backup wizard (initial settings, schema,
 * confirmation), and downloads it into `destDir`. Without users' data unless `withUsers`, which
 * needs `moodle/backup:userinfo` (`anonymize` makes their names anonymous). An asynchronous backup
 * is waited for up to `timeoutMs` (ten minutes). Moodle keeps the file in the course's or the
 * person's backup area too.
 *
 * With `sections` (section ids) or `activities` (course module ids: activities and resources), only
 * those go in: a section with everything in it, an activity alone (with its section's name, which
 * Moodle needs for it). A selection never carries people's data, nor what belongs to the course
 * rather than to its content (blocks, filters, badges, course events, groups, competencies, custom
 * fields, content bank, legacy files); the file is read afterwards to check that it holds what was
 * asked and no people's data.
 */
export async function backupCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  destDir: string,
  {
    withUsers = false,
    anonymize,
    sections,
    activities,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: {
    withUsers?: boolean;
    anonymize?: boolean;
    /** Ids of the sections to back up, each with everything in it. */
    sections?: number[];
    /** Course module ids of activities and resources to back up, each alone. */
    activities?: number[];
    timeoutMs?: number;
  } = {},
): Promise<{ changed: string; file: DownloadedFile }> {
  const selecting = sections !== undefined || activities !== undefined;
  if (selecting && withUsers) throw new MoodleError("A backup of part of a course carries no users' data: leave out withUsers, or back up the whole course.", "invalid-input");
  if (selecting && (sections ?? []).length + (activities ?? []).length === 0) throw new MoodleError("Give the sections or activities to back up, or neither for the whole course.", "invalid-input");
  const page = await openWizard(
    context,
    siteUrl,
    `backup/backup.php?id=${courseId}`,
    "_qf__backup_initial_form",
    `Moodle offers no backup of course ${courseId}: you aren't allowed (moodle/backup:backupcourse), or a backup of it is already in progress`,
  );
  let fileName: string;
  let contextId: number;
  let backupId: string | undefined;
  let selection: { sectionIds: Set<number>; activityIds: Set<number> } | undefined;
  try {
    const usersField = await page.locator('form.mform input[name="setting_root_users"]:not([type="hidden"])').count();
    if (withUsers && usersField === 0) throw new BackupError(`You can't back up course ${courseId} with its users' data: Moodle asks for moodle/backup:userinfo.`);
    const settings: Record<string, FieldValue> = {};
    if (usersField > 0) settings.setting_root_users = withUsers;
    if (withUsers && anonymize !== undefined) settings.setting_root_anonymize = anonymize;
    if (selecting) {
      // Every one of those settings the person may change, off (the rest are off already, or locked by users').
      const open = await page.evaluate(() =>
        Array.from(
          (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string }> } }).document.querySelectorAll('form.mform input[type="checkbox"][name^="setting_root_"]:not([disabled])'),
        ).map((box) => box.name),
      );
      for (const name of open) if (SELECTION_OFF.includes(name.slice("setting_root_".length))) settings[name] = false;
    }
    if (Object.keys(settings).length > 0) await setFields(page, settings);
    contextId = await pageContextId(page);
    await submitForm(page, "submitbutton"); // To the schema settings.
    if (selecting) {
      const boxes = await schemaBoxes(page);
      const missingSections = (sections ?? []).filter((id) => !boxes.sections.has(id));
      const missingActivities = (activities ?? []).filter((id) => !boxes.activities.has(id));
      if (missingSections.length + missingActivities.length > 0) {
        const what = [missingSections.length > 0 ? `no section ${missingSections.join(", ")}` : "", missingActivities.length > 0 ? `no activity ${missingActivities.join(", ")}` : ""].filter(Boolean).join(" and ");
        throw new MoodleError(`Course ${courseId} has ${what} to back up: take the ids from its structure.`, "not-found");
      }
      selection = selectionOf(await courseState(context, siteUrl, courseId), { sections, activities });
      const chosen = selection;
      // Activities first: unticking a section disables its activities' boxes (the page's dependencies).
      await setFields(page, {
        ...Object.fromEntries([...boxes.activities].map(([id, name]) => [name, chosen.activityIds.has(id)])),
        ...Object.fromEntries([...boxes.sections].map(([id, name]) => [name, chosen.sectionIds.has(id)])),
      });
    }
    await submitForm(page, "submitbutton"); // To the confirmation.
    fileName = (await formValue(page, "setting_root_filename")) ?? "";
    if (!fileName) throw new BackupError(`Moodle's backup wizard for course ${courseId} didn't reach its confirmation stage.`);
    await submitForm(page, "submitbutton"); // Perform the backup.
    backupId = await asyncBackupId(page);
  } finally {
    await page.close().catch(() => undefined);
  }
  if (backupId) await waitForAsync(context, siteUrl, "backup", backupId, contextId, timeoutMs);
  // The file's link from the restore page's backup areas (the course's, the person's).
  const files = await openSitePage(context, siteUrl, `backup/restorefile.php?contextid=${contextId}`);
  let link: string | undefined;
  try {
    const hrefs = await files.locator('a[href*="/pluginfile.php/"]').evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    link = hrefs.find((href) => decodeURIComponent(new URL(href).pathname).endsWith(`/${fileName}`));
  } finally {
    await files.close().catch(() => undefined);
  }
  if (!link) throw new BackupError(`Moodle made the backup "${fileName}", but it isn't in the backup areas you can see.`);
  const file = await downloadFile(context, siteUrl, link, destDir);
  if (!selection) return { changed: `Course ${courseId} backed up to ${file.name}.`, file };
  await checkSelection(file.path, selection);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return { changed: `Part of course ${courseId} (${count(selection.activityIds.size, "activity", "activities")} in ${count(selection.sectionIds.size, "section", "sections")}) backed up to ${file.name}, without people's data.`, file };
}

/** Reads a selection's file: it must hold what was asked and no people's data, or it's deleted. */
async function checkSelection(file: string, selection: { sectionIds: Set<number>; activityIds: Set<number> }): Promise<void> {
  const info = await readBackupInfo(file);
  const personal = PERSONAL_SETTINGS.filter((name) => info.settings[name] === "1");
  const held = new Set(info.activities.filter((a) => a.included).map((a) => a.id));
  const differs = held.size !== selection.activityIds.size || [...selection.activityIds].some((id) => !held.has(id));
  if (personal.length === 0 && !differs) return;
  await rm(file, { force: true });
  throw new BackupError(
    personal.length > 0
      ? `Moodle's backup kept people's data (${personal.join(", ")}) although the driver turned it off, so the file was deleted.`
      : `Moodle's backup holds activities ${[...held].join(", ") || "none"}, not those asked for (${[...selection.activityIds].join(", ")}), so the file was deleted.`,
  );
}

// Moodle's restore targets (backup::TARGET_*), and the wizard's stages (restore_ui::STAGE_*).
const TARGET_CURRENT_DELETING = 0;
const TARGET_CURRENT_ADDING = 1;
const TARGET_NEW_COURSE = 2;
const STAGE_SETTINGS = 4;

/** A page's context id, from the `M.cfg` of a page of the site (a course's, a category's). */
async function contextIdOf(context: BrowserContext, siteUrl: string, path: string, missing: string): Promise<number> {
  const page = await openSitePage(context, siteUrl, path);
  try {
    const level = await page.evaluate(() => (globalThis as unknown as { M?: { cfg?: { contextid?: number } } }).M?.cfg?.contextid ?? 0);
    const found = await page.locator("body#page-course-view-topics, body[id^='page-course-view'], body#page-course-index-category").count();
    if (!level || found === 0) throw new BackupError(missing);
    return level;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Submits a wizard stage with its "next" button. */
async function nextStage(page: Page): Promise<void> {
  await submitForm(page, "submitbutton");
}

/** The site's front page, a course to Moodle: the content types a new course would offer are asked of it. */
const SITE_COURSE = 1;
/** Modules a course's activity chooser never offers, though a backup may hold them: Moodle 5's question banks. */
const NOT_IN_CHOOSER = new Set(["qbank"]);

/**
 * Refuses a backup with activities of a type the site doesn't offer the person in the course: Moodle
 * would restore the rest and skip those without a word (`restore_plan_builder`, confirmed on 5.2).
 * When the chooser offers nothing (the person can't add activities there), there's nothing to compare.
 */
async function checkModules(context: BrowserContext, siteUrl: string, courseId: number, info: BackupInfo, file: string): Promise<void> {
  const offered = new Set((await courseActivityTypes(context, siteUrl, courseId).catch(() => [])).map((type) => type.type));
  if (offered.size === 0) return;
  const missing = [...new Set(info.activities.filter((a) => a.included && !offered.has(a.module) && !NOT_IN_CHOOSER.has(a.module)).map((a) => a.module))];
  if (missing.length === 0) return;
  const titles = info.activities.filter((a) => a.included && missing.includes(a.module)).map((a) => `"${a.title}"`);
  throw new BackupError(
    `${file} holds activities of ${missing.length === 1 ? "a type" : "types"} this site doesn't offer you in course ${courseId} (${missing.join(", ")}: ${titles.join(", ")}): Moodle would restore the rest without them. The site lacks those plugins, or has them disabled, or doesn't let you add them.`,
  );
}

/**
 * The site's Moodle branch ([5, 2]) from the documentation link Moodle puts on the restore page
 * (`<docroot>/<branch>/<language>/backup/restorefile`); undefined when the site shows none.
 */
async function siteBranch(page: Page): Promise<[number, number] | undefined> {
  const hrefs = await page.locator('a[href*="/backup/restorefile"]').evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  for (const href of hrefs) {
    const branch = /\/(\d{2,3})\/[^/]+\/backup\/restorefile(?:[?#]|$)/.exec(href)?.[1];
    const parsed = branch ? branchOfNumber(branch) : undefined;
    if (parsed) return parsed;
  }
  return undefined;
}

/** Refuses a backup made on a newer Moodle branch than the site's: Moodle only warns, and such a restore can fail half-way. */
async function checkVersion(page: Page, info: BackupInfo, file: string): Promise<void> {
  const site = await siteBranch(page);
  const backup = branchOfRelease(info.moodleRelease);
  if (!site || !backup) return;
  if (backup[0] > site[0] || (backup[0] === site[0] && backup[1] > site[1])) {
    throw new BackupError(`${file} was made on Moodle ${info.moodleRelease}, newer than this site's ${site.join(".")}: restore it on a site with Moodle ${backup.join(".")} or later.`);
  }
}

/** Where a restore merged into a course goes: every activity into one section, or the backup's sections as new ones after one. */
export type Place = { sectionId: number; afterSectionId?: undefined } | { afterSectionId: number; sectionId?: undefined };

const isRegular = (section: CourseState["section"][number]) => !section.component;

/** The sections and activities `after` has that `before` hadn't, in the course's order. */
function newItems(before: CourseState, after: CourseState): { sectionIds: number[]; activityIds: number[] } {
  const oldSections = new Set(before.section.map((s) => s.id));
  const oldCms = new Set(before.cm.map((cm) => cm.id));
  const ordered = after.section.flatMap((s) => s.cmlist ?? after.cm.filter((cm) => cm.sectionid === s.id).map((cm) => cm.id));
  return {
    sectionIds: after.section.filter((s) => isRegular(s) && !oldSections.has(s.id)).map((s) => Number(s.id)),
    activityIds: ordered.filter((id) => !oldCms.has(id)).map(Number),
  };
}

/** A section description that can be copied as it is: no files and no links Moodle encodes in backups. */
const plainSummary = (summary: string | undefined) => (summary && !summary.includes("@@PLUGINFILE@@") && !summary.includes("$@") ? summary : undefined);

/**
 * Moves what a restore merged into a course where `place` says, and puts back what Moodle changed in
 * the course's own sections (a name, a description, the visibility or restrictions they hadn't).
 * Moodle put each of the backup's sections into the course's section of the same number, or a new
 * one when the course had none (`restore_section_structure_step`, confirmed on 5.2).
 */
export async function placeRestored(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  info: BackupInfo | undefined,
  before: CourseState,
  beforeSummaries: Map<number, string>,
  place: Place,
): Promise<{ sectionIds: number[]; activityIds: number[] }> {
  const after = await courseState(context, siteUrl, courseId);
  const oldSections = new Map(before.section.map((s) => [s.id, s]));
  const oldCms = new Set(before.cm.map((cm) => cm.id));
  const fresh = (s: CourseState["section"][number]) => (s.cmlist ?? after.cm.filter((cm) => cm.sectionid === s.id).map((cm) => cm.id)).filter((id) => !oldCms.has(id)).map(Number);
  const top = after.section.filter(isRegular);
  // The backup's own sections (not subsections), by number; without its description, those that received activities.
  const backupSections = (info?.sections ?? []).filter((s) => s.included && !s.parentActivityId && s.number !== undefined);
  const merged = top.filter((s) => oldSections.has(s.id) && (backupSections.length > 0 ? backupSections.some((b) => b.number === s.number) : fresh(s).length > 0));
  const created = top.filter((s) => !oldSections.has(s.id));

  if (place.sectionId !== undefined) {
    const moving = top.flatMap(fresh);
    if (moving.length > 0) await editCourse(context, siteUrl, courseId, "cm_move", moving, { sectionId: place.sectionId });
    if (created.length > 0) await editCourse(context, siteUrl, courseId, "section_delete", created.map((s) => Number(s.id)));
  } else {
    // Each of the backup's sections, in order: Moodle's new one, or a new one split out of the course's own.
    const order: number[] = [];
    let createdLeft = [...created];
    for (const section of top) {
      if (createdLeft.some((s) => s.id === section.id)) {
        order.push(Number(section.id));
        createdLeft = createdLeft.filter((s) => s.id !== section.id);
      } else if (merged.includes(section)) {
        const from = backupSections.find((b) => b.number === section.number);
        const { sectionId: split } = await addSection(context, siteUrl, courseId, { ...(from?.name ? { name: from.name } : {}), ...(plainSummary(from?.summary) ? { summary: plainSummary(from?.summary) } : {}) });
        if (!split) throw new BackupError(`Moodle didn't add the section to move the restored content of section ${section.id} into.`);
        if (from?.visible === false) await editCourse(context, siteUrl, courseId, "section_hide", [split]);
        const moving = fresh(section);
        if (moving.length > 0) await editCourse(context, siteUrl, courseId, "cm_move", moving, { sectionId: split });
        order.push(split);
      }
    }
    let previous = place.afterSectionId;
    for (const id of order) {
      await editCourse(context, siteUrl, courseId, "section_move_after", [id], { sectionId: previous });
      previous = id;
    }
  }

  // What Moodle took from the backup into the course's own sections, put back.
  const now = await courseState(context, siteUrl, courseId);
  const summaries = merged.length > 0 ? (await courseDetails(context, siteUrl, courseId, now)).summaries : new Map<number, string>();
  for (const section of merged) {
    const was = oldSections.get(section.id)!;
    const is = now.section.find((s) => s.id === section.id);
    if (!is) continue;
    const id = Number(section.id);
    if (is.title !== was.title) await renameSection(context, siteUrl, courseId, id, "");
    if ((was.visible ?? true) && is.visible === false) await editCourse(context, siteUrl, courseId, "section_show", [id]);
    const restrictions = !was.hasrestrictions && is.hasrestrictions;
    const summary = !beforeSummaries.has(id) && summaries.has(id);
    if (restrictions || summary) await editSection(context, siteUrl, courseId, id, { ...(restrictions ? { restrictions: { conditions: [] } } : {}), ...(summary ? { summary: "" } : {}) });
  }
  return newItems(before, await courseState(context, siteUrl, courseId));
}

/**
 * Restores a backup file (`.mbz`) through Moodle's restore wizard: into a new course in a category
 * (`into: "new"`, with `categoryId`, which needs `moodle/course:create` there), or into an existing
 * course (`into: <course id>`), its content added to the course's (`mode: "merge"`, the default) or
 * replacing it (`"replace"`: the course's content is deleted first). A new course takes the backup's
 * names unless `fullName` and `shortName` are given. Users' data is restored when `withUsers` and the
 * backup has it. An asynchronous restore is waited for up to `timeoutMs` (ten minutes). Needs
 * `moodle/restore:restorecourse` where it restores.
 *
 * Before the wizard, the backup is read: one made on a newer Moodle than the site's, or holding
 * activities of a type the site doesn't offer the person in that course, is refused (Moodle would
 * warn only, or skip those activities without a word).
 *
 * Merged into an existing course, Moodle puts each of the backup's sections into the course's section
 * of the same number (creating it when there's none) and each activity at the end of it; `sectionId`
 * puts every restored activity at the end of that section instead, and `afterSectionId` makes each
 * of the backup's sections a new section, in order, after that one (the driver restores, then moves
 * what Moodle made: one move per section). With either, a section of the course that Moodle changed
 * on the way (named, described, hidden or restricted as the backup's, when it had none) is put back.
 * Returns the sections and activities the course has new, in the course's order.
 */
export async function restoreCourse(
  context: BrowserContext,
  siteUrl: string,
  file: string,
  {
    into,
    categoryId,
    mode = "merge",
    fullName,
    shortName,
    withUsers = false,
    sectionId,
    afterSectionId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: {
    into: "new" | number;
    categoryId?: number;
    mode?: "merge" | "replace";
    fullName?: string;
    shortName?: string;
    withUsers?: boolean;
    /** Merged into an existing course: every restored activity at the end of this section. */
    sectionId?: number;
    /** Merged into an existing course: the backup's sections as new sections after this one. */
    afterSectionId?: number;
    timeoutMs?: number;
  },
): Promise<{ changed: string; course: CourseRef; sectionIds?: number[]; activityIds?: number[]; warnings?: RestoreWarning[] }> {
  await checkLocalFiles([file]);
  if (into === "new" && categoryId === undefined) throw new MoodleError('A restore into a new course needs the category to create it in (categoryId).', "invalid-input");
  if (into !== "new" && mode !== "merge" && mode !== "replace") throw new MoodleError(`Unknown restore mode "${String(mode)}": use "merge" or "replace".`, "invalid-input");
  const place: Place | undefined = sectionId !== undefined ? { sectionId } : afterSectionId !== undefined ? { afterSectionId } : undefined;
  if (sectionId !== undefined && afterSectionId !== undefined) throw new MoodleError("Give sectionId (into one section) or afterSectionId (as new sections), not both.", "invalid-input");
  if (place && (into === "new" || mode !== "merge")) throw new MoodleError("sectionId and afterSectionId place a restore merged into an existing course (into: <course id>, mode: \"merge\").", "invalid-input");
  // A zip-format backup isn't read here: Moodle checks it alone.
  const read = (await archiveKind(file)) === "zip" ? undefined : await readBackupContents(file);
  const info = read?.info;
  // The wizard works in the context it restores into: the category's for a new course, the course's otherwise.
  const contextId =
    into === "new"
      ? await contextIdOf(context, siteUrl, `course/index.php?categoryid=${categoryId}`, `There's no course category ${categoryId}, or you can't see it.`)
      : await contextIdOf(context, siteUrl, `course/view.php?id=${into}`, `There's no course ${into}, or you can't open it.`);
  const before = into === "new" ? undefined : await courseState(context, siteUrl, into);
  if (before && place) {
    const target = place.sectionId ?? place.afterSectionId;
    if (!before.section.some((s) => Number(s.id) === target && !s.component)) throw new MoodleError(`Course ${into} has no section ${target}: take its id from the course's structure.`, "not-found");
  }
  if (info) await checkModules(context, siteUrl, into === "new" ? SITE_COURSE : into, info, file);
  // Moodle fills a section's empty description from the backup's: told by the course page, which shows descriptions.
  const beforeSummaries = before && place ? (await courseDetails(context, siteUrl, into as number, before)).summaries : undefined;
  const page = await openWizard(
    context,
    siteUrl,
    `backup/restorefile.php?contextid=${contextId}`,
    "_qf__course_restore_form",
    into === "new"
      ? `You can't restore into a new course in category ${categoryId}: Moodle asks for moodle/restore:restorecourse and moodle/course:create there`
      : `You can't restore into course ${into}: Moodle asks for moodle/restore:restorecourse in it`,
  );
  let restoreId: string | undefined;
  let newShortName: string | undefined;
  try {
    if (info) await checkVersion(page, info, file);
    const draft = await formValue(page, "backupfile");
    if (!draft) throw new BackupError("Moodle's restore page has no file field to upload the backup to.");
    await uploadToDraft(page, draft, [file]);
    await submitForm(page, "submitbutton"); // To the confirmation: Moodle unpacks the file.
    const filepath = await page.locator('input[name="filepath"]').first().getAttribute("value").catch(() => null);
    if (!filepath) {
      const moodle = await moodleErrorMessage(page);
      throw new BackupError(`Moodle didn't accept ${file} as a backup${moodle ? `: ${moodle}` : " (it isn't a Moodle backup, or it's damaged)."}`);
    }
    // The destination, as its course selector would send it: Moodle shows the new-course choice only to who may create courses.
    const sesskey = await page.evaluate(() => (globalThis as unknown as { M: { cfg: { sesskey: string } } }).M.cfg.sesskey);
    const target = into === "new" ? TARGET_NEW_COURSE : mode === "replace" ? TARGET_CURRENT_DELETING : TARGET_CURRENT_ADDING;
    const query = new URLSearchParams({ contextid: String(contextId), stage: String(STAGE_SETTINGS), filepath, target: String(target), targetid: String(into === "new" ? categoryId : into), sesskey });
    await page.goto(new URL(`backup/restore.php?${query}`, siteUrl).href, { waitUntil: "domcontentloaded" });
    if ((await page.locator('form.mform [name="_qf__restore_settings_form"]').count()) === 0) {
      const moodle = await moodleErrorMessage(page);
      throw new BackupError(`Moodle didn't take the restore's destination${moodle ? `: ${moodle}` : "."}`);
    }
    const usersField = await page.locator('form.mform input[name="setting_root_users"]:not([type="hidden"])').count();
    if (withUsers && usersField === 0) throw new BackupError("This restore can't include users' data: the backup has none, or Moodle asks for moodle/restore:userinfo.");
    if (usersField > 0) await setFields(page, { setting_root_users: withUsers });
    await nextStage(page); // To the schema: the course's names, and what to restore.
    // Each name is a "default or custom" field: its [customize] checkbox, then its [value].
    for (const [field, value] of [
      ["setting_course_course_fullname", fullName],
      ["setting_course_course_shortname", shortName],
    ] as const) {
      if (value === undefined) continue;
      const custom = await page.locator(`form.mform input[type="checkbox"][name="${field}[customize]"]`).count();
      await setFields(page, { ...(custom > 0 ? { [`${field}[customize]`]: true } : {}), [`${field}[value]`]: value });
    }
    newShortName = (await formValue(page, "setting_course_course_shortname[value]")) ?? shortName;
    await nextStage(page); // To the review.
    await nextStage(page); // Perform the restore.
    // Moodle may stop at a precheck (warnings to confirm) before going on.
    if ((await page.locator('form [name="substage"]').count()) > 0) await nextStage(page);
    restoreId = await asyncBackupId(page);
    if (!restoreId && (await page.locator(".backup_stage_current").count()) === 0) {
      const moodle = await moodleErrorMessage(page);
      throw new BackupError(`Moodle didn't perform the restore${moodle ? `: ${moodle}` : "."}`);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  if (restoreId) await waitForAsync(context, siteUrl, "restore", restoreId, contextId, timeoutMs);
  if (into !== "new") {
    const course = (await courseById(context, siteUrl, into)) ?? { id: into, fullName: "", shortName: "", url: new URL(`course/view.php?id=${into}`, siteUrl).href };
    let restored = newItems(before!, await courseState(context, siteUrl, into));
    let where = "";
    if (place) {
      restored = await placeRestored(context, siteUrl, into, info, before!, beforeSummaries!, place);
      where = place.sectionId !== undefined ? `, its activities at the end of section ${place.sectionId}` : `, its sections after section ${place.afterSectionId}`;
    }
    const warnings = await restoreWarnings(context, siteUrl, into, restored.activityIds, read?.contents);
    return {
      changed: `Backup ${file} restored into course ${into} (${mode === "replace" ? "its content replaced" : "merged with its content"}${where}): ${restored.sectionIds.length} new section(s), ${restored.activityIds.length} new activit${restored.activityIds.length === 1 ? "y" : "ies"}${warnings.length > 0 ? `, ${warnings.length} thing(s) left to fix` : ""}.`,
      course,
      ...restored,
      warnings,
    };
  }
  const course = newShortName ? await courseByShortName(context, siteUrl, newShortName) : undefined;
  if (!course) throw new BackupError(`Moodle finished the restore, but the new course${newShortName ? ` "${newShortName}"` : ""} isn't visible to you.`);
  return { changed: `Backup ${file} restored into new course ${course.id} "${course.fullName}".`, course };
}

/** Something a restore left broken in an activity, for a teacher to fix. */
export interface RestoreWarning {
  /** The restored activity: its course module id in the course restored into, and its name. */
  activityId: number;
  name: string;
  /**
   * `restriction`: an access condition Moodle restored marked as broken, its activity, grade item,
   * group or grouping not restored with it (`condition` says which). `link`: a link in its text to an
   * activity outside the course (`url`), on this site or the one the backup came from.
   */
  kind: "restriction" | "link";
  condition?: "completion" | "grade" | "group" | "grouping";
  url?: string;
  message: string;
}

/**
 * What's broken in a restored activity, from its form's availability JSON and texts: conditions Moodle
 * restored pointing at nothing (an activity not in the course, or 0 and -1, its marks for an
 * activity, grade item, group or grouping not restored, confirmed in its `update_after_restore`, 5.2),
 * and links to activities that aren't in the course (Moodle points one it didn't restore back to the
 * original site's activity).
 */
export function brokenInActivity(
  activity: { id: number; name: string },
  availability: string | undefined,
  texts: string[],
  courseActivities: Set<number>,
  siteUrl: string,
): RestoreWarning[] {
  const warnings: RestoreWarning[] = [];
  const what = `Activity ${activity.id} "${activity.name}"`;
  for (const condition of conditionsOf(availability)) {
    const type = String(condition.type);
    const id = Number(type === "completion" ? condition.cm : condition.id);
    if (!["completion", "grade", "group", "grouping"].includes(type) || Number.isNaN(id)) continue;
    // -1 is "the previous activity" for completion, Moodle's mark of a group not restored for groups.
    const broken = type === "completion" ? id === 0 || (id > 0 && !courseActivities.has(id)) : id <= 0;
    if (!broken) continue;
    const on = { completion: "another activity's completion", grade: "a grade", group: "a group", grouping: "a grouping" }[type as "completion"];
    warnings.push({
      activityId: activity.id,
      name: activity.name,
      kind: "restriction",
      condition: type as RestoreWarning["condition"],
      message: `${what}: its access restriction on ${on} names one that wasn't restored with it; Moodle keeps it marked as broken. Fix or remove the condition.`,
    });
  }
  const site = siteUrl.replace(/\/$/, "");
  const seen = new Set<string>();
  for (const text of texts) {
    for (const [url, , id] of text.replaceAll("&amp;", "&").matchAll(/(?:https?:\/\/[^\s"'<>]*?)?\/mod\/([a-z0-9_]+)\/view\.php\?id=(\d+)/g)) {
      const elsewhere = /^https?:/.test(url) && !url.startsWith(`${site}/`);
      if ((!elsewhere && courseActivities.has(Number(id))) || seen.has(url)) continue;
      seen.add(url);
      warnings.push({
        activityId: activity.id,
        name: activity.name,
        kind: "link",
        url,
        message: `${what} links to ${url}, an activity ${elsewhere ? "on another site" : "outside this course"}: the one it linked to wasn't restored with it.`,
      });
    }
  }
  return warnings;
}

/**
 * What the restore left broken in the activities it added to a course: those with restrictions (the
 * course's state says which), and those whose text linked to activities left out of the backup (its
 * contents say which), each read from its settings form.
 */
async function restoreWarnings(context: BrowserContext, siteUrl: string, courseId: number, added: number[], contents: BackupContents | undefined): Promise<RestoreWarning[]> {
  if (added.length === 0) return [];
  const state = await courseState(context, siteUrl, courseId);
  const inCourse = new Set(state.cm.map((cm) => Number(cm.id)));
  const linking = (contents?.activities ?? []).filter((a) => a.dependencies.some((d) => d.kind === "link"));
  const warnings: RestoreWarning[] = [];
  for (const id of added) {
    const cm = state.cm.find((c) => Number(c.id) === id);
    if (!cm) continue;
    const name = decodeEntities(cm.name);
    if (!cm.hascmrestrictions && !linking.some((a) => a.type === cm.module && a.title === name)) continue;
    const page = await openSitePage(context, siteUrl, `course/modedit.php?update=${id}&return=0`);
    let fields: { name: string; value: string }[];
    try {
      fields = await page.evaluate(() =>
        Array.from(
          (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string; value: string }> } }).document.querySelectorAll("form.mform textarea, form.mform input[name='availabilityconditionsjson']"),
        ).map((field) => ({ name: field.name, value: field.value })),
      );
    } finally {
      await page.close().catch(() => undefined);
    }
    const availability = fields.find((f) => f.name === "availabilityconditionsjson")?.value;
    const texts = fields.filter((f) => f.name !== "availabilityconditionsjson").map((f) => f.value);
    warnings.push(...brokenInActivity({ id, name }, availability, texts, inCourse, siteUrl));
  }
  return warnings;
}

/** A course by id (`core_course_get_courses`), when the person may see it. */
async function courseById(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseRef | undefined> {
  try {
    const [course] = await callService<{ id: number; fullname: string; shortname: string; categoryid?: number }[]>(context, siteUrl, "core_course_get_courses", { options: { ids: [courseId] } });
    return course ? toRef(siteUrl, course) : undefined;
  } catch (error) {
    if (error instanceof MoodleServiceError) return undefined;
    throw error;
  }
}

/**
 * Imports activities from another course into a course, as Moodle's "Import" does: every activity
 * of `fromCourseId`, or only `activityIds`, added to `toCourseId`'s content (with their sections),
 * without users' data. Needs `moodle/restore:restoretargetimport` in the course imported into and
 * `moodle/backup:backuptargetimport` in the other. Returns the activities the course has afterwards
 * that it didn't have before, by id.
 */
export async function importActivities(
  context: BrowserContext,
  siteUrl: string,
  fromCourseId: number,
  toCourseId: number,
  { activityIds }: { activityIds?: number[] } = {},
): Promise<{ changed: string; activityIds: number[] }> {
  if (fromCourseId === toCourseId) throw new MoodleError("A course can't import from itself.", "invalid-input");
  const page = await openSitePage(context, siteUrl, `backup/import.php?id=${toCourseId}&importid=${fromCourseId}`);
  let before: number[] = [];
  try {
    const stage = async () => (await formValue(page, "stage").catch(() => undefined)) ?? "";
    if ((await page.locator('form.mform [name="backup"]').count()) === 0) {
      const moodle = await moodleErrorMessage(page);
      throw new BackupError(
        `You can't import from course ${fromCourseId} into course ${toCourseId}: Moodle asks for moodle/restore:restoretargetimport in the one and moodle/backup:backuptargetimport in the other${moodle ? `: ${moodle}` : "."}`,
      );
    }
    before = await courseActivityIds(context, siteUrl, toCourseId);
    await page.waitForLoadState("load");
    // The initial settings, when Moodle shows them, then the schema (what to import).
    if (Number(await stage()) === 1) await nextStage(page);
    if (activityIds) {
      const boxes = await page.evaluate(() =>
        Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string }> } }).document.querySelectorAll('form.mform input[type="checkbox"][name^="setting_activity_"][name$="_included"]')).map(
          (box) => box.name,
        ),
      );
      // setting_activity_<module>_<course module id>_included.
      const idOf = (name: string) => Number(/_(\d+)_included$/.exec(name)?.[1]);
      const missing = activityIds.filter((id) => !boxes.some((name) => idOf(name) === id));
      if (missing.length > 0) throw new BackupError(`Course ${fromCourseId} has no activity ${missing.join(", ")} to import: take the ids from its structure.`);
      await setFields(page, Object.fromEntries(boxes.map((name) => [name, activityIds.includes(idOf(name))])));
    }
    await nextStage(page); // To the confirmation.
    await nextStage(page); // Perform the import.
    if ((await page.locator(".backup_stage_current").count()) === 0) {
      const moodle = await moodleErrorMessage(page);
      throw new BackupError(`Moodle didn't perform the import${moodle ? `: ${moodle}` : "."}`);
    }
  } finally {
    await page.close().catch(() => undefined);
  }
  const after = await courseActivityIds(context, siteUrl, toCourseId);
  const added = after.filter((id) => !before.includes(id));
  return { changed: `Imported ${added.length} activit${added.length === 1 ? "y" : "ies"} from course ${fromCourseId} into course ${toCourseId}.`, activityIds: added };
}

/** The course module ids of a course's activities (`core_courseformat_get_state`). */
async function courseActivityIds(context: BrowserContext, siteUrl: string, courseId: number): Promise<number[]> {
  const state = JSON.parse(await callService<string>(context, siteUrl, "core_courseformat_get_state", { courseid: courseId })) as { cm?: { id: number | string }[] };
  return (state.cm ?? []).map((cm) => Number(cm.id));
}

