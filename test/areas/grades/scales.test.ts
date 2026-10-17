import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { GradebookError, addScale, courseScales, editScale, gradeLetters, setGradeLetters } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const fatal = (message: string) => `<div data-rel="fatalerror"><p class="errormessage">${message}</p></div>`;

interface Scale {
  id: number;
  name: string;
  scale: string;
  used: boolean;
  site: boolean;
}

/** A made-up course 9 (context 900): its scales and grade letters, the pages and forms that change them, as Moodle 5.2 renders them, reduced. */
interface FakeGrades {
  canManage: boolean;
  /** Whether the person can manage the site's scales: their rows get links then. */
  siteManager: boolean;
  scales: Scale[];
  letters?: { letter: string; boundary: number }[];
  posts: Record<string, string>[];
}

const SITE_LETTERS = [
  { letter: "A", boundary: 90 },
  { letter: "B", boundary: 70 },
  { letter: "F", boundary: 0 },
];

function scaleRows(fake: FakeGrades, site: boolean): string {
  return fake.scales
    .filter((s) => s.site === site)
    .map((s) => {
      const links = !site || fake.siteManager ? `<a href="edit.php?courseid=9&amp;id=${s.id}" class="action-icon">E</a>${s.used ? "" : `<a href="index.php?id=9&amp;scaleid=${s.id}&amp;action=delete&amp;sesskey=s1">D</a>`}` : "";
      return `<tr><td class="cell c0">${s.name}<div class="scale_options">${s.scale.replaceAll(",", ", ")}</div></td><td class="cell c1">${s.used ? "Yes" : "No"}</td><td class="cell c2">${links}</td></tr>`;
    })
    .join("");
}

/** The scales page: Moodle gives the course's table the site's class when both show, and the site's table none of its own. */
function scalesPage(fake: FakeGrades): string {
  const local = scaleRows(fake, false);
  const site = scaleRows(fake, true);
  return `${local ? `<h3>Custom scales</h3><table class="scaletable ${site ? "globalscales" : "localscales"} table generaltable"><thead><tr><th>Scale</th><th>Used</th><th>Edit</th></tr></thead><tbody>${local}</tbody></table>` : ""}${site ? `<h3>Standard scales</h3><table class="generaltable table"><thead><tr><th>Scale</th><th>Used</th><th>Edit</th></tr></thead><tbody>${site}</tbody></table>` : ""}`;
}

function scaleForm(scale?: Scale): string {
  const values = scale && scale.used ? `<div class="form-control-static">${scale.scale}</div>` : `<textarea name="scale" id="id_scale">${scale?.scale ?? ""}</textarea>`;
  return `<form class="mform" action="${SITE}grade/edit/scale/edit.php" method="post"><input name="id" type="hidden" value="${scale?.id ?? 0}"><input name="courseid" type="hidden" value="9"><input name="sesskey" type="hidden" value="s1"><input name="_qf__edit_scale_form" type="hidden" value="1">
<input type="text" name="name" id="id_name" value="${scale?.name ?? ""}"><input type="hidden" name="standard" value="0"><input type="checkbox" name="standard" value="1" disabled>${values}
<textarea id="id_description_editor" name="description_editor[text]"></textarea><input type="submit" name="submitbutton" value="Save changes"><input type="submit" name="cancel" value="Cancel"></form>`;
}

function lettersForm(fake: FakeGrades, rows: number): string {
  const letters = fake.letters ?? SITE_LETTERS;
  const disabled = fake.letters ? "" : " disabled";
  const fields = Array.from({ length: Math.max(rows, letters.length) }, (_, i) => `<input type="text" name="gradeletter[${i}]" value="${letters[i]?.letter ?? ""}"${disabled}><input type="text" name="gradeboundary[${i}]" value="${letters[i]?.boundary ?? ""}"${disabled}>`).join("");
  // Moodle's disabledIf, reduced: ticking "override" enables the rows.
  return `<form class="mform" id="mform1" action="${SITE}grade/edit/letter/index.php?id=900&amp;edit=1" method="post"><input name="gradeentrycount" type="hidden" value="${Math.max(rows, letters.length)}"><input name="id" type="hidden" value="900"><input name="sesskey" type="hidden" value="s1"><input name="_qf__edit_letter_form" type="hidden" value="1">
<input type="checkbox" name="override" value="1" id="id_override"${fake.letters ? " checked" : ""} onchange="for (const f of document.querySelectorAll('[name^=gradeletter], [name^=gradeboundary]')) f.disabled = !this.checked">${fields}<input type="submit" name="submitbutton" value="Save changes"></form>`;
}

