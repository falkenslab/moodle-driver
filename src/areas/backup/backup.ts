// Copying, backing up, restoring and importing courses. Copying goes through Moodle's copy service;
// backups, restores and imports through their page wizards, stage by stage, as a person would. Moodle
// runs copies, and backups and restores when the site makes them asynchronous, in its scheduled tasks
// (cron): the driver waits for them, up to a timeout.
import type { BrowserContext, Page } from "playwright-core";
import { MoodleServiceError, callService } from "../../core/ajax.js";
import { dateSelectorValues, openForm, setFields, submitForm, uploadToDraft, formValue, type FieldValue } from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { checkLocalFiles, downloadFile, type DownloadedFile } from "../../core/files.js";
import { MoodleError } from "../../core/errors.js";
import { decodeEntities } from "../../core/text.js";

/** Moodle refused a copy, backup, restore or import, or didn't finish it in time. */
export class BackupError extends MoodleError {
  override name = "BackupError";
  constructor(message: string) {
    super(message, "backup");
  }
}

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
 * Backs a course up to a `.mbz` file, through Moodle's backup wizard (initial settings, schema,
 * confirmation), and downloads it into `destDir`. Without users' data unless `withUsers`, which
 * needs `moodle/backup:userinfo` (`anonymize` makes their names anonymous). An asynchronous backup
 * is waited for up to `timeoutMs` (ten minutes). Moodle keeps the file in the course's or the
 * person's backup area too.
 */
export async function backupCourse(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  destDir: string,
  { withUsers = false, anonymize, timeoutMs = DEFAULT_TIMEOUT_MS }: { withUsers?: boolean; anonymize?: boolean; timeoutMs?: number } = {},
): Promise<{ changed: string; file: DownloadedFile }> {
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
  try {
    const usersField = await page.locator('form.mform input[name="setting_root_users"]:not([type="hidden"])').count();
    if (withUsers && usersField === 0) throw new BackupError(`You can't back up course ${courseId} with its users' data: Moodle asks for moodle/backup:userinfo.`);
    const settings: Record<string, FieldValue> = {};
    if (usersField > 0) settings.setting_root_users = withUsers;
    if (withUsers && anonymize !== undefined) settings.setting_root_anonymize = anonymize;
    if (Object.keys(settings).length > 0) await setFields(page, settings);
    contextId = await pageContextId(page);
    await submitForm(page, "submitbutton"); // To the schema settings.
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
  return { changed: `Course ${courseId} backed up to ${file.name}.`, file };
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

/**
 * Restores a backup file (`.mbz`) through Moodle's restore wizard: into a new course in a category
 * (`into: "new"`, with `categoryId`, which needs `moodle/course:create` there), or into an existing
 * course (`into: <course id>`), its content added to the course's (`mode: "merge"`, the default) or
 * replacing it (`"replace"`: the course's content is deleted first). A new course takes the backup's
 * names unless `fullName` and `shortName` are given. Users' data is restored when `withUsers` and the
 * backup has it. An asynchronous restore is waited for up to `timeoutMs` (ten minutes). Needs
 * `moodle/restore:restorecourse` where it restores.
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
    timeoutMs = DEFAULT_TIMEOUT_MS,
  }: { into: "new" | number; categoryId?: number; mode?: "merge" | "replace"; fullName?: string; shortName?: string; withUsers?: boolean; timeoutMs?: number },
): Promise<{ changed: string; course: CourseRef }> {
  await checkLocalFiles([file]);
  if (into === "new" && categoryId === undefined) throw new MoodleError('A restore into a new course needs the category to create it in (categoryId).', "invalid-input");
  if (into !== "new" && mode !== "merge" && mode !== "replace") throw new MoodleError(`Unknown restore mode "${String(mode)}": use "merge" or "replace".`, "invalid-input");
  // The wizard works in the context it restores into: the category's for a new course, the course's otherwise.
  const contextId =
    into === "new"
      ? await contextIdOf(context, siteUrl, `course/index.php?categoryid=${categoryId}`, `There's no course category ${categoryId}, or you can't see it.`)
      : await contextIdOf(context, siteUrl, `course/view.php?id=${into}`, `There's no course ${into}, or you can't open it.`);
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
    return { changed: `Backup ${file} restored into course ${into} (${mode === "replace" ? "its content replaced" : "merged with its content"}).`, course };
  }
  const course = newShortName ? await courseByShortName(context, siteUrl, newShortName) : undefined;
  if (!course) throw new BackupError(`Moodle finished the restore, but the new course${newShortName ? ` "${newShortName}"` : ""} isn't visible to you.`);
  return { changed: `Backup ${file} restored into new course ${course.id} "${course.fullName}".`, course };
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

