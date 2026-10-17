// Groups made several at once, as a teacher does with Moodle's "Auto-create groups" form
// (`group/autogroup.php`, its Preview button showing them first) and "Import groups" (`group/import.php`,
// a CSV of groups). Neither has a service: the forms are filled and posted as the person would.
import path from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { MoodleError } from "../../core/errors.js";
import { checkLocalFiles } from "../../core/files.js";
import { FormError, formValue, openForm, setFields, submitForm, uploadToDraft, type FieldValue } from "../../core/forms.js";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { groupings, readAssignPage } from "./groups.js";
import { participantFilters } from "./participants.js";

const MANAGE = "it takes Moodle's capability moodle/course:managegroups, which editing teachers have";

/** How `autoCreateGroups` splits the participants, as the auto-create form asks. */
export interface AutoCreateGroupsOptions {
  /** `"groups"`: `count` groups; `"members"`: groups of `count` members each. */
  by: "groups" | "members";
  count: number;
  /** The groups' names: `#` is replaced by their number (1, 2…), `@` by a letter (A, B…); exactly one of them, unless a single group is made. */
  naming: string;
  /** How members go into groups (Moodle's default: `"random"`); `"none"` makes the groups empty. */
  allocation?: "random" | "firstname" | "lastname" | "idnumber" | "none";
  /** Only participants with this role (its id); 0 for every role. Moodle's default: the student role. */
  roleId?: number;
  /** Only members of this cohort (one with members enrolled in the course). */
  cohortId?: number;
  /** Only members of this grouping's groups. */
  fromGroupingId?: number;
  /** Only members of this group. */
  fromGroupId?: number;
  /** Only participants in no group yet (not with `fromGroupingId` or `fromGroupId`). */
  notInGroup?: boolean;
  /** With `by: "members"`, spreads the members of a last group that would be too small over the others instead. */
  noSmallGroups?: boolean;
  /** Puts the new groups in this existing grouping. */
  groupingId?: number;
  /** Puts the new groups in a new grouping of this name. */
  newGrouping?: string;
  /** Only shows the groups Moodle would make, creating nothing. */
  preview?: boolean;
  /** The random allocation's seed: a preview's `seed` given back makes the same groups. */
  seed?: number;
}

/** A group as the auto-create preview shows it. */
export interface PreviewedGroup {
  name: string;
  /** The members' full names, as Moodle lists them. */
  members: string[];
  /** A group of that name is already in the course: Moodle would create none of them. */
  nameTaken: boolean;
}

/** What `autoCreateGroups` with `preview` returns: the groups Moodle would make, nothing written. */
export interface AutoGroupsPreview {
  changed: string;
  groups: PreviewedGroup[];
  /** Give it back as `seed` to create these same groups. */
  seed: number;
}

/** What `autoCreateGroups` returns once it created the groups. */
export interface AutoGroupsCreated {
  changed: string;
  groups: { id: number; name: string; members: number[] }[];
  /** The grouping they went into, when one was asked for. */
  groupingId?: number;
  seed: number;
}

/** A naming scheme's name for the group at `index` (from 0), as Moodle's `groups_parse_name` makes it: `@` letters run A…Z, AA… */
export function groupName(scheme: string, index: number): string {
  if (scheme.includes("@")) {
    let letters = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
    return scheme.replace("@", letters);
  }
  return scheme.replace("#", String(index + 1));
}

/** Opens one of the group pages' forms; a person who can't manage the course's groups gets Moodle's refusal. */
async function openGroupForm(context: BrowserContext, siteUrl: string, pathAndQuery: string, what: string): Promise<Page> {
  try {
    return await openForm(context, siteUrl, pathAndQuery);
  } catch (error) {
    if (!(error instanceof FormError)) throw error;
    const page = await openSitePage(context, siteUrl, pathAndQuery);
    try {
      throw new MoodleError(`You can't ${what}: ${(await moodleErrorMessage(page)) ?? "the course doesn't exist, or you aren't allowed."} (${MANAGE}).`, "not-available");
    } finally {
      await page.close().catch(() => undefined);
    }
  }
}

