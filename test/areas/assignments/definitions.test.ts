import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import { GradingError, MoodleError, setGradingDefinition, type GradingCriterion } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A made-up assignment's advanced grading area (area 5), as Moodle 5.2's pages show it. */
interface Area {
  method: "none" | "rubric" | "guide";
  /** The saved definitions, by method, as the editors show them. */
  saved: Partial<Record<"rubric" | "guide", GradingCriterion[]>>;
  /** Graded with already: the editor offers no draft button. */
  used?: boolean;
  /** The manage page refuses the person (no moodle/grade:managegradingforms). */
  refused?: boolean;
  /** The editor comes back with this notification instead of saving. */
  rejects?: string;
  setMethods: string[];
  posts: URLSearchParams[];
}

const page = (body: string, bodyId: string) => moodlePage({ userId: 3, body, bodyId });

function managePage(area: Area): string {
  if (area.refused) return page('<div data-rel="fatalerror"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Manage advanced grading methods).</p></div>', "page-grade-grading-manage");
  const option = (value: string) => `<option value="${value}"${area.method === value ? " selected" : ""}>${value}</option>`;
  return page(`<form method="get" action="${SITE}grade/grading/manage.php" id="activemethodselector"><input type="hidden" name="areaid" value="5"><input type="hidden" name="sesskey" value="s1"><select name="setmethod">${option("guide")}${option("rubric")}${option("none")}</select></form>`, "page-grade-grading-manage");
}

function editorPage(area: Area, method: "rubric" | "guide", notice = ""): string {
  const saved = area.saved[method];
  let criteria: string;
  if (method === "rubric") {
    const rows = saved ?? [{ id: "NEWID1", description: "", levels: [0, 1, 2].map((l) => ({ id: `NEWID${l}`, definition: "", score: l })) }];
    criteria = rows
      .map((c) => {
        const p = `rubric[criteria][${c.id}]`;
        const levels = (c.levels ?? []).map((l) => `<textarea name="${p}[levels][${l.id}][definition]">${l.definition}</textarea><input type="text" name="${p}[levels][${l.id}][score]" value="${l.score}"><input type="submit" name="${p}[levels][${l.id}][delete]">`).join("");
        return `<input type="submit" name="${p}[delete]"><input type="hidden" name="${p}[sortorder]" value="1"><textarea name="${p}[description]">${c.description}</textarea>${levels}<input type="submit" name="${p}[levels][addlevel]">`;
      })
      .join("");
  } else {
    const rows = saved ?? [{ id: "NEWID1", description: "", maxScore: "" }];
    criteria =
      rows
        .map((c) => {
          const p = `guide[criteria][${c.id}]`;
          return `<textarea name="${p}[shortname]">${c.description}</textarea><textarea name="${p}[description]">${"details" in c ? (c.details ?? "") : ""}</textarea><textarea name="${p}[descriptionmarkers]">${"markers" in c ? (c.markers ?? "") : ""}</textarea><input type="text" name="${p}[maxscore]" value="${c.maxScore}">`;
        })
        .join("") + '<textarea name="guide[comments][NEWID1][description]"></textarea><input type="submit" name="guide[comments][addcomment]">';
  }
  const draft = area.used ? "" : `<input type="submit" name="save${method}draft" value="Save as draft">`;
  return page(
    `<form class="mform" method="post" action="${SITE}grade/grading/form/${method}/edit.php"><input type="hidden" name="areaid" value="5"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="_qf__gradingform_${method}_edit${method}" value="1">
<input type="text" name="name" value=""><textarea name="description_editor[text]"></textarea>${notice ? `<div class="alert alert-danger">${notice}</div>` : ""}
<div id="${method}-${method}">${criteria}<input type="submit" name="${method}[criteria][addcriterion]"></div><input type="hidden" name="${method}[options][alwaysshowdefinition]" value="1">
<input type="submit" name="save${method}" value="Save">${draft}</form>`,
    `page-grade-grading-form-${method}-edit`,
  );
}

