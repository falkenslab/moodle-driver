// Who is in a course: enrolling users by manual enrolment, unenrolling them and choosing their roles,
// as the participants page does. Its "Enrol users" dialog is a form fragment (`core_get_fragment`) sent
// to `enrol/manual/ajax.php`; unenrolling and the roles column are AJAX services (ADR-004).
import type { BrowserContext, Page } from "playwright-core";
import { MoodleServiceError, callService } from "../../core/ajax.js";
import { openSitePage } from "../../core/session.js";
import { siteFetch } from "../../core/http.js";
import { inPage } from "../../core/inPage.js";
import { dateSelectorParts } from "../../core/forms.js";
import { MoodleError } from "../../core/errors.js";
import { MAX_PARTICIPANT_PAGES, NoParticipantsError, PARTICIPANTS_PAGE_SIZE, participantsTablePage } from "./participants.js";

/** Moodle refused to enrol, unenrol or change a role: no manual enrolment, a role the person can't assign, a user not enrolled. */
export class EnrolmentError extends MoodleError {
  override name = "EnrolmentError";
  constructor(message: string) {
    super(message, "enrolment");
  }
}

/** A user the person may enrol in a course. */
export interface PotentialUser {
  userId: number;
  fullName: string;
  /** Only when the site shows emails to the person (its identity fields). */
  email?: string;
}

/** What the participants page says about enrolling in a course: its manual enrolment and the course's context. */
interface EnrolFacts {
  participants: boolean;
  enrolId?: number;
  contextId?: number;
  sesskey?: string;
  timeZone?: string;
}

/** Opens the participants page and reads the manual enrolment's id ("Enrol users" button), the course context and the sesskey. */
async function openEnrolment(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ page: Page; enrolId: number; contextId: number; sesskey: string; timeZone: string }> {
  const page = await openSitePage(context, siteUrl, `user/index.php?id=${courseId}`);
  try {
    const facts = await page.evaluate((): EnrolFacts => {
      const g = globalThis as unknown as {
        M?: { cfg?: { contextid?: number; sesskey?: string; usertimezone?: string } };
        document: { body: { id: string }; querySelector(s: string): { value: string } | null };
      };
      const enrolId = Number(g.document.querySelector('form[action*="/enrol/manual/manage.php"] input[name="enrolid"]')?.value);
      return {
        participants: g.document.body.id === "page-course-view-participants",
        ...(enrolId ? { enrolId } : {}),
        ...(g.M?.cfg?.contextid ? { contextId: g.M.cfg.contextid } : {}),
        ...(g.M?.cfg?.sesskey ? { sesskey: g.M.cfg.sesskey } : {}),
        ...(g.M?.cfg?.usertimezone ? { timeZone: g.M.cfg.usertimezone } : {}),
      };
    });
    if (!facts.participants) throw new NoParticipantsError(`You can't see the participants of course ${courseId}: it doesn't exist, or you aren't allowed.`);
    if (!facts.enrolId || !facts.contextId || !facts.sesskey) {
      throw new EnrolmentError(`Course ${courseId} has no manual enrolment you can enrol users with: it isn't in the course's enrolment methods, it's disabled, or you aren't allowed to enrol.`);
    }
    return { page, enrolId: facts.enrolId, contextId: facts.contextId, sesskey: facts.sesskey, timeZone: facts.timeZone ?? "UTC" };
  } catch (error) {
    await page.close().catch(() => undefined);
    throw error;
  }
}

/**
 * Users the person may enrol in a course by manual enrolment, matching `search` anywhere in their
 * name or the identity fields the site shows (all of them, a page of up to 100, when empty), as the
 * "Enrol users" dialog finds them. Throws `EnrolmentError` when the course has no manual enrolment
 * the person can use.
 */
export async function potentialUsers(context: BrowserContext, siteUrl: string, courseId: number, search = ""): Promise<PotentialUser[]> {
  const { page, enrolId } = await openEnrolment(context, siteUrl, courseId);
  await page.close().catch(() => undefined);
  const found = await callService<{ id: number; fullname: string; email?: string }[]>(context, siteUrl, "core_enrol_get_potential_users", {
    courseid: courseId,
    enrolid: enrolId,
    search,
    searchanywhere: true,
    page: 0,
    perpage: 100,
  });
  return found.map((u) => ({ userId: u.id, fullName: u.fullname, ...(u.email ? { email: u.email } : {}) }));
}

/** The "Enrol users" form's defaults that matter: the role, the duration, the start, recovering grades. */
interface EnrolDefaults {
  roleId?: string;
  duration: string;
  startdate?: string;
  recoverGrades: boolean;
}

