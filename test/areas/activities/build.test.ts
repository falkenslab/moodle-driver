import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { ActivitySettingsError, FormError, MoodleServiceError, activitySettings, addSection, createActivity, deleteActivity, deleteSection, duplicateActivity, editActivity, editSection, updateActivity, type CourseChange } from "../../../src/index.js";
import { type CourseState } from "../../../src/areas/courses/state.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
let dir: string;
before(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "moodle-driver-forms-"));
  await writeFile(path.join(dir, "brief.txt"), "Write a program.\n");
});
after(async () => {
  await browser?.close();
  await rm(dir, { recursive: true, force: true });
});

/** An activity form reduced to what the driver touches, shaped like Moodle 5.2's `modedit.php`; made up. */
function activityForm(values: { name?: string; error?: string; fileField?: string } = {}): string {
  return `<form class="mform" action="modedit.php" method="post">
<input type="hidden" name="course" value="5"><input type="hidden" name="modulename" value="resource"><input type="hidden" name="sesskey" value="s1">
<input type="text" name="name" id="id_name" value="${values.name ?? ""}"><div id="id_error_name">${values.error ?? ""}</div>
<textarea name="introeditor[text]" id="id_introeditor"></textarea>
<input type="hidden" name="showdescription" value="0"><input type="checkbox" name="showdescription" value="1">
<input type="hidden" name="${values.fileField ?? "files"}" value="777">
<select name="visible"><option value="1">Show</option><option value="0">Hide</option></select>
<input type="submit" name="submitbutton2" value="Save and return"></form>
<script>var filepicker = {"repositories":{"5":{"id":"5","name":"Upload a file","type":"upload"}}};</script>`;
}

