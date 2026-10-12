import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { EnrolmentError, enrolmentMethods, setEnrolmentMethod } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface SelfState {
  status: string;
  password: string;
  roleid: string;
  customint3: string;
  start?: Record<string, string>;
  end?: Record<string, string>;
  customint4: string;
  customtext1: string;
}

/** A row of the methods page (enrol/instances.php), reduced as Moodle 5.2 renders it: name, users, icons. */
function row(id: number, type: string, name: string, enabled: boolean, users: number, canSwitch = true): string {
  const icon = (action: string) => `<a href="${SITE}enrol/instances.php?sesskey=s1&amp;id=3&amp;action=${action}&amp;instance=${id}"><i class="icon"></i></a>`;
  const label = enabled ? name : `<span class="dimmed_text">${name}</span>`;
  // Delete, enable and disable only for whom may configure the method (an editing teacher can't, on manual enrolment).
  const config = canSwitch ? `${icon("delete")}${icon(enabled ? "disable" : "enable")}` : "";
  return `<tr><td class="cell c0">${label}</td><td class="cell c1">${users}</td><td>${icon("up")}</td><td>${config}<a href="${SITE}enrol/editinstance.php?courseid=3&amp;id=${id}&amp;type=${type}"><i class="icon"></i></a></td></tr>`;
}

/**
 * Manual enrolment's form as Moodle 5.2 renders it: with enrol/manual:config (an admin) its status,
 * default role and periods; without it (an editing teacher) only the welcome message.
 */
function manualForm(m: { status: string; roleid: string; customint1: string; customtext1: string }, config: boolean): string {
  const select = (name: string, options: string[], value: string) => `<select name="${name}">${options.map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  const settings = config ? `${select("status", ["0", "1"], m.status)}${select("roleid", ["4", "5"], m.roleid)}<input type="checkbox" name="enrolperiod[enabled]" value="1"><input type="text" name="enrolperiod[number]" value="0">${select("expirynotify", ["0", "1", "2"], "0")}` : "";
  return `<form class="mform" method="post" action="${SITE}enrol/instances.php?id=3"><input type="hidden" name="type" value="manual">${settings}${select("customint1", ["0", "1", "2", "3"], m.customint1)}<textarea name="customtext1">${m.customtext1}</textarea><input type="submit" name="submitbutton" value="Save changes"></form>`;
}

/** A date selector's parts, with its enable checkbox. */
function dateSelector(name: string, value?: Record<string, string>): string {
  const part = (p: string) => `<input type="text" name="${name}[${p}]" value="${value?.[p] ?? ""}">`;
  return `<input type="checkbox" name="${name}[enabled]" value="1"${value ? " checked" : ""}>${["day", "month", "year", "hour", "minute"].map(part).join("")}`;
}

/** Self enrolment's form (enrol/editinstance.php?type=self), the fields read and set; it posts back to the methods page. */
function selfForm(s: SelfState): string {
  const select = (name: string, options: string[], value: string) => `<select name="${name}">${options.map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  return `<form class="mform" method="post" action="${SITE}enrol/instances.php?id=3">${select("status", ["0", "1"], s.status)}<input type="text" name="password" value="${s.password}">
${select("roleid", ["4", "5"], s.roleid)}${dateSelector("enrolstartdate", s.start)}${dateSelector("enrolenddate", s.end)}<input type="text" name="customint3" value="${s.customint3}">
${select("customint4", ["0", "1", "2"], s.customint4)}<textarea name="customtext1">${s.customtext1}</textarea><input type="submit" name="submitbutton" value="Save changes"></form>`;
}

async function site({ withSelf = true, manualConfig = false } = {}) {
  const self: SelfState = { status: "1", password: "", roleid: "5", customint3: "0", customint4: "0", customtext1: "" };
  const manual = { status: "0", roleid: "5", customint1: "0", customtext1: "" };
  let selfId = withSelf ? 6 : 0;
  const posts: URLSearchParams[] = [];
  /** The enable and disable icons followed, as "action instance". */
  const switches: string[] = [];
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
  const html = (route: Route, body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body, bodyId }) });
  const methodsPage = () => {
    const rows = [row(4, "manual", "Manual enrolments", manual.status === "0", 5, manualConfig), ...(selfId ? [row(selfId, "self", "Self enrolment (Student)", self.status === "0", 0)] : [])];
    const add = selfId ? "" : `<option value="/enrol/editinstance.php?type=self&amp;courseid=3">Self enrolment</option>`;
    return `<table class="generaltable"><tbody>${rows.join("")}</tbody></table><form><select class="form-select urlselect" name="jump"><option value="">Choose...</option>${add}</select></form>`;
  };
  await context.route(`${SITE}enrol/instances.php**`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    const action = query.get("action");
    if ((action === "enable" || action === "disable") && query.get("sesskey") === "s1") {
      switches.push(`${action} ${query.get("instance")}`);
      const status = action === "enable" ? "0" : "1";
      if (query.get("instance") === "4") manual.status = status;
      else self.status = status;
    }
    if (route.request().method() === "POST") {
      const form = new URLSearchParams(route.request().postData() ?? "");
      posts.push(form);
      if (form.get("type") === "manual") {
        for (const key of ["status", "roleid", "customint1", "customtext1"] as const) manual[key] = form.get(key) ?? manual[key];
        return html(route, methodsPage(), "page-enrol-instances");
      }
      selfId ||= 7;
      for (const key of ["status", "password", "roleid", "customint3", "customint4", "customtext1"] as const) self[key] = form.get(key) ?? self[key];
      const date = (name: string) => (form.get(`${name}[enabled]`) ? Object.fromEntries(["day", "month", "year", "hour", "minute"].map((p) => [p, form.get(`${name}[${p}]`) ?? ""])) : undefined);
      self.start = date("enrolstartdate");
      self.end = date("enrolenddate");
    }
    return html(route, methodsPage(), "page-enrol-instances");
  });
  await context.route(`${SITE}enrol/editinstance.php**`, (route) => {
    const type = new URL(route.request().url()).searchParams.get("type");
    if (type === "manual") return html(route, manualForm(manual, manualConfig), "page-enrol-editinstance");
    return html(route, selfForm(self), "page-enrol-editinstance");
  });
  return { context, posts, switches, self, manual };
}

