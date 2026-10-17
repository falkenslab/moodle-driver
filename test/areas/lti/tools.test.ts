import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { ExternalToolError, NotLoggedInError, addExternalTool, deleteExternalTool, externalToolLaunchUrl, externalTools, setExternalToolInChooser } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const COURSE = 3;

interface FakeTool {
  id: number;
  name: string;
  description: string;
  /** The site's (1) or the course's. */
  course: number;
  url: string;
  secret: string;
  /** Moodle's coursevisible: 2 in the activity chooser, 1 only preconfigured. */
  visible: number;
}

/** A row of the course tools table, as Moodle 5.2's report renders it: a lock for a site tool or for whom can't add tools, else the actions menu. */
function row(t: FakeTool, canAdd: boolean): string {
  const toggle = `<div class="form-check form-switch"><input type="checkbox" class="form-check-input" id="showinactivitychooser-toggle-${t.id}" data-id="${t.id}" data-courseid="${COURSE}" data-action="showinactivitychooser-toggle" data-state="${t.visible === 2 ? 1 : 0}"${t.visible === 2 ? " checked" : ""}${canAdd ? "" : " disabled"}></div>`;
  const actions =
    t.course === 1 || !canAdd
      ? '<div class="d-flex justify-content-end"><div class="tool-action-icon-container"><i class="icon fa fa-lock fa-fw" title="Locked"></i></div></div>'
      : `<div class="action-menu"><a href="${SITE}mod/lti/coursetooledit.php?course=${COURSE}&amp;typeid=${t.id}" class="dropdown-item">Edit</a><a href="#" data-action="course-tool-delete" data-course-tool-id="${t.id}" data-course-tool-name="${t.name}" data-course-tool-usage="0">Delete</a></div>`;
  const icon = `<div class="d-flex"><div class="me-2 activityiconcontainer smaller"><img class="activityicon" src="${SITE}theme/image.php/boost/lti/1/monologo" alt="Icon for ${t.name}"></div><span class="align-self-center">${t.name}</span></div>`;
  return `<tr><td class="cell c0">${icon}</td><td class="cell c1">${t.description}</td><td class="cell c2">0</td><td class="cell c3">${toggle}</td><td class="cell c4">${actions}</td></tr>`;
}

function table(tools: FakeTool[], canAdd: boolean, total = tools.length): string {
  const sortable = (key: string) => `<th class="header"><a data-sortable="1" data-sortby="${key}" href="#">${key}</a></th>`;
  const filters = JSON.stringify({ jointype: 2, filters: { reportid: { name: "reportid", jointype: 1, values: [10] } } }).replaceAll('"', "&quot;");
  return `<div data-region="core_table/dynamic" data-table-handler="system_report_table" data-table-component="core_reportbuilder" data-table-uniqueid="system-report-table-10" data-table-filters="${filters}" data-table-sort-data="[]" data-table-total-rows="${total}"><table data-region="reportbuilder-table"><thead><tr>${sortable("c0_name")}${sortable("c1_description")}${sortable("c2_id")}<th class="header c3">Show in activity chooser</th><th class="header c4">Actions</th></tr></thead><tbody>${tools.map((t) => row(t, canAdd)).join("")}<tr class="emptyrow"><td></td></tr></tbody></table></div>`;
}

/** The course tool form, as Moodle 5.2's coursetooledit.php shapes it (the fields the driver touches); it posts where Moodle's redirect leads (the fake serves no redirects). */
function toolForm(t?: FakeTool): string {
  const value = (v: string | undefined) => (v === undefined ? "" : v.replaceAll("&", "&amp;").replaceAll('"', "&quot;"));
  return `<form class="mform" method="post" action="${SITE}mod/lti/coursetools.php?id=${COURSE}&amp;posted=1"><input type="hidden" name="course" value="${COURSE}"><input type="hidden" name="typeid" value="${t?.id ?? ""}">
<input type="text" name="lti_typename" value="${value(t?.name)}"><input type="text" name="lti_toolurl" value="${value(t?.url)}"><textarea name="lti_description">${t?.description ?? ""}</textarea>
<input type="text" name="lti_resourcekey" value=""><input type="password" class="form-control d-none" name="lti_password" value="${value(t?.secret)}">
<select name="lti_launchcontainer"><option value="2">Embed</option><option value="3" selected>Embed, without blocks</option><option value="4">New window</option></select>
<input type="submit" name="submitbutton" value="Save changes"></form>`;
}

