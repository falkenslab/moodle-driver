// A course's badges, read and managed on Moodle's badge pages: the course's badges page
// (`badges/index.php?type=2`, a report builder table), each badge's overview, details form
// (`badges/edit.php`), criteria page and criterion forms (`badges/criteria.php`,
// `criteria_settings.php`, `criteria_action.php`) and manual award page (`badges/award.php`).
// Enabling and disabling go through Moodle's own services (`core_badges_enable_badges`,
// `core_badges_disable_badges`), the ones the badges page's buttons call; no service reads badges
// over AJAX (Moodle 5.2).
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { callService, MoodleServiceError } from "../../core/ajax.js";
import { MoodleError } from "../../core/errors.js";
import { checkLocalFiles } from "../../core/files.js";
import { dateSelectorDate, dateSelectorValues, formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { inPage } from "../../core/inPage.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";

/** Badges can't be read or changed as asked: a missing capability, a badge that doesn't exist, a criterion Moodle doesn't offer. */
export class BadgeError extends MoodleError {
  override name = "BadgeError";
  constructor(message: string) {
    super(message, "badge");
  }
}

/** The site has badges, or course badges, turned off (Site administration > Badges): nothing about badges works until an administrator turns them on. */
export class BadgesDisabledError extends MoodleError {
  override name = "BadgesDisabledError";
  constructor(message = "Badges are disabled on this site (or course badges are): an administrator turns them on in Site administration > Badges > Badge settings.") {
    super(message, "badges-disabled");
  }
}

/** A course badge, as its course's badges page and its overview show it. */
export interface CourseBadge {
  id: number;
  courseId: number;
  name: string;
  /** Its description (plain text). */
  description: string;
  /** Its image, as Moodle serves it (the large version). */
  imageUrl: string;
  /** Whether it's available to users (Moodle's "enabled"): only an enabled badge is awarded. */
  enabled: boolean;
  /** What earns it, as the badges page sums it up, in the site's language ("" without criteria). */
  criteria: string;
  /** How many people have it; only for whom may see who has it (a teacher). */
  recipients?: number;
  /** Whether the person has it. */
  awarded: boolean;
}

/** A badge's criteria, as its criterion forms hold them; the badge's other kinds of criteria (other badges, competencies…) aren't read. */
export interface BadgeCriteria {
  /** Completing activities, by course module id: all of them, or any one. */
  activities?: { activityIds: number[]; all: boolean };
  /** Completing the course, with a minimum course grade and by a date (ISO) when set. */
  courseCompletion?: { minGrade?: number; by?: string };
  /** Awarded by hand by people with these roles: by all of them, or any one. */
  manual?: { roleIds: number[]; all: boolean };
  /** With more than one criterion: whether all must be met or any one. */
  all?: boolean;
}

/** What `setBadgeCriteria` changes: a criterion given replaces that kind's settings, `null` removes it, one not given stays. */
export interface BadgeCriteriaChanges {
  /** Completing these activities (course module ids, with completion tracking); `all` defaults to true (Moodle's form to "any"). */
  activities?: { activityIds: number[]; all?: boolean } | null;
  /** Completing the course (it must track completion), optionally with a minimum course grade and by a date (in the person's time zone, the day counts). */
  courseCompletion?: { minGrade?: number; by?: Date } | null;
  /** Awarded by hand by people with these roles (only roles that may award badges); `all` defaults to false: any one of them awards it. */
  manual?: { roleIds: number[]; all?: boolean } | null;
  /** With more than one criterion: whether all must be met or any one; ignored with one. */
  all?: boolean;
}

/** What `createBadge` needs: Moodle requires a name, a description and an image. */
export interface NewBadge {
  name: string;
  /** Plain text: Moodle strips tags from it. */
  description: string;
  /** A local image file (absolute path): PNG, JPEG or GIF, at most 256 KB; Moodle resizes it. */
  image: string;
  /** The image's caption (its alternative text). */
  imageCaption?: string;
}

// Moodle's criterion types (badges/criteria/award_criteria.php) and aggregations.
const ACTIVITY = 1;
const MANUAL = 2;
const COURSE = 4;
const AGG_ALL = "1";
const AGG_ANY = "2";
/** The capability each kind of change takes, as Moodle checks it. */
const CAPABILITY = { create: "moodle/badges:createbadge", criteria: "moodle/badges:configurecriteria", award: "moodle/badges:awardbadge", view: "moodle/badges:viewbadges" };

/** The error code of Moodle's error page (its "More information" link ends in error/<component>/<code>), or undefined. */
async function errorCode(page: Page): Promise<string | undefined> {
  const href = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-rel="fatalerror"] .errorcode a')?.getAttribute("href"));
  return href ? href.split("/").pop() : undefined;
}

