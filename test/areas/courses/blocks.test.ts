import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext } from "playwright-core";
import { BlockError, FormError, NotLoggedInError, addBlock, configureBlock, courseBlocks, deleteBlock, moveBlock } from "../../../src/index.js";
import { SITE, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

interface FakeBlock {
  id: number;
  type: string;
  title: string;
  region: string;
  weight: number;
  visible: boolean;
  content?: string;
}

/**
 * A course page with blocks, reduced and made up, as Moodle 5.2's course/view.php renders them: the
 * edit mode switch (editmode.php), the side-pre region, each block's section, and in editing mode the
 * "Add a block" link, the `bui_*` actions and each block's configure form. `classic` draws it as Moodle
 * 4.5's Classic theme does: a "Turn editing on/off" button posting `edit` to the course page instead of
 * the switch, and an "Add a block" block's select instead of the link.
 */
async function fakeCourse(context: BrowserContext, { canEdit = true, canManage = true, editing = false, blocks = [] as FakeBlock[], classic = false } = {}) {
  const fake = { editing, blocks, modes: [] as string[], actions: [] as string[], nextId: 100 };
  const state: FakeMoodleState = {
    user: { id: 3, fullName: "Teacher" },
    services: {
      core_block_fetch_addable_blocks: (args) => {
        fake.actions.push(`addable ${String(args.pagetype)} ${String(args.pagelayout)} ${String(args.pagecontextid)}`);
        return canManage ? [{ name: "html", title: "Text", blockform: "block_html_edit_form" }, { name: "calendar_upcoming", title: "Upcoming events", blockform: null }].filter((b) => b.name === "html" || !fake.blocks.some((x) => x.type === b.name)) : [];
      },
    },
  };
  await serveFakeMoodle(context, state);
  const section = (b: FakeBlock) => {
    const title = b.type === "html" && !b.title && fake.editing ? "(new text block)" : b.title;
    return `<section id="inst${b.id}" class="block_${b.type} block ${b.visible ? "" : "invisibleblock"} card" data-block="${b.type}" data-instance-id="${b.id}">${title ? `<h3 id="instance-${b.id}-header" class="card-title">${title}</h3>` : ""}<div class="card-text content mt-3">${b.type === "html" ? `<div class="no-overflow">${b.content ?? ""}</div>` : "<p>No upcoming events</p>"}<div class="footer"></div></div></section>`;
  };
  const coursePage = () => {
    const shown = fake.blocks.filter((b) => fake.editing || b.visible).sort((a, b) => a.weight - b.weight);
    const button = `<form method="post" action="${SITE}course/view.php"><input type="hidden" name="id" value="3"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="edit" value="${fake.editing ? "off" : "on"}"><button type="submit">Turn editing</button></form>`;
    const add = classic ? `<section class="block_adminblock block"><form method="get" action="${SITE}course/view.php"><select name="bui_addblock"><option value="">Add...</option></select></form></section>` : `<a href="${SITE}course/view.php?id=3&amp;bui_addblock&amp;sesskey=s1" data-key="addblock">Add a block</a>`;
    const body = `${canEdit && classic ? button : ""}${canEdit && !classic ? `<form action="${SITE}editmode.php" method="post" class="editmode-switch-form"><input type="checkbox" name="setmode"><input type="hidden" name="sesskey" value="s1"><input type="hidden" name="context" value="40"><input type="hidden" name="pageurl" value="${SITE}course/view.php?id=3"></form>` : ""}
${fake.editing && canManage ? add : ""}
<aside id="block-region-side-pre" class="block-region" data-blockregion="side-pre">${shown.map(section).join("")}</aside>`;
    return moodlePage({ userId: 3, heading: "Course", bodyId: "page-course-view-topics", bodyClass: `pagelayout-course ${fake.editing ? "editing" : ""}`, contextId: 40, body });
  };
  const form = (b: FakeBlock) => {
    const options = (values: string[], selected: string) => values.map((v) => `<option value="${v}"${v === selected ? " selected" : ""}>${v}</option>`).join("");
    const weights = Array.from({ length: 21 }, (_, i) => String(i - 10));
    return moodlePage({
      userId: 3,
      bodyId: "page-course-view",
      body: `<form class="mform" method="post" action="${SITE}course/view.php?id=3&amp;bui_editid=${b.id}"><input type="hidden" name="blockid" value="${b.id}"><input type="hidden" name="sesskey" value="s1">
${b.type === "html" ? `<input name="config_title" value="${b.title}"><textarea name="config_text[text]">${b.content ?? ""}</textarea><input type="hidden" name="config_text[itemid]" value="77">` : ""}
<select name="bui_visible">${options(["0", "1"], b.visible ? "1" : "0")}</select><select name="bui_region">${options(["side-pre"], b.region)}</select><select name="bui_weight">${options(weights, String(b.weight))}</select>
<input type="submit" name="submitbutton" value="Save changes"></form>`,
    });
  };
  await context.route(`${SITE}editmode.php`, (route) => {
    const data = new URLSearchParams(route.request().postData() ?? "");
    fake.modes.push(data.get("setmode") ?? "");
    fake.editing = data.get("setmode") === "1";
    return route.fulfill({ status: 200, contentType: "text/html", body: coursePage() });
  });
  await context.route(`${SITE}course/view.php**`, (route) => {
    const url = new URL(route.request().url());
    const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
    const p = (name: string) => url.searchParams.get(name);
    const posted = new URLSearchParams(route.request().postData() ?? "");
    if (classic && route.request().method() === "POST" && posted.get("sesskey") === "s1" && posted.has("edit")) {
      fake.modes.push(posted.get("edit")!);
      fake.editing = posted.get("edit") === "on";
    }
    if (fake.editing && p("bui_editid")) {
      const block = fake.blocks.find((b) => b.id === Number(p("bui_editid")));
      if (!block) return html(moodlePage({ userId: 3, body: '<div data-rel="fatalerror"><p class="errormessage">The block is not on this page.</p></div>' }));
      if (route.request().method() === "POST") {
        const data = new URLSearchParams(route.request().postData() ?? "");
        fake.actions.push(`configure ${block.id}`);
        if (data.has("config_title")) block.title = data.get("config_title")!;
        if (data.has("config_text[text]")) block.content = data.get("config_text[text]")!;
        block.visible = data.get("bui_visible") !== "0";
        block.weight = Number(data.get("bui_weight"));
        return html(coursePage());
      }
      return html(form(block));
    }
    if (fake.editing && canManage && p("sesskey") === "s1") {
      if (p("bui_addblock")) {
        fake.actions.push(`add ${p("bui_addblock")} ${p("bui_blockregion") ?? ""}`);
        const weight = Math.max(0, ...fake.blocks.map((b) => b.weight + 1));
        fake.blocks.push({ id: fake.nextId++, type: p("bui_addblock")!, title: p("bui_addblock") === "html" ? "" : "Upcoming events", region: "side-pre", weight, visible: true });
      } else if (p("bui_moveid")) {
        fake.actions.push(`move ${p("bui_moveid")} ${p("bui_newregion")} ${p("bui_newweight")}`);
        const block = fake.blocks.find((b) => b.id === Number(p("bui_moveid")))!;
        block.region = p("bui_newregion")!;
        block.weight = Number(p("bui_newweight"));
      } else if (p("bui_deleteid") && p("bui_confirm") === "1") {
        fake.actions.push(`delete ${p("bui_deleteid")}`);
        fake.blocks = fake.blocks.filter((b) => b.id !== Number(p("bui_deleteid")));
      }
    }
    return html(coursePage());
  });
  return fake;
}

const TEXT: FakeBlock = { id: 7, type: "html", title: "Welcome", region: "side-pre", weight: 2, visible: true, content: "<p>Hi <b>all</b></p>" };
const EVENTS: FakeBlock = { id: 8, type: "calendar_upcoming", title: "Upcoming events", region: "side-pre", weight: 1, visible: false };

describe("courseBlocks", { skip: !browser && "no system browser" }, () => {
  it("reads every block in editing mode, with its weight, and turns the mode back off", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { blocks: [{ ...TEXT }, { ...EVENTS }] });
    const blocks = await courseBlocks(context, SITE, 3);
    assert.deepEqual(blocks, [
      { id: 8, type: "calendar_upcoming", title: "Upcoming events", region: "side-pre", weight: 1, visible: false },
      { id: 7, type: "html", title: "Welcome", region: "side-pre", weight: 2, visible: true, content: "<p>Hi <b>all</b></p>" },
    ]);
    assert.deepEqual(fake.modes, ["1", "0"]);
    await context.close();
  });

  it("gives a text block without a title its empty title, not the editing placeholder; leaves editing mode on when it was", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { editing: true, blocks: [{ ...TEXT, title: "" }] });
    const [block] = await courseBlocks(context, SITE, 3);
    assert.equal(block?.title, "");
    assert.deepEqual(fake.modes, []);
    assert.equal(fake.editing, true);
    await context.close();
  });

  it("gives whom can't edit the course the blocks the page shows, without weights", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { canEdit: false, canManage: false, blocks: [{ ...TEXT }, { ...EVENTS }] });
    assert.deepEqual(await courseBlocks(context, SITE, 3), [{ id: 7, type: "html", title: "Welcome", region: "side-pre", visible: true, content: "<p>Hi <b>all</b></p>" }]);
    assert.deepEqual(fake.modes, []);
    await context.close();
  });

  it("turns editing mode on and off with Classic's button, and reads its blocks (Moodle 4.5)", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { classic: true, blocks: [{ ...TEXT }, { ...EVENTS }] });
    assert.deepEqual((await courseBlocks(context, SITE, 3)).map((b) => [b.id, b.weight]), [[8, 1], [7, 2]]);
    const { block } = await addBlock(context, SITE, 3, { type: "html", title: "Links" });
    assert.equal(block.title, "Links");
    assert.deepEqual(fake.modes, ["on", "off", "on", "off"]);
    assert.equal(fake.editing, false);
    await context.close();
  });

  it("throws NotLoggedInError without a session", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, {});
    await assert.rejects(courseBlocks(context, SITE, 3), NotLoggedInError);
    await context.close();
  });
});

