import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { ContentBankError, MoodleError, contentBank, deleteContent, downloadContent, h5pContentTypes, renameContent, uploadToContentBank } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
const dir = mkdtempSync(path.join(tmpdir(), "contentbank-test-"));
after(async () => {
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
});

const COURSE = 7;
const CONTEXT = 77;
const FILE = `${SITE}pluginfile.php/${CONTEXT}/contentbank/public/1/multiple-choice.h5p`;

/** The bank's list as Moodle 5.2 renders it, reduced: one row per content, its facts in data attributes. */
const row = (id: number, name: string, unlisted = false) =>
  `<div role="listitem" class="cb-listitem${unlisted ? " cb-unlisted" : ""}" data-file="${name.toLowerCase()}" data-name="${name}" data-bytes="736671" data-uses="2" data-timemodified="1792272688" data-type="Archive (H5P)" data-author="Profesor Demo">
<div class="cb-file cb-column position-relative"><div class="cb-thumbnail" style="background-image: url('${SITE}pluginfile.php/1/core_h5p/libraries/9/H5P.MultiChoice-1.14/icon.svg');"></div>
<a href="${SITE}contentbank/view.php?id=${id}" class="cb-link stretched-link"><span class="cb-name" data-region="cb-content-name">${name}</span></a></div></div>`;
const BANK = (rows: string) => `<div class="content-bank-container view-grid" data-region="contentbank"><div class="content-bank"><div data-region="filearea">${rows}</div></div></div>`;
/** A content's page: its menu (rename, download, delete) and its player, whose `url` is the file. */
const VIEW = (download: boolean, name = "Quick &amp; check") => `<div class="core_contentbank_viewcontent"><h2>${name}</h2><div class="dropdown-menu">
<a class="dropdown-item" data-action="renamecontent" data-contentname="${name}" data-contentid="1" href="#">Rename</a>
${download ? `<a class="dropdown-item" url="${FILE}" href="${FILE}">Download</a>` : ""}
<a class="dropdown-item text-danger" data-action="deletecontent" data-contentname="${name}" data-uses="2" data-contentid="1" data-contextid="${CONTEXT}" href="#">Delete</a></div>
<iframe src="${SITE}h5p/embed.php?url=${encodeURIComponent(FILE)}&amp;preventredirect=1&amp;component" class="h5p-player"></iframe></div>`;