/** Throws the error an error page means, if the page is one: badges off, or what `refused` says (with Moodle's message). */
async function failOnErrorPage(page: Page, refused: string): Promise<void> {
  const message = await moodleErrorMessage(page);
  if (message === undefined) return;
  const code = await errorCode(page);
  if (code === "badgesdisabled" || code === "coursebadgesdisabled") throw new BadgesDisabledError();
  throw new BadgeError(`${refused}: ${message}`);
}

/** The course a badge page belongs to, from its body class (`course-<id>`). */
async function pageCourseId(page: Page): Promise<number> {
  const classes = (await page.locator("body").getAttribute("class")) ?? "";
  return Number(/(?:^|\s)course-(\d+)(?:\s|$)/.exec(classes)?.[1] ?? 0);
}

/** A row of the badges page's table. */
export interface BadgeRow {
  id: number;
  name: string;
  enabled: boolean;
  criteria: string;
  recipients?: number;
  awarded: boolean;
  /** Its "Award badge" action: Moodle shows it when the badge is enabled, has a manual criterion, and the person may award it. */
  canAward: boolean;
}

/**
 * The rows of a badges table (the page, or the HTML its table service sends), read by links, classes
 * and the columns' sort keys. The columns are Moodle's (5.2): name, the status (for whom may see
 * disabled badges), the criteria, the recipients (the same people) and "issued to me".
 */
export function readBadgeRows(page: Page, html?: string): Promise<BadgeRow[]> {
  return inPage(
    page,
    (html: string | null) => {
      interface El {
        textContent: string | null;
        className: string;
        innerHTML: string;
        content: El;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El & { createElement(tag: string): El } }).document;
      let root: El = doc;
      if (html !== null) {
        const template = doc.createElement("template");
        template.innerHTML = html;
        root = template.content;
      }
      const table = root.querySelector('table[data-region="reportbuilder-table"]');
      if (!table) return [];
      const headers = Array.from(table.querySelectorAll("thead th"));
      const column = (key: string) => headers.findIndex((th) => (th.querySelector("a[data-sortby]")?.getAttribute("data-sortby") ?? "").endsWith(`_${key}`));
      const status = column("status");
      const recipients = column("visible");
      const issued = column("dateissued");
      // The criteria come right after the name, or after the status when it's shown.
      const criteria = status >= 0 ? status + 1 : 1;
      const text = (el: El | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
      return Array.from(table.querySelectorAll("tbody tr")).flatMap((row) => {
        if (/\bemptyrow\b/.test(row.className)) return [];
        const link = row.querySelector('a[href*="/badges/overview.php?id="]');
        const id = Number(new URL(link?.getAttribute("href") ?? "", "http://x/").searchParams.get("id"));
        if (!link || !id) return [];
        const cells = Array.from(row.querySelectorAll(":scope > td"));
        const count = recipients >= 0 ? Number(text(cells[recipients])) : NaN;
        return [
          {
            id,
            name: text(link),
            // Moodle mutes the rows of disabled badges; whom may not see them gets enabled ones only.
            enabled: !/\btext-muted\b/.test(row.className),
            criteria: cells[criteria]?.querySelector(".no-criteria-set") ? "" : text(cells[criteria]),
            ...(Number.isNaN(count) ? {} : { recipients: count }),
            // "Issued to me" links to the person's own copy of the badge.
            awarded: Boolean(issued >= 0 && cells[issued]?.querySelector('a[href*="/badges/badge.php"]')),
            canAward: row.querySelector('a[href*="/badges/award.php"]') !== null,
          },
        ];
      });
    },
    html ?? null,
  );
}