describe("addBlock", { skip: !browser && "no system browser" }, () => {
  it("adds a text block and fills its title and content through its configure form", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { blocks: [{ ...EVENTS, visible: true }] });
    const result = await addBlock(context, SITE, 3, { type: "html", region: "side-pre", title: "Links", content: "<p>See the guide.</p>" });
    assert.deepEqual(result.block, { id: 100, type: "html", title: "Links", region: "side-pre", weight: 2, visible: true, content: "<p>See the guide.</p>" });
    assert.match(result.changed, /Block 100 \(html\) added/);
    assert.deepEqual(fake.actions, ["addable course-view-topics course 40", "add html side-pre", "configure 100"]);
    assert.deepEqual(fake.modes, ["1", "0"]);
    await context.close();
  });

  it("refuses a type the page doesn't offer, naming the ones it does, and a region it lacks", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { blocks: [{ ...EVENTS }] });
    await assert.rejects(addBlock(context, SITE, 3, { type: "calendar_upcoming" }), (error: Error) => error instanceof BlockError && /doesn't offer the block "calendar_upcoming".*block\/calendar_upcoming:addinstance.*offers: html/.test(error.message));
    await assert.rejects(addBlock(context, SITE, 3, { type: "html", region: "side-post" }), (error: Error) => error instanceof BlockError && /no region "side-post".*side-pre/.test(error.message));
    await assert.rejects(addBlock(context, SITE, 3, { type: "<html>" }), (error: Error) => !(error instanceof BlockError) && /isn't a block type/.test(error.message));
    assert.ok(!fake.actions.some((a) => a.startsWith("add ")));
    assert.equal(fake.editing, false);
    await context.close();
  });

  it("takes the block off again when its form has no such field", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context);
    await assert.rejects(addBlock(context, SITE, 3, { type: "calendar_upcoming", title: "Soon" }), FormError);
    assert.deepEqual(fake.blocks, []);
    await context.close();
  });

  it("says which capability is missing", async () => {
    const context = await browser!.newContext();
    await fakeCourse(context, { canManage: false });
    await assert.rejects(addBlock(context, SITE, 3, { type: "html" }), (error: Error) => error instanceof BlockError && /moodle\/site:manageblocks/.test(error.message));
    await context.close();
    const student = await browser!.newContext();
    await fakeCourse(student, { canEdit: false, canManage: false });
    await assert.rejects(addBlock(student, SITE, 3, { type: "html" }), (error: Error) => error instanceof BlockError && /manageblocks/.test(error.message));
    await student.close();
  });
});

