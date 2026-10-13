import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { BackupError, backupCourse, copyCourse, importActivities, restoreCourse } from "../../../src/index.js";
import { brokenInActivity, placeRestored } from "../../../src/areas/backup/backup.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";
import { writeTgz } from "./tgz.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const ERROR_PAGE = '<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Create courses).</p></div>';

/** Serves `path` (any query) with a Moodle page whose body is `body(postData)`: a wizard's stages by what was posted. */
async function serveStages(context: BrowserContext, path: string, body: (posted: URLSearchParams) => string): Promise<URLSearchParams[]> {
  const posts: URLSearchParams[] = [];
  await context.route(`${SITE}${path}**`, async (route: Route) => {
    const posted = new URLSearchParams(route.request().postData() ?? "");
    if (route.request().method() === "POST") posts.push(posted);
    await route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 2, bodyId: `page-${path.replace(/\.php$/, "").replaceAll("/", "-")}`, body: body(posted) }) });
  });
  return posts;
}

/** Moodle's copy form, reduced: its hidden fields, the names, the category, the user data choice and the roles to keep. */
const COPY_FORM = `<form class="mform" method="post" action="${SITE}backup/copy.php"><input type="hidden" name="courseid" value="3"><input type="hidden" name="sesskey" value="s1">
<input type="hidden" name="_qf__core_backup_output_copy_form" value="1"><input name="fullname" value=""><input name="shortname" value="">
<select name="category"><option value="1">Miscellaneous</option><option value="4">Archive</option></select><select name="userdata"><option value="0">No</option><option value="1">Yes</option></select>
<input type="hidden" name="role_5" value="0"><input type="checkbox" name="role_5" value="5"><input type="submit" name="submitdisplay" value="Copy and view"></form>`;

describe("copyCourse", { skip: !browser && "no system browser" }, () => {
  it("sends the copy form to Moodle's copy service, waits for the copy and finds the new course", async () => {
    const context = await browser!.newContext();
    const sent: string[] = [];
    let polls = 0;
    await serveFakeMoodle(context, {
      user: { id: 2, fullName: "Admin" },
      bodies: { "/backup/copy.php": COPY_FORM },
      services: {
        core_backup_submit_copy_form: (args) => {
          sent.push(JSON.parse(String(args.jsonformdata)) as string);
          return JSON.stringify({ backupid: "b1", restoreid: "r1" });
        },
        core_backup_get_copy_progress: () => [{ status: ++polls > 1 ? 1000 : 800, progress: 0.5, backupid: "r1", operation: "restore" }],
        core_course_search_courses: () => ({ total: 2, courses: [{ id: 9, fullname: "Old", shortname: "check-copy-old", categoryid: 1 }, { id: 10, fullname: "Check copy", shortname: "check-copy", categoryid: 4 }] }),
      },
    });
    const result = await copyCourse(context, SITE, 3, { fullName: "Check copy", shortName: "check-copy", categoryId: 4, withUsers: true });
    assert.deepEqual(result.course, { id: 10, fullName: "Check copy", shortName: "check-copy", categoryId: 4, url: `${SITE}course/view.php?id=10` });
    const form = new URLSearchParams(sent[0]);
    assert.deepEqual([form.get("courseid"), form.get("fullname"), form.get("shortname"), form.get("category"), form.get("userdata"), form.getAll("role_5"), form.get("sesskey")], ["3", "Check copy", "check-copy", "4", "1", ["0", "5"], "s1"]);
    assert.equal(form.has("submitdisplay"), false);
    assert.equal(polls, 2);
    await context.close();
  });

  it("says what Moodle asks for when the person can't copy, and when it refuses the settings", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/backup/copy.php": ERROR_PAGE } });
    await assert.rejects(copyCourse(context, SITE, 3, { fullName: "A", shortName: "a" }), (error: Error) => error instanceof BackupError && /moodle\/course:create/.test(error.message) && /Create courses/.test(error.message));
    await context.close();
    const other = await browser!.newContext();
    await serveFakeMoodle(other, {
      user: { id: 2, fullName: "Admin" },
      bodies: { "/backup/copy.php": COPY_FORM },
      services: {
        core_backup_submit_copy_form: () => {
          throw new ServiceFailure("copyformfail");
        },
      },
    });
    await assert.rejects(copyCourse(other, SITE, 3, { fullName: "A", shortName: "taken" }), (error: Error) => error instanceof BackupError && /"taken"/.test(error.message));
    await other.close();
  });
});