/**
 * Enrols users in a course by manual enrolment, as the participants page's "Enrol users" dialog does:
 * with `roleId` or the enrolment's default role, from `start` (now, unless given) until `end` (the
 * enrolment's default duration, unless given). Users already enrolled keep their enrolment, with the
 * new dates. Throws `EnrolmentError` with Moodle's reason when it refuses (a role the person can't
 * assign, no manual enrolment).
 */
export async function enrolUsers(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  userIds: number[],
  { roleId, start, end }: { roleId?: number; start?: Date; end?: Date } = {},
): Promise<{ changed: string; count: number; roleId?: number }> {
  if (userIds.length === 0) throw new EnrolmentError("No users to enrol: give at least one user id.");
  const { page, enrolId, contextId, sesskey, timeZone } = await openEnrolment(context, siteUrl, courseId);
  let defaults: EnrolDefaults;
  try {
    const { html } = await callService<{ html: string }>(context, siteUrl, "core_get_fragment", { component: "enrol_manual", callback: "enrol_users_form", contextid: contextId, args: [] });
    // A helper inside: through inPage (see the conventions on page.evaluate).
    defaults = await inPage(page, (html: string): EnrolDefaults => {
      const g = globalThis as unknown as { DOMParser: new () => { parseFromString(html: string, type: string): { querySelector(s: string): { value: string; checked?: boolean } | null } } };
      const form = new g.DOMParser().parseFromString(html, "text/html");
      const selected = (name: string) => form.querySelector(`select[name="${name}"] option[selected]`)?.value;
      return {
        ...(selected("roletoassign") ? { roleId: selected("roletoassign") } : {}),
        duration: selected("duration") ?? "",
        ...(selected("startdate") ? { startdate: selected("startdate") } : {}),
        recoverGrades: form.querySelector('input[type="checkbox"][name="recovergrades"]')?.checked === true,
      };
    }, html);
  } finally {
    await page.close().catch(() => undefined);
  }

  const role = roleId !== undefined ? String(roleId) : defaults.roleId;
  const query = new URLSearchParams({ id: String(courseId), action: "enrol", enrolid: String(enrolId), sesskey });
  for (const userId of userIds) query.append("userlist[]", String(userId));
  if (role) query.set("roletoassign", role);
  if (defaults.recoverGrades) query.set("recovergrades", "1");
  // 5 is the start menu's "Choose...": the date selector's own date.
  if (start) {
    query.set("startdate", "5");
    for (const [key, value] of Object.entries(dateSelectorParts("startdateselect", start, timeZone))) query.set(key, String(value));
  } else if (defaults.startdate) query.set("startdate", defaults.startdate);
  if (end) {
    query.set("timeend[enabled]", "1");
    for (const [key, value] of Object.entries(dateSelectorParts("timeend", end, timeZone))) query.set(key, String(value));
  } else if (defaults.duration) query.set("duration", defaults.duration);

  const { body } = await siteFetch(context, new URL(`enrol/manual/ajax.php?${query}`, siteUrl).href);
  let answer: { success?: boolean; error?: string; count?: number };
  try {
    answer = JSON.parse(body) as typeof answer;
  } catch {
    throw new EnrolmentError(`Moodle didn't answer the enrolment in course ${courseId} as expected.`);
  }
  // Moodle answers its refusals (enrol_ajax_exception) as JSON with the reason in `error`.
  if (answer.error) throw new EnrolmentError(`Moodle didn't enrol the users in course ${courseId}: ${answer.error}`);
  const count = answer.count ?? 0;
  return { changed: `${count} user(s) enrolled in course ${courseId}${role ? ` with role ${role}` : ""}.`, count, ...(role ? { roleId: Number(role) } : {}) };
}

/** A user's row in the participants table: their enrolments, with the id of each the person may remove. */
interface EnrolmentCell {
  found: boolean;
  enrolments: { method: string; ueId?: number }[];
}

/**
 * Unenrols a user from a course: removes every enrolment of theirs the person may remove (its
 * unenrol link on the participants page), with their roles and group memberships in the course, as
 * that link does. `changed` and `removed` say which ones (by enrolment method's name), `kept` those
 * the person may not remove (a cohort sync, another teacher's method). Throws `EnrolmentError` when
 * the user isn't enrolled.
 */