describe("configureBlock, moveBlock, deleteBlock", { skip: !browser && "no system browser" }, () => {
  it("changes a text block's title and content, and other fields by name", async () => {
    const context = await browser!.newContext();
    await fakeCourse(context, { blocks: [{ ...TEXT }] });
    const { block } = await configureBlock(context, SITE, 3, 7, { title: "Hello", content: "<p>New</p>", settings: { bui_visible: "0" } });
    assert.deepEqual(block, { id: 7, type: "html", title: "Hello", region: "side-pre", weight: 2, visible: false, content: "<p>New</p>" });
    await assert.rejects(configureBlock(context, SITE, 3, 9, { title: "None" }), (error: Error) => error instanceof BlockError && /no block 9.*7 \(html\)/.test(error.message));
    await assert.rejects(configureBlock(context, SITE, 3, 7, {}), /Give a title/);
    await context.close();
  });

  it("moves a block to a weight, or after the region's blocks without one", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { blocks: [{ ...TEXT }, { ...EVENTS, weight: 4 }] });
    assert.equal((await moveBlock(context, SITE, 3, 7, { region: "side-pre", weight: -3 })).block.weight, -3);
    assert.equal((await moveBlock(context, SITE, 3, 7, {})).block.weight, 5);
    assert.deepEqual(fake.actions, ["move 7 side-pre -3", "move 7 side-pre 5"]);
    await assert.rejects(moveBlock(context, SITE, 3, 7, { region: "side-post" }), BlockError);
    await assert.rejects(moveBlock(context, SITE, 3, 7, { weight: 1.5 }), /whole number/);
    await context.close();
  });

  it("deletes a block", async () => {
    const context = await browser!.newContext();
    const fake = await fakeCourse(context, { blocks: [{ ...TEXT }] });
    assert.match((await deleteBlock(context, SITE, 3, 7)).changed, /Block 7 \(html\) deleted/);
    assert.deepEqual(fake.blocks, []);
    await assert.rejects(deleteBlock(context, SITE, 3, 7), BlockError);
    assert.deepEqual(fake.modes, ["1", "0", "1", "0"]);
    await context.close();
  });
});