/** The backup wizard's stages, reduced: the initial settings (users locked, as for a teacher), the schema, the confirmation, the asynchronous progress. */
const backupStage = (posted: URLSearchParams) => {
  const stage = Number(posted.get("stage") ?? 0);
  const form = (fields: string) => `<form class="mform" method="post" action="${SITE}backup/backup.php">${fields}<input type="submit" name="submitbutton" value="Next"></form>`;
  if (!stage) return form('<input type="hidden" name="stage" value="1"><input type="hidden" name="_qf__backup_initial_form" value="1"><input type="hidden" name="setting_root_users" value="0">');
  if (stage === 1) return form('<input type="hidden" name="stage" value="2"><input type="hidden" name="_qf__backup_schema_form" value="1">');
  if (stage === 2) return form('<input type="hidden" name="stage" value="4"><input name="setting_root_filename" value="backup-moodle2-course-3-check.mbz">');
  return '<div class="progressbar_container"><div class="progress-bar" data-backupid="bk1"></div></div>';
};

describe("backupCourse", { skip: !browser && "no system browser" }, () => {
  it("goes through the wizard's stages, waits for the asynchronous backup and looks for its file", async () => {
    const context = await browser!.newContext();
    const progress: unknown[] = [];
    await serveFakeMoodle(context, {
      user: { id: 3, fullName: "Teacher" },
      bodies: { "/backup/restorefile.php": '<table><tr><td><a href="http://moodle.test/pluginfile.php/13/user/backup/other.mbz?forcedownload=1">Download</a></td></tr></table>' },
      services: {
        core_backup_get_async_backup_progress: (args) => {
          progress.push(args);
          return [{ status: 1000, progress: 1, backupid: "bk1", operation: "backup" }];
        },
      },
    });
    const posts = await serveStages(context, "backup/backup.php", backupStage);
    // The file isn't in the backup areas: the stages and the wait are what's checked here.
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups"), (error: Error) => error instanceof BackupError && /backup-moodle2-course-3-check\.mbz/.test(error.message));
    assert.deepEqual(posts.map((p) => p.get("stage")), ["1", "2", "4"]);
    assert.deepEqual(progress, [{ backupids: ["bk1"], contextid: 0 }]);
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups", { withUsers: true }), (error: Error) => error instanceof BackupError && /backup:userinfo/.test(error.message));
    await context.close();
  });

  it("ticks only the sections and activities asked for, with what belongs to the course turned off", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {
      user: { id: 3, fullName: "Teacher" },
      services: {
        core_backup_get_async_backup_progress: () => [{ status: 1000, progress: 1, backupid: "bk1", operation: "backup" }],
        core_courseformat_get_state: () =>
          JSON.stringify({
            section: [],
            cm: [
              { id: "20", sectionid: "10" },
              { id: "23", sectionid: "10" },
              { id: "21", sectionid: "11" },
              { id: "22", sectionid: "11" },
              { id: "24", sectionid: "11", delegatesectionid: "12" },
              { id: "25", sectionid: "12" },
            ],
          }),
      },
    });
    const box = (name: string, extra = "") => `<input type="hidden" name="${name}" value="0"><input type="checkbox" name="${name}" value="1" checked ${extra}>`;
    const form = (fields: string) => `<form class="mform" method="post" action="${SITE}backup/backup.php">${fields}<input type="submit" name="submitbutton" value="Next"></form>`;
    const posts = await serveStages(context, "backup/backup.php", (posted) => {
      const stage = Number(posted.get("stage") ?? 0);
      if (!stage) return form(`<input type="hidden" name="stage" value="1"><input type="hidden" name="_qf__backup_initial_form" value="1"><input type="hidden" name="setting_root_users" value="0">${box("setting_root_badges")}${box("setting_root_files")}${box("setting_root_logs", "disabled")}`);
      if (stage === 1)
        return form(
          `<input type="hidden" name="stage" value="2">${["setting_section_section_10_included", "setting_activity_forum_20_included", "setting_activity_label_23_included", "setting_section_section_11_included", "setting_activity_page_21_included", "setting_activity_quiz_22_included", "setting_activity_subsection_24_included", "setting_section_section_12_included", "setting_activity_page_25_included"].map((name) => box(name)).join("")}`,
        );
      return backupStage(posted);
    });
    // The file isn't in the backup areas: the stages' settings are what's checked here.
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups", { sections: [10], activities: [24] }), /isn't in the backup areas/);
    assert.deepEqual([posts[0]!.getAll("setting_root_badges"), posts[0]!.getAll("setting_root_files"), posts[0]!.getAll("setting_root_logs")], [["0"], ["0", "1"], ["0"]]);
    const ticked = [...new Set([...posts[1]!.keys()].filter((name) => name.endsWith("_included")))].filter((name) => posts[1]!.getAll(name).includes("1"));
    // Section 10 whole; the subsection alone from section 11, with its own section's content.
    assert.deepEqual(ticked.sort(), ["setting_activity_forum_20_included", "setting_activity_label_23_included", "setting_activity_page_25_included", "setting_activity_subsection_24_included", "setting_section_section_10_included", "setting_section_section_11_included", "setting_section_section_12_included"]);
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups", { sections: [99], activities: [98] }), { code: "not-found", message: /Course 3 has no section 99 and no activity 98/ });
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups", { activities: [21], withUsers: true }), { code: "invalid-input" });
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups", { activities: [] }), { code: "invalid-input" });
    await context.close();
  });

  it("says so when Moodle offers no backup", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, bodies: { "/backup/backup.php": ERROR_PAGE } });
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups"), BackupError);
    await context.close();
  });
});