/** Saves what the editor posted as Moodle does: new criteria and levels get ids, the ones left out are gone. */
function save(area: Area, method: "rubric" | "guide", form: URLSearchParams): void {
  let next = 100;
  const criteria = new Map<string, GradingCriterion>();
  for (const [name, value] of form) {
    const match = new RegExp(`^${method}\\[criteria\\]\\[(\\w+)\\]\\[(\\w+)\\](?:\\[(\\w+)\\]\\[(\\w+)\\])?$`).exec(name);
    if (!match) continue;
    const [, key, field, levelKey, levelField] = match;
    if (!criteria.has(key!)) criteria.set(key!, { id: next++, description: "", ...(method === "rubric" ? { levels: [] } : {}) });
    const criterion = criteria.get(key!)!;
    if (field === "levels") {
      if (levelField === "definition") criterion.levels!.push({ id: next++, definition: value, score: Number(form.get(`${method}[criteria][${key}][levels][${levelKey}][score]`)) });
    } else if (field === "description" && method === "rubric") criterion.description = value;
    else if (field === "shortname") criterion.description = value;
    else if (field === "description" && value) criterion.details = value;
    else if (field === "descriptionmarkers" && value) criterion.markers = value;
    else if (field === "maxscore") criterion.maxScore = Number(value);
  }
  area.saved[method] = [...criteria.values()];
}