/** A fake Moodle with course 7 (context 77), its bank and its content's page. */
async function site(state: Partial<FakeMoodleState> = {}, { bank = BANK(row(1, "Quick &amp; check")), view = VIEW(true) } = {}): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 3, fullName: "Profesor Demo" }, ...state, bodies: { "/contentbank/index.php": bank, "/contentbank/view.php": view, ...state.bodies } });
  // The course's page gives its context id in M.cfg, as Moodle's does.
  await context.route(`${SITE}course/view.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-course-view-topics", bodyClass: `course-${COURSE}`, contextId: CONTEXT }) }));
  return context;
}

describe("contentBank", { skip: !browser && "no system browser" }, () => {
  it("lists the bank's rows with each content's stored name and file, from its page", async () => {
    const context = await site({}, { bank: BANK(row(1, "Quick &amp; check (Unlisted)", true)) });
    assert.deepEqual(await contentBank(context, SITE, COURSE), [
      {
        id: 1,
        name: "Quick & check",
        type: "h5p",
        contentType: { library: "H5P.MultiChoice", version: "1.14" },
        authorName: "Profesor Demo",
        modified: new Date(1792272688 * 1000).toISOString(),
        size: 736671,
        uses: 2,
        unlisted: true,
        fileUrl: FILE,
      },
    ]);
    await context.close();
  });

  it("takes the file from the player when there's no download link", async () => {
    const context = await site({}, { view: VIEW(false) });
    assert.equal((await contentBank(context, SITE, COURSE))[0]!.fileUrl, FILE);
    await context.close();
  });

  it("names the capability when the bank refuses the person", async () => {
    const denied = `<div class="box errorbox alert alert-danger" data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Access the content bank).</p></div>`;
    const context = await site({}, { bank: denied });
    await assert.rejects(contentBank(context, SITE, COURSE), (error: unknown) => error instanceof ContentBankError && /moodle\/contentbank:access/.test(error.message));
    await context.close();
  });
});

/**
 * The bank's "Add" menu as Moodle 4.5 and 5.2 render it: an entry per H5P content type at its newest
 * version, the library and version in the link, its title beside the icon.
 */
const ADD = (types: [library: string, version: string, title: string][]) => `<div class="cb-toolbar-container mb-2 d-flex"><div class="btn-group me-1" role="group">
<button type="button" class="btn btn-primary dropdown-toggle" data-bs-toggle="dropdown" data-action="Add-content">Add</button>
<div class="dropdown-menu dropdown-scrollable dropdown-menu-end"><h6 class="dropdown-header">H5P interactive content</h6>
${types.map(([library, version, title]) => `<a class="dropdown-item icon-size-4" href="${SITE}contentbank/edit.php?contextid=${CONTEXT}&amp;plugin=h5p&amp;library=${library} ${version}">
  <img alt="" class="icon" src="${SITE}pluginfile.php/1/core_h5p/libraries/15/${library}-${version}/icon.svg">
 ${title}
</a>`).join("")}</div></div></div>`;

describe("h5pContentTypes", { skip: !browser && "no system browser" }, () => {
  const TYPES: [string, string, string][] = [
    ["H5P.MultiChoice", "1.16", "Multiple Choice"],
    ["H5P.TrueFalse", "1.8", "True/False Question"],
  ];

  it("lists the types the bank's Add menu offers, and tells an admin may install new ones", async () => {
    const context = await site({}, { bank: ADD(TYPES) + BANK("") });
    assert.deepEqual(await h5pContentTypes(context, SITE, COURSE), {
      types: [
        { library: "H5P.MultiChoice", version: "1.16", title: "Multiple Choice" },
        { library: "H5P.TrueFalse", version: "1.8", title: "True/False Question" },
      ],
      canInstall: true,
    });
    await context.close();
  });

  it("says a teacher may not install types, gives none on a site without libraries, and refuses who can't open the bank", async () => {
    const context = await site({}, { bank: BANK("") });
    // Moodle sends a person without moodle/h5p:updatelibraries to its error page.
    await context.route(`${SITE}h5p/libraries.php`, (route: Route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-site-index", body: `<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Manage H5P content types).</p></div>` }) }),
    );
    assert.deepEqual(await h5pContentTypes(context, SITE, COURSE), { types: [], canInstall: false });
    await context.close();
    const denied = await site({}, { bank: `<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Access the content bank).</p></div>` });
    await assert.rejects(h5pContentTypes(denied, SITE, COURSE), ContentBankError);
    await denied.close();
  });
});

describe("uploadToContentBank", { skip: !browser && "no system browser" }, () => {
  const FORM = `<form class="mform" action="#"><input type="hidden" name="contextid" value="${CONTEXT}"><input type="hidden" name="id" value=""><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__core_contentbank_form_upload_files" value="1"><input type="hidden" name="file" value="555"></form>`;
  const SCRIPTS = `M.form_filepicker.init(Y, {"repositories":{"4":{"id":"4","name":"Upload a file","type":"upload"}},"accepted_types":[".h5p"],"itemid":555});`;

  async function uploading(answer: string) {
    const state: Partial<FakeMoodleState> = {
      serviceCalls: [],
      services: { core_form_dynamic_form: (args) => (String(args.formdata).includes("file=555") ? { submitted: true, data: JSON.stringify({ returnurl: answer }) } : { submitted: false, html: FORM, javascript: SCRIPTS }) },
    };
    const context = await site(state);
    const uploads: string[] = [];
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      const body = route.request().postData() ?? "";
      const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
      uploads.push(`${field("repo_id")}:${field("itemid")}:${field("title")}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ url: `${SITE}draftfile.php/9/user/draft/555/${field("title")}` }) });
    });
    return { context, state, uploads };
  }

  it("uploads the file to the form's draft area, submits the form and gives the new content", async () => {
    const file = path.join(dir, "multiple-choice.h5p");
    writeFileSync(file, "PK fake");
    const { context, state, uploads } = await uploading(`${SITE}contentbank/view.php?id=1&contextid=${CONTEXT}`);
    const result = await uploadToContentBank(context, SITE, COURSE, file);
    assert.equal(result.content.id, 1);
    assert.equal(result.changed, `Uploaded "multiple-choice.h5p" to course ${COURSE}'s content bank as content 1.`);
    assert.deepEqual(uploads, ["4:555:multiple-choice.h5p"]);
    const sent = new URLSearchParams(String(state.serviceCalls!.filter((call) => call.methodname === "core_form_dynamic_form")[1]!.args.formdata));
    assert.equal(sent.get("contextid"), String(CONTEXT));
    assert.equal(sent.get("_qf__core_contentbank_form_upload_files"), "1");
    await context.close();
  });

  it("refuses a file of a type the bank doesn't take, and says Moodle's error code when it refuses the package", async () => {
    const zip = path.join(dir, "package.zip");
    writeFileSync(zip, "PK fake");
    const bad = path.join(dir, "broken.h5p");
    writeFileSync(bad, "not a zip");
    const { context, uploads } = await uploading(`${SITE}contentbank/index.php?contextid=${CONTEXT}&errormsg=invalidpackage`);
    await assert.rejects(uploadToContentBank(context, SITE, COURSE, zip), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
    assert.deepEqual(uploads, []);
    await assert.rejects(uploadToContentBank(context, SITE, COURSE, bad), (error: unknown) => error instanceof ContentBankError && /invalidpackage/.test(error.message));
    await context.close();
  });
});