/** A backup's moodle_backup.xml, reduced: its release and its activities' modules. */
const backupXml = (release: string, modules: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<moodle_backup><information><moodle_version>2026042004</moodle_version><moodle_release>${release}</moodle_release>
<original_wwwroot>http://other.test</original_wwwroot><original_course_id>3</original_course_id>
<details><detail backup_id="x"><type>course</type></detail></details>
<contents><activities>${modules.map((module, i) => `<activity><moduleid>${i + 1}</moduleid><sectionid>5</sectionid><modulename>${module}</modulename><title>A &amp; ${module}</title><directory>activities/${module}_${i + 1}</directory></activity>`).join("")}</activities>
<sections><section><sectionid>5</sectionid><title>0</title><directory>sections/section_5</directory></section></sections></contents>
<settings><setting><level>root</level><name>users</name><value>0</value></setting></settings></information></moodle_backup>`;

describe("restoreCourse", { skip: !browser && "no system browser" }, () => {
  it("needs a file that's there, and a category for a new course", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 2, fullName: "Admin" } });
    await assert.rejects(restoreCourse(context, SITE, "/nowhere/backup.mbz", { into: 9 }), { code: "not-found" });
    await assert.rejects(restoreCourse(context, SITE, import.meta.filename, { into: "new" }), { code: "invalid-input" });
    await assert.rejects(restoreCourse(context, SITE, import.meta.filename, { into: 9, sectionId: 1, afterSectionId: 2 }), { code: "invalid-input" });
    await assert.rejects(restoreCourse(context, SITE, import.meta.filename, { into: 9, mode: "replace", sectionId: 1 }), { code: "invalid-input" });
    await assert.rejects(restoreCourse(context, SITE, import.meta.filename, { into: 9 }), (error: Error) => error instanceof BackupError && /isn't a Moodle backup/.test(error.message));
    await context.close();
  });

  it("refuses, before uploading it, a backup from a newer Moodle or with modules the site doesn't offer", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "restore-check-"));
    const newer = path.join(dir, "newer.mbz");
    const foreign = path.join(dir, "foreign.mbz");
    await writeFile(newer, writeTgz([["moodle_backup.xml", backupXml("5.3.1 (Build: 20270101)", ["page"])]]));
    await writeFile(foreign, writeTgz([["moodle_backup.xml", backupXml("4.5.2 (Build: 20250101)", ["page", "questionnaire", "qbank"])]]));
    const context = await browser!.newContext();
    const calls: FakeMoodleState["serviceCalls"] = [];
    await serveFakeMoodle(context, {
      user: { id: 3, fullName: "Teacher" },
      serviceCalls: calls,
      services: {
        core_courseformat_get_state: () => JSON.stringify({ section: [{ id: "50", number: 0, title: "General", cmlist: [] }], cm: [] }),
        core_course_get_course_content_items: () => ({ content_items: [{ name: "page", title: "Page" }, { name: "quiz", title: "Quiz" }] }),
      },
      // The restore page as Moodle 5.2 shows it, reduced: its form and the link to its documentation.
      bodies: { "/backup/restorefile.php": '<form class="mform"><input type="hidden" name="_qf__course_restore_form" value="1"><input type="hidden" name="backupfile" value="77"></form><a href="https://docs.moodle.org/502/en/backup/restorefile">Documentation for this page</a>' },
    });
    await context.route(`${SITE}course/view.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, bodyId: "page-course-view-topics", contextId: 30 }) }));
    await assert.rejects(restoreCourse(context, SITE, newer, { into: 9 }), (error: Error) => error instanceof BackupError && /Moodle 5\.3\.1 \(Build: 20270101\), newer than this site's 5\.2/.test(error.message));
    await assert.rejects(restoreCourse(context, SITE, foreign, { into: 9 }), (error: Error) => error instanceof BackupError && /\(questionnaire: "A & questionnaire"\)/.test(error.message));
    await assert.rejects(restoreCourse(context, SITE, foreign, { into: 9, sectionId: 51 }), { code: "not-found", message: /Course 9 has no section 51/ });
    // Nothing uploaded: no draft area touched.
    assert.ok(!calls.some((call) => call.methodname.includes("repository")));
    await context.close();
    await rm(dir, { recursive: true, force: true });
  });
});

