// A course's participants and groups, read from the participants page's own table service
// (`core_table_get_dynamic_table_content`), filtered by role, group and inactivity as its filters do.
// No emails, phones or profile fields: telling participants apart doesn't need them.
import type { BrowserContext, Page } from "playwright-core";
import { callService } from "../../core/ajax.js";
import { openSitePage } from "../../core/session.js";
import { MoodleError } from "../../core/errors.js";

/** A participant of a course with their roles and groups, as `participants` lists them. */
export interface Participant {
  userId: number;
  fullName: string;
  roles: { id: number; name: string }[];
  groups: { id: number; name: string }[];
}

/** A group of a course, as `groups` lists it. */
export interface CourseGroup {
  id: number;
  name: string;
  /** The members' user ids. */
  members: number[];
}

/** The person can't see the course's participants. */
export class NoParticipantsError extends MoodleError {
  override name = "NoParticipantsError";
  constructor(message: string) {
    super(message, "no-participants");
  }
}

// The table's join types (core\output\datafilter): a filter's values match any; filters all apply.
const JOIN_ANY = 1;
const JOIN_ALL = 2;
export const PARTICIPANTS_PAGE_SIZE = 100;
export const MAX_PARTICIPANT_PAGES = 100;

export interface Filter {
  name: string;
  jointype: number;
  values: number[];
}

/** The rows of a participants table fragment: user id and name, read by link and markup, in any language. */
export function readParticipantRows(page: Page): Promise<{ userId: number; fullName: string }[]> {
  return page.evaluate(() => {
    interface El {
      textContent: string | null;
      getAttribute(name: string): string | null;
      querySelector(s: string): El | null;
      querySelectorAll(s: string): ArrayLike<El & { remove(): void }>;
      cloneNode(deep: boolean): El;
    }
    const doc = (globalThis as unknown as { document: El }).document;
    // Moodle pads a page with empty rows up to its size.
    return Array.from(doc.querySelectorAll("tbody tr:not(.emptyrow)")).flatMap((row) => {
      const link = row.querySelector('a[href*="/user/view.php?id="]');
      const userId = Number(new URL(link?.getAttribute("href") ?? "", "http://x/").searchParams.get("id"));
      if (!link || !userId) return [];
      // The link holds the picture or initials before the name.
      const copy = link.cloneNode(true);
      for (const extra of Array.from(copy.querySelectorAll(".userinitials, img, .visually-hidden"))) extra.remove();
      return [{ userId, fullName: (copy.textContent ?? "").replace(/\s+/g, " ").trim() }];
    });
  });
}

/** One page (from 1) of the participants table matching `filters`, as the HTML fragment the page renders. */
export async function participantsTablePage(context: BrowserContext, siteUrl: string, courseId: number, filters: Filter[], pagenumber: number): Promise<string> {
  const { html } = await callService<{ html: string }>(context, siteUrl, "core_table_get_dynamic_table_content", {
    component: "core_user",
    handler: "participants",
    uniqueid: `user-index-participants-${courseId}`,
    sortdata: [{ sortby: "lastname", sortorder: 4 }],
    // Integer filters take numbers: a string id fails (confirmed empirically, Moodle 5.2).
    filters: [{ name: "courseid", jointype: JOIN_ANY, values: [courseId] }, ...filters],
    jointype: JOIN_ALL,
    firstinitial: "",
    lastinitial: "",
    pagenumber,
    pagesize: PARTICIPANTS_PAGE_SIZE,
    hiddencolumns: [],
    resetpreferences: false,
  });
  return html;
}

/** Every participant matching `filters`, page by page, parsed in `parser` (a blank tab). */
async function fetchAll(context: BrowserContext, siteUrl: string, parser: Page, courseId: number, filters: Filter[]): Promise<{ userId: number; fullName: string }[]> {
  const all = new Map<number, { userId: number; fullName: string }>();
  for (let pagenumber = 1; pagenumber <= MAX_PARTICIPANT_PAGES; pagenumber++) {
    const html = await participantsTablePage(context, siteUrl, courseId, filters, pagenumber);
    await parser.setContent(html);
    const rows = await readParticipantRows(parser);
    for (const row of rows) all.set(row.userId, row);
    if (rows.length < PARTICIPANTS_PAGE_SIZE) break;
  }
  return Array.from(all.values());
}