/** Every row of a course's badges table: the page shows a page of it; the rest comes from its table service, as its paging does. */
async function badgeRows(context: BrowserContext, siteUrl: string, courseId: number): Promise<BadgeRow[]> {
  const page = await openSitePage(context, siteUrl, `badges/index.php?type=2&id=${courseId}`);
  try {
    await failOnErrorPage(page, `You can't see the badges of course ${courseId}`);
    // Without any badge capability in the course, Moodle sends the person to the site's front page.
    if ((await page.locator("body#page-badges-index").count()) === 0) throw new BadgeError(`You can't see the badges of course ${courseId} (it takes ${CAPABILITY.view}), or it doesn't exist.`);
    const rows = await readBadgeRows(page);
    // Helpers inside: through inPage (see the conventions on page.evaluate).
    const table = await inPage(page, () => {
      const el = (globalThis as unknown as { document: { querySelector(s: string): { getAttribute(n: string): string | null } | null } }).document.querySelector('[data-region="core_table/dynamic"]');
      if (!el) return undefined;
      const get = (name: string) => el.getAttribute(`data-table-${name}`) ?? "";
      return { component: get("component"), handler: get("handler"), uniqueid: get("uniqueid"), filters: get("filters"), sortdata: get("sort-data"), total: Number(get("total-rows")) || 0 };
    }, null);
    if (!table || rows.length >= table.total) return rows;
    const filters = JSON.parse(table.filters || "{}") as { jointype?: number; filters?: Record<string, { name: string; jointype: number; values: unknown[] }> };
    const { html } = await callService<{ html: string }>(context, siteUrl, "core_table_get_dynamic_table_content", {
      component: table.component,
      handler: table.handler,
      uniqueid: table.uniqueid,
      sortdata: JSON.parse(table.sortdata || "[]"),
      filters: Object.values(filters.filters ?? {}),
      jointype: filters.jointype ?? 2,
      firstinitial: "",
      lastinitial: "",
      pagenumber: 1,
      pagesize: table.total,
      hiddencolumns: [],
      resetpreferences: false,
    });
    return await readBadgeRows(page, html);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** What a badge's overview adds to its row: its course, description and large image. */
async function readOverview(context: BrowserContext, siteUrl: string, badgeId: number): Promise<{ courseId: number; description: string; imageUrl: string }> {
  const page = await openSitePage(context, siteUrl, `badges/overview.php?id=${badgeId}`);
  try {
    await failOnErrorPage(page, `You can't see badge ${badgeId} (it takes ${CAPABILITY.view}), or it doesn't exist`);
    if ((await page.locator("body#page-badges-overview").count()) === 0) throw new BadgeError(`Badge ${badgeId} doesn't exist, or you can't see it.`);
    const details = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelector(s: string): { querySelectorAll(s: string): ArrayLike<{ textContent: string | null; querySelector(s: string): { getAttribute(n: string): string | null } | null }> } | null } }).document;
      // The badge's details, in Moodle's order: name, version, language, description, created, image, caption, tags.
      const values = Array.from(doc.querySelector("#badge-overview dl")?.querySelectorAll("dd") ?? []);
      return { description: (values[3]?.textContent ?? "").trim(), image: values[5]?.querySelector("img")?.getAttribute("src") ?? "" };
    });
    const image = details.image ? new URL(details.image, siteUrl) : undefined;
    // The query only defeats the browser's cache.
    image?.searchParams.delete("refresh");
    return { courseId: await pageCourseId(page), description: details.description, imageUrl: image?.href ?? "" };
  } finally {
    await page.close().catch(() => undefined);
  }
}

function courseBadge(row: BadgeRow, overview: { courseId: number; description: string; imageUrl: string }): CourseBadge {
  return {
    id: row.id,
    courseId: overview.courseId,
    name: row.name,
    description: overview.description,
    imageUrl: overview.imageUrl,
    enabled: row.enabled,
    criteria: row.criteria,
    ...(row.recipients !== undefined ? { recipients: row.recipients } : {}),
    awarded: row.awarded,
  };
}

/** One badge, by id, with its row; the course comes from its overview. */
async function readBadge(context: BrowserContext, siteUrl: string, badgeId: number): Promise<{ badge: CourseBadge; row: BadgeRow }> {
  const overview = await readOverview(context, siteUrl, badgeId);
  if (overview.courseId <= 1) throw new BadgeError(`Badge ${badgeId} is a site badge: the driver works with course badges.`);
  const row = (await badgeRows(context, siteUrl, overview.courseId)).find((r) => r.id === badgeId);
  if (!row) throw new BadgeError(`Badge ${badgeId} isn't on course ${overview.courseId}'s badges page: it's disabled and you can't see disabled badges.`);
  return { badge: courseBadge(row, overview), row };
}