describe("createActivity and updateActivity", { skip: !browser && "no system browser" }, () => {
  async function site(fileField?: string): Promise<{ context: BrowserContext; posts: URLSearchParams[]; uploads: string[]; course: CourseState; draft: Map<string, number>; mkdirs: string[] }> {
    const course: CourseState = { section: [{ id: "10", number: 0, title: "General", cmlist: [] }, { id: "11", number: 1, title: "Unit 1", cmlist: [] }], cm: [] };
    const posts: URLSearchParams[] = [];
    const uploads: string[] = [];
    // The activity's files while its form is open, by their path in the area (made up).
    const draft = new Map<string, number>();
    const mkdirs: string[] = [];
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, services: { core_courseformat_get_state: () => JSON.stringify(course) } });
    const page = (body: string) => moodlePage({ userId: 3, body });
    await context.route(`${SITE}course/modedit.php**`, (route: Route) => {
      const request = route.request();
      if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "text/html", body: page(activityForm({ fileField })) });
      const form = new URLSearchParams(request.postData() ?? "");
      posts.push(form);
      // Moodle sends the form back with its error by field; else the activity is saved.
      if (!form.get("name")) return route.fulfill({ status: 200, contentType: "text/html", body: page(activityForm({ error: "You must supply a value here." })) });
      const existing = course.cm.find((cm) => cm.id === "40");
      if (existing) existing.name = form.get("name")!;
      else {
        course.cm.push({ id: "40", name: form.get("name")!, module: "resource", visible: form.get("visible") === "1", sectionid: "11", url: `${SITE}mod/resource/view.php?id=40` });
        course.section[1]!.cmlist!.push("40");
      }
      return route.fulfill({ status: 200, contentType: "text/html", body: page("<p>Course page</p>") });
    });
    await context.route(`${SITE}repository/repository_ajax.php**`, (route: Route) => {
      const body = route.request().postData() ?? "";
      const field = (name: string) => new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`).exec(body)?.[1];
      uploads.push(`${field("itemid")}:${/filename="([^"]+)"/.exec(body)?.[1]}`);
      const name = `${field("savepath")}${field("title")}`;
      // Moodle keeps both, renaming the new one, unless asked to overwrite (Moodle 5.2's upload repository).
      if (draft.has(name) && field("overwrite") !== "1") return route.fulfill({ status: 200, contentType: "application/json", body: '{"event":"fileexists"}' });
      draft.set(name, /filename="[^"]+"\r\n(?:[^\r]+\r\n)*\r\n([^\r]*)/.exec(body)?.[1]?.length ?? 0);
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    // The file manager's draft area, made up after Moodle 5.2's draftfiles_ajax.php: a listing per folder, deleting, creating folders.
    await context.route(`${SITE}repository/draftfiles_ajax.php**`, (route: Route) => {
      const action = new URL(route.request().url()).searchParams.get("action");
      const form = new URLSearchParams(route.request().postData() ?? "");
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      const filepath = form.get("filepath") ?? "/";
      if (action === "list") {
        const list: { type: string; filepath: string; filename?: string; size?: number }[] = [];
        for (const [name, size] of draft) {
          if (!name.startsWith(filepath)) continue;
          const rest = name.slice(filepath.length);
          const folder = `${filepath}${rest.split("/")[0]}/`;
          if (!rest.includes("/")) list.push({ type: "file", filepath, filename: rest, size });
          else if (!list.some((entry) => entry.filepath === folder)) list.push({ type: "folder", filepath: folder });
        }
        return json({ list, filecount: draft.size });
      }
      if (action === "delete") return json(draft.delete(`${filepath}${form.get("filename")}`) ? { filepath } : false);
      if (action === "mkdir") {
        mkdirs.push(`${filepath}${form.get("newdirname")}/`);
        return json({ filepath });
      }
      return json(false);
    });
    return { context, posts, uploads, course, draft, mkdirs };
  }

  it("fills the form, uploads the files to its draft area, saves hidden and returns the new activity", async () => {
    const { context, posts, uploads } = await site();
    const result = await createActivity(context, SITE, { courseId: 5, sectionId: 11, type: "resource", name: "Brief", description: "<p>Read it</p>", files: [path.join(dir, "brief.txt")], settings: { showdescription: true } });
    assert.deepEqual([result.activityId, result.url, result.changed], [40, `${SITE}mod/resource/view.php?id=40`, 'Created resource 40 "Brief" in section 1.']);
    assert.deepEqual(result.sections[1]?.activities.map((a) => [a.id, a.visible]), [[40, false]]);
    assert.deepEqual(uploads, ["777:brief.txt"]);
    const sent = posts[0]!;
    assert.equal(sent.get("name"), "Brief");
    assert.equal(sent.get("introeditor[text]"), "<p>Read it</p>");
    assert.equal(sent.get("visible"), "0");
    assert.deepEqual(sent.getAll("showdescription"), ["0", "1"]);
    await context.close();
  });

  it("uploads a SCORM's package, the first file, to its packagefile field", async () => {
    const { context, uploads } = await site("packagefile");
    await writeFile(path.join(dir, "quiz.zip"), "PK");
    const result = await createActivity(context, SITE, { courseId: 5, sectionId: 11, type: "scorm", name: "Check", files: [path.join(dir, "quiz.zip"), path.join(dir, "brief.txt")] });
    assert.equal(result.activityId, 40);
    assert.deepEqual(uploads, ["777:quiz.zip"]);
    await context.close();
  });

  it("updates only what's given", async () => {
    const { context, posts } = await site();
    await createActivity(context, SITE, { courseId: 5, sectionId: 11, type: "resource", name: "Brief" });
    const result = await updateActivity(context, SITE, 40, { name: "Brief 2" });
    assert.deepEqual([result.activityId, result.changed], [40, 'Updated activity 40 "Brief 2".']);
    // The form's own value stays: the update didn't ask to change it.
    assert.equal(posts[1]?.get("visible"), "1");
    await context.close();
  });

  it("removes, adds (in subfolders) and overwrites a resource's files, and activitySettings lists them", async () => {
    const { context, posts, draft, mkdirs } = await site();
    draft.set("/brief.txt", 3).set("/old.txt", 4);
    await writeFile(path.join(dir, "notes.txt"), "Notes.\n");
    const result = await updateActivity(context, SITE, 40, { name: "Brief", files: { remove: ["old.txt"], add: [path.join(dir, "brief.txt"), { from: path.join(dir, "notes.txt"), to: "week1/day1/notes.txt" }] } });
    assert.equal(result.changed, "Updated activity 40 \"Brief\": removed old.txt and added brief.txt, week1/day1/notes.txt.");
    // brief.txt is overwritten (its new size), not kept beside the old one.
    assert.deepEqual(result.files, [{ name: "brief.txt", size: 17 }, { name: "week1/day1/notes.txt", size: 7 }]);
    assert.deepEqual(mkdirs, ["/week1/", "/week1/day1/"]);
    assert.equal(posts.length, 1);
    const settings = await activitySettings(context, SITE, 40);
    assert.deepEqual(settings.files, result.files);
    await context.close();
  });

  it("replaces the whole set of files", async () => {
    const { context, draft } = await site();
    draft.set("/a.txt", 1).set("/sub/b.txt", 2);
    const result = await updateActivity(context, SITE, 40, { name: "Brief", files: { replace: [path.join(dir, "brief.txt")] } });
    assert.deepEqual(result.files, [{ name: "brief.txt", size: 17 }]);
    assert.match(result.changed, /removed a\.txt, sub\/b\.txt and added brief\.txt/);
    await context.close();
  });

  it("refuses a file to remove that isn't there, and replace with add or remove, without saving", async () => {
    const { context, posts, draft } = await site();
    draft.set("/a.txt", 1);
    await assert.rejects(updateActivity(context, SITE, 40, { files: { remove: ["b.txt"] } }), (error: Error & { code?: string }) => error.code === "not-found" && /no file "b\.txt"; it has "a\.txt"/.test(error.message));
    await assert.rejects(updateActivity(context, SITE, 40, { files: { replace: [], remove: ["a.txt"] } }), (error: Error & { code?: string }) => error.code === "invalid-input");
    assert.equal(posts.length, 0);
    assert.deepEqual([...draft.keys()], ["/a.txt"]);
    await context.close();
  });

  it("returns Moodle's form errors by field, and refuses fields the form doesn't have", async () => {
    const { context, course } = await site();
    await assert.rejects(updateActivity(context, SITE, 40, { name: "x", settings: { name: "" } }), (error: unknown) => {
      assert.ok(error instanceof FormError);
      assert.deepEqual(error.fields, [{ field: "name", message: "You must supply a value here." }]);
      return true;
    });
    await assert.rejects(createActivity(context, SITE, { courseId: 5, sectionId: 11, type: "resource", name: "X", settings: { duedate: 1 } }), /no such field: duedate/);
    assert.equal(course.cm.length, 0);
    await context.close();
  });

  it("refuses relative paths and a section the course doesn't have", async () => {
    const { context, posts } = await site();
    await assert.rejects(createActivity(context, SITE, { courseId: 5, sectionId: 11, type: "resource", name: "X", files: ["brief.txt"] }), /absolute paths/);
    await assert.rejects(createActivity(context, SITE, { courseId: 5, sectionId: 99, type: "page", name: "X" }), /has no section 99/);
    assert.equal(posts.length, 0);
    await context.close();
  });
});