type FakeSection = { id: string; number: number; title: string; visible: boolean; hasrestrictions?: boolean; cmlist: string[] };

/** A course after a restore Moodle merged into it, served by the fake with the course editor's actions. */
function restoredCourse() {
  const section = (id: string, number: number, title: string, cmlist: string[], visible = true): FakeSection => ({ id, number, title, visible, cmlist });
  const before = {
    section: [section("10", 0, "General", ["1"]), section("11", 1, "New section", ["2"]), section("12", 2, "Unit 2", [])],
    cm: ["1", "2"].map((id) => ({ id, name: `Old ${id}`, module: "page", visible: true, sectionid: id === "1" ? "10" : "11" })),
  };
  // What Moodle made of a backup with sections 0, 1 ("Loops", hidden) and 3 ("Extra"): 0 and 1
  // merged into the course's (the unnamed one named and hidden as the backup's), 3 a new section.
  const course = {
    section: [section("10", 0, "General", ["1", "101"]), section("11", 1, "Loops", ["2", "102", "103"], false), section("12", 2, "Unit 2", []), section("13", 3, "Extra", ["104"])],
    cm: [...before.cm, ...["101", "102", "103", "104"].map((id) => ({ id, name: `New ${id}`, module: "page", visible: true, sectionid: "" }))],
  };
  const sync = () => {
    course.section.forEach((s, i) => (s.number = i));
    for (const s of course.section) for (const id of s.cmlist) course.cm.find((cm) => cm.id === id)!.sectionid = s.id;
  };
  sync();
  let nextId = 200;
  const actions: string[] = [];
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    services: {
      core_courseformat_get_state: () => JSON.stringify(course),
      core_update_inplace_editable: (args) => {
        actions.push(`rename ${String(args.itemid)} "${String(args.value)}"`);
        course.section.find((s) => s.id === String(args.itemid))!.title = String(args.value) || "New section";
        return { value: args.value };
      },
      core_courseformat_update_course: ({ action, ids, targetsectionid }) => {
        const list = (ids as number[]).map(String);
        actions.push(`${String(action)} ${list.join(",")}${targetsectionid ? ` -> ${String(targetsectionid)}` : ""}`);
        const target = course.section.find((s) => s.id === String(targetsectionid));
        for (const id of list) {
          if (action === "cm_move") {
            for (const s of course.section) s.cmlist = s.cmlist.filter((c) => c !== id);
            target!.cmlist.push(id);
          } else if (action === "section_move_after") {
            const moving = course.section.find((s) => s.id === id)!;
            course.section = course.section.filter((s) => s !== moving);
            course.section.splice(course.section.indexOf(target!) + 1, 0, moving);
          } else if (action === "section_delete") course.section = course.section.filter((s) => s.id !== id);
          else if (action === "section_show") course.section.find((s) => s.id === id)!.visible = true;
          else if (action === "section_hide") course.section.find((s) => s.id === id)!.visible = false;
        }
        if (action === "section_add") course.section.push(section(String(nextId++), 0, "New section", []));
        sync();
        return "[]";
      },
    },
  };
  const info = {
    type: "course" as const,
    moodleVersion: "2026042004",
    moodleRelease: "5.2.4",
    originalCourse: { id: 3 },
    settings: {},
    activities: [],
    sections: [
      { id: 5, title: "0", directory: "sections/section_5", included: true, number: 0 },
      { id: 6, title: "Loops", directory: "sections/section_6", included: true, number: 1, name: "Loops", visible: false, summary: '<p><a href="$@PAGEVIEWBYID*9@$">x</a></p>' },
      { id: 8, title: "Extra", directory: "sections/section_8", included: true, number: 3, name: "Extra" },
    ],
  };
  return { state, before, course, info, actions };
}