async function serveArea(context: BrowserContext, area: Area, activityId: number): Promise<FakeMoodleState> {
  const state: FakeMoodleState = { user: { id: 3, fullName: "Teacher" }, pagesServed: [], bodies: { "/mod/assign/view.php": `<div data-assignmentid="${activityId * 10}" data-contextid="${activityId * 100}"></div>` } };
  await serveFakeMoodle(context, state);
  const html = (route: Route, body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
  await context.route(`${SITE}grade/grading/manage.php**`, (route) => {
    const url = new URL(route.request().url());
    const method = url.searchParams.get("setmethod");
    if (method && url.searchParams.get("sesskey") === "s1") {
      area.setMethods.push(method);
      area.method = method as Area["method"];
    }
    return html(route, managePage(area));
  });
  await context.route(`${SITE}grade/grading/form/*/edit.php**`, (route) => {
    const method = new URL(route.request().url()).pathname.includes("/rubric/") ? "rubric" : "guide";
    if (route.request().method() !== "POST") return html(route, editorPage(area, method));
    const form = new URLSearchParams(route.request().postData() ?? "");
    area.posts.push(form);
    if (area.rejects) return html(route, editorPage(area, method, area.rejects));
    save(area, method, form);
    // Moodle redirects to the advanced grading page; served in place here.
    return html(route, managePage(area));
  });
  return state;
}

const newArea = (overrides: Partial<Area> = {}): Area => ({ method: "none", saved: {}, setMethods: [], posts: [], ...overrides });
const RUBRIC = {
  method: "rubric" as const,
  name: "Loops",
  description: "<p>How loops are graded</p>",
  criteria: [
    {
      description: "Explains a loop",
      levels: [
        { definition: "No", score: 0 },
        { definition: "Clearly", score: 2 },
      ],
    },
  ],
};

describe("setGradingDefinition", { skip: !browser && "no system browser" }, () => {
  it("defines a rubric where there's none, setting the method, and gives it back with its ids", async () => {
    const context = await browser!.newContext();
    const area = newArea();
    await serveArea(context, area, 61);
    const saved = await setGradingDefinition(context, SITE, 61, RUBRIC);
    assert.deepEqual(area.setMethods, ["rubric"]);
    const [posted] = area.posts;
    // The editor's empty criterion is gone: only the definition's fields, as new ones.
    assert.deepEqual(
      [...posted!.keys()].filter((name) => name.startsWith("rubric[criteria]")),
      ["rubric[criteria][NEWID1][description]", "rubric[criteria][NEWID1][levels][NEWID0][definition]", "rubric[criteria][NEWID1][levels][NEWID0][score]", "rubric[criteria][NEWID1][levels][NEWID1][definition]", "rubric[criteria][NEWID1][levels][NEWID1][score]"],
    );
    assert.deepEqual([posted!.get("name"), posted!.get("description_editor[text]"), posted!.get("saverubric"), posted!.has("saverubricdraft"), posted!.get("rubric[options][alwaysshowdefinition]")], ["Loops", "<p>How loops are graded</p>", "Save", false, "1"]);
    assert.deepEqual(saved, {
      changed: 'Defined assignment 61\'s rubric "Loops" (1 criterion), ready for use, and set its grading method to rubric.',
      assignment: { id: 61 },
      method: "rubric",
      criteria: [{ id: 100, description: "Explains a loop", levels: [{ id: 101, definition: "No", score: 0 }, { id: 102, definition: "Clearly", score: 2 }] }],
    });
    await context.close();
  });

  it("replaces a marking guide, its criteria and comments, without touching the method it already has", async () => {
    const context = await browser!.newContext();
    const area = newArea({ method: "guide", saved: { guide: [{ id: 7, description: "Old", maxScore: 3 }] } });
    await serveArea(context, area, 62);
    const saved = await setGradingDefinition(context, SITE, 62, { method: "guide", name: "Essay", criteria: [{ shortName: "Clarity", description: "Is it clear", markers: "Look at the intro", maxScore: 4 }, { shortName: "Depth", maxScore: 6 }], comments: ["Well done"] });
    assert.deepEqual(area.setMethods, []);
    const posted = area.posts[0]!;
    assert.equal([...posted.keys()].some((name) => name.includes("[7]")), false, "the old criterion isn't sent: Moodle deletes it");
    assert.deepEqual([posted.get("guide[criteria][NEWID2][maxscore]"), posted.get("guide[comments][NEWID1][description]"), posted.get("saveguide")], ["6", "Well done", "Save"]);
    assert.equal(saved.changed, 'Replaced assignment 62\'s marking guide "Essay" (2 criteria), ready for use.');
    assert.deepEqual(saved.criteria, [
      { id: 100, description: "Clarity", details: "Is it clear", markers: "Look at the intro", maxScore: 4 },
      { id: 101, description: "Depth", maxScore: 6 },
    ]);
    await context.close();
  });

  it("refuses a definition already used for grading, changing nothing, the method neither", async () => {
    const context = await browser!.newContext();
    const area = newArea({ method: "guide", used: true, saved: { rubric: [{ id: 7, description: "Old", levels: [{ id: 8, definition: "A", score: 0 }, { id: 9, definition: "B", score: 1 }] }] } });
    await serveArea(context, area, 63);
    await assert.rejects(setGradingDefinition(context, SITE, 63, RUBRIC), (error: Error) => error instanceof GradingError && /already been used for grading/.test(error.message));
    assert.deepEqual([area.posts.length, area.setMethods, area.method], [0, [], "guide"]);
    await context.close();
  });

  it("names the capability when Moodle refuses the advanced grading page", async () => {
    const context = await browser!.newContext();
    const area = newArea({ refused: true });
    await serveArea(context, area, 64);
    await assert.rejects(setGradingDefinition(context, SITE, 64, RUBRIC), (error: Error) => error instanceof GradingError && /moodle\/grade:managegradingforms/.test(error.message) && /Manage advanced grading methods/.test(error.message));
    assert.equal(area.posts.length, 0);
    await context.close();
  });

  it("gives Moodle's reasons when its editor doesn't save the definition", async () => {
    const context = await browser!.newContext();
    const area = newArea({ method: "rubric", rejects: "There must be a variation in the score" });
    await serveArea(context, area, 65);
    await assert.rejects(setGradingDefinition(context, SITE, 65, RUBRIC), (error: Error) => error instanceof GradingError && /didn't save assignment 65's rubric: There must be a variation/.test(error.message));
    await context.close();
  });

  it("refuses what Moodle's editor wouldn't take before opening anything", async () => {
    const context = await browser!.newContext();
    const area = newArea();
    const state = await serveArea(context, area, 66);
    const invalid = (error: Error) => error instanceof MoodleError && error.code === "invalid-input";
    await assert.rejects(setGradingDefinition(context, SITE, 66, { ...RUBRIC, criteria: [{ description: "One level", levels: [{ definition: "Only", score: 1 }] }] }), invalid);
    await assert.rejects(setGradingDefinition(context, SITE, 66, { ...RUBRIC, name: " " }), invalid);
    await assert.rejects(setGradingDefinition(context, SITE, 66, { method: "guide", name: "G", criteria: [{ shortName: "A", maxScore: -1 }] }), invalid);
    await assert.rejects(setGradingDefinition(context, SITE, 66, { method: "guide", name: "G", criteria: [] }), invalid);
    assert.deepEqual(state.pagesServed, []);
    await context.close();
  });
});