/**
 * A tiny course editor: a made-up course 5 whose state changes as Moodle's would for the actions
 * the driver sends, so each test checks both the calls and the structure they return.
 */
function fakeCourse(): { state: FakeMoodleState; renames: unknown[] } {
  const course: CourseState = {
    section: [
      { id: "10", number: 0, title: "General", visible: true, cmlist: ["20"] },
      { id: "11", number: 1, title: "Unit 1", visible: true, cmlist: ["21", "22"] },
    ],
    cm: [
      { id: "20", name: "News", module: "forum", visible: true, sectionid: "10" },
      { id: "21", name: "Notes", module: "page", visible: true, sectionid: "11" },
      { id: "22", name: "Task", module: "assign", visible: true, sectionid: "11" },
    ],
  };
  let nextId = 30;
  const renames: unknown[] = [];
  const sectionOf = (activityId: string) => course.section.find((s) => s.cmlist!.includes(activityId))!;
  const renumber = () => course.section.forEach((s, i) => (s.number = i));
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    bodyClasses: { "/course/view.php": "format-topics path-course" },
    services: {
      core_courseformat_get_state: () => JSON.stringify(course),
      core_update_inplace_editable: (args) => {
        renames.push(args);
        if (args.itemtype === "activityname") course.cm.find((cm) => cm.id === String(args.itemid))!.name = String(args.value);
        else course.section.find((s) => s.id === String(args.itemid))!.title = String(args.value);
        return { value: args.value };
      },
      core_courseformat_update_course: ({ action, ids, targetsectionid, targetcmid }) => {
        const [id] = (ids as number[]).map(String);
        const cm = course.cm.find((c) => c.id === id);
        const section = course.section.find((s) => s.id === id);
        // Moodle refuses ids the course doesn't have.
        if (String(action).startsWith("cm_") && !cm) throw new ServiceFailure("invalidrecord");
        if (String(action).startsWith("section_") && action !== "section_add" && !section) throw new ServiceFailure("invalidrecord");
        switch (action) {
          case "cm_hide":
            cm!.visible = false;
            break;
          case "cm_show":
            cm!.visible = true;
            break;
          case "cm_move": {
            const from = sectionOf(id!);
            from.cmlist = from.cmlist!.filter((c) => c !== id);
            const to = targetcmid ? sectionOf(String(targetcmid)) : course.section.find((s) => s.id === String(targetsectionid))!;
            const at = targetcmid ? to.cmlist!.indexOf(String(targetcmid)) : to.cmlist!.length;
            to.cmlist!.splice(at, 0, id!);
            cm!.sectionid = to.id;
            break;
          }
          case "cm_duplicate": {
            const copy = { ...cm!, id: String(nextId++), name: `${cm!.name} (copy)` };
            course.cm.push(copy);
            const list = sectionOf(id!).cmlist!;
            list.splice(list.indexOf(id!) + 1, 0, copy.id);
            break;
          }
          case "cm_delete":
            sectionOf(id!).cmlist = sectionOf(id!).cmlist!.filter((c) => c !== id);
            course.cm = course.cm.filter((c) => c.id !== id);
            break;
          case "section_add": {
            const at = targetsectionid ? course.section.findIndex((s) => s.id === String(targetsectionid)) + 1 : course.section.length;
            course.section.splice(at, 0, { id: String(nextId++), number: 0, title: "New section", visible: true, cmlist: [] });
            renumber();
            break;
          }
          case "section_hide":
            section!.visible = false;
            break;
          case "section_move_after": {
            course.section = course.section.filter((s) => s.id !== id);
            course.section.splice(course.section.findIndex((s) => s.id === String(targetsectionid)) + 1, 0, section!);
            renumber();
            break;
          }
          case "section_delete":
            course.cm = course.cm.filter((c) => !section!.cmlist!.includes(c.id));
            course.section = course.section.filter((s) => s.id !== id);
            renumber();
            break;
          default:
            throw new ServiceFailure("invalidaction");
        }
        return "[]";
      },
    },
  };
  return { state, renames };
}