async function site({ canAdd = true, canList = true }: { canAdd?: boolean; canList?: boolean } = {}) {
  const tools: FakeTool[] = [
    { id: 1, name: "Site simulator", description: "For every course.", course: 1, url: "https://sim.example/launch", secret: "site-secret", visible: 1 },
    { id: 4, name: "Course lab", description: "", course: COURSE, url: "https://lab.example/lti?a=1&b=2", secret: "lab-secret", visible: 2 },
  ];
  const posts: URLSearchParams[] = [];
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    serviceCalls: [],
    services: {
      mod_lti_toggle_showinactivitychooser: (args) => {
        if (!canAdd) throw new ServiceFailure("nopermissions");
        tools.find((t) => t.id === args.tooltypeid)!.visible = args.showinactivitychooser ? 2 : 1;
        return true;
      },
      mod_lti_delete_course_tool_type: (args) => {
        tools.splice(tools.findIndex((t) => t.id === args.tooltypeid), 1);
        return true;
      },
    },
  };
  const context: BrowserContext = await browser!.newContext();
  await serveFakeMoodle(context, state);
  const page = (route: Route, body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body, bodyId }) });
  const fatal = (route: Route, bodyId: string) => page(route, '<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that.</p></div>', bodyId);
  await context.route(`${SITE}mod/lti/**`, async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.replace("/mod/lti/", "");
    if (name === "coursetools.php") {
      if (!canList) return fatal(route, "page-mod-lti-coursetools");
      if (route.request().method() === "POST") {
        const form = new URLSearchParams(route.request().postData() ?? "");
        posts.push(form);
        tools.push({ id: 9, name: form.get("lti_typename")!, description: form.get("lti_description") ?? "", course: COURSE, url: form.get("lti_toolurl")!, secret: form.get("lti_password") ?? "", visible: 2 });
      }
      return page(route, table(tools, canAdd), "page-mod-lti-coursetools");
    }
    if (name === "coursetooledit.php") {
      if (!canAdd) return fatal(route, "page-mod-lti-coursetooledit");
      const typeid = Number(url.searchParams.get("typeid"));
      return page(route, toolForm(typeid ? tools.find((t) => t.id === typeid) : undefined), "page-mod-lti-coursetooledit");
    }
    if (name === "launch.php") {
      // The launch page is the tool's form alone, posted by its script; an activity of another module, Moodle's error page.
      if (url.searchParams.get("id") === "50") return route.fulfill({ status: 200, contentType: "text/html", body: '<form action="https://lab.example/lti" name="ltiLaunchForm" id="ltiLaunchForm" method="post"><input type="hidden" name="oauth_signature" value="x"></form><script>document.ltiLaunchForm.submit();</script>' });
      return page(route, '<div data-rel="fatalerror"><p class="errormessage">Invalid course module ID</p></div>', "page-mod-lti-launch");
    }
    return page(route, "", "page-mod-lti-other");
  });
  return { context, tools, posts, state };
}

