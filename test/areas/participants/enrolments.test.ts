import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { EnrolmentError, NoParticipantsError, enrolUsers, potentialUsers, setUserRoles, unenrolUser } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// The participants page of course 3 as Moodle 5.2 renders its "Enrol users" button (the manual enrolment, id 4).
const ENROL_BUTTON = `<form method="get" action="http://moodle.test/enrol/manual/manage.php" id="enrolusersbutton-1"><div><input type="submit" value="Enrol users"><input type="hidden" name="enrolid" value="4"><input type="hidden" name="id" value="3"></div></form>`;

// The "Enrol users" form fragment (enrol_manual / enrol_users_form), reduced to the fields read.
const FRAGMENT = `<form class="mform"><input name="enrolid" type="hidden" value="4">
<select name="roletoassign"><option value="4">Non-editing teacher</option><option value="5" selected>Student</option></select>
<input type="checkbox" name="recovergrades" value="1">
<select name="startdate"><option value="3">Today</option><option value="4" selected>Now</option><option value="5">Choose...</option></select>
<select name="duration"><option value="" selected>Unlimited</option><option value="86400">1 days</option></select></form>`;

/** A participants table row with one enrolment block per method, with an unenrol link (ue id) when the person may remove it. */
function row(userId: number, enrolments: { method: string; ue?: number }[]): string {
  const blocks = enrolments
    .map((e) => `<div data-fullname="X" data-enrolinstancename="${e.method}" data-status="Active"><span class="badge">Active</span>${e.ue ? `<a href="${SITE}enrol/unenroluser.php?id=3&amp;ue=${e.ue}" class="unenrollink" rel="${e.ue}" data-action="unenrol"><i class="icon fa fa-trash-can"></i></a>` : ""}</div>`)
    .join("");
  return `<tr id="user-index-participants-3_r0"><th scope="row"><a href="${SITE}user/view.php?id=${userId}&amp;course=3"><span class="userinitials">XX</span>Someone</a></th><td>${blocks}</td></tr>`;
}

function fakeCourse(): FakeMoodleState & { enrolQueries: URLSearchParams[] } {
  return {
    user: { id: 3, fullName: "Teacher Uno" },
    serviceCalls: [],
    enrolQueries: [],
    services: {
      core_enrol_get_potential_users: () => [{ id: 9, fullname: "Nuevo Alumno", email: "nuevo@example.com", profileimageurl: "x" }, { id: 10, fullname: "Sin Correo" }],
      core_get_fragment: () => ({ html: FRAGMENT, javascript: "" }),
      core_table_get_dynamic_table_content: () => ({ html: `<table><tbody>${row(9, [{ method: "Manual enrolments", ue: 21 }, { method: "Cohort sync" }])}<tr class="emptyrow"><td></td></tr></tbody></table>` }),
      core_enrol_unenrol_user_enrolment: () => ({ result: true, errors: [] }),
      core_update_inplace_editable: (args) => {
        const roles = JSON.parse(String(args.value)) as string[];
        if (roles.includes("3")) throw new ServiceFailure("codingerror");
        return { value: JSON.stringify(roles), displayvalue: "Student" };
      },
    },
  };
}