describe("course layout", { skip: !browser && "no system browser" }, () => {
  async function site(state: FakeMoodleState): Promise<BrowserContext> {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    return context;
  }
  const layout = (r: CourseChange) => r.sections.map((s) => `${s.title}${s.visible ? "" : "(h)"}:${s.activities.map((a) => `${a.name}${a.visible ? "" : "(h)"}`).join(",")}`).join(" | ");

  it("renames, hides and moves an activity, and returns the new structure", async () => {
    const { state, renames } = fakeCourse();
    const context = await site(state);
    const result = await editActivity(context, SITE, 5, 22, { name: "Essay", visibility: "hidden", beforeActivityId: 21 });
    assert.equal(layout(result), "General:News | Unit 1:Essay(h),Notes");
    assert.deepEqual(renames, [{ component: "core_course", itemtype: "activityname", itemid: 22, value: "Essay" }]);
    assert.equal(result.changed, 'Activity 22 renamed to "Essay", made hidden, moved before activity 21.');
    await context.close();
  });

  it("duplicates an activity and gives the copy's id", async () => {
    const context = await site(fakeCourse().state);
    const result = await duplicateActivity(context, SITE, 5, 21);
    assert.equal(result.activityId, 30);
    assert.equal(layout(result), "General:News | Unit 1:Notes,Notes (copy),Task");
    await context.close();
  });

  it("adds a named section after another, renaming it through the course format", async () => {
    const { state, renames } = fakeCourse();
    const context = await site(state);
    const result = await addSection(context, SITE, 5, { name: "Unit 0", afterSectionId: 10 });
    assert.equal(result.sectionId, 30);
    assert.equal(layout(result), "General:News | Unit 0: | Unit 1:Notes,Task");
    assert.deepEqual(renames, [{ component: "format_topics", itemtype: "sectionname", itemid: 30, value: "Unit 0" }]);
    await context.close();
  });

  it("renames, hides and moves a section, deletes an activity and a section with its activities", async () => {
    const context = await site(fakeCourse().state);
    assert.equal(layout(await editSection(context, SITE, 5, 11, { name: "Unit A", visible: false, afterSectionId: 10 })), "General:News | Unit A(h):Notes,Task");
    assert.equal(layout(await deleteActivity(context, SITE, 5, 21)), "General:News | Unit A(h):Task");
    assert.equal(layout(await deleteSection(context, SITE, 5, 11)), "General:News");
    await context.close();
  });

  it("sets a section's description through its form, on adding it and after", async () => {
    const context = await site(fakeCourse().state);
    const posts: URLSearchParams[] = [];
    // A section's form, reduced, as Moodle 5.2's course/editsection.php renders it (made up).
    await context.route(`${SITE}course/editsection.php**`, (route: Route) => {
      if (route.request().method() === "POST") posts.push(new URLSearchParams(route.request().postData() ?? ""));
      const form = `<form class="mform" action="editsection.php" method="post"><input type="hidden" name="id" value="${new URL(route.request().url()).searchParams.get("id")}"><input type="hidden" name="course" value="5">
<input type="text" name="name" value=""><textarea name="summary_editor[text]" id="id_summary_editor"></textarea><input type="hidden" name="summary_editor[format]" value="1">
<textarea name="availabilityconditionsjson"></textarea><input type="submit" name="submitbutton" value="Save changes"></form>`;
      return route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 3, body: form }) });
    });
    const added = await addSection(context, SITE, 5, { name: "Unit 2", summary: "<p>Recursion.</p>" });
    assert.equal(added.changed, 'Section 30 added as "Unit 2" with a description.');
    const edited = await editSection(context, SITE, 5, 11, { summary: "<p>Loops, <em>again</em>.</p>" });
    assert.equal(edited.changed, "Section 11 description set.");
    assert.deepEqual(posts.map((p) => [p.get("summary_editor[text]"), p.get("name")]), [["<p>Recursion.</p>", ""], ["<p>Loops, <em>again</em>.</p>", ""]]);
    // The form edits any section by id: one of another course is refused before saving.
    await assert.rejects(editSection(context, SITE, 6, 11, { summary: "x" }), /Course 6 has no section 11/);
    assert.equal(posts.length, 2);
    await context.close();
  });

  it("passes Moodle's error for an activity or section the course doesn't have", async () => {
    const context = await site(fakeCourse().state);
    const invalid = (error: unknown) => error instanceof MoodleServiceError && error.errorcode === "invalidrecord";
    await assert.rejects(deleteActivity(context, SITE, 5, 99), invalid);
    await assert.rejects(editActivity(context, SITE, 5, 99, { visibility: "shown" }), invalid);
    await assert.rejects(duplicateActivity(context, SITE, 5, 99), invalid);
    await assert.rejects(editSection(context, SITE, 5, 99, { visible: false }), invalid);
    await assert.rejects(deleteSection(context, SITE, 5, 99), invalid);
    await context.close();
  });
});