async function serve(context: BrowserContext, fake: FakeGrades): Promise<void> {
  await serveFakeMoodle(context, {
    user: { id: 3, fullName: "Teacher" },
    services: {
      core_get_string: () => "Yes",
      // The item form lists the course's scales, then the site's, as Moodle does.
      core_form_dynamic_form: () => ({ html: `<form class="mform"><select name="scaleid"><option value="0">Use no scale</option>${[...fake.scales.filter((s) => !s.site), ...fake.scales.filter((s) => s.site)].map((s) => `<option value="${s.id}">${s.name}</option>`).join("")}</select></form>` }),
    },
  });
  const page = (body: string, bodyId: string, extra: { contextId?: number; bodyClass?: string } = {}) => moodlePage({ userId: 3, bodyId, body: `<div role="main">${body}</div>`, ...extra });
  await context.route(`${SITE}course/view.php**`, (route: Route) => route.fulfill({ status: 200, contentType: "text/html", body: page("", "page-course-view-topics", { contextId: 900, bodyClass: "course-9 context-900" }) }));
  await context.route(`${SITE}grade/edit/**`, (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const form = Object.fromEntries(new URLSearchParams(request.postData() ?? ""));
    const html = (body: string, bodyId: string) => route.fulfill({ status: 200, contentType: "text/html", body: page(body, bodyId) });
    if (request.method() === "POST") fake.posts.push(form);
    if (url.pathname.startsWith("/grade/edit/scale/")) {
      if (!fake.canManage) return html(fatal("Sorry, but you do not currently have permissions to do that (Manage scales)."), "page-grade-edit-scale-index");
      if (url.pathname.endsWith("/edit.php")) {
        if (request.method() === "POST") {
          const scale = fake.scales.find((s) => s.id === Number(form.id));
          const values = (form.scale ?? scale?.scale ?? "").split(",").map((v) => v.trim()).join(",");
          if (fake.scales.some((s) => s !== scale && !s.site && s.scale === values)) return html(scaleForm(scale).replace("</textarea>", '</textarea><div id="id_error_scale">This scale is a duplicate.</div>'), "page-grade-edit-scale-edit");
          if (scale) Object.assign(scale, { name: form.name, scale: values });
          else fake.scales.push({ id: Math.max(...fake.scales.map((s) => s.id)) + 1, name: form.name!, scale: values, used: false, site: false });
          return html(scalesPage(fake), "page-grade-edit-scale-index");
        }
        const scale = fake.scales.find((s) => s.id === Number(url.searchParams.get("id")));
        if (scale?.site && !fake.siteManager) return html(fatal("Sorry, but you do not currently have permissions to do that (Manage scales)."), "page-grade-edit-scale-edit");
        return html(scaleForm(scale), "page-grade-edit-scale-edit");
      }
      return html(scalesPage(fake), "page-grade-edit-scale-index");
    }
    if (url.pathname === "/grade/edit/letter/index.php" && url.searchParams.get("id") === "900") {
      if (!fake.canManage) return html(fatal("Sorry, but you do not currently have permissions to do that (Manage letter grades)."), "page-site-index");
      if (request.method() === "POST") {
        if (form.override !== "1") delete fake.letters;
        else {
          fake.letters = Array.from({ length: Number(form.gradeentrycount) }, (_, i) => ({ letter: form[`gradeletter[${i}]`] ?? "", boundary: Number(form[`gradeboundary[${i}]`]) }))
            .filter((l) => l.letter !== "")
            .sort((a, b) => b.boundary - a.boundary);
        }
        return html("<table id=\"grade-letters-view\"></table>", "page-grade-edit-letter-index");
      }
      return html(lettersForm(fake, Number(url.searchParams.get("gradeentrycount") ?? 0)), "page-grade-edit-letter-index");
    }
    return html(fatal("Not served by the fake"), "page-site-index");
  });
}

async function site(overrides: Partial<FakeGrades> = {}) {
  const context = await browser!.newContext();
  const fake: FakeGrades = {
    canManage: true,
    siteManager: false,
    scales: [
      { id: 1, name: "Separate and Connected ways of knowing", scale: "Mostly separate knowing,Separate and connected,Mostly connected knowing", used: true, site: true },
      { id: 2, name: "Default competence scale", scale: "Not yet competent,Competent", used: false, site: true },
      { id: 7, name: "Effort", scale: "Low,Medium,High", used: true, site: false },
      { id: 8, name: "Stars", scale: "One,Two,Three", used: false, site: false },
    ],
    posts: [],
    ...overrides,
  };
  await serve(context, fake);
  return { context, fake };
}

