// A course's groups and groupings, made, changed and deleted as a teacher does on Moodle's group
// pages: no group service that writes is open to AJAX (Moodle 5.2), so the group and grouping forms,
// and the members (`group/members.php`) and grouping (`group/assign.php`) pages, posted as they post.
import type { BrowserContext } from "playwright-core";
import { NotLoggedInError, htmlSessionFacts, isLoggedIn, moodleErrorMessage, openSitePage } from "../../core/session.js";
import { siteFetch } from "../../core/http.js";
import { inPage } from "../../core/inPage.js";
import { openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { MoodleError } from "../../core/errors.js";

/** A group's settings, as its form names them. */
export interface GroupSettings {
  name?: string;
  /** HTML. */
  description?: string;
  idNumber?: string;
  /** The key that puts a student enrolling with self enrolment in this group. */
  enrolmentKey?: string;
}

/** A grouping's settings, as its form names them. */
export interface GroupingSettings {
  name?: string;
  /** HTML. */
  description?: string;
  idNumber?: string;
}

/** A grouping of a course (a set of its groups), as `groupings` lists it. */
export interface Grouping {
  id: number;
  name: string;
  /** The ids of its groups. */
  groupIds: number[];
}

/** The two lists of a members page (`group/members.php`) or a grouping's groups page (`group/assign.php`): who's in, who may be added. */
interface AssignPage {
  found: boolean;
  courseId: number;
  sesskey: string;
  current: number[];
  potential: number[];
}

/** Reads a members or grouping page: the current and potential lists by option value, the course and the sesskey. */
async function readAssignPage(context: BrowserContext, siteUrl: string, path: string, what: string): Promise<AssignPage> {
  const page = await openSitePage(context, siteUrl, path);
  try {
    // A helper inside: through inPage (see the conventions on page.evaluate).
    const read = await inPage(page, (): AssignPage => {
      const g = globalThis as unknown as {
        M?: { cfg?: { courseId?: number; sesskey?: string } };
        document: { querySelector(s: string): unknown; querySelectorAll(s: string): ArrayLike<{ value: string }> };
      };
      // Options' values are ids (a grouping page writes them "5."); its empty lists hold a blank option.
      const ids = (select: string) => Array.from(g.document.querySelectorAll(`#assignform select#${select} option`)).map((o) => Number.parseInt(o.value, 10)).filter((id) => id > 0);
      return {
        found: g.document.querySelector("#assignform") !== null,
        courseId: g.M?.cfg?.courseId ?? 0,
        sesskey: g.M?.cfg?.sesskey ?? "",
        current: ids("removeselect"),
        potential: ids("addselect"),
      };
    }, null);
    if (!read.found) throw new MoodleError(`You can't manage ${what}: ${(await moodleErrorMessage(page)) ?? "it doesn't exist, or you aren't allowed."}`, "not-found");
    return read;
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Posts a form of the site's group pages, as its buttons do; throws when the session is gone. */
async function post(context: BrowserContext, siteUrl: string, path: string, fields: [string, string][]): Promise<string> {
  const { url, body } = await siteFetch(context, new URL(path, siteUrl).href, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  if (!isLoggedIn(url, siteUrl, htmlSessionFacts(body))) throw new NotLoggedInError();
  return body;
}

function groupFields(settings: GroupSettings): Record<string, FieldValue> {
  return {
    ...(settings.name !== undefined ? { name: settings.name } : {}),
    ...(settings.idNumber !== undefined ? { idnumber: settings.idNumber } : {}),
    ...(settings.description !== undefined ? { "description_editor[text]": settings.description } : {}),
    ...("enrolmentKey" in settings && settings.enrolmentKey !== undefined ? { enrolmentkey: settings.enrolmentKey } : {}),
  };
}

/**
 * Creates a group in a course with its group form (`group/group.php`). Throws `FormError` with
 * Moodle's reason when it refuses (a name already used, an enrolment key another group has).
 */
export async function createGroup(context: BrowserContext, siteUrl: string, courseId: number, settings: GroupSettings & { name: string }): Promise<{ changed: string; groupId: number }> {
  const page = await openForm(context, siteUrl, `group/group.php?courseid=${courseId}`);
  try {
    await setFields(page, groupFields(settings));
    await submitForm(page, "submitbutton");
    // Moodle goes to the groups page with the new group selected.
    const groupId = Number(new URL(page.url()).searchParams.get("group"));
    if (!groupId) throw new MoodleError(`Moodle didn't say which group it created in course ${courseId}.`, "unexpected-page");
    return { changed: `Group ${groupId} "${settings.name}" created in course ${courseId}.`, groupId };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Changes a group's name, description, ID number or enrolment key with its form; what isn't given stays. */
export async function updateGroup(context: BrowserContext, siteUrl: string, groupId: number, settings: GroupSettings): Promise<{ changed: string }> {
  const fields = groupFields(settings);
  if (Object.keys(fields).length === 0) throw new MoodleError("Nothing to change: give a name, description, ID number or enrolment key.", "invalid-input");
  const page = await openForm(context, siteUrl, `group/group.php?id=${groupId}`);
  try {
    await setFields(page, fields);
    await submitForm(page, "submitbutton");
    return { changed: `Group ${groupId} updated: ${Object.keys(settings).join(", ")}.` };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Deletes a group, as the groups page's "Delete selected group" does once confirmed; its members stay in the course. */
export async function deleteGroup(context: BrowserContext, siteUrl: string, groupId: number): Promise<{ changed: string }> {
  const { courseId, sesskey } = await readAssignPage(context, siteUrl, `group/members.php?group=${groupId}`, `group ${groupId}`);
  await post(context, siteUrl, "group/delete.php", [
    ["courseid", String(courseId)],
    ["groups", String(groupId)],
    ["confirm", "1"],
    ["sesskey", sesskey],
  ]);
  return { changed: `Group ${groupId} deleted from course ${courseId}.` };
}

/**
 * Adds and removes a group's members (user ids), as its members page does. Only the course's
 * participants can be added: ids the page doesn't offer (not enrolled, or already members) and
 * members not in it are left as they were and named in `changed`. Returns the members afterwards.
 */
export async function setGroupMembers(context: BrowserContext, siteUrl: string, groupId: number, { add = [], remove = [] }: { add?: number[]; remove?: number[] }): Promise<{ changed: string; members: number[] }> {
  const path = `group/members.php?group=${groupId}`;
  const before = await readAssignPage(context, siteUrl, path, `the members of group ${groupId}`);
  const toAdd = add.filter((id) => before.potential.includes(id));
  const toRemove = remove.filter((id) => before.current.includes(id));
  if (toAdd.length > 0) await post(context, siteUrl, path, [["sesskey", before.sesskey], ["add", "1"], ...toAdd.map((id): [string, string] => ["addselect[]", String(id)])]);
  if (toRemove.length > 0) await post(context, siteUrl, path, [["sesskey", before.sesskey], ["remove", "1"], ...toRemove.map((id): [string, string] => ["removeselect[]", String(id)])]);
  const { current } = await readAssignPage(context, siteUrl, path, `the members of group ${groupId}`);
  const added = toAdd.filter((id) => current.includes(id));
  const removed = toRemove.filter((id) => !current.includes(id));
  const skipped = [...add.filter((id) => !toAdd.includes(id) && !before.current.includes(id)), ...remove.filter((id) => !toRemove.includes(id) && before.current.includes(id))];
  const parts = [
    added.length > 0 ? `added ${added.join(", ")}` : "",
    removed.length > 0 ? `removed ${removed.join(", ")}` : "",
    skipped.length > 0 ? `couldn't change ${skipped.join(", ")} (not participants the page offers)` : "",
  ].filter(Boolean);
  return { changed: `Group ${groupId}: ${parts.join("; ") || "nothing changed"}.`, members: current };
}

/** A course's groupings with their groups' ids, from its groupings page and each grouping's groups page. Throws `MoodleError` with Moodle's refusal for a person who can't manage groups. */
export async function groupings(context: BrowserContext, siteUrl: string, courseId: number): Promise<Grouping[]> {
  const page = await openSitePage(context, siteUrl, `group/groupings.php?id=${courseId}`);
  let found: { id: number; name: string }[];
  try {
    // Moodle's refusal (no moodle/course:managegroups) keeps the page's body id: its error box tells.
    const refusal = await moodleErrorMessage(page);
    if (refusal || (await page.locator("body#page-group-groupings").count()) === 0) {
      throw new MoodleError(`You can't see the groupings of course ${courseId}: ${refusal ?? "it doesn't exist, or you aren't allowed."}`, "not-found");
    }
    found = await page.evaluate(() => {
      interface El {
        textContent: string | null;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      // One row per grouping, its id in the link to its groups page (assign.php?id=), its name in the first cell.
      return Array.from(doc.querySelectorAll("table tbody tr")).flatMap((row) => {
        const href = row.querySelector('a[href*="/group/assign.php?id="]')?.getAttribute("href");
        const id = href ? Number(new URL(href, "http://x/").searchParams.get("id")) : 0;
        return id ? [{ id, name: (row.querySelector("td")?.textContent ?? "").replace(/\s+/g, " ").trim() }] : [];
      });
    });
  } finally {
    await page.close().catch(() => undefined);
  }
  const result: Grouping[] = [];
  for (const grouping of found) {
    const { current } = await readAssignPage(context, siteUrl, `group/assign.php?id=${grouping.id}`, `grouping ${grouping.id}`);
    result.push({ ...grouping, groupIds: current });
  }
  return result;
}

/** Creates a grouping in a course with its form (`group/grouping.php`); add its groups with `setGroupingGroups`. */
export async function createGrouping(context: BrowserContext, siteUrl: string, courseId: number, settings: GroupingSettings & { name: string }): Promise<{ changed: string; groupingId: number }> {
  const before = new Set((await groupings(context, siteUrl, courseId)).map((g) => g.id));
  const page = await openForm(context, siteUrl, `group/grouping.php?courseid=${courseId}`);
  try {
    await setFields(page, groupFields(settings));
    await submitForm(page, "submitbutton");
  } finally {
    await page.close().catch(() => undefined);
  }
  // Moodle goes back to the groupings page without naming the new one: it's the one that wasn't there.
  const created = (await groupings(context, siteUrl, courseId)).find((g) => !before.has(g.id));
  if (!created) throw new MoodleError(`Moodle didn't show the new grouping in course ${courseId}.`, "unexpected-page");
  return { changed: `Grouping ${created.id} "${settings.name}" created in course ${courseId}.`, groupingId: created.id };
}

/** Deletes a grouping, as its delete icon does once confirmed; its groups stay. */
export async function deleteGrouping(context: BrowserContext, siteUrl: string, groupingId: number): Promise<{ changed: string }> {
  const { courseId, sesskey } = await readAssignPage(context, siteUrl, `group/assign.php?id=${groupingId}`, `grouping ${groupingId}`);
  await post(context, siteUrl, "group/grouping.php", [
    ["id", String(groupingId)],
    ["delete", "1"],
    ["courseid", String(courseId)],
    ["confirm", "1"],
    ["sesskey", sesskey],
  ]);
  return { changed: `Grouping ${groupingId} deleted from course ${courseId}.` };
}

/**
 * Makes a grouping's groups exactly `groupIds`, as its groups page adds and removes them. Groups of
 * other courses aren't offered there and are left out, named in `changed`. Returns the groups afterwards.
 */
export async function setGroupingGroups(context: BrowserContext, siteUrl: string, groupingId: number, groupIds: number[]): Promise<{ changed: string; groupIds: number[] }> {
  const path = `group/assign.php?id=${groupingId}`;
  const before = await readAssignPage(context, siteUrl, path, `grouping ${groupingId}`);
  const toAdd = groupIds.filter((id) => before.potential.includes(id));
  const toRemove = before.current.filter((id) => !groupIds.includes(id));
  if (toAdd.length > 0) await post(context, siteUrl, path, [["sesskey", before.sesskey], ["add", "1"], ...toAdd.map((id): [string, string] => ["addselect[]", String(id)])]);
  if (toRemove.length > 0) await post(context, siteUrl, path, [["sesskey", before.sesskey], ["remove", "1"], ...toRemove.map((id): [string, string] => ["removeselect[]", String(id)])]);
  const { current } = await readAssignPage(context, siteUrl, path, `grouping ${groupingId}`);
  const unknown = groupIds.filter((id) => !before.potential.includes(id) && !before.current.includes(id));
  const parts = [
    toAdd.length > 0 ? `added groups ${toAdd.join(", ")}` : "",
    toRemove.length > 0 ? `removed groups ${toRemove.join(", ")}` : "",
    unknown.length > 0 ? `left out ${unknown.join(", ")} (not groups of its course)` : "",
  ].filter(Boolean);
  return { changed: `Grouping ${groupingId}: ${parts.join("; ") || "nothing changed"}.`, groupIds: current };
}