async function open(state: ReturnType<typeof fakeCourse>, body = ENROL_BUTTON, bodyId = "page-course-view-participants"): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  await context.route(`${SITE}user/index.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, heading: "Participants", bodyId, body, contextId: 30 }) }));
  // enrol/manual/ajax.php: the dialog's submission, a GET with the form's fields; it refuses role 3 as Moodle does.
  await context.route(`${SITE}enrol/manual/ajax.php**`, (route) => {
    const query = new URL(route.request().url()).searchParams;
    state.enrolQueries.push(query);
    const answer = query.get("roletoassign") === "3" ? { error: "Invalid role", errorcode: "invalidrole" } : { success: true, response: {}, error: "", count: query.getAll("userlist[]").length };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
  });
  return context;
}

describe("potentialUsers", { skip: !browser && "no system browser" }, () => {
  it("asks for the course's manual enrolment and returns user id, name and email when shown", async () => {
    const state = fakeCourse();
    const context = await open(state);
    assert.deepEqual(await potentialUsers(context, SITE, 3, "nue"), [
      { userId: 9, fullName: "Nuevo Alumno", email: "nuevo@example.com" },
      { userId: 10, fullName: "Sin Correo" },
    ]);
    const call = state.serviceCalls!.find((c) => c.methodname === "core_enrol_get_potential_users");
    assert.deepEqual(call?.args, { courseid: 3, enrolid: 4, search: "nue", searchanywhere: true, page: 0, perpage: 100 });
    await context.close();
  });

  it("refuses a course without manual enrolment, and one whose participants the person can't see", async () => {
    let context = await open(fakeCourse(), "");
    await assert.rejects(potentialUsers(context, SITE, 3), EnrolmentError);
    await context.close();
    context = await open(fakeCourse(), "", "page-user-index");
    await assert.rejects(potentialUsers(context, SITE, 3), NoParticipantsError);
    await context.close();
  });
});

describe("enrolUsers", { skip: !browser && "no system browser" }, () => {
  it("enrols with the form's default role and duration, as the dialog sends them", async () => {
    const state = fakeCourse();
    const context = await open(state);
    assert.deepEqual(await enrolUsers(context, SITE, 3, [9, 10]), { changed: "2 user(s) enrolled in course 3 with role 5.", count: 2, roleId: 5 });
    const query = state.enrolQueries[0]!;
    assert.deepEqual(
      { id: query.get("id"), action: query.get("action"), enrolid: query.get("enrolid"), sesskey: query.get("sesskey"), users: query.getAll("userlist[]"), role: query.get("roletoassign"), start: query.get("startdate"), recover: query.get("recovergrades") },
      { id: "3", action: "enrol", enrolid: "4", sesskey: "s1", users: ["9", "10"], role: "5", start: "4", recover: null },
    );
    await context.close();
  });

  it("sends a chosen role and dates in the person's time zone", async () => {
    const state = fakeCourse();
    const context = await open(state);
    // 1 March 2027, 09:30 UTC is 10:30 in Madrid (the fake's M.cfg.usertimezone).
    await enrolUsers(context, SITE, 3, [9], { roleId: 4, start: new Date("2027-03-01T09:30:00Z"), end: new Date("2027-06-30T21:00:00Z") });
    const query = state.enrolQueries[0]!;
    assert.equal(query.get("roletoassign"), "4");
    assert.equal(query.get("startdate"), "5");
    assert.deepEqual(["day", "month", "year", "hour", "minute"].map((p) => query.get(`startdateselect[${p}]`)), ["1", "3", "2027", "10", "30"]);
    assert.equal(query.get("timeend[enabled]"), "1");
    assert.deepEqual(["day", "month", "year", "hour", "minute"].map((p) => query.get(`timeend[${p}]`)), ["30", "6", "2027", "23", "0"]);
    await context.close();
  });

  it("throws EnrolmentError with Moodle's reason for a role the person can't assign", async () => {
    const context = await open(fakeCourse());
    await assert.rejects(enrolUsers(context, SITE, 3, [9], { roleId: 3 }), (error: Error) => error instanceof EnrolmentError && /Invalid role/.test(error.message));
    await context.close();
  });
});

describe("unenrolUser", { skip: !browser && "no system browser" }, () => {
  it("removes the enrolments the person may remove and names those kept", async () => {
    const state = fakeCourse();
    const context = await open(state);
    const result = await unenrolUser(context, SITE, 3, 9);
    assert.deepEqual(result.removed, ["Manual enrolments"]);
    assert.deepEqual(result.kept, ["Cohort sync"]);
    assert.deepEqual(state.serviceCalls!.filter((c) => c.methodname === "core_enrol_unenrol_user_enrolment").map((c) => c.args), [{ ueid: 21 }]);
    await context.close();
  });

  it("throws EnrolmentError for a user who isn't enrolled", async () => {
    const context = await open(fakeCourse());
    await assert.rejects(unenrolUser(context, SITE, 3, 77), EnrolmentError);
    await context.close();
  });
});

describe("setUserRoles", { skip: !browser && "no system browser" }, () => {
  it("sets the roles through the roles column's inplace editable and returns them", async () => {
    const state = fakeCourse();
    const context = await open(state);
    assert.deepEqual(await setUserRoles(context, SITE, 3, 9, [5, 4]), { changed: "User 9's roles in course 3 are now: 5, 4.", roleIds: [5, 4] });
    const call = state.serviceCalls!.find((c) => c.methodname === "core_update_inplace_editable");
    assert.deepEqual(call?.args, { component: "core_user", itemtype: "user_roles", itemid: "3:9", value: '["5","4"]' });
    await assert.rejects(setUserRoles(context, SITE, 3, 9, [3]), EnrolmentError);
    await context.close();
  });
});