describe("courseScales", { skip: !browser && "no system browser" }, () => {
  it("reads the course's scales and the site's, their ids from the item form where the page has no links", async () => {
    const { context } = await site();
    assert.deepEqual(await courseScales(context, SITE, 9), [
      { id: 7, name: "Effort", items: ["Low", "Medium", "High"], used: true, site: false },
      { id: 8, name: "Stars", items: ["One", "Two", "Three"], used: false, site: false },
      { id: 1, name: "Separate and Connected ways of knowing", items: ["Mostly separate knowing", "Separate and connected", "Mostly connected knowing"], used: true, site: true },
      { id: 2, name: "Default competence scale", items: ["Not yet competent", "Competent"], used: false, site: true },
    ]);
    await context.close();
  });

  it("reads the site's scales by their links for someone who manages them, and only the site's when the course has none", async () => {
    const { context, fake } = await site({ siteManager: true });
    fake.scales = fake.scales.filter((s) => s.site);
    assert.deepEqual(
      (await courseScales(context, SITE, 9)).map((s) => [s.id, s.used, s.site]),
      [
        [1, true, true],
        [2, false, true],
      ],
    );
    await context.close();
  });

  it("names the capability when the person can't manage scales", async () => {
    const { context } = await site({ canManage: false });
    await assert.rejects(courseScales(context, SITE, 9), (error: Error) => error instanceof GradebookError && /moodle\/course:managescales/.test(error.message) && /Manage scales/.test(error.message));
    await context.close();
  });
});

describe("addScale and editScale", { skip: !browser && "no system browser" }, () => {
  it("adds a course scale and returns it", async () => {
    const { context, fake } = await site();
    const added = await addScale(context, SITE, 9, { name: "Grades", items: ["Poor", " Fair", "Good"], description: "<p>Ours</p>" });
    assert.deepEqual(added.scale, { id: 9, name: "Grades", items: ["Poor", "Fair", "Good"], used: false, site: false });
    assert.equal(added.changed, 'Scale 9 "Grades" added to course 9.');
    assert.equal(fake.posts[0]!.scale, "Poor,Fair,Good");
    assert.equal(fake.posts[0]!["description_editor[text]"], "<p>Ours</p>");
    await assert.rejects(addScale(context, SITE, 9, { name: "Again", items: ["Poor", "Fair", "Good"] }), (error: Error) => error instanceof GradebookError && /duplicate/.test(error.message));
    await assert.rejects(addScale(context, SITE, 9, { name: "Commas", items: ["a,b"] }), /comma/);
    await context.close();
  });

  it("edits an unused scale's values, a used one's name only", async () => {
    const { context } = await site();
    assert.deepEqual((await editScale(context, SITE, 9, 8, { items: ["One", "Two", "Three", "Four"] })).scale?.items, ["One", "Two", "Three", "Four"]);
    await assert.rejects(editScale(context, SITE, 9, 7, { items: ["Low", "High"] }), (error: Error) => error instanceof GradebookError && /in use/.test(error.message));
    const renamed = await editScale(context, SITE, 9, 7, { name: "Effort made" });
    assert.deepEqual([renamed.scale?.name, renamed.scale?.items], ["Effort made", ["Low", "Medium", "High"]]);
    await assert.rejects(editScale(context, SITE, 9, 99, { name: "x" }), /no scale 99/);
    await assert.rejects(editScale(context, SITE, 9, 2, { name: "x" }), /site scale 2.*moodle\/course:managescales on the whole site/);
    await context.close();
  });
});

describe("gradeLetters and setGradeLetters", { skip: !browser && "no system browser" }, () => {
  it("reads the site's defaults, sets the course's own, and goes back", async () => {
    const { context, fake } = await site();
    assert.deepEqual(await gradeLetters(context, SITE, 9), { overridden: false, letters: [{ letter: "A", minGrade: 90 }, { letter: "B", minGrade: 70 }, { letter: "F", minGrade: 0 }] });
    const set = await setGradeLetters(context, SITE, 9, [
      { letter: "Pass", minGrade: 50 },
      { letter: "Fail", minGrade: 0 },
    ]);
    assert.deepEqual([set.overridden, set.letters], [true, [{ letter: "Pass", minGrade: 50 }, { letter: "Fail", minGrade: 0 }]]);
    // The site's three rows are all written: the one left over empty, so Moodle drops it.
    assert.deepEqual([fake.posts[0]!["gradeletter[2]"], fake.posts[0]!["gradeboundary[2]"]], ["", ""]);
    assert.equal(set.changed, "Course 9's grade letters set: Pass from 50%, Fail from 0%.");
    const back = await setGradeLetters(context, SITE, 9, null);
    assert.deepEqual([back.overridden, back.letters.length, back.changed], [false, 3, "Course 9's grade letters are the site's defaults again."]);
    await assert.rejects(setGradeLetters(context, SITE, 9, [{ letter: "A", minGrade: 120 }]), /0 to 100/);
    await assert.rejects(setGradeLetters(context, SITE, 9, [{ letter: "A", minGrade: 50 }, { letter: "B", minGrade: 50 }]), /same minGrade/);
    await context.close();
  });

  it("names the capability when the person can't manage letters", async () => {
    const { context } = await site({ canManage: false });
    await assert.rejects(gradeLetters(context, SITE, 9), (error: Error) => error instanceof GradebookError && /moodle\/grade:manageletters/.test(error.message));
    await context.close();
  });
});