/** The texts of a page's notifications, without their close button's hidden label. */
function alerts(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    interface El {
      textContent: string | null;
      cloneNode(deep: boolean): El;
      querySelectorAll(s: string): ArrayLike<{ remove(): void }>;
    }
    const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<El> } }).document;
    return Array.from(doc.querySelectorAll(selector)).map((alert) => {
      const copy = alert.cloneNode(true);
      for (const button of Array.from(copy.querySelectorAll("button"))) button.remove();
      return (copy.textContent ?? "").replace(/\s+/g, " ").trim();
    });
  }, selector);
}

/** The members cell of a preview row: full names joined by ", ", each followed by the identity fields Moodle shows the person (an email…), which are dropped. */
export function previewMembers(text: string, count: number): string[] {
  if (count === 0 || text.trim() === "") return [];
  const parts = text.split(/,\s+(?![^()]*\))/).map((part) => part.trim());
  // A site that writes names "Last, First" puts commas in every name: the same number in each.
  const per = parts.length % count === 0 ? parts.length / count : 1;
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += per) names.push(parts.slice(i, i + per).join(", "));
  return names.map((name) => name.replace(/\s*\([^()]*\)$/, ""));
}

/**
 * Splits a course's participants into groups at once, as Moodle's "Auto-create groups" does: `count`
 * groups, or groups of `count` members, named by `naming`, filled at random or in name or ID number
 * order (or left empty), from a role, a cohort, a grouping or a group, optionally into an existing or
 * new grouping. With `preview` it returns the groups and members Moodle would make and writes
 * nothing (members by full name, as the preview lists them); a random allocation is the same when
 * the preview's `seed` is given back (confirmed empirically, Moodle 5.2). Otherwise it returns the groups created with their ids and
 * members' user ids, and the grouping's id. Throws `MoodleError` (`not-available`) when the person
 * can't manage the course's groups (moodle/course:managegroups), `invalid-input` for a role, cohort,
 * grouping or group the form doesn't offer, and `FormError` with Moodle's reason when it refuses:
 * no one to allocate, more groups than people, a naming scheme without one `#` or `@`, a group or
 * grouping name already in the course.
 */