/**
 * An assignment's settings form, reduced and made up, as Moodle 5.2 renders it: a name, a description,
 * a date selector, submission types, a completion radio group, and a maximum grade that stays
 * disabled until rescaling is chosen (grades exist), as Moodle's form dependencies do.
 */
const SETTINGS = `<form class="mform" id="mform1" action="modedit.php" method="post">
<input type="hidden" name="course" value="3"><input type="hidden" name="modulename" value="assign"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__mod_assign_mod_form" value="1">
<div class="fitem"><label for="id_name">Assignment name</label><input type="text" name="name" id="id_name" value="Loops"></div>
<div class="fitem"><label for="id_introeditor">Description</label><textarea name="introeditor[text]" id="id_introeditor">&lt;p&gt;Explain a loop.&lt;/p&gt;</textarea></div>
<div class="fitem fdate_time_selector"><p id="id_duedate_label">Due date</p>
<div class="fitem"><label class="visually-hidden" for="id_duedate_day">Day</label><select name="duedate[day]" id="id_duedate_day"><option value="15">15</option><option value="16" selected>16</option></select></div>
<input type="hidden" name="duedate[enabled]" value="0"><input type="checkbox" name="duedate[enabled]" id="id_duedate_enabled" value="1" checked><label for="id_duedate_enabled">Enable</label></div>
<div class="fitem"><input type="hidden" name="assignsubmission_onlinetext_enabled" value="0"><input type="checkbox" name="assignsubmission_onlinetext_enabled" id="id_ot" value="1" checked><label for="id_ot">Online text</label></div>
<div class="fitem"><label class="form-check-label"><input type="radio" name="completion" value="0" checked> None</label></div>
<div class="fitem"><label class="form-check-label"><input type="radio" name="completion" value="1"> Students mark it done</label></div>
<div class="fitem"><label for="id_rescale">Rescale existing grades</label><select name="grade[modgrade_rescalegrades]" id="id_rescale"><option value="">Choose</option><option value="no">No</option><option value="yes">Yes</option></select></div>
<div class="fitem"><label for="id_point">Maximum grade</label><input type="text" name="grade[modgrade_point]" id="id_point" value="100" disabled></div>
<input type="submit" name="submitbutton2" value="Save and return"></form>
<script>document.getElementById("id_rescale").addEventListener("change", (e) => { document.getElementById("id_point").disabled = e.target.value === ""; });</script>`;

