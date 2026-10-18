import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";
import ts from "typescript";
import { FOLLOWED_PAGES, MOODLE_METHODS, createMoodle } from "../src/index.js";
import { UNFOLLOWED_METHODS } from "../src/followed-pages.js";
import { followPages } from "../src/core/session.js";
import { SITE, fakeBrowserManager, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/**
 * What each function of `src/` reaches, followed through its calls (resolved by the file's own
 * definitions and its relative imports): a page opened and followed (`openSitePage`, `fetchSitePage`
 * without `follow: false`) and an AJAX service (`callService`).
 */
function reachability(): (file: string, name: string) => { follows: boolean; ajax: boolean } {
  type Def = { refs: [string, string][]; follows: boolean; ajax: boolean };
  const defs = new Map<string, Def>();
  const files = readdirSync(SRC, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts") && !/^(testing|cli)[\\/]/.test(f));
  for (const relative of files) {
    const file = join(SRC, relative);
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
    const imports = new Map<string, [string, string]>();
    const local = new Map<string, ts.Node>();
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text.startsWith(".")) {
        const target = resolve(dirname(file), statement.moduleSpecifier.text.replace(/\.js$/, ".ts"));
        const bindings = statement.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) imports.set(element.name.text, [target, (element.propertyName ?? element.name).text]);
      } else if (ts.isFunctionDeclaration(statement) && statement.name && statement.body) local.set(statement.name.text, statement.body);
      else if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) local.set(d.name.text, d.initializer);
    }
    for (const [name, body] of local) {
      const def: Def = { refs: [], follows: false, ajax: false };
      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ["openSitePage", "fetchSitePage", "callService"].includes(node.expression.text)) {
          if (node.expression.text === "callService") def.ajax = true;
          else if (!node.arguments.some((a) => /follow:\s*false/.test(a.getText()))) def.follows = true;
          node.arguments.forEach(visit);
          return;
        }
        if (ts.isIdentifier(node) && node.text !== name) {
          if (local.has(node.text)) def.refs.push([file, node.text]);
          else if (imports.has(node.text)) def.refs.push(imports.get(node.text)!);
        }
        ts.forEachChild(node, visit);
      };
      visit(body);
      defs.set(`${file}#${name}`, def);
    }
  }
  const memo = new Map<string, { follows: boolean; ajax: boolean }>();
  const reach = (file: string, name: string, seen = new Set<string>()): { follows: boolean; ajax: boolean } => {
    const key = `${file}#${name}`;
    const def = defs.get(key);
    if (!def || seen.has(key)) return { follows: false, ajax: false };
    if (memo.has(key)) return memo.get(key)!;
    seen.add(key);
    const result = { follows: def.follows, ajax: def.ajax };
    for (const [f, n] of def.refs) {
      const r = reach(f, n, seen);
      result.follows ||= r.follows;
      result.ajax ||= r.ajax;
    }
    memo.set(key, result);
    return result;
  };
  return reach;
}