export async function unenrolUser(context: BrowserContext, siteUrl: string, courseId: number, userId: number): Promise<{ changed: string; removed: string[]; kept: string[] }> {
  const parser = await openSitePage(context, siteUrl, `user/index.php?id=${courseId}`);
  let cell: EnrolmentCell = { found: false, enrolments: [] };
  try {
    if ((await parser.locator("body#page-course-view-participants").count()) === 0) {
      throw new NoParticipantsError(`You can't see the participants of course ${courseId}: it doesn't exist, or you aren't allowed.`);
    }
    for (let pagenumber = 1; pagenumber <= MAX_PARTICIPANT_PAGES && !cell.found; pagenumber++) {
      const html = await participantsTablePage(context, siteUrl, courseId, [], pagenumber);
      const read = await parser.evaluate(
        ({ html, userId }) => {
          interface El {
            getAttribute(name: string): string | null;
            querySelector(s: string): El | null;
            querySelectorAll(s: string): ArrayLike<El>;
          }
          const g = globalThis as unknown as { DOMParser: new () => { parseFromString(html: string, type: string): El } };
          const doc = new g.DOMParser().parseFromString(html, "text/html");
          const rows = Array.from(doc.querySelectorAll("tbody tr:not(.emptyrow)"));
          const row = rows.find((r) => {
            const href = r.querySelector('a[href*="/user/view.php?id="]')?.getAttribute("href") ?? "";
            return Number(new URL(href, "http://x/").searchParams.get("id")) === userId;
          });
          if (!row) return { rows: rows.length, cell: { found: false, enrolments: [] } };
          // One block per enrolment, named by its method, with an unenrol link when the person may remove it.
          const enrolments = Array.from(row.querySelectorAll("[data-enrolinstancename]")).map((block) => {
            const link = block.querySelector('a[data-action="unenrol"]')?.getAttribute("href");
            const ueId = link ? Number(new URL(link, "http://x/").searchParams.get("ue")) : 0;
            return { method: block.getAttribute("data-enrolinstancename") ?? "", ...(ueId ? { ueId } : {}) };
          });
          return { rows: rows.length, cell: { found: true, enrolments } };
        },
        { html, userId },
      );
      cell = read.cell;
      if (read.rows < PARTICIPANTS_PAGE_SIZE) break;
    }
  } finally {
    await parser.close().catch(() => undefined);
  }
  if (!cell.found) throw new EnrolmentError(`User ${userId} isn't enrolled in course ${courseId}.`);

  const removed: string[] = [];
  const kept: string[] = [];
  for (const enrolment of cell.enrolments) {
    if (!enrolment.ueId) {
      kept.push(enrolment.method);
      continue;
    }
    const { result, errors } = await callService<{ result: boolean; errors: { key: string; message: string }[] }>(context, siteUrl, "core_enrol_unenrol_user_enrolment", { ueid: enrolment.ueId });
    if (!result) {
      if (errors.length > 0) throw new EnrolmentError(`Moodle didn't remove user ${userId}'s enrolment "${enrolment.method}" in course ${courseId}: ${errors.map((e) => e.message).join("; ")}`);
      kept.push(enrolment.method);
    } else removed.push(enrolment.method);
  }
  if (removed.length === 0) throw new EnrolmentError(`You can't remove any of user ${userId}'s enrolments in course ${courseId} (${kept.join(", ")}).`);
  const rest = kept.length > 0 ? `; kept, which you can't remove: ${kept.join(", ")}` : "";
  return { changed: `User ${userId} unenrolled from course ${courseId}: removed ${removed.join(", ")}${rest}.`, removed, kept };
}

/**
 * Sets a user's roles in a course, as the participants page's roles column does: gives the roles in
 * `roleIds` the person may assign, and takes away the others the person may assign. Roles the person
 * can't assign that the user already holds, and those from elsewhere (a category, an enrolment that
 * protects them), stay. Returns the user's roles afterwards, as that column shows them. Throws
 * `EnrolmentError` with Moodle's reason for a role the person can't assign or a user not enrolled.
 */
export async function setUserRoles(context: BrowserContext, siteUrl: string, courseId: number, userId: number, roleIds: number[]): Promise<{ changed: string; roleIds: number[] }> {
  let answer: { value: string };
  try {
    answer = await callService<{ value: string }>(context, siteUrl, "core_update_inplace_editable", {
      component: "core_user",
      itemtype: "user_roles",
      itemid: `${courseId}:${userId}`,
      value: JSON.stringify(roleIds.map(String)),
    });
  } catch (error) {
    if (error instanceof MoodleServiceError) throw new EnrolmentError(`Moodle didn't set user ${userId}'s roles in course ${courseId}: ${error.message}`);
    throw error;
  }
  const now = (JSON.parse(answer.value || "[]") as (string | number)[]).map(Number);
  return { changed: `User ${userId}'s roles in course ${courseId} are now: ${now.join(", ") || "none"}.`, roleIds: now };
}
