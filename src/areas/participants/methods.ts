// A course's enrolment methods (manual, self enrolment, guest access…), read and set on Moodle's pages:
// the methods page (`enrol/instances.php`) lists them, each method's form (`enrol/editinstance.php`)
// holds its settings, and its row's enable and disable icons switch it on and off. No service for them
// is open to AJAX (Moodle 5.2).
import type { BrowserContext, Page } from "playwright-core";
import { moodleErrorMessage, openSitePage } from "../../core/session.js";
import { inPage } from "../../core/inPage.js";
import { dateSelectorDate, dateSelectorValues, openForm, setFields, submitForm, type FieldValue } from "../../core/forms.js";
import { EnrolmentError } from "./enrolments.js";

/** One of a course's enrolment methods, as its methods page and its form show it. */
export interface EnrolmentMethod {
  id: number;
  /** The enrolment plugin: "manual", "self", "guest", "cohort"… */
  type: string;
  /** Its name on the methods page, in the site's language ("Self enrolment (Student)"). */
  name: string;
  enabled: boolean;
  /** Users enrolled by it. */
  users: number;
  /** The role it gives (manual: the default role; self: the role students get). */
  roleId?: number;
  /** Self enrolment and guest access: whether it asks for a key (the key itself isn't returned). */
  hasKey?: boolean;
  /** Self enrolment: when students may enrol from and until (ISO dates). */
  start?: string;
  end?: string;
  /** Self enrolment: the most users it enrols. */
  maxUsers?: number;
}

/** What `setEnrolmentMethod` may change; what isn't given stays. */
export interface EnrolmentMethodSettings {
  enabled?: boolean;
  /** Self enrolment and guest access: the key to ask for; "" removes it. */
  key?: string;
  /** Self enrolment: from when and until when students may enrol; `null` removes the limit. */
  start?: Date | null;
  end?: Date | null;
  /** The role it gives (manual and self enrolment). */
  roleId?: number;
  /** Self enrolment: the most users it enrols; 0 for no limit. */
  maxUsers?: number;
  /** Manual and self enrolment: the welcome message to send (from the course contact unless another sender is set); `false` sends none. */
  welcome?: string | false;
}

interface ListedMethod {
  id: number;
  type: string;
  name: string;
  enabled: boolean;
  users: number;
  /** The row's enable or disable icon, when the person may switch the method: its query on the methods page (`?sesskey=…&action=…&instance=…`). */
  toggle?: { action: "enable" | "disable"; query: string };
}