describe("placeRestored", { skip: !browser && "no system browser" }, () => {
  async function site(state: FakeMoodleState): Promise<BrowserContext> {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { ...state, bodyClasses: { "/course/view.php": "format-topics" } });
    return context;
  }
  const layout = (course: { section: FakeSection[] }) => course.section.map((s) => `${s.title}${s.visible ? "" : "(h)"}:${s.cmlist.join(",")}`).join(" | ");

  it("makes each of the backup's sections a new section after the one asked, and puts back what Moodle changed", async () => {
    const { state, before, course, info, actions } = restoredCourse();
    const context = await site(state);
    const result = await placeRestored(context, SITE, 9, info, before as never, new Map(), { afterSectionId: 12 });
    assert.equal(layout(course), "General:1 | New section:2 | Unit 2: | New section:101 | Loops(h):102,103 | Extra:104");
    assert.deepEqual(result, { sectionIds: [200, 201, 13], activityIds: [101, 102, 103, 104] });
    // The hidden section's description isn't copied: it has a link Moodle encodes in backups.
    assert.ok(actions.includes('rename 201 "Loops"') && actions.includes('rename 11 ""') && actions.includes("section_show 11"), actions.join("\n"));
    await context.close();
  });

  it("moves every restored activity into the section asked, and deletes the sections Moodle made for them", async () => {
    const { state, before, course, info, actions } = restoredCourse();
    const context = await site(state);
    const result = await placeRestored(context, SITE, 9, info, before as never, new Map(), { sectionId: 12 });
    assert.equal(layout(course), "General:1 | New section:2 | Unit 2:101,102,103,104");
    assert.deepEqual(result, { sectionIds: [], activityIds: [101, 102, 103, 104] });
    assert.ok(actions.includes("cm_move 101,102,103,104 -> 12") && actions.includes("section_delete 13"), actions.join("\n"));
    await context.close();
  });
});

