import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { NoParticipantsError, groups, participants } from "../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

// A made-up course 3: a teacher, two students, one group; Ana hasn't opened the course lately.
const PEOPLE = [
  { id: 3, name: "Teacher Uno", roles: [3], groups: [] as number[], lastAccess: 1_800_000_000 },
  { id: 4, name: "Ana Student", roles: [5], groups: [1], lastAccess: 1_700_000_000 },
  { id: 5, name: "Bruno Student", roles: [5], groups: [], lastAccess: 1_800_000_000 },
];

/** A participants table fragment as Moodle 5.2 renders it, reduced, padded with empty rows. */
function table(rows: typeof PEOPLE): string {
  const tr = (p: (typeof PEOPLE)[number]) =>
    `<tr><td><input id="user${p.id}" type="checkbox" class="usercheckbox"><label class="accesshide">Select</label></td>
<th scope="row"><a href="${SITE}user/view.php?id=${p.id}&amp;course=3"><span class="userinitials">XX</span>${p.name}</a></th><td>Some role</td><td>No groups</td></tr>`;
  return `<div data-table-total-rows="${rows.length}"><table><tbody>${rows.map(tr).join("")}<tr class="emptyrow"><td></td></tr></tbody></table></div>`;
}

type Filter = { name: string; values: number[] };

function fakeCourse(): FakeMoodleState {
  return {
    user: { id: 3, fullName: "Teacher Uno" },
    serviceCalls: [],
    services: {
      core_table_get_dynamic_table_content: (args) => {
        const filters = args.filters as Filter[];
        const value = (name: string) => filters.find((f) => f.name === name)?.values[0];
        const rows = PEOPLE.filter((p) => {
          const role = value("roles");
          const group = value("groups");
          const since = value("accesssince");
          return (role === undefined || p.roles.includes(role)) && (group === undefined || p.groups.includes(group)) && (since === undefined || p.lastAccess < since);
        });
        return { html: table(rows), warnings: [] };
      },
    },
  };
}

const FILTERS = `<select data-field-name="roles"><option value="-1">No roles</option><option value="3">Teacher</option><option value="5">Student</option></select>
<select data-field-name="groups"><option value="-1">No group</option><option value="1">Group A</option></select>`;

async function open(state: FakeMoodleState, page = moodlePage({ userId: 3, heading: "Participants", bodyId: "page-course-view-participants", body: FILTERS })): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, state);
  // The participants page's body id isn't its path's (Moodle names it course-view-participants).
  await context.route(`${SITE}user/index.php**`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: page }));
  return context;
}

describe("participants", { skip: !browser && "no system browser" }, () => {
  it("lists everyone with their roles and groups, by id, without empty rows or initials", async () => {
    const context = await open(fakeCourse());
    assert.deepEqual(await participants(context, SITE, 3), [
      { userId: 3, fullName: "Teacher Uno", roles: [{ id: 3, name: "Teacher" }], groups: [] },
      { userId: 4, fullName: "Ana Student", roles: [{ id: 5, name: "Student" }], groups: [{ id: 1, name: "Group A" }] },
      { userId: 5, fullName: "Bruno Student", roles: [{ id: 5, name: "Student" }], groups: [] },
    ]);
    await context.close();
  });

  it("filters by role, group and inactivity as the page's filters do", async () => {
    const state = fakeCourse();
    const context = await open(state);
    assert.deepEqual((await participants(context, SITE, 3, { role: 5 })).map((p) => p.userId), [4, 5]);
    assert.deepEqual((await participants(context, SITE, 3, { group: 1 })).map((p) => p.userId), [4]);
    assert.deepEqual((await participants(context, SITE, 3, { inactiveSince: new Date(1_750_000_000_000) })).map((p) => p.userId), [4]);
    const call = state.serviceCalls!.find((c) => (c.args.filters as Filter[]).some((f) => f.name === "accesssince"));
    assert.deepEqual((call?.args.filters as Filter[])[0], { name: "courseid", jointype: 1, values: [3] });
    await context.close();
  });

  it("refuses a course whose participants the person can't see", async () => {
    const context = await open(fakeCourse(), moodlePage({ userId: 3, heading: "Error", bodyId: "page-user-index" }));
    await assert.rejects(participants(context, SITE, 99), NoParticipantsError);
    await context.close();
  });
});

describe("groups", { skip: !browser && "no system browser" }, () => {
  it("lists the groups the person can see with their members", async () => {
    const context = await open(fakeCourse());
    assert.deepEqual(await groups(context, SITE, 3), [{ id: 1, name: "Group A", members: [4] }]);
    await context.close();
  });
});