describe("activitySettings", { skip: !browser && "no system browser" }, () => {
  it("reads every field by the name updateActivity takes, with labels, values, options and what's disabled", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "Teacher" }, bodies: { "/course/modedit.php": SETTINGS } });
    const settings = await activitySettings(context, SITE, 35);
    assert.deepEqual([settings.id, settings.module, settings.courseId, settings.name, settings.description], [35, "assign", 3, "Loops", "<p>Explain a loop.</p>"]);
    const byName = new Map(settings.fields.map((f) => [f.name, f]));
    assert.deepEqual(byName.get("duedate[day]"), { name: "duedate[day]", type: "date", label: "Due date (day)", value: "16" });
    assert.deepEqual(byName.get("duedate[enabled]"), { name: "duedate[enabled]", type: "checkbox", label: "Enable", value: "1", checked: true });
    assert.deepEqual(byName.get("completion"), { name: "completion", type: "radio", options: [{ value: "0", label: "None" }, { value: "1", label: "Students mark it done" }], value: "0" });
    assert.deepEqual(byName.get("grade[modgrade_point]"), { name: "grade[modgrade_point]", type: "text", label: "Maximum grade", value: "100", disabled: true });
    assert.ok(!byName.has("sesskey") && !byName.has("course") && !byName.has("_qf__mod_assign_mod_form"));
    await context.close();
  });

  it("gives Moodle's reason when there's no form to read", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 4, fullName: "Student" }, bodies: { "/course/modedit.php": `<div data-rel="fatalerror"><p class="errormessage">Sorry, no permission (Manage activities).</p></div>` } });
    await assert.rejects(activitySettings(context, SITE, 35), (error: Error) => error instanceof ActivitySettingsError && /no permission \(Manage activities\)/.test(error.message));
    await context.close();
  });
});