/**
 * A course's badges, as its badges page lists them: each one's name, description, image, criteria
 * (Moodle's summary, in the site's language), whether it's enabled, whether the person has it and,
 * for whom may see it (a teacher), how many people have it. A student sees only enabled badges.
 * Throws `BadgesDisabledError` on a site with badges off, `BadgeError` when the person can't see the
 * course's badges.
 */
export async function courseBadges(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseBadge[]> {
  const rows = await badgeRows(context, siteUrl, courseId);
  const result: CourseBadge[] = [];
  for (const row of rows) result.push(courseBadge(row, await readOverview(context, siteUrl, row.id)));
  return result;
}

/**
 * Creates a course badge, disabled and without criteria, through Moodle's new badge form: its name,
 * description and image (a local file, uploaded as the form's file picker does). The issuer is the
 * site's default. Returns the badge. Throws `BadgeError` when the person can't create badges in the
 * course (it takes moodle/badges:createbadge), `BadgesDisabledError` on a site with badges off,
 * `FormError` with Moodle's reason when it refuses the form (an image it can't use).
 */
export async function createBadge(context: BrowserContext, siteUrl: string, courseId: number, badge: NewBadge): Promise<{ changed: string; badge: CourseBadge }> {
  if (!badge.name.trim() || !badge.description.trim()) throw new MoodleError("A badge needs a name and a description.", "invalid-input");
  await checkLocalFiles([badge.image]);
  let page: Page;
  try {
    page = await openForm(context, siteUrl, `badges/edit.php?courseid=${courseId}&action=new`);
  } catch (error) {
    // No form: Moodle's error page says why.
    const probe = await openSitePage(context, siteUrl, `badges/edit.php?courseid=${courseId}&action=new`);
    try {
      await failOnErrorPage(probe, `You can't create badges in course ${courseId} (it takes ${CAPABILITY.create})`);
    } finally {
      await probe.close().catch(() => undefined);
    }
    throw error;
  }
  let badgeId: number;
  try {
    const draft = await formValue(page, "image");
    if (!draft) throw new BadgeError("Moodle's new badge form has no image field.");
    await uploadToDraft(page, draft, [{ from: badge.image, to: path.basename(badge.image) }]);
    const values: Record<string, FieldValue> = { name: badge.name, description: badge.description };
    if (badge.imageCaption !== undefined) values.imagecaption = badge.imageCaption;
    await setFields(page, values);
    await submitForm(page, "submitbutton");
    // Moodle goes on to the badge's criteria page, or its overview for whom can't set criteria.
    badgeId = Number(new URL(page.url()).searchParams.get("id"));
    if (!badgeId || !/\/badges\/(?:criteria|overview)\.php$/.test(new URL(page.url()).pathname)) throw new BadgeError(`Moodle didn't create the badge "${badge.name}" in course ${courseId}.`);
  } finally {
    await page.close().catch(() => undefined);
  }
  const { badge: created } = await readBadge(context, siteUrl, badgeId);
  return { changed: `Badge ${badgeId} "${created.name}" created in course ${courseId}, disabled: set its criteria, then enable it.`, badge: created };
}

/** A badge's criteria page: what can still change (an enabled or awarded badge can't), the criteria it has and the session key. */
interface CriteriaPage {
  /** Criterion types the person may add (the "Add badge criteria" menu); empty when the badge can't change. */
  addable: number[];
  /** Existing criteria by type: their id, from their edit links (shown only while the badge can change). */
  existing: Record<number, number>;
  /** With more than one criterion: the overall aggregation's select value ("1" all, "2" any). */
  overall?: string;
  /** Whether the badge's status box says it's enabled. */
  active: boolean;
  sesskey: string;
}

async function readCriteriaPage(context: BrowserContext, siteUrl: string, badgeId: number): Promise<CriteriaPage> {
  const page = await openSitePage(context, siteUrl, `badges/criteria.php?id=${badgeId}`);
  try {
    await failOnErrorPage(page, `You can't set the criteria of badge ${badgeId} (it takes ${CAPABILITY.criteria}), or it doesn't exist`);
    if ((await page.locator("body#page-badges-criteria").count()) === 0) throw new BadgeError(`Badge ${badgeId} has no criteria page you can open.`);
    return await page.evaluate(() => {
      interface El {
        value: string;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const g = globalThis as unknown as { document: El; M?: { cfg?: { sesskey?: string } } };
      const doc = g.document;
      const addable = Array.from(doc.querySelectorAll('form[action*="/badges/criteria_settings.php"] select[name="type"] option'))
        .map((option) => Number(option.value))
        .filter((type) => type > 0);
      const existing: Record<number, number> = {};
      for (const link of Array.from(doc.querySelectorAll('a[href*="/badges/criteria_settings.php"]'))) {
        const url = new URL(link.getAttribute("href") ?? "", "http://x/");
        const type = Number(url.searchParams.get("type"));
        if (type > 0 && url.searchParams.get("edit")) existing[type] = Number(url.searchParams.get("crit"));
      }
      // The overall aggregation's select: its form posts to "criteria.php", a relative action.
      const overall = doc.querySelector('select[name="update"]')?.value;
      return { addable, existing, ...(overall ? { overall } : {}), active: doc.querySelector(".statusbox.active") !== null, sesskey: g.M?.cfg?.sesskey ?? "" };
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A criterion's form, opened on its existing criterion or a new one. */
function criterionForm(context: BrowserContext, siteUrl: string, badgeId: number, type: number, crit: number | undefined): Promise<Page> {
  return openForm(context, siteUrl, `badges/criteria_settings.php?badgeid=${badgeId}&type=${type}${crit ? `&edit=1&crit=${crit}` : "&add=1"}`);
}

/** The ids of a criterion form's checkboxes named `<prefix>_<id>`, and those ticked. */
function checkboxIds(page: Page, prefix: string): Promise<{ all: number[]; checked: number[] }> {
  return inPage(page, (prefix: string) => {
    const boxes = Array.from((globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string; checked: boolean }> } }).document.querySelectorAll(`form.mform input[type="checkbox"][name^="${prefix}_"]`)).filter((box) => new RegExp(`^${prefix}_\\d+$`).test(box.name));
    const id = (box: { name: string }) => Number(box.name.slice(prefix.length + 1));
    return { all: boxes.map(id), checked: boxes.filter((box) => box.checked).map(id) };
  }, prefix);
}

/** The checked aggregation radio of a criterion form ("1" all, "2" any). */
function aggregation(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector('form.mform input[name="agg"]:checked, form.mform input[type="hidden"][name="agg"]')?.value);
}

/** The course completion form's course id, from its `grade_<course>` field. */
async function completionCourse(page: Page): Promise<number | undefined> {
  const name = await page.evaluate(() => (globalThis as unknown as { document: { querySelector(s: string): { name: string } | null } }).document.querySelector('form.mform input[name^="grade_"]')?.name);
  return name ? Number(name.slice("grade_".length)) : undefined;
}

/** A badge's activity, course completion and manual criteria, read from their forms; the overall aggregation from its criteria page. */
async function readCriteria(context: BrowserContext, siteUrl: string, badgeId: number, state: CriteriaPage): Promise<BadgeCriteria> {
  const criteria: BadgeCriteria = {};
  for (const type of [ACTIVITY, COURSE, MANUAL]) {
    const crit = state.existing[type];
    if (!crit) continue;
    const page = await criterionForm(context, siteUrl, badgeId, type, crit);
    try {
      if (type === COURSE) {
        const course = await completionCourse(page);
        if (course === undefined) continue;
        const grade = await formValue(page, `grade_${course}`);
        const by = await dateSelectorDate(page, `bydate_${course}`);
        criteria.courseCompletion = { ...(grade ? { minGrade: Number(grade) } : {}), ...(by ? { by: by.toISOString() } : {}) };
      } else {
        const { checked } = await checkboxIds(page, type === ACTIVITY ? "module" : "role");
        const all = (await aggregation(page)) === AGG_ALL;
        if (type === ACTIVITY) criteria.activities = { activityIds: checked, all };
        else criteria.manual = { roleIds: checked, all };
      }
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  if (state.overall) criteria.all = state.overall === AGG_ALL;
  return criteria;
}

/** Fills a criterion's open form with what's asked, refusing activities or roles it doesn't offer. */
async function fillCriterion(page: Page, badgeId: number, type: number, change: NonNullable<BadgeCriteriaChanges["activities"] | BadgeCriteriaChanges["courseCompletion"] | BadgeCriteriaChanges["manual"]>): Promise<void> {
  // Without what the criterion needs (activities with completion, a course tracking it), the form has only a message and "Continue".
  if ((await page.locator('form.mform [name="submitbutton"]').count()) === 0) {
    const reason = type === COURSE ? "the course doesn't track completion (enable it in the course's settings)" : type === ACTIVITY ? "the course has no activities with completion tracking" : "no role may award badges in the course";
    throw new BadgeError(`Badge ${badgeId} can't have that criterion: ${reason}.`);
  }
  const values: Record<string, FieldValue> = {};
  if (type === COURSE) {
    const { minGrade, by } = change as { minGrade?: number; by?: Date };
    const course = await completionCourse(page);
    if (course === undefined) throw new BadgeError("Moodle's course completion criterion form has no grade field.");
    values[`grade_${course}`] = minGrade === undefined ? "" : String(minGrade);
    values[`bydate_${course}[enabled]`] = by !== undefined;
    if (by) {
      // A date selector without a time: only its day, month and year.
      const parts = await dateSelectorValues(page, `bydate_${course}`, by);
      for (const part of ["day", "month", "year"]) values[`bydate_${course}[${part}]`] = parts[`bydate_${course}[${part}]`]!;
    }
  } else {
    const activity = type === ACTIVITY;
    const ids = activity ? (change as { activityIds: number[] }).activityIds : (change as { roleIds: number[] }).roleIds;
    const all = (change as { all?: boolean }).all ?? activity;
    const [prefix, what] = activity ? ["module", "activities"] : ["role", "roles"];
    if (ids.length === 0) throw new MoodleError(`Give at least one of the ${what}, or null to remove the criterion.`, "invalid-input");
    const offered = await checkboxIds(page, prefix);
    const missing = ids.filter((id) => !offered.all.includes(id));
    if (missing.length > 0) {
      const why = activity ? "Moodle offers only the course's activities with completion tracking" : "Moodle offers only roles that may award badges (moodle/badges:awardbadge) and you can see";
      throw new BadgeError(`Badge ${badgeId}'s ${activity ? "activity completion" : "manual"} criterion can't take ${what} ${missing.join(", ")}: ${why} (${offered.all.join(", ") || "none"}).`);
    }
    for (const id of offered.all) values[`${prefix}_${id}`] = ids.includes(id);
    values.agg = all ? AGG_ALL : AGG_ANY;
  }
  await setFields(page, values);
}

/**
 * Sets a badge's criteria through its criterion forms: activity completion (course module ids),
 * course completion (with a minimum grade and a date), and manual award by role; `all` sets whether
 * all criteria must be met or any. A criterion given replaces that kind's settings, `null` removes it,
 * one not given stays. Moodle lets criteria change only while the badge is disabled and nobody has it.
 * Returns the criteria afterwards. Throws `BadgeError` when the person can't set criteria (it takes
 * moodle/badges:configurecriteria), when the badge is enabled or already awarded, and for activities
 * or roles the criterion doesn't offer (naming them); `BadgesDisabledError` on a site with badges off.
 */
export async function setBadgeCriteria(context: BrowserContext, siteUrl: string, badgeId: number, changes: BadgeCriteriaChanges): Promise<{ changed: string; criteria: BadgeCriteria }> {
  const kinds = [
    ["activities", ACTIVITY],
    ["courseCompletion", COURSE],
    ["manual", MANUAL],
  ] as const;
  const given = kinds.filter(([key]) => changes[key] !== undefined);
  if (given.length === 0 && changes.all === undefined) throw new MoodleError("Nothing to change: give at least one criterion, or all.", "invalid-input");
  let state = await readCriteriaPage(context, siteUrl, badgeId);
  if (state.active) throw new BadgeError(`Badge ${badgeId} is enabled: Moodle doesn't let its criteria change. Disable it first.`);
  // Moodle offers no criteria actions on a badge someone has (locked), enabled or not.
  if (state.addable.length === 0 && Object.keys(state.existing).length === 0) throw new BadgeError(`Badge ${badgeId}'s criteria can't change: it's been awarded already (Moodle locks it), or Moodle offers no criteria to you.`);

  const done: string[] = [];
  for (const [key, type] of given) {
    const change = changes[key];
    const crit = state.existing[type];
    if (change === null) {
      if (!crit) continue;
      // The criterion's delete link, confirmed: a request with the session key.
      const page = await openSitePage(context, siteUrl, `badges/criteria_action.php?badgeid=${badgeId}&delete=1&type=${type}&confirm=1&sesskey=${state.sesskey}`);
      await page.close().catch(() => undefined);
      done.push(`${key} removed`);
      continue;
    }
    if (!crit && !state.addable.includes(type)) throw new BadgeError(`Badge ${badgeId} can't have a ${key} criterion: Moodle doesn't offer it for this badge.`);
    const page = await criterionForm(context, siteUrl, badgeId, type, crit);
    try {
      await fillCriterion(page, badgeId, type, change!);
      await submitForm(page, "submitbutton");
      if (!new URL(page.url()).pathname.endsWith("/badges/criteria.php")) throw new BadgeError(`Moodle didn't save badge ${badgeId}'s ${key} criterion.`);
    } finally {
      await page.close().catch(() => undefined);
    }
    done.push(`${key} ${crit ? "updated" : "added"}`);
  }

  state = await readCriteriaPage(context, siteUrl, badgeId);
  if (changes.all !== undefined && state.overall !== undefined && state.overall !== (changes.all ? AGG_ALL : AGG_ANY)) {
    // The criteria page's aggregation select: a request with the session key.
    const page = await openSitePage(context, siteUrl, `badges/criteria.php?id=${badgeId}&sesskey=${state.sesskey}&update=${changes.all ? AGG_ALL : AGG_ANY}`);
    await page.close().catch(() => undefined);
    state = await readCriteriaPage(context, siteUrl, badgeId);
    done.push(`all criteria ${changes.all ? "required" : "not required (any one)"}`);
  }
  const criteria = await readCriteria(context, siteUrl, badgeId, state);
  return { changed: `Badge ${badgeId}'s criteria: ${done.join(", ") || "nothing changed"}.`, criteria };
}

/** Moodle's answer to enabling or disabling badges: per badge, a warning when it didn't. */
interface SwitchAnswer {
  result?: { badgeid: number; awards?: string }[];
  warnings?: { item?: string; warningcode?: string; message?: string }[];
}

/**
 * Enables or disables a badge through the service its badges page's buttons call. Enabling awards it
 * at once to whoever already meets its criteria; Moodle needs criteria first. A badge already in that
 * state is left as it is. Returns the badge afterwards. Throws `BadgeError` when the person can't
 * (it takes moodle/badges:configurecriteria) or the badge has no criteria, `BadgesDisabledError` on a
 * site with badges or course badges off.
 */
export async function setBadgeEnabled(context: BrowserContext, siteUrl: string, badgeId: number, enabled: boolean): Promise<{ changed: string; badge: CourseBadge }> {
  const before = await readBadge(context, siteUrl, badgeId);
  if (before.badge.enabled === enabled) return { changed: `Badge ${badgeId} was already ${enabled ? "enabled" : "disabled"}.`, badge: before.badge };
  let answer: SwitchAnswer;
  try {
    answer = await callService<SwitchAnswer>(context, siteUrl, enabled ? "core_badges_enable_badges" : "core_badges_disable_badges", { badgeids: [String(badgeId)] });
  } catch (error) {
    if (error instanceof MoodleServiceError && error.errorcode === "badgesdisabled") throw new BadgesDisabledError();
    throw error;
  }
  const warning = answer.warnings?.[0];
  if (warning) {
    if (warning.warningcode === "coursebadgesdisabled") throw new BadgesDisabledError();
    const reason = warning.warningcode === "nopermissions" ? `it takes ${CAPABILITY.criteria}` : warning.warningcode === "nocriteria" ? "it has no criteria: set them first" : (warning.message ?? warning.warningcode ?? "Moodle refused");
    throw new BadgeError(`You can't ${enabled ? "enable" : "disable"} badge ${badgeId}: ${reason}.`);
  }
  const { badge } = await readBadge(context, siteUrl, badgeId);
  return { changed: `Badge ${badgeId} ${enabled ? "enabled" : "disabled"}${enabled && badge.recipients ? `: ${badge.recipients} ${badge.recipients === 1 ? "person has" : "people have"} it` : ""}.`, badge };
}

/** The manual award page's state: its recipients form, or the role menu Moodle asks to choose from first. */
async function readAwardPage(page: Page): Promise<{ form: boolean; roles: number[]; existing: number[] }> {
  return inPage(page, () => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): unknown; querySelectorAll(s: string): ArrayLike<{ value: string }> } }).document;
    const values = (selector: string) => Array.from(doc.querySelectorAll(selector)).map((option) => Number(option.value)).filter((id) => id > 0);
    return { form: doc.querySelector("form#recipientform") !== null, roles: values('form[action*="/badges/award.php"] select[name="role"] option'), existing: values('form#recipientform select[name="existingrecipients[]"] option') };
  }, null);
}