describe("enrolmentMethods", { skip: !browser && "no system browser" }, () => {
  it("lists each method from its row and its form: state, users, role, key, dates, limit", async () => {
    const { context, self } = await site();
    Object.assign(self, { status: "0", password: "secret", customint3: "20", end: { day: "30", month: "6", year: "2027", hour: "23", minute: "0" } });
    assert.deepEqual(await enrolmentMethods(context, SITE, 3), [
      { id: 4, type: "manual", name: "Manual enrolments", enabled: true, users: 5 },
      { id: 6, type: "self", name: "Self enrolment (Student)", enabled: true, users: 0, roleId: 5, hasKey: true, end: "2027-06-30T21:00:00.000Z", maxUsers: 20 },
    ]);
    await context.close();
  });

  it("throws EnrolmentError when the person can't manage the methods", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" } });
    // Moodle's error page for a person without the permission keeps no methods page body id.
    const error = moodlePage({ userId: 3, bodyId: "page-course-view", body: '<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that</p></div>' });
    await context.route(`${SITE}enrol/instances.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: error }));
    await assert.rejects(enrolmentMethods(context, SITE, 3), (e: Error) => e instanceof EnrolmentError && /permissions/.test(e.message));
    await context.close();
  });
});

describe("setEnrolmentMethod", { skip: !browser && "no system browser" }, () => {
  it("enables self enrolment with a key, a limit, an end and a welcome message, by type", async () => {
    const { context, posts, switches } = await site();
    const { method } = await setEnrolmentMethod(context, SITE, 3, { type: "self" }, { enabled: true, key: "k1", maxUsers: 10, end: new Date("2027-06-30T21:00:00Z"), welcome: "Hello" });
    const form = posts[0]!;
    // The form keeps its status; the method is enabled with its row's icon, after the key is set.
    assert.deepEqual([form.get("status"), form.get("password"), form.get("customint3"), form.get("enrolenddate[enabled]"), form.get("enrolenddate[hour]"), form.get("customint4"), form.get("customtext1")], ["1", "k1", "10", "1", "23", "1", "Hello"]);
    assert.deepEqual(switches, ["enable 6"]);
    assert.deepEqual(method, { id: 6, type: "self", name: "Self enrolment (Student)", enabled: true, users: 0, roleId: 5, hasKey: true, end: "2027-06-30T21:00:00.000Z", maxUsers: 10 });
    await context.close();
  });

  it("removes a key, a date and the welcome message, by id", async () => {
    const { context, posts, switches, self } = await site();
    Object.assign(self, { status: "0", password: "k1", customint4: "2", end: { day: "1", month: "1", year: "2027", hour: "0", minute: "0" } });
    const { method } = await setEnrolmentMethod(context, SITE, 3, 6, { enabled: false, key: "", end: null, welcome: false });
    assert.equal(posts[0]!.get("enrolenddate[enabled]"), null);
    assert.equal(posts[0]!.get("customint4"), "0");
    assert.deepEqual(switches, ["disable 6"]);
    assert.deepEqual([method.enabled, method.hasKey, method.end], [false, false, undefined]);
    await context.close();
  });

  it("switches a method with only its row's icon when only enabled is given", async () => {
    const { context, posts, switches } = await site();
    const { method } = await setEnrolmentMethod(context, SITE, 3, 6, { enabled: true });
    assert.equal(method.enabled, true);
    assert.deepEqual([posts.length, switches], [0, ["enable 6"]]);
    await context.close();
  });

  it("adds a method of a type the course lacks when the menu offers it, enabled by its form", async () => {
    const { context, posts, switches } = await site({ withSelf: false });
    const result = await setEnrolmentMethod(context, SITE, 3, { type: "self" }, { enabled: true });
    assert.equal(result.method.id, 7);
    assert.equal(result.method.enabled, true);
    assert.equal(posts[0]!.get("status"), "0");
    assert.deepEqual(switches, []);
    assert.match(result.changed, /added to course 3/);
    await context.close();
  });

  it("manual enrolment as an editing teacher: its state as it is, its welcome message, and what Moodle doesn't let them change refused", async () => {
    const { context, posts, switches } = await site();
    // Already enabled: nothing to do, though the teacher couldn't switch it.
    const same = await setEnrolmentMethod(context, SITE, 3, { type: "manual" }, { enabled: true });
    assert.equal(same.method.enabled, true);
    assert.match(same.changed, /enabled \(already on\)/);
    await assert.rejects(setEnrolmentMethod(context, SITE, 3, 4, { enabled: false }), (e: Error) => e instanceof EnrolmentError && /can't disable the manual enrolment method 4/.test(e.message) && /enrol\/manual:config/.test(e.message));
    await assert.rejects(setEnrolmentMethod(context, SITE, 3, 4, { roleId: 4, maxUsers: 3 }), (e: Error) => e instanceof EnrolmentError && /can't change roleId, maxUsers of the manual enrolment method 4/.test(e.message));
    assert.deepEqual([posts.length, switches], [0, []]);
    // Its form has the welcome message, under its own field name.
    await setEnrolmentMethod(context, SITE, 3, 4, { welcome: "Welcome" });
    assert.deepEqual([posts[0]!.get("customint1"), posts[0]!.get("customtext1")], ["1", "Welcome"]);
    await context.close();
  });

  it("manual enrolment as an admin: disabled and enabled with its icons, its role through its form", async () => {
    const { context, posts, switches } = await site({ manualConfig: true });
    const off = await setEnrolmentMethod(context, SITE, 3, { type: "manual" }, { enabled: false });
    assert.equal(off.method.enabled, false);
    const on = await setEnrolmentMethod(context, SITE, 3, 4, { enabled: true, roleId: 4 });
    assert.deepEqual([on.method.enabled, on.method.roleId], [true, 4]);
    assert.deepEqual(switches, ["disable 4", "enable 4"]);
    assert.equal(posts[0]!.get("roleid"), "4");
    await context.close();
  });

  it("refuses a method the course doesn't have and can't add", async () => {
    const { context } = await site();
    await assert.rejects(setEnrolmentMethod(context, SITE, 3, 99, { enabled: true }), EnrolmentError);
    await assert.rejects(setEnrolmentMethod(context, SITE, 3, { type: "guest" }, { enabled: true }), EnrolmentError);
    await context.close();
  });
});