/** The methods page: each method's row, and the types the "Add method" menu offers. */
async function readMethodsPage(context: BrowserContext, siteUrl: string, courseId: number): Promise<{ methods: ListedMethod[]; addable: string[] }> {
  const page = await openSitePage(context, siteUrl, `enrol/instances.php?id=${courseId}`);
  try {
    if ((await page.locator("body#page-enrol-instances").count()) === 0) {
      throw new EnrolmentError(`You can't manage the enrolment methods of course ${courseId}: ${(await moodleErrorMessage(page)) ?? "it doesn't exist, or you aren't allowed."}`);
    }
    // Helpers inside: through inPage (see the conventions on page.evaluate).
    return await inPage(page, () => {
      interface El {
        textContent: string | null;
        value: string;
        getAttribute(name: string): string | null;
        querySelector(s: string): El | null;
        querySelectorAll(s: string): ArrayLike<El>;
      }
      const doc = (globalThis as unknown as { document: El }).document;
      const methods = Array.from(doc.querySelectorAll("table.generaltable tbody tr")).flatMap((row) => {
        const links = Array.from(row.querySelectorAll("a[href]")).map((a) => new URL(a.getAttribute("href") ?? "", "http://x/"));
        const edit = links.find((url) => url.pathname.endsWith("/enrol/editinstance.php"));
        const action = (name: string) => links.find((url) => url.searchParams.get("action") === name);
        const id = Number(edit?.searchParams.get("id") ?? links.find((url) => url.searchParams.get("instance"))?.searchParams.get("instance"));
        if (!id) return [];
        const cells = Array.from(row.querySelectorAll("td"));
        // The enable and disable icons say its state; without them (a plugin off on the site), its name is dimmed when off.
        const enabled = action("disable") ? true : action("enable") ? false : cells[0]?.querySelector(".dimmed_text") === null;
        // Moodle shows them only to whom may switch the method (its plugin's can_hide_show_instance).
        const switchUrl = action("disable") ?? action("enable");
        const toggle = switchUrl ? { toggle: { action: switchUrl.searchParams.get("action") as "enable" | "disable", query: switchUrl.search } } : {};
        return [{ id, type: edit?.searchParams.get("type") ?? "", name: (cells[0]?.textContent ?? "").replace(/\s+/g, " ").trim(), enabled, users: Number((cells[1]?.textContent ?? "").trim()) || 0, ...toggle }];
      });
      // "Add method": options lead to editinstance.php?type=…&courseid=….
      const addable = Array.from(doc.querySelectorAll("select.urlselect option"))
        .map((option) => new URL(option.value || "/", "http://x/"))
        .filter((url) => url.pathname.endsWith("/enrol/editinstance.php"))
        .map((url) => url.searchParams.get("type") ?? "");
      return { methods, addable };
    }, null);
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** A method's settings from its open form: the role, the key, self enrolment's dates and limit. */
async function readMethodForm(page: Page): Promise<Partial<EnrolmentMethod>> {
  const fields = await page.evaluate(() => {
    const doc = (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document;
    return {
      roleId: doc.querySelector('form.mform select[name="roleid"]')?.value,
      key: doc.querySelector('form.mform [name="password"]')?.value,
      maxUsers: doc.querySelector('form.mform [name="customint3"]')?.value,
      hasDates: doc.querySelector('form.mform [name="enrolstartdate[day]"]') !== null,
    };
  });
  const [start, end] = fields.hasDates ? await Promise.all([dateSelectorDate(page, "enrolstartdate"), dateSelectorDate(page, "enrolenddate")]) : [undefined, undefined];
  return {
    ...(fields.roleId ? { roleId: Number(fields.roleId) } : {}),
    ...(fields.key !== undefined ? { hasKey: fields.key !== "" } : {}),
    ...(start ? { start: start.toISOString() } : {}),
    ...(end ? { end: end.toISOString() } : {}),
    ...(Number(fields.maxUsers) > 0 ? { maxUsers: Number(fields.maxUsers) } : {}),
  };
}

/** A listed method with what its form adds, when the person may open it. */
async function withSettings(context: BrowserContext, siteUrl: string, courseId: number, listed: ListedMethod): Promise<EnrolmentMethod> {
  const method: EnrolmentMethod = { id: listed.id, type: listed.type, name: listed.name, enabled: listed.enabled, users: listed.users };
  if (!method.type) return method;
  let page: Page;
  try {
    page = await openForm(context, siteUrl, `enrol/editinstance.php?courseid=${courseId}&id=${method.id}&type=${method.type}`);
  } catch {
    // A method without a form of its own, or one the person can't edit: what the list says.
    return method;
  }
  try {
    return { ...method, ...(await readMethodForm(page)) };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/**
 * A course's enrolment methods, in the order Moodle tries them: each one's type, name, whether it's
 * enabled and how many users it enrolled, and from its form the role it gives and, for self enrolment
 * and guest access, whether it asks for a key (never the key), self enrolment's dates and limit.
 * Throws `EnrolmentError` when the person can't manage the course's enrolment methods.
 */
export async function enrolmentMethods(context: BrowserContext, siteUrl: string, courseId: number): Promise<EnrolmentMethod[]> {
  const { methods } = await readMethodsPage(context, siteUrl, courseId);
  const result: EnrolmentMethod[] = [];
  for (const method of methods) result.push(await withSettings(context, siteUrl, courseId, method));
  return result;
}

/** The select that turns a method's welcome message on: manual enrolment's form and self enrolment's name it differently (Moodle 5.2). */
const WELCOME_FIELD: Record<string, string> = { manual: "customint1", self: "customint4" };

/** The form field each setting is set through, to tell which ones the person's form lacks. */
function formFieldOf(setting: keyof EnrolmentMethodSettings, type: string): string {
  const fields: Record<keyof EnrolmentMethodSettings, string> = {
    enabled: "status",
    key: "password",
    roleId: "roleid",
    start: "enrolstartdate[enabled]",
    end: "enrolenddate[enabled]",
    maxUsers: "customint3",
    welcome: WELCOME_FIELD[type] ?? "customint4",
  };
  return fields[setting];
}

/**
 * Sets an enrolment method: by id, or the course's first method of a type (`{ type: "self" }`),
 * added when the course has none and the "Add method" menu offers it. Only what's given changes.
 * `enabled` goes through the methods page's enable and disable icons, the rest through the method's
 * form: what Moodle lets the person change differs by method (an editing teacher can't configure
 * manual enrolment, enrol/manual:config, so neither switch it nor set its role). Returns the method
 * afterwards. Throws `EnrolmentError` for a method the course doesn't have or can't add, and for a
 * setting Moodle doesn't let the person change (naming it); `FormError` with Moodle's reason when it
 * refuses the form (a key required by the site, an end before the start).
 */
export async function setEnrolmentMethod(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  method: number | { type: string },
  settings: EnrolmentMethodSettings,
): Promise<{ changed: string; method: EnrolmentMethod }> {
  const before = await readMethodsPage(context, siteUrl, courseId);
  const existing = typeof method === "number" ? before.methods.find((m) => m.id === method) : before.methods.find((m) => m.type === method.type);
  if (typeof method === "number" && !existing) throw new EnrolmentError(`Course ${courseId} has no enrolment method ${method}.`);
  const type = existing?.type ?? (method as { type: string }).type;
  if (!existing && !before.addable.includes(type)) {
    throw new EnrolmentError(`Course ${courseId} has no "${type}" enrolment method and you can't add one: the site doesn't enable it, the course may have only one, or you aren't allowed.`);
  }
  if (existing && !existing.type) throw new EnrolmentError(`Enrolment method ${existing.id} of course ${courseId} has no settings you can change.`);
  const given = (Object.keys(settings) as (keyof EnrolmentMethodSettings)[]).filter((key) => settings[key] !== undefined);
  if (existing && given.length === 0) throw new EnrolmentError("Nothing to change: give at least one setting.");

  // An existing method is switched with its row's icon, which Moodle shows only to whom may switch
  // it (confirmed empirically, 5.2: not to an editing teacher on manual enrolment); a new one takes
  // its state from the form. Checked before anything is saved.
  let toggle: ListedMethod["toggle"];
  if (existing && settings.enabled !== undefined && existing.enabled !== settings.enabled) {
    toggle = existing.toggle;
    if (toggle?.action !== (settings.enabled ? "enable" : "disable")) {
      throw new EnrolmentError(`You can't ${settings.enabled ? "enable" : "disable"} the ${type} enrolment method ${existing.id} of course ${courseId}: Moodle doesn't offer it to you (it takes the enrol/${type}:config capability, or the method is off on the site).`);
    }
  }
  const inForm = given.filter((key) => !(existing && key === "enabled"));

  if (inForm.length > 0 || !existing) {
    const page = await openForm(context, siteUrl, `enrol/editinstance.php?courseid=${courseId}&type=${type}${existing ? `&id=${existing.id}` : ""}`);
    try {
      // What the person's form lacks, Moodle doesn't let them change: refused before anything is saved.
      const present = await page.evaluate(
        (names) => names.map((name) => (globalThis as unknown as { document: { querySelector(s: string): unknown } }).document.querySelector(`form.mform [name="${name}"]`) !== null),
        inForm.map((key) => formFieldOf(key, type)),
      );
      const lacking = inForm.filter((_, i) => !present[i]);
      if (lacking.length > 0) {
        throw new EnrolmentError(
          `You can't change ${lacking.join(", ")} of the ${type} enrolment method${existing ? ` ${existing.id}` : ""} of course ${courseId}: Moodle's form for it doesn't offer ${lacking.length > 1 ? "them" : "it"} to you (most of a method's settings take the enrol/${type}:config capability).`,
        );
      }
      const values: Record<string, FieldValue> = {};
      if (inForm.includes("enabled")) values.status = settings.enabled ? "0" : "1"; // ENROL_INSTANCE_ENABLED, _DISABLED
      if (settings.key !== undefined) values.password = settings.key;
      if (settings.roleId !== undefined) values.roleid = String(settings.roleId);
      for (const [name, date] of [["enrolstartdate", settings.start], ["enrolenddate", settings.end]] as const) {
        if (date === undefined) continue;
        values[`${name}[enabled]`] = date !== null;
        if (date) Object.assign(values, await dateSelectorValues(page, name, date));
      }
      if (settings.maxUsers !== undefined) values.customint3 = String(settings.maxUsers);
      if (settings.welcome !== undefined) {
        const field = formFieldOf("welcome", type);
        const sending = await page.evaluate((name) => (globalThis as unknown as { document: { querySelector(s: string): { value: string } | null } }).document.querySelector(`form.mform select[name="${name}"]`)?.value, field);
        // 0 is "No" (ENROL_DO_NOT_SEND_EMAIL); 1 sends from the course contact.
        if (settings.welcome === false) values[field] = "0";
        else {
          if (!sending || sending === "0") values[field] = "1";
          values.customtext1 = settings.welcome;
        }
      }
      await setFields(page, values);
      await submitForm(page, "submitbutton");
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  if (toggle) {
    // The icon's link: a GET with the session key; Moodle switches the method and sends back to the list.
    const page = await openSitePage(context, siteUrl, `enrol/instances.php${toggle.query}`);
    await page.close().catch(() => undefined);
  }

  const after = await readMethodsPage(context, siteUrl, courseId);
  const listed = existing ? after.methods.find((m) => m.id === existing.id) : after.methods.find((m) => m.type === type && !before.methods.some((b) => b.id === m.id));
  if (!listed) throw new EnrolmentError(`Moodle didn't show the ${type} enrolment method of course ${courseId} after saving it.`);
  if (toggle && listed.enabled !== settings.enabled) {
    // Disabling the method the person is enrolled through asks for a confirmation the driver doesn't give.
    throw new EnrolmentError(`Moodle didn't ${toggle.action} the ${type} enrolment method ${listed.id} of course ${courseId}: it asks to confirm disabling the method you're enrolled through, or the method needs other settings first.`);
  }
  const result = await withSettings(context, siteUrl, courseId, listed);
  const what = given.map((key) => (key === "enabled" && existing && !toggle ? `enabled (already ${settings.enabled ? "on" : "off"})` : key)).join(", ");
  return { changed: existing ? `Enrolment method ${result.id} (${type}) of course ${courseId} updated: ${what}.` : `Enrolment method ${result.id} (${type}) added to course ${courseId}${what ? `: ${what}` : ""}.`, method: result };
}