/**
 * Awards a badge by hand to a participant, through its manual award page, as the person's role in its
 * manual criterion (`roleId` when the criterion names several the person holds; the first otherwise).
 * The badge must be enabled and have a manual criterion naming a role the person holds. Moodle issues
 * the badge when its criteria are met: at once when the manual award is enough (its only criterion, or
 * any one earning it), else once the rest are met too (confirmed empirically, 5.2). A participant
 * awarded already is left as is. Returns the badge afterwards. Throws `BadgeError` when the person
 * can't award it (it takes moodle/badges:awardbadge and one of the criterion's roles), when it isn't
 * enabled or has no manual criterion, and when Moodle doesn't award it (the user isn't a participant).
 */
export async function awardBadge(context: BrowserContext, siteUrl: string, badgeId: number, userId: number, { roleId }: { roleId?: number } = {}): Promise<{ changed: string; badge: CourseBadge }> {
  let page = await openSitePage(context, siteUrl, `badges/award.php?id=${badgeId}${roleId ? `&role=${roleId}` : ""}`);
  try {
    await failOnErrorPage(page, `You can't award badge ${badgeId} (it takes ${CAPABILITY.award}), or it doesn't exist`);
    let state = await readAwardPage(page);
    if (!state.form && state.roles.length > 0) {
      // Several roles may award it: Moodle asks which one the person awards as.
      const role = roleId ?? state.roles[0]!;
      if (!state.roles.includes(role)) throw new BadgeError(`You can't award badge ${badgeId} as role ${role}: you award it as ${state.roles.join(" or ")}.`);
      await page.close().catch(() => undefined);
      page = await openSitePage(context, siteUrl, `badges/award.php?id=${badgeId}&role=${role}`);
      state = await readAwardPage(page);
    }
    if (!state.form) {
      const courseId = await pageCourseId(page);
      const row = courseId > 1 ? (await badgeRows(context, siteUrl, courseId)).find((r) => r.id === badgeId) : undefined;
      if (row && !row.enabled) throw new BadgeError(`Badge ${badgeId} isn't enabled: enable it before awarding it.`);
      throw new BadgeError(`You can't award badge ${badgeId} by hand: it has no manual criterion, or it names no role you hold in the course${roleId ? ` (or not role ${roleId})` : ""}.`);
    }
    if (!state.existing.includes(userId)) {
      // The recipients form's potential list holds the participants Moodle may award it to; the one
      // asked is chosen there (added when the list shows only matches of a search), then "Award".
      await page.evaluate((userId) => {
        const doc = (globalThis as unknown as { document: { querySelector(s: string): { options: ArrayLike<{ value: string; selected: boolean }>; appendChild(o: unknown): void } | null; createElement(t: string): { value: string; selected: boolean } } }).document;
        const select = doc.querySelector('form#recipientform select[name="potentialrecipients[]"]');
        if (!select) return;
        for (const option of Array.from(select.options)) option.selected = option.value === String(userId);
        if (!Array.from(select.options).some((option) => option.value === String(userId))) {
          const option = doc.createElement("option");
          option.value = String(userId);
          option.selected = true;
          select.appendChild(option);
        }
      }, userId);
      await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded" }), page.click('form#recipientform input[name="award"]', { noWaitAfter: true })]);
      if (!(await readAwardPage(page)).existing.includes(userId)) throw new BadgeError(`Moodle didn't award badge ${badgeId} to user ${userId}: they aren't a participant it can be awarded to.`);
    }
    const already = state.existing.includes(userId);
    await page.close().catch(() => undefined);
    const { badge } = await readBadge(context, siteUrl, badgeId);
    return { changed: already ? `User ${userId} was already awarded badge ${badgeId} by hand.` : `Badge ${badgeId} awarded by hand to user ${userId}${badge.recipients !== undefined ? ` (${badge.recipients} ${badge.recipients === 1 ? "person has" : "people have"} it)` : ""}.`, badge };
  } finally {
    await page.close().catch(() => undefined);
  }
}