export function autoCreateGroups(context: BrowserContext, siteUrl: string, courseId: number, options: AutoCreateGroupsOptions & { preview: true }): Promise<AutoGroupsPreview>;
export function autoCreateGroups(context: BrowserContext, siteUrl: string, courseId: number, options: AutoCreateGroupsOptions & { preview?: false }): Promise<AutoGroupsCreated>;
export function autoCreateGroups(context: BrowserContext, siteUrl: string, courseId: number, options: AutoCreateGroupsOptions): Promise<AutoGroupsPreview | AutoGroupsCreated>;
export async function autoCreateGroups(context: BrowserContext, siteUrl: string, courseId: number, options: AutoCreateGroupsOptions): Promise<AutoGroupsPreview | AutoGroupsCreated> {
  const { by, count, naming, allocation = "random", preview = false } = options;
  if (by !== "groups" && by !== "members") throw new MoodleError(`by is "groups" or "members", not "${String(by)}".`, "invalid-input");
  if (!Number.isInteger(count) || count < 1) throw new MoodleError(`count is a whole number from 1: ${count}.`, "invalid-input");
  if (!naming?.trim()) throw new MoodleError("Give a naming scheme for the groups, with # or @ for their number or letter.", "invalid-input");
  if (options.groupingId !== undefined && options.newGrouping !== undefined) throw new MoodleError("Give either groupingId or newGrouping, not both.", "invalid-input");
  if (options.newGrouping !== undefined && !options.newGrouping.trim()) throw new MoodleError("Give the new grouping a name.", "invalid-input");
  const allocateby = allocation === "none" ? "no" : allocation;
  if (!["no", "random", "firstname", "lastname", "idnumber"].includes(allocateby)) throw new MoodleError(`allocation is "random", "firstname", "lastname", "idnumber" or "none", not "${allocation}".`, "invalid-input");

  const before = preview ? [] : (await participantFilters(context, siteUrl, courseId)).groups.map((g) => g.id);
  const page = await openGroupForm(context, siteUrl, `group/autogroup.php?courseid=${courseId}`, `create groups in course ${courseId}`);
  let seed: number;
  try {
    // The form's selects and their options: an id it doesn't offer would be sent as nothing.
    const offered = await page.evaluate(() => {
      const doc = (globalThis as unknown as { document: { querySelectorAll(s: string): ArrayLike<{ name: string; options: ArrayLike<{ value: string }> }> } }).document;
      return Object.fromEntries(Array.from(doc.querySelectorAll("form.mform select")).map((select) => [select.name, Array.from(select.options).map((o) => o.value)]));
    });
    const choose = (field: string, value: number | undefined, option: string, what: string): Record<string, FieldValue> => {
      if (value === undefined) return {};
      if (!offered[field]?.includes(String(value))) throw new MoodleError(`${option} ${value} isn't ${what} course ${courseId}'s auto-create form offers.`, "invalid-input");
      return { [field]: String(value) };
    };
    const fields: Record<string, FieldValue> = {
      namingscheme: naming,
      groupby: by,
      number: String(count),
      ...choose("roleid", options.roleId, "roleId", "a role"),
      ...choose("cohortid", options.cohortId, "cohortId", "a cohort"),
      ...choose("groupingid", options.fromGroupingId, "fromGroupingId", "a grouping"),
      ...choose("groupid", options.fromGroupId, "fromGroupId", "a group"),
      allocateby,
      ...(options.noSmallGroups !== undefined && by === "members" ? { nosmallgroups: options.noSmallGroups } : {}),
      ...(options.notInGroup !== undefined ? { notingroup: options.notInGroup } : {}),
      ...choose("grouping", options.groupingId, "groupingId", "a grouping"),
      ...(options.newGrouping !== undefined ? { grouping: "-1", groupingname: options.newGrouping.trim() } : {}),
      // Without a grouping asked for, none (Moodle's default is a new one once the course has groupings).
      ...(options.groupingId === undefined && options.newGrouping === undefined && offered["grouping"] ? { grouping: "0" } : {}),
      ...(options.seed !== undefined ? { seed: String(options.seed) } : {}),
    };
    await setFields(page, fields);
    seed = Number(await formValue(page, "seed"));
    await submitForm(page, preview ? "preview" : "submitbutton");

    if (preview) {
      const rows = await page.evaluate(() => {
        interface El {
          textContent: string | null;
          querySelector(s: string): El | null;
          querySelectorAll(s: string): ArrayLike<El>;
        }
        const doc = (globalThis as unknown as { document: El }).document;
        return Array.from(doc.querySelectorAll("#region-main table.generaltable tbody tr")).map((row) => {
          const cells = Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim());
          return { taken: row.querySelector("td .notifyproblem") !== null, name: cells[0] ?? "", members: cells[1] ?? "", count: Number(cells[2] ?? 0) };
        });
      });
      const groups = rows.map((row, i): PreviewedGroup => ({ name: row.taken ? groupName(naming.trim(), i) : row.name, members: previewMembers(row.members, row.count), nameTaken: row.taken }));
      const taken = groups.filter((g) => g.nameTaken).map((g) => `"${g.name}"`);
      const people = groups.reduce((sum, g) => sum + g.members.length, 0);
      return {
        changed: `Nothing created (a preview): ${groups.length} groups${allocateby === "no" ? "" : ` of ${people} participants`} in course ${courseId}${taken.length > 0 ? `; ${taken.join(", ")} already in the course, so Moodle would create none` : ""}.`,
        groups,
        seed,
      };
    }
    // Moodle goes back to the groups page; it stays on the form with its message when a name was taken.
    if ((await page.locator("body#page-group-autogroup").count()) > 0) {
      const [alert] = await alerts(page, "#region-main .alert-danger");
      throw new FormError("Moodle created no groups:", [{ field: "namingscheme", message: alert ?? "it refused the form" }]);
    }
  } finally {
    await page.close().catch(() => undefined);
  }

  const created = (await participantFilters(context, siteUrl, courseId)).groups.filter((g) => !before.includes(g.id));
  const groups: AutoGroupsCreated["groups"] = [];
  for (const group of created) {
    const { current } = await readAssignPage(context, siteUrl, `group/members.php?group=${group.id}`, `the members of group ${group.id}`);
    groups.push({ ...group, members: current });
  }
  let groupingId = options.groupingId;
  if (options.newGrouping !== undefined) {
    const name = options.newGrouping.trim();
    groupingId = (await groupings(context, siteUrl, courseId)).find((g) => g.name === name)?.id;
  }
  const people = groups.reduce((sum, g) => sum + g.members.length, 0);
  return {
    changed: `${groups.length} groups created in course ${courseId} (${groups.map((g) => `${g.id} "${g.name}"`).join(", ")}) with ${people} members${groupingId !== undefined ? `, in grouping ${groupingId}` : ""}.`,
    groups,
    ...(groupingId !== undefined ? { groupingId } : {}),
    seed,
  };
}