describe("FOLLOWED_PAGES", () => {
  it("has a page, or says it has none, for every method that works through AJAX alone", () => {
    const reach = reachability();
    // Where each method's function comes from, as client.ts imports it.
    const client = ts.createSourceFile("client.ts", readFileSync(join(SRC, "client.ts"), "utf8"), ts.ScriptTarget.Latest, true);
    const origin = new Map<string, string>();
    for (const statement of client.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) origin.set(e.name.text, resolve(SRC, statement.moduleSpecifier.text.replace(/\.js$/, ".ts")));
    }
    const ajaxOnly = MOODLE_METHODS.filter((name) => {
      const r = reach(origin.get(name)!, name);
      return r.ajax && !r.follows;
    });
    // The analysis finds them (a sanity check that it reads the code at all).
    assert.ok(ajaxOnly.includes("listCourses") && ajaxOnly.includes("editActivity") && !ajaxOnly.includes("courseBlocks"), ajaxOnly.join(", "));
    const missing = ajaxOnly.filter((name) => !(name in FOLLOWED_PAGES) && !UNFOLLOWED_METHODS.includes(name as never));
    assert.deepEqual(missing, [], `give these a page in FOLLOWED_PAGES, or list them in UNFOLLOWED_METHODS (src/followed-pages.ts): ${missing.join(", ")}`);
  });

  it("names only methods, none both with a page and without", () => {
    for (const name of [...Object.keys(FOLLOWED_PAGES), ...UNFOLLOWED_METHODS]) assert.ok(MOODLE_METHODS.includes(name), name);
    for (const name of UNFOLLOWED_METHODS) assert.ok(!(name in FOLLOWED_PAGES), name);
  });

  it("builds each page from the call's arguments and result", () => {
    assert.equal(FOLLOWED_PAGES.gradeSubmission!([7, 4, { grade: 8 }], {} as never), "mod/assign/view.php?id=7&action=grader&userid=4");
    assert.equal(FOLLOWED_PAGES.editActivity!([3, 12, {}], {} as never), "course/view.php?id=3");
    assert.equal(FOLLOWED_PAGES.discussion!([9], {} as never), "mod/forum/discuss.php?d=9");
    assert.equal(FOLLOWED_PAGES.deadlines!([], [] as never), "calendar/view.php?view=upcoming");
    assert.equal(FOLLOWED_PAGES.createEvent!([{ courseId: 3, name: "Exam", start: new Date(0) }], { changed: "", event: { id: 1, name: "Exam", type: "course", start: "2026-10-18T10:00:00.000Z", courseId: 3 } }), "calendar/view.php?view=day&time=1792317600&course=3");
  });
});

// Shaped like Moodle 5.2's answers; the data is made up.
const COURSES = { courses: [{ id: 3, shortname: "loops", fullname: "Loops", viewurl: `${SITE}course/view.php?id=3`, visible: true }] };
const STATE = { section: [{ id: "10", number: 0, title: "General", cmlist: ["20"] }], cm: [{ id: "20", name: "Welcome", module: "page", visible: true, uservisible: true, accessvisible: true, sectionid: "10", istrackeduser: false }] };

describe("The Moodle object's methods", { skip: !browser && "no system browser" }, () => {
  async function setUp(visible: boolean, show: (url: string) => Promise<void>) {
    const context = await browser!.newContext();
    const state: FakeMoodleState = {
      user: { id: 4, fullName: "Ada Lovelace" },
      pagesServed: [],
      bodies: { "/course/view.php": `<ul><li class="activity" data-for="cmitem" data-id="20"></li></ul>` },
      services: {
        core_course_get_enrolled_courses_by_timeline_classification: () => COURSES,
        core_courseformat_get_state: () => JSON.stringify(STATE),
      },
    };
    await serveFakeMoodle(context, state);
    followPages(context, show);
    const moodle = createMoodle({ site: SITE, browser: fakeBrowserManager({ context: async () => context, visible: () => visible }) });
    return { context, moodle, state };
  }

  it("show the page of an AJAX call's work while the browser is visible", async () => {
    const shown: string[] = [];
    const { context, moodle } = await setUp(true, async (url) => void shown.push(url));
    assert.deepEqual((await moodle.listCourses()).map((c) => c.id), [3]);
    await moodle.courseStructure(3);
    assert.deepEqual(shown, [`${SITE}my/courses.php`, `${SITE}course/view.php?id=3`]);
    await context.close();
  });

  it("show nothing more after a call that showed its own page", async () => {
    const shown: string[] = [];
    const { context, moodle } = await setUp(true, async (url) => void shown.push(url));
    // With details, the course page is opened (and followed) by the function itself.
    await moodle.courseStructure(3, { details: true });
    assert.deepEqual(shown, [`${SITE}course/view.php?id=3`]);
    await context.close();
  });

  it("show nothing, and load no page, while the browser is hidden", async () => {
    const shown: string[] = [];
    const { context, moodle, state } = await setUp(false, async (url) => void shown.push(url));
    await moodle.listCourses();
    await moodle.courseStructure(3);
    assert.deepEqual(shown, []);
    assert.deepEqual(state.pagesServed!.filter((p) => ["/my/courses.php", "/course/view.php"].includes(p)), []);
    await context.close();
  });

  it("return the call's result when the page can't be shown", async () => {
    const { context, moodle } = await setUp(true, async () => {
      throw new Error("the window was closed");
    });
    assert.deepEqual((await moodle.listCourses()).map((c) => c.id), [3]);
    await context.close();
  });
});
