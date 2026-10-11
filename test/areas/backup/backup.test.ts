import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { BackupError, backupCourse, copyCourse, importActivities, restoreCourse } from "../../../src/index.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

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

  it("says so when Moodle offers no backup", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 5, fullName: "Student" }, bodies: { "/backup/backup.php": ERROR_PAGE } });
    await assert.rejects(backupCourse(context, SITE, 3, "/tmp/backups"), BackupError);
    await context.close();
  });
});

describe("restoreCourse", { skip: !browser && "no system browser" }, () => {
  it("needs a file that's there, and a category for a new course", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 2, fullName: "Admin" } });
    await assert.rejects(restoreCourse(context, SITE, "/nowhere/backup.mbz", { into: 9 }), { code: "not-found" });
    await assert.rejects(restoreCourse(context, SITE, import.meta.filename, { into: "new" }), { code: "invalid-input" });
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