describe("renameContent, deleteContent and downloadContent", { skip: !browser && "no system browser" }, () => {
  it("renames with Moodle's service and gives the name its page shows", async () => {
    const state: Partial<FakeMoodleState> = { serviceCalls: [], services: { core_contentbank_rename_content: () => ({ result: true, warnings: [] }) } };
    const context = await site(state, { view: VIEW(true, "New name") });
    assert.deepEqual(await renameContent(context, SITE, 1, "New <b>name</b>"), { changed: 'Renamed content 1 to "New name".', contentId: 1, name: "New name" });
    assert.deepEqual(state.serviceCalls, [{ methodname: "core_contentbank_rename_content", args: { contentid: 1, name: "New <b>name</b>" } }]);
    await assert.rejects(renameContent(context, SITE, 1, " "), (error: unknown) => error instanceof MoodleError && error.code === "invalid-input");
    await context.close();
  });

  it("turns the services' warnings into errors naming the capability, or the missing content", async () => {
    const context = await site({
      services: {
        core_contentbank_rename_content: () => ({ result: false, warnings: [{ item: 1, warningcode: "nopermissiontomanage", message: "You don't have permission to manage this content" }] }),
        core_contentbank_delete_content: () => ({ result: false, warnings: [{ item: 9, warningcode: "exception", message: "Can't find data record in database table contentbank_content." }] }),
      },
    });
    await assert.rejects(renameContent(context, SITE, 1, "x"), (error: unknown) => error instanceof ContentBankError && /manageowncontent/.test(error.message));
    await assert.rejects(deleteContent(context, SITE, 9), (error: unknown) => error instanceof ContentBankError && /There's no content 9/.test(error.message));
    await context.close();
  });

  it("deletes with Moodle's service", async () => {
    const state: Partial<FakeMoodleState> = { serviceCalls: [], services: { core_contentbank_delete_content: () => ({ result: true, warnings: [] }) } };
    const context = await site(state);
    assert.deepEqual(await deleteContent(context, SITE, 1), { changed: "Deleted content 1 from its content bank.", contentId: 1 });
    assert.deepEqual(state.serviceCalls, [{ methodname: "core_contentbank_delete_content", args: { contentids: [1] } }]);
    await context.close();
  });

  it("refuses to download without the page's download link, or without a content page", async () => {
    const context = await site({}, { view: VIEW(false) });
    await assert.rejects(downloadContent(context, SITE, 1, dir), (error: unknown) => error instanceof ContentBankError && /downloadcontent/.test(error.message));
    await context.close();
    const missing = await site({}, { view: `<div class="box errorbox" data-rel="fatalerror"><p class="errormessage">Can't find data record</p></div>` });
    await assert.rejects(downloadContent(missing, SITE, 9, dir), (error: unknown) => error instanceof ContentBankError && /no content 9/.test(error.message));
    await missing.close();
  });
});