describe("externalTools", { skip: !browser && "no system browser" }, () => {
  it("lists the site's and the course's tools, a course tool's URL read from its form, never a secret", async () => {
    const { context } = await site();
    const tools = await externalTools(context, SITE, COURSE);
    assert.deepEqual(tools, [
      { id: 1, name: "Site simulator", description: "For every course.", scope: "site", shownInActivityChooser: false },
      { id: 4, name: "Course lab", description: "", scope: "course", url: "https://lab.example/lti?a=1&b=2", shownInActivityChooser: true },
    ]);
    assert.doesNotMatch(JSON.stringify(tools), /secret/);
    await context.close();
  });

  it("leaves the scope out for whom can't add course tools, where every row is locked", async () => {
    const { context } = await site({ canAdd: false });
    assert.deepEqual((await externalTools(context, SITE, COURSE)).map((t) => [t.id, t.scope, t.url]), [[1, undefined, undefined], [4, undefined, undefined]]);
    await context.close();
  });

  it("asks the table's service for the rows beyond the page's", async () => {
    const { context, state, tools } = await site();
    await context.unroute(`${SITE}mod/lti/**`);
    await context.route(`${SITE}mod/lti/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/coursetools.php")) return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-lti-coursetools", body: table(tools.slice(0, 1), true, 2) }) });
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-mod-lti-coursetooledit", body: toolForm(tools[1]) }) });
    });
    state.services!.core_table_get_dynamic_table_content = () => ({ html: table(tools, true) });
    assert.deepEqual((await externalTools(context, SITE, COURSE)).map((t) => t.id), [1, 4]);
    const call = state.serviceCalls!.find((c) => c.methodname === "core_table_get_dynamic_table_content")!;
    assert.deepEqual([call.args.uniqueid, call.args.pagesize], ["system-report-table-10", 2]);
    await context.close();
  });

  it("names the capability when Moodle refuses the page", async () => {
    const { context } = await site({ canList: false });
    await assert.rejects(externalTools(context, SITE, COURSE), (e: Error) => e instanceof ExternalToolError && e.code === "external-tool" && /mod\/lti:addpreconfiguredinstance/.test(e.message));
    await context.close();
  });
});

describe("addExternalTool", { skip: !browser && "no system browser" }, () => {
  it("fills the course tool form and returns the new tool", async () => {
    const { context, posts } = await site();
    const { changed, tool } = await addExternalTool(context, SITE, COURSE, { name: "Quiz lab", url: "https://quiz.example/lti", key: "k1", secret: "s3cret", description: "Practice", settings: { lti_launchcontainer: 4 } });
    const form = posts[0]!;
    assert.deepEqual(
      ["lti_typename", "lti_toolurl", "lti_resourcekey", "lti_password", "lti_description", "lti_launchcontainer"].map((n) => form.get(n)),
      ["Quiz lab", "https://quiz.example/lti", "k1", "s3cret", "Practice", "4"],
    );
    assert.deepEqual(tool, { id: 9, name: "Quiz lab", description: "Practice", scope: "course", url: "https://quiz.example/lti", shownInActivityChooser: true });
    assert.equal(changed, 'Added external tool 9 "Quiz lab" to course 3.');
    await context.close();
  });

  it("checks the name and URL first, and names the capability when Moodle refuses the form", async () => {
    const { context, posts } = await site();
    await assert.rejects(addExternalTool(context, SITE, COURSE, { name: " ", url: "https://x.example/" }), { code: "invalid-input" });
    await assert.rejects(addExternalTool(context, SITE, COURSE, { name: "X", url: "x.example" }), { code: "invalid-input", message: /http/ });
    assert.equal(posts.length, 0);
    await context.close();
    const refused = await site({ canAdd: false });
    await assert.rejects(addExternalTool(refused.context, SITE, COURSE, { name: "X", url: "https://x.example/" }), (e: Error) => e instanceof ExternalToolError && /mod\/lti:addcoursetool/.test(e.message));
    await refused.context.close();
  });
});

describe("setExternalToolInChooser", { skip: !browser && "no system browser" }, () => {
  it("toggles a site tool for the course through the page's service, and reads it back", async () => {
    const { context, state } = await site();
    const { changed, tool } = await setExternalToolInChooser(context, SITE, COURSE, 1, true);
    assert.deepEqual(state.serviceCalls!.find((c) => c.methodname === "mod_lti_toggle_showinactivitychooser")!.args, { tooltypeid: 1, courseid: COURSE, showinactivitychooser: true });
    assert.equal(tool.shownInActivityChooser, true);
    assert.equal(changed, 'External tool 1 "Site simulator" shown in course 3\'s activity chooser.');
    await context.close();
  });

  it("refuses a tool the course doesn't list, and names the capability without it", async () => {
    const { context, state } = await site();
    await assert.rejects(setExternalToolInChooser(context, SITE, COURSE, 77, false), (e: Error) => e instanceof ExternalToolError && /no external tool 77/.test(e.message));
    assert.equal(state.serviceCalls!.length, 0);
    await context.close();
    const refused = await site({ canAdd: false });
    await assert.rejects(setExternalToolInChooser(refused.context, SITE, COURSE, 4, false), (e: Error) => e instanceof ExternalToolError && /mod\/lti:addcoursetool/.test(e.message));
    await refused.context.close();
  });
});

describe("deleteExternalTool", { skip: !browser && "no system browser" }, () => {
  it("deletes a course tool through the page's service, and refuses a site tool", async () => {
    const { context, tools } = await site();
    assert.equal((await deleteExternalTool(context, SITE, COURSE, 4)).changed, 'Deleted external tool 4 "Course lab" from course 3.');
    assert.deepEqual(tools.map((t) => t.id), [1]);
    await assert.rejects(deleteExternalTool(context, SITE, COURSE, 1), (e: Error) => e instanceof ExternalToolError && /site tool/.test(e.message));
    await context.close();
  });
});

describe("externalToolLaunchUrl", { skip: !browser && "no system browser" }, () => {
  it("gives the launch URL once Moodle's launch page answers with the tool's form, which is never submitted", async () => {
    const { context } = await site();
    const tool: string[] = [];
    context.on("request", (request) => {
      if (!request.url().startsWith(SITE)) tool.push(request.url());
    });
    assert.equal(await externalToolLaunchUrl(context, SITE, 50), `${SITE}mod/lti/launch.php?id=50`);
    assert.deepEqual(tool, []);
    await context.close();
  });

  it("throws ExternalToolError with Moodle's message for an activity that isn't an external tool, NotLoggedInError without a session", async () => {
    const { context, state } = await site();
    await assert.rejects(externalToolLaunchUrl(context, SITE, 51), (e: Error) => e instanceof ExternalToolError && /Invalid course module ID/.test(e.message) && /mod\/lti:view/.test(e.message));
    await context.unroute(`${SITE}mod/lti/**`);
    delete state.user;
    await assert.rejects(externalToolLaunchUrl(context, SITE, 50), NotLoggedInError);
    await context.close();
  });
});