/** What `importGroups` did: the course's new groups, and what Moodle said about the rows it didn't take. */
export interface GroupsImport {
  changed: string;
  groups: { id: number; name: string }[];
  /** Moodle's messages for the rows with a problem: skipped (a name already in the course, a course not found…) or created without what was wrong (an ID number another group has). */
  problems: string[];
}

/**
 * Creates groups from a CSV file, as Moodle's "Import groups" does: a `groupname` column, and
 * optionally `description`, `enrolmentkey`, `groupidnumber`, `groupingname` (made when missing),
 * `enablemessaging`, `coursename` or `idnumber` (another course's short name or ID number). Moodle
 * creates groups only, without members. Returns the groups new in this course, and Moodle's
 * messages for the rows with a problem (skipped, or created without their ID number). Throws `MoodleError` (`not-available`) when the person can't
 * manage the course's groups (moodle/course:managegroups), and `invalid-input` with Moodle's reason
 * when it can't read the file (an unknown column, no `groupname`, no rows).
 */
export async function importGroups(context: BrowserContext, siteUrl: string, courseId: number, file: string, { delimiter = "comma" }: { delimiter?: "comma" | "semicolon" | "colon" | "tab" } = {}): Promise<GroupsImport> {
  await checkLocalFiles([file]);
  const before = (await participantFilters(context, siteUrl, courseId)).groups.map((g) => g.id);
  const page = await openGroupForm(context, siteUrl, `group/import.php?id=${courseId}`, `import groups into course ${courseId}`);
  let problems: string[];
  try {
    const draft = await formValue(page, "userfile");
    if (!draft) throw new MoodleError(`Course ${courseId}'s import form has no file to choose.`, "unexpected-page");
    await uploadToDraft(page, draft, [file]);
    await setFields(page, { delimiter_name: delimiter });
    await submitForm(page, "submitbutton");
    const refusal = await moodleErrorMessage(page);
    if (refusal) throw new MoodleError(`Moodle couldn't import ${path.basename(file)} into course ${courseId}: ${refusal}`, "invalid-input");
    // One notification per row: a success, or why the row was skipped.
    problems = await alerts(page, "#region-main .alert:not(.alert-success)");
  } finally {
    await page.close().catch(() => undefined);
  }
  const groups = (await participantFilters(context, siteUrl, courseId)).groups.filter((g) => !before.includes(g.id));
  return {
    changed: `${groups.length} groups imported into course ${courseId}${groups.length > 0 ? ` (${groups.map((g) => `${g.id} "${g.name}"`).join(", ")})` : ""}${problems.length > 0 ? `; ${problems.length} rows with a problem` : ""}.`,
    groups,
    problems,
  };
}
