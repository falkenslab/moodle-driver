// A made-up Attendance activity (mod_attendance), as its pages render on Moodle 5.2 with the plugin's
// 2026042102 release: the sessions page (manage.php), the add, update and delete pages (sessions.php),
// the take page (take.php) and the report's summary view (report.php, view 7), keeping what is posted
// to them as the plugin keeps it.
import type { BrowserContext, Route } from "playwright-core";
import { dateSelectorParts } from "../../../src/core/forms.js";
import { zonedDate } from "../../../src/areas/attendance/sessions.js";
import { SITE, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const ZONE = "Europe/Madrid";

export interface FakeSession {
  id: number;
  /** Epoch seconds. */
  start: number;
  /** Seconds. */
  duration: number;
  groupId: number;
  description: string;
  taken: boolean;
}

export interface FakeAttendance {
  cmid: number;
  /** Who's looking: an editing teacher manages sessions, a teacher only takes attendance, a student neither. */
  role: "editing" | "teacher" | "student";
  /** 0 none, 1 separate groups, 2 visible groups. */
  groupMode: 0 | 1 | 2;
  groups: { id: number; name: string }[];
  statuses: { id: number; acronym: string; description: string; grade: number }[];
  users: { id: number; name: string; groupIds: number[]; suspended?: boolean }[];
  sessions: FakeSession[];
  logs: { sessionId: number; userId: number; statusId: number; remarks: string }[];
  /** Participants per take and report page. */
  perPage: number;
  /** Every POST received, by path. */
  posts: { path: string; form: URLSearchParams }[];
}

export function newAttendance(overrides: Partial<FakeAttendance> = {}): FakeAttendance {
  return {
    cmid: 40,
    role: "editing",
    groupMode: 0,
    groups: [],
    statuses: [
      { id: 13, acronym: "P", description: "Present", grade: 2 },
      { id: 14, acronym: "A", description: "Absent", grade: 0 },
      { id: 15, acronym: "L", description: "Late", grade: 1 },
      { id: 16, acronym: "E", description: "Excused", grade: 1 },
    ],
    users: [
      { id: 4, name: "Alumno Demo", groupIds: [] },
      { id: 5, name: "Lucía Martín", groupIds: [] },
    ],
    sessions: [],
    logs: [],
    perPage: 25,
    posts: [],
    ...overrides,
  };
}

const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function page(a: FakeAttendance, body: string, script: string): string {
  return moodlePage({ userId: 3, body, bodyId: `page-mod-attendance-${script}`, bodyClass: `path-mod-attendance cmid-${a.cmid}` });
}

/** Moodle's error page; a refusal before the plugin names its page (a missing capability or activity) is the site's, `page-site-index`. */
function fatal(a: FakeAttendance, message: string, code: string, script: string | undefined): string {
  const box = `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">${message}</p><p class="errorcode"><a href="https://docs.moodle.org/502/en/error/moodle/${code}">More information about this error</a></p></div>`;
  return script ? page(a, box, script) : moodlePage({ userId: 3, body: box, bodyId: "page-site-index" });
}

const NO_PERMISSION = (what: string) => `Sorry, but you do not currently have permissions to do that (${what}).`;

/** A session's wall time in the person's zone: the form's parts. */
function parts(seconds: number): { day: number; month: number; year: number; hour: number; minute: number } {
  const p = dateSelectorParts("d", new Date(seconds * 1000), ZONE);
  return { day: p["d[day]"]!, month: p["d[month]"]!, year: p["d[year]"]!, hour: p["d[hour]"]!, minute: p["d[minute]"]! };
}

function manage(a: FakeAttendance): string {
  const rows = [...a.sessions]
    .sort((x, y) => x.start - y.start)
    .map((s) => {
      const take = `${SITE}mod/attendance/take.php?id=${a.cmid}&amp;sessionid=${s.id}&amp;grouptype=${s.groupId}`;
      const p = parts(s.start);
      const date = `Day ${p.day}.${p.month}.${p.year}`;
      const dateCell = s.taken ? `<a href="${take}" title="Change attendance"><nobr>${date}</nobr></a>` : `<nobr>${date}</nobr>`;
      const group = s.groupId ? `Group: ${escape(a.groups.find((g) => g.id === s.groupId)?.name ?? "")}` : "All students";
      const actions = `<a href="${take}" title="Take attendance"><i class="icon fa fa-play"></i></a>${a.role === "editing" ? `<a href="${SITE}mod/attendance/sessions.php?id=${a.cmid}&amp;sessionid=${s.id}&amp;action=2"><i class="icon fa fa-pen"></i></a><a href="${SITE}mod/attendance/sessions.php?id=${a.cmid}&amp;sessionid=${s.id}&amp;action=3"><i class="icon fa fa-trash-can"></i></a>` : ""}`;
      const description = s.description === "" ? "No description" : s.description;
      return `<tr><td class="cell c0"><input class="attendancesesscheckbox" type="checkbox" value="${s.id}" name="sessid[]" /></td><td class="cell c1">${dateCell}</td><td class="cell c2"><nobr>${p.hour}:${String(p.minute).padStart(2, "0")}</nobr></td><td class="cell c3">${group}</td><td class="cell c4"><div class="text_to_html">${description}</div></td><td class="cell c5 lastcol">${actions}</td></tr>`;
    })
    .join("");
  return page(a, `<div class="attsessions_manage_table"><div class="generalbox attwidth"><form method="post" action="${SITE}mod/attendance/sessions.php?id=${a.cmid}"><table class="generaltable"><thead><tr><th></th><th>Date</th><th>Time</th><th>Type</th><th>Description</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></form></div></div>`, "manage");
}

function select(name: string, from: number, to: number, value: number): string {
  let options = "";
  for (let i = from; i <= to; i++) options += `<option value="${i}"${i === value ? " selected" : ""}>${i}</option>`;
  return `<select name="${name}" id="id_${name.replace(/\W+/g, "_")}">${options}</select>`;
}

function dateFields(name: string, seconds: number): string {
  const p = parts(seconds);
  return `${select(`${name}[day]`, 1, 31, p.day)}${select(`${name}[month]`, 1, 12, p.month)}${select(`${name}[year]`, 1900, 2050, p.year)}`;
}

function timeFields(s: { start: number; duration: number }): string {
  const from = parts(s.start);
  const to = parts(s.start + s.duration);
  return `${select("sestime[starthour]", 0, 23, from.hour)}${select("sestime[startminute]", 0, 59, from.minute)}${select("sestime[endhour]", 0, 23, to.hour)}${select("sestime[endminute]", 0, 59, to.minute)}`;
}

function addForm(a: FakeAttendance): string {
  const now = Math.floor(Date.UTC(2026, 10, 12, 0, 0) / 1000);
  let groups = "";
  if (a.groupMode === 1) groups += '<input type="hidden" name="sessiontype" value="1">';
  if (a.groupMode === 2) groups += '<input type="radio" name="sessiontype" value="0" checked><input type="radio" name="sessiontype" value="1">';
  if (a.groupMode === 0) groups += '<input type="hidden" name="sessiontype" value="0">';
  if (a.groupMode > 0 && a.groups.length > 0) groups += `<select name="groups[]" id="id_groups" multiple>${a.groups.map((g) => `<option value="${g.id}">${escape(g.name)}</option>`).join("")}</select>`;
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<input type="hidden" name="sdays[${d}]" value="0"><input type="checkbox" name="sdays[${d}]" value="1">`).join("");
  return page(
    a,
    `<form class="mform" id="mform1" method="post" action="${SITE}mod/attendance/sessions.php?id=${a.cmid}&amp;action=1"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_attendance_form_addsession" value="1">
${groups}${dateFields("sessiondate", now)}${timeFields({ start: now, duration: 0 })}
<textarea name="sdescription[text]" id="id_sdescription"></textarea>
<input type="hidden" name="addmultiply" value="0"><input type="checkbox" name="addmultiply" value="1">${days}${select("period", 1, 36, 1)}${dateFields("sessionenddate", now)}
<input type="submit" name="submitbutton" value="Add"><input type="submit" name="cancel" value="Cancel"></form>`,
    "sessions",
  );
}

function updateForm(a: FakeAttendance, s: FakeSession): string {
  return page(
    a,
    `<form class="mform" id="mform1" method="post" action="${SITE}mod/attendance/sessions.php?id=${a.cmid}&amp;sessionid=${s.id}&amp;action=2"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_attendance_form_updatesession" value="1">
${dateFields("sessiondate", s.start)}${timeFields(s)}<textarea name="sdescription[text]" id="id_sdescription">${escape(s.description)}</textarea>
<input type="submit" name="submitbutton" value="Save changes"><input type="submit" name="cancel" value="Cancel"></form>`,
    "sessions",
  );
}

/** The seconds a form's date and times are, as the plugin computes them (the date's midnight plus the times, in the person's zone). */
function formTimes(form: URLSearchParams, date = "sessiondate"): { start: number; duration: number; day: (offset: number) => number } {
  const n = (name: string) => Number(form.get(name) ?? 0);
  const midnight = (offsetDays: number) => zonedDate(n(`${date}[year]`), n(`${date}[month]`), n(`${date}[day]`) + offsetDays, 0, 0, ZONE).getTime() / 1000;
  const startMinutes = n("sestime[starthour]") * 60 + n("sestime[startminute]");
  const endMinutes = n("sestime[endhour]") * 60 + n("sestime[endminute]");
  return { start: midnight(0) + startMinutes * 60, duration: (endMinutes - startMinutes) * 60, day: midnight };
}

/** Keeps a posted add form as attendance_construct_sessions_data_for_add does; its errors as the form's validation gives them. */
function addSessions(a: FakeAttendance, form: URLSearchParams, nextId: () => number): string | undefined {
  const { start, duration } = formTimes(form);
  if (duration < 0) return "The session end time must be after the session start time";
  const type = form.get("sessiontype") ?? "0";
  const groups = form.getAll("groups[]").map(Number);
  if (type === "1" && groups.length === 0) return "No group selected";
  const description = form.get("sdescription[text]") ?? "";
  const starts: number[] = [];
  if (form.getAll("addmultiply").includes("1")) {
    const end = formTimes(form, "sessionenddate").day(1);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const period = Number(form.get("period") ?? 1);
    const first = new Date(start * 1000);
    // The week starts on Monday.
    const weekStart = start - ((first.getUTCDay() + 6) % 7) * 86_400;
    for (let at = start; at < end; at += 86_400) {
      const week = Math.floor((at - weekStart) / (7 * 86_400));
      const day = weekdays[new Date(at * 1000).getUTCDay()]!;
      if (week % period === 0 && form.getAll(`sdays[${day}]`).includes("1")) starts.push(at);
    }
  } else starts.push(start);
  for (const at of starts) {
    for (const groupId of type === "1" ? groups : [0]) a.sessions.push({ id: nextId(), start: at, duration, groupId, description, taken: false });
  }
  return undefined;
}

function takePage(a: FakeAttendance, s: FakeSession, pageNumber: number): string {
  const listed = a.users.filter((u) => s.groupId === 0 || u.groupIds.includes(s.groupId));
  const shown = listed.slice((pageNumber - 1) * a.perPage, pageNumber * a.perPage);
  const head = a.statuses.map((st) => `<th><a id="checkstatus${st.id}" title="Set status to «${st.description}»" href="#">${st.acronym}</a></th>`).join("");
  const rows = shown
    .map((u) => {
      const name = `<a href="${SITE}mod/attendance/view.php?id=${a.cmid}&amp;studentid=${u.id}">${escape(u.name)}</a>`;
      if (u.suspended) return `<tr class="userwithoutenrol"><td>${name}</td><td colspan="${a.statuses.length + 1}">Enrolment suspended</td></tr>`;
      const log = a.logs.find((l) => l.sessionId === s.id && l.userId === u.id);
      const radios = a.statuses.map((st) => `<td><input type="radio" name="user${u.id}" class="st${st.id}" value="${st.id}"${log?.statusId === st.id ? " checked" : ""} /></td>`).join("");
      return `<tr><td>${name}</td>${radios}<td><input type="text" name="remarks${u.id}" maxlength="255" value="${escape(log?.remarks ?? "")}" /></td></tr>`;
    })
    .join("");
  const next = pageNumber * a.perPage < listed.length ? `<a href="${SITE}mod/attendance/take.php?id=${a.cmid}&amp;sessionid=${s.id}&amp;grouptype=${s.groupId}&amp;page=${pageNumber + 1}&amp;perpage=${a.perPage}">→</a>` : "";
  const counts = a.statuses.map((st) => `${st.description} = ${a.logs.filter((l) => l.sessionId === s.id && l.statusId === st.id).length} <br/>`).join("");
  return page(
    a,
    `<div>${next}<form method="post" action="${SITE}mod/attendance/take.php" id="attendancetakeform"><table class="generaltable takelist"><thead><tr><th>Name</th>${head}<th>Remarks</th></tr></thead><tbody>${rows}</tbody></table><input type="hidden" name="sessionid" value="${s.id}" /><input type="hidden" name="grouptype" value="${s.groupId}" /><input type="hidden" name="id" value="${a.cmid}" /><input type="hidden" name="sesskey" value="s1" /><input type="hidden" name="page" value="${pageNumber}" /><input type="hidden" name="perpage" value="${a.perPage}" /><center><input type="submit" class="btn btn-primary" value="Save and show next page" /></center></form><br/>${counts}</div>`,
    "take",
  );
}

/** Keeps a posted take form as take_from_form_data does: a log for each participant with a status or remarks. */
function keepTaken(a: FakeAttendance, form: URLSearchParams): void {
  const sessionId = Number(form.get("sessionid"));
  for (const [key, remarks] of form.entries()) {
    const userId = /^remarks(\d+)$/.exec(key)?.[1];
    if (!userId) continue;
    const statusId = Number(form.get(`user${userId}`) ?? 0);
    if (!statusId && !remarks) continue;
    const existing = a.logs.find((l) => l.sessionId === sessionId && l.userId === Number(userId));
    if (existing) Object.assign(existing, { statusId, remarks });
    else a.logs.push({ sessionId, userId: Number(userId), statusId, remarks });
  }
  const session = a.sessions.find((s) => s.id === sessionId);
  if (session) session.taken = true;
}

/** The report's summary view, its numbers as Moodle formats them. */
function report(a: FakeAttendance, q: URLSearchParams): string {
  const groupId = Number(q.get("group") ?? 0);
  const listed = a.users.filter((u) => !groupId || u.groupIds.includes(groupId));
  const pageNumber = Number(q.get("page") ?? 1);
  const shown = listed.slice((pageNumber - 1) * a.perPage, pageNumber * a.perPage);
  const best = Math.max(...a.statuses.map((st) => st.grade));
  const percent = (points: number, max: number) => `${max ? ((points / max) * 100).toFixed(1) : "0.0"}%`;
  const head = `<tr><th class="header headcol">Users</th><th class="header"></th><th class="header contrast" colspan="${a.statuses.length}">Status set 1</th><th colspan="3">Over taken sessions</th><th class="contrast" colspan="3">Over all sessions</th><th colspan="2">Maximum possible</th></tr>
<tr><th class="header headcol"><a href="${SITE}mod/attendance/report.php?id=${a.cmid}&amp;sort=2">First name</a> / <a href="${SITE}mod/attendance/report.php?id=${a.cmid}&amp;sort=1">Last name</a></th><th class="header">Email address</th>${a.statuses.map((st) => `<th class="header contrast">${st.acronym}</th>`).join("")}<th class="header">Sessions</th><th class="header">Points</th><th class="header">Percentage</th><th class="header contrast">Sessions</th><th class="header contrast">Points</th><th class="header contrast">Percentage</th><th class="header">Points</th><th class="header">Percentage</th></tr>`;
  const rows = shown
    .map((u) => {
      const sessions = a.sessions.filter((s) => s.groupId === 0 || u.groupIds.includes(s.groupId));
      const logs = a.logs.filter((l) => l.userId === u.id && sessions.some((s) => s.id === l.sessionId && s.taken));
      const points = logs.reduce((sum, l) => sum + (a.statuses.find((st) => st.id === l.statusId)?.grade ?? 0), 0);
      const taken = logs.length;
      const remaining = sessions.length - taken;
      const counts = a.statuses.map((st) => `<td class="contrast">${logs.filter((l) => l.statusId === st.id).length}</td>`).join("");
      return `<tr><td class="left headcol"><input type="checkbox" name="user${u.id}" /><a href="${SITE}mod/attendance/view.php?id=${a.cmid}&amp;studentid=${u.id}">${escape(u.name)}</a></td><td>${u.id}@example.com</td>${counts}<td>${taken}</td><td>${points} / ${taken * best}</td><td>${percent(points, taken * best)}</td><td class="contrast">${sessions.length}</td><td class="contrast">${points} / ${sessions.length * best}</td><td class="contrast">${percent(points, sessions.length * best)}</td><td>${points + remaining * best} / ${sessions.length * best}</td><td>${percent(points + remaining * best, sessions.length * best)}</td></tr>`;
    })
    .join("");
  const next = pageNumber * a.perPage < listed.length ? `<a href="${SITE}mod/attendance/report.php?id=${a.cmid}&amp;view=7&amp;page=${pageNumber + 1}">→</a>` : "";
  return page(a, `${next}<div class="attendancereporttable"><table class="generaltable attwidth attreport"><tbody>${head}${rows}<tr><td class="headcol">Summary</td></tr></tbody></table></div>`, "report");
}

/** Serves the activity's pages at `SITE`; other course module ids are Moodle's invalidcoursemodule. */
export async function serveAttendance(context: BrowserContext, a: FakeAttendance): Promise<FakeMoodleState> {
  const state: FakeMoodleState = { user: { id: 3, fullName: "Teacher" }, pagesServed: [] };
  await serveFakeMoodle(context, state);
  let lastId = Math.max(100, ...a.sessions.map((s) => s.id));
  const nextId = () => ++lastId;
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body });
  await context.route(`${SITE}mod/attendance/*.php**`, (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const form = new URLSearchParams(request.postData() ?? "");
    const q = url.searchParams;
    const script = url.pathname.slice("/mod/attendance/".length, -".php".length);
    state.pagesServed?.push(`${url.pathname}${url.search}`);
    if (request.method() === "POST") a.posts.push({ path: url.pathname, form });
    const cmid = Number(q.get("id") ?? form.get("id") ?? 0);
    if (cmid !== a.cmid) return html(route, fatal(a, "Can't find data record in database.", "invalidrecordunknown", undefined));
    const session = (id: number) => a.sessions.find((s) => s.id === id);
    if (script === "manage") {
      // Moodle sends who can't take attendance to the activity's own page.
      if (a.role === "student") return html(route, page(a, "<p>Your attendance</p>", "view"));
      return html(route, manage(a));
    }
    if (script === "sessions") {
      if (a.role !== "editing") return html(route, fatal(a, NO_PERMISSION("Manage attendances"), "nopermissions", undefined));
      const action = Number(q.get("action") ?? form.get("action"));
      if (action === 1) {
        if (request.method() === "POST") {
          const error = addSessions(a, form, nextId);
          if (!error) return html(route, manage(a));
        }
        return html(route, addForm(a));
      }
      const s = session(Number(q.get("sessionid") ?? form.get("sessionid")));
      if (!s) return html(route, fatal(a, "Can't find data record in database.", "invalidrecordunknown", script));
      if (action === 2) {
        if (request.method() === "POST") {
          const { start, duration } = formTimes(form);
          Object.assign(s, { start, duration, description: form.get("sdescription[text]") ?? "" });
          return html(route, manage(a));
        }
        return html(route, updateForm(a, s));
      }
      if (action === 3) {
        if (request.method() === "POST" && form.get("confirm") === "1" && form.get("sesskey") === "s1") {
          a.sessions = a.sessions.filter((other) => other.id !== s.id);
          a.logs = a.logs.filter((l) => l.sessionId !== s.id);
          return html(route, manage(a));
        }
        return html(route, page(a, `<div class="modal-body"><p>Are you absolutely sure you want to completely delete the Session, including all user data?</p></div><div class="modal-footer"><form method="get" action="${SITE}mod/attendance/manage.php"><input type="hidden" name="id" value="${a.cmid}"><button type="submit">Cancel</button></form><form method="post" action="${SITE}mod/attendance/sessions.php"><input type="hidden" name="id" value="${a.cmid}"><input type="hidden" name="action" value="3"><input type="hidden" name="sessionid" value="${s.id}"><input type="hidden" name="confirm" value="1"><input type="hidden" name="sesskey" value="s1"><button type="submit" class="btn btn-primary">Continue</button></form></div>`, script));
      }
    }
    if (script === "take") {
      if (a.role === "student") return html(route, fatal(a, NO_PERMISSION("Taking Attendances"), "nopermissions", undefined));
      if (request.method() === "POST") {
        keepTaken(a, form);
        return html(route, manage(a));
      }
      const s = session(Number(q.get("sessionid")));
      if (!s) return html(route, fatal(a, "Can't find data record in database table attendance_sessions.", "invalidrecordunknown", undefined));
      return html(route, takePage(a, s, Number(q.get("page") ?? 1)));
    }
    if (script === "report") {
      if (a.role === "student") return html(route, fatal(a, NO_PERMISSION("Viewing Reports"), "nopermissions", undefined));
      return html(route, report(a, q));
    }
    return html(route, page(a, "", script));
  });
  return state;
}