/**
 * The roles and groups the participants page filters by in a course (its filters' options), as the
 * person may use them: every group, or only their own in a course with separate groups. "No roles"
 * and "no group" left out.
 */
export async function participantFilters(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ roles: { id: number; name: string }[]; groups: { id: number; name: string }[] }> {
  const page = await openSitePage(context, siteUrl, `user/index.php?id=${courseId}`);
  try {
    if ((await page.locator("body#page-course-view-participants").count()) === 0) {
      throw new NoParticipantsError(`You can't see the participants of course ${courseId}: it doesn't exist, or you aren't allowed.`);
    }
    return await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ value: string; textContent: string | null }> } }).document;
      // Anonymous callbacks only: see the conventions on page.evaluate.
      const [roles, groups] = ["roles", "groups"].map((field) =>
        Array.from(doc.querySelectorAll(`select[data-field-name="${field}"] option`))
          .map((option) => ({ id: Number(option.value), name: (option.textContent ?? "").trim() }))
          .filter((option) => option.id > 0),
      );
      return { roles: roles ?? [], groups: groups ?? [] };
    });
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A course's groups the person can see, with their members' user ids. */
export async function groups(context: BrowserContext, siteUrl: string, courseId: number): Promise<CourseGroup[]> {
  const { groups: found } = await participantFilters(context, siteUrl, courseId);
  const parser = await context.newPage();
  try {
    const result: CourseGroup[] = [];
    for (const group of found) {
      const members = await fetchAll(context, siteUrl, parser, courseId, [{ name: "groups", jointype: JOIN_ANY, values: [group.id] }]);
      result.push({ ...group, members: members.map((m) => m.userId) });
    }
    return result;
  } finally {
    await parser.close().catch(() => undefined);
  }
}

/**
 * A course's participants with their roles and groups, as the participants page lists them: only
 * those with a role (its id), in a group, or (`inactiveSince`) who haven't accessed the course since
 * that date, when asked. Each role and group is a filter of its own, so ids come in any language.
 */
export async function participants(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  { role, group, inactiveSince }: { role?: number; group?: number; inactiveSince?: Date } = {},
): Promise<Participant[]> {
  const { roles, groups: courseGroupList } = await participantFilters(context, siteUrl, courseId);
  const filters: Filter[] = [];
  if (role !== undefined) filters.push({ name: "roles", jointype: JOIN_ANY, values: [role] });
  if (group !== undefined) filters.push({ name: "groups", jointype: JOIN_ANY, values: [group] });
  // "Inactive for more than": no access to the course since this time (the filter's "any" join).
  if (inactiveSince !== undefined) filters.push({ name: "accesssince", jointype: JOIN_ANY, values: [Math.floor(inactiveSince.getTime() / 1000)] });

  const parser = await context.newPage();
  try {
    const people = await fetchAll(context, siteUrl, parser, courseId, filters);
    const byUser = new Map<number, Participant>(people.map((p) => [p.userId, { ...p, roles: [], groups: [] }]));
    for (const r of roles) {
      for (const member of await fetchAll(context, siteUrl, parser, courseId, [{ name: "roles", jointype: JOIN_ANY, values: [r.id] }])) byUser.get(member.userId)?.roles.push(r);
    }
    for (const g of courseGroupList) {
      for (const member of await fetchAll(context, siteUrl, parser, courseId, [{ name: "groups", jointype: JOIN_ANY, values: [g.id] }])) byUser.get(member.userId)?.groups.push(g);
    }
    return Array.from(byUser.values());
  } finally {
    await parser.close().catch(() => undefined);
  }
}