/** The import wizard's schema and confirmation stages, reduced, and its last page. */
const importStage = (posted: URLSearchParams) => {
  const stage = Number(posted.get("stage") ?? 0);
  const form = (fields: string) => `<form class="mform" method="post" action="${SITE}backup/import.php"><input type="hidden" name="backup" value="i1">${fields}<input type="submit" name="submitbutton" value="Next"></form>`;
  const box = (name: string) => `<input type="hidden" name="${name}" value="0"><input type="checkbox" name="${name}" value="1" checked>`;
  if (!stage) return form(`<input type="hidden" name="stage" value="2">${box("setting_activity_page_5_included")}${box("setting_activity_quiz_7_included")}`);
  if (stage === 2) return form('<input type="hidden" name="stage" value="4">');
  return '<div class="backup_progress"><span class="backup_stage backup_stage_current">5. Complete</span></div>';
};

describe("importActivities", { skip: !browser && "no system browser" }, () => {
  it("imports only the activities asked for, and answers with those the course has new", async () => {
    const context = await browser!.newContext();
    let states = 0;
    await serveFakeMoodle(context, {
      user: { id: 2, fullName: "Admin" },
      services: { core_courseformat_get_state: () => JSON.stringify({ cm: ++states > 1 ? [{ id: "1" }, { id: "20" }] : [{ id: "1" }] }) },
    });
    const posts = await serveStages(context, "backup/import.php", importStage);
    assert.deepEqual(await importActivities(context, SITE, 3, 9, { activityIds: [5] }), { changed: "Imported 1 activity from course 3 into course 9.", activityIds: [20] });
    assert.deepEqual([posts[0]!.getAll("setting_activity_page_5_included"), posts[0]!.getAll("setting_activity_quiz_7_included")], [["0", "1"], ["0"]]);
    await assert.rejects(importActivities(context, SITE, 3, 9, { activityIds: [99] }), BackupError);
    await context.close();
  });
});

describe("brokenInActivity", () => {
  it("names the restrictions Moodle restored broken and the links to activities outside the course", () => {
    const availability = JSON.stringify({ op: "&", c: [{ type: "completion", cm: 0, e: 1 }, { type: "completion", cm: 31, e: 1 }, { type: "completion", cm: -1, e: 1 }, { type: "grade", id: 0 }, { type: "group", id: -1 }, { type: "date", d: ">=", t: 1 }] });
    const texts = [`<a href="${SITE}mod/page/view.php?id=31">ok</a> <a href="${SITE}mod/page/view.php?id=12">here</a> <a href="https://old.example.org/mod/quiz/view.php?id=31&amp;x=1">there</a>`];
    const warnings = brokenInActivity({ id: 40, name: "Check" }, availability, texts, new Set([31, 40]), SITE);
    assert.deepEqual(
      warnings.map((w) => [w.kind, w.condition ?? w.url]),
      [
        ["restriction", "completion"],
        ["restriction", "grade"],
        ["restriction", "group"],
        ["link", `${SITE}mod/page/view.php?id=12`],
        ["link", "https://old.example.org/mod/quiz/view.php?id=31"],
      ],
    );
    assert.match(warnings[3]!.message, /^Activity 40 "Check" links to .*id=12, an activity outside this course/);
    assert.match(warnings[4]!.message, /on another site/);
    assert.deepEqual(brokenInActivity({ id: 40, name: "Check" }, undefined, [], new Set(), SITE), []);
  });
});
