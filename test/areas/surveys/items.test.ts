import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import type { BrowserContext, Route } from "playwright-core";
import {
  FormError,
  SurveyError,
  addFeedbackItem,
  deleteFeedbackItem,
  deleteFeedbackTemplate,
  editFeedbackItem,
  feedbackItems,
  feedbackTemplates,
  moveFeedbackItem,
  saveFeedbackTemplate,
  useFeedbackTemplate,
} from "../../../src/index.js";
import { parseFeedbackExport } from "../../../src/areas/surveys/items.js";
import { SITE, ServiceFailure, launchTestBrowser, moodlePage, serveFakeMoodle, type FakeMoodleState } from "../../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

interface FakeItem {
  id: number;
  typ: string;
  required: number;
  name: string;
  label: string;
  presentation: string;
  options: string;
  dependitem: number;
  dependvalue: string;
}

const TYPES = ["info", "label", "multichoice", "multichoicerated", "numeric", "pagebreak", "textarea", "textfield"];

/** The export file as Moodle 5.2's export.php writes it. */
function exportXml(items: FakeItem[]): string {
  const cdata = (tag: string, value: string | number) => `      <${tag}>\n         <![CDATA[${value}]]>\n      </${tag}>\n`;
  return `<?xml version="1.0" encoding="UTF-8" ?>\n<FEEDBACK VERSION="200701" COMMENT="XML-Importfile for mod/feedback">\n     <ITEMS>\n${items
    .map(
      (i) =>
        `          <ITEM TYPE="${i.typ}" REQUIRED="${i.required}">\n${cdata("ITEMID", i.id)}${cdata("ITEMTEXT", i.name)}${cdata("ITEMLABEL", i.label)}${cdata("PRESENTATION", i.presentation)}${cdata("OPTIONS", i.options)}${cdata("DEPENDITEM", i.dependitem)}${cdata("DEPENDVALUE", i.dependvalue)}          </ITEM>\n`,
    )
    .join("")}     </ITEMS>\n</FEEDBACK>\n`;
}

/** A feedback with an item of each kind, as Moodle saves them. */
function seeded(): FakeItem[] {
  const item = (id: number, typ: string, rest: Partial<FakeItem>): FakeItem => ({ id, typ, required: 0, name: "", label: "", presentation: "", options: "", dependitem: 0, dependvalue: "", ...rest });
  return [
    item(1, "multichoice", { name: "Did it help?", label: "help", required: 1, presentation: "c>>>>>Yes|No|Somewhat<<<<<1", options: "h" }),
    item(2, "multichoicerated", { name: "Overall", presentation: "r>>>>>1####Bad|5####Good", options: "i" }),
    item(3, "pagebreak", {}),
    item(4, "numeric", { name: "Mark", presentation: "0|10", dependitem: 1, dependvalue: "Yes" }),
    item(5, "textfield", { name: "One word", presentation: "30|255" }),
    item(6, "textarea", { name: "Tell us", presentation: "40|5" }),
    item(7, "info", { name: "Course", presentation: "2" }),
    item(8, "label", { name: "label", presentation: "<p>Thanks</p>" }),
  ];
}

/**
 * A made-up feedback (cmid 34) in Moodle 5.2's question editor: the questions page with its "Add
 * question" menu and export link, the export file, each type's form (new or an item's own), the
 * page break's sesskey link, the delete link, the reorder service, and the templates page with its
 * dynamic forms (core_form_dynamic_form).
 */
function fakeFeedback({ items = seeded(), canEdit = true, anonymous = true, templates = [] as { id: number; name: string; public: boolean; items: FakeItem[] }[] } = {}) {
  let nextId = 100;
  let nextTemplate = 50;
  const posted: URLSearchParams[] = [];
  const reorders: string[] = [];
  const html = (route: Route, bodyId: string, main: string) => route.fulfill({ status: 200, contentType: "text/html", body: moodlePage({ userId: 4, bodyId, body: `<div id="region-main"><div role="main">${main}</div></div>` }) });
  const editor = () =>
    `<div class="tertiary-navigation">${TYPES.map((t) => `<a href="${SITE}mod/feedback/edit_item.php?cmid=34&amp;position=${items.length + 1}&amp;sesskey=s1&amp;typ=${t}">${t}</a>`).join("")}
${items.length > 0 ? `<a href="${SITE}mod/feedback/export.php?id=34&amp;action=exportfile">Export questions</a>` : ""}</div>
<form class="feedback_form"><div data-region="questions-sortable-list">${items.map((i) => `<div id="fitem_feedback_item_${i.id}" class="feedback_itemlist"></div>`).join("")}</div></form>`;
  const select = (name: string, options: string[], value: string) => `<select name="${name}">${options.map((o) => `<option value="${o}"${o === value ? " selected" : ""}>${o}</option>`).join("")}</select>`;
  /** The type's form, with the item's values when it has one. */
  const form = (typ: string, item: FakeItem | undefined) => {
    const v = (value: string | number | undefined) => String(value ?? "").replaceAll('"', "&quot;");
    const fields: string[] = [];
    const [subtype, rest = ""] = (item?.presentation ?? "").includes(">>>>>") ? item!.presentation.split(">>>>>") : ["r", ""];
    if (["multichoice", "multichoicerated", "numeric", "textfield", "textarea"].includes(typ)) fields.push(`<input type="hidden" name="required" value="0"><input type="checkbox" name="required" value="1"${item?.required ? " checked" : ""}>`);
    else fields.push(`<input type="hidden" name="required" value="0">`);
    if (typ === "label") fields.push(`<input type="hidden" name="name" value="label"><input type="hidden" name="label" value=""><textarea name="presentation_editor[text]">${item?.presentation ?? ""}</textarea>`);
    else fields.push(`<input name="name" value="${v(item?.name)}"><input name="label" value="${v(item?.label)}">`);
    if (typ === "multichoice" || typ === "multichoicerated") {
      const [values = "", adjust] = rest.split("<<<<<");
      const lines = values ? values.split("|").map((line) => (typ === "multichoicerated" ? line.replace("####", "/") : line)) : [];
      fields.push(select("subtype", typ === "multichoice" ? ["r", "c", "d"] : ["r", "d"], subtype ?? "r"));
      fields.push(select("horizontal", ["0", "1"], adjust === "1" ? "1" : "0"), select("hidenoselect", ["0", "1"], item?.options.includes("h") ? "1" : "0"), select("ignoreempty", ["0", "1"], item?.options.includes("i") ? "1" : "0"));
      fields.push(`<textarea name="values">${lines.join("\n")}</textarea>`);
    }
    if (typ === "numeric") {
      const [from = "", to = ""] = (item?.presentation ?? "").split("|");
      fields.push(`<input name="rangefrom" value="${from === "-" ? "" : from}"><input name="rangeto" value="${to === "-" ? "" : to}">`);
    }
    if (typ === "info") fields.push(select("presentation", anonymous ? ["2", "3"] : ["1", "2", "3"], item?.presentation ?? "2"));
    const others = items.filter((i) => i.id !== item?.id && !["pagebreak", "label", "info"].includes(i.typ));
    fields.push(others.length > 0 ? `${select("dependitem", ["0", ...others.map((i) => String(i.id))], String(item?.dependitem ?? 0))}<input name="dependvalue" value="${v(item?.dependvalue)}">` : `<input type="hidden" name="dependitem" value="0"><input type="hidden" name="dependvalue" value="">`);
    const positions = Array.from({ length: items.length + (item ? 0 : 1) }, (_, i) => String(i + 1));
    fields.push(select("position", positions, item ? String(items.indexOf(item) + 1) : String(items.length + 1)));
    // Moodle's own check: a question without its text comes back with the message by the field.
    const error = `<div id="id_error_name"></div>`;
    return `<form class="mform" id="mform1" method="post" action="${SITE}mod/feedback/edit_item.php">
<input type="hidden" name="cmid" value="34"><input type="hidden" name="id" value="${item?.id ?? ""}"><input type="hidden" name="typ" value="${typ}">
${fields.join("\n")}${error}
${item ? `<input type="submit" name="update_item" value="Save changes"><input type="submit" name="clone_item" value="Save as new">` : `<input type="hidden" name="clone_item" value="0"><input type="submit" name="save_item" value="Save">`}</form>`;
  };
  /** A posted form saved as Moodle saves it: its presentation from the type's fields. */
  const save = (data: URLSearchParams) => {
    const typ = data.get("typ")!;
    let presentation = data.get("presentation") ?? "";
    if (typ === "multichoice" || typ === "multichoicerated") {
      const lines = (data.get("values") ?? "").trim().split("\n");
      const values = typ === "multichoice" ? lines.join("|") : lines.map((l) => l.replace("/", "####")).join("|");
      presentation = `${data.get("subtype")}>>>>>${values}${data.get("horizontal") === "1" && data.get("subtype") !== "d" ? "<<<<<1" : ""}`;
    }
    if (typ === "numeric") presentation = `${data.get("rangefrom") || "-"}|${data.get("rangeto") || "-"}`;
    if (typ === "label") presentation = data.get("presentation_editor[text]") ?? "";
    const options = `${data.get("hidenoselect") === "1" ? "h" : ""}${data.get("ignoreempty") === "1" ? "i" : ""}`;
    const fields = { typ, required: Number(data.getAll("required").at(-1) ?? 0), name: data.get("name") ?? "", label: data.get("label") ?? "", presentation, options, dependitem: Number(data.get("dependitem") ?? 0), dependvalue: data.get("dependvalue") ?? "" };
    const id = Number(data.get("id"));
    let item = items.find((i) => i.id === id);
    if (item) Object.assign(item, fields);
    else {
      item = { id: nextId++, ...fields };
      items.push(item);
    }
    const position = Number(data.get("position"));
    items.splice(items.indexOf(item), 1);
    items.splice(position - 1, 0, item);
  };
  const forbidden = (route: Route, bodyId: string) => html(route, bodyId, `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">Sorry, but you do not currently have permissions to do that (Edit items).</p></div>`);
  const templatesPage = () =>
    [false, true]
      .map((isPublic) => {
        const own = templates.filter((t) => t.public === isPublic);
        if (own.length === 0) return `<div class="alert alert-info">No templates available yet</div>`;
        const table = `feedback_template_${isPublic ? "public" : "course"}_table`;
        return `<table class="flexible table templateslist"><tbody>${own
          .map((t, i) => `<tr class="" id="${table}_r${i}"><td class="cell c0 template">${t.name}</td><td class="cell c1"><a href="${SITE}mod/feedback/use_templ.php?id=34&amp;templateid=${t.id}&amp;sesskey=s1">Preview</a></td></tr>`)
          .join("")}<tr class="emptyrow" id="${table}_r${own.length}"><td></td></tr></tbody></table>`;
      })
      .join("");
  const services: FakeMoodleState["services"] = {
    mod_feedback_questions_reorder: (args) => {
      if (!canEdit) throw new ServiceFailure("nopermissions");
      reorders.push(String(args.itemorder));
      const order = String(args.itemorder).split(",").map(Number);
      items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return true;
    },
    core_form_dynamic_form: (args) => {
      const form = String(args.form);
      const data = new URLSearchParams(String(args.formdata));
      if (!data.get("sesskey")) {
        const fields =
          form === "mod_feedback\\form\\create_template_form"
            ? `<input name="templatename" value=""><div id="id_error_templatename_ABCDEFGHIJKLMNO"></div>`
            : `<input type="radio" name="deleteolditems" value="1" checked><input type="radio" name="deleteolditems" value="0"><input type="hidden" name="templateid" value="${data.get("templateid")}">`;
        return { html: `<form class="mform"><input type="hidden" name="id" value="${data.get("id")}"><input type="hidden" name="sesskey" value="s1">${fields}</form>` };
      }
      posted.push(data);
      if (form === "mod_feedback\\form\\create_template_form") {
        if (!data.get("templatename")) return { submitted: false, html: `<form class="mform"><div id="id_error_templatename_ABCDEFGHIJKLMNO">Required</div></form>` };
        templates.push({ id: nextTemplate++, name: data.get("templatename")!, public: false, items: items.map((i) => ({ ...i })) });
        return { submitted: true, html: "", data: JSON.stringify({ result: true }) };
      }
      const template = templates.find((t) => t.id === Number(data.get("templateid")))!;
      if (data.get("deleteolditems") === "1") items.splice(0, items.length);
      for (const i of template.items) items.push({ ...i, id: nextId++ });
      return { submitted: true, html: "", data: JSON.stringify({ result: true, url: `${SITE}mod/feedback/edit.php?id=34` }) };
    },
  };
  const routes = async (context: BrowserContext) => {
    await context.route(`${SITE}mod/feedback/**`, (route: Route) => {
      const url = new URL(route.request().url());
      const q = url.searchParams;
      switch (url.pathname) {
        case "/mod/feedback/edit.php": {
          if (q.get("id") !== "34") return html(route, "page-mod-feedback-view", `<div class="errorbox"><p class="errormessage">Invalid course module ID</p></div>`);
          if (!canEdit) return forbidden(route, "page-mod-feedback-edit");
          const deleted = Number(q.get("deleteitem"));
          if (deleted) {
            assert.equal(q.get("sesskey"), "s1");
            const at = items.findIndex((i) => i.id === deleted);
            if (at >= 0) items.splice(at, 1);
          }
          return html(route, "page-mod-feedback-edit", editor());
        }
        case "/mod/feedback/export.php":
          // Without items Moodle answers with its "nodata" error page.
          if (items.length === 0) return html(route, "page-mod-feedback-export", `<div data-rel="fatalerror" class="box errorbox alert alert-danger"><p class="errormessage">No data</p></div>`);
          return route.fulfill({ status: 200, contentType: "application/xml", body: exportXml(items) });
        case "/mod/feedback/edit_item.php": {
          if (route.request().method() === "POST") {
            const data = new URLSearchParams(route.request().postData() ?? "");
            posted.push(data);
            if (data.get("typ") !== "label" && !data.get("name")) return html(route, "page-mod-feedback-edit_item", form(data.get("typ")!, undefined).replace('<div id="id_error_name"></div>', '<div id="id_error_name">Required</div>'));
            save(data);
            return html(route, "page-mod-feedback-edit", editor());
          }
          const typ = q.get("typ");
          if (typ === "pagebreak" || typ === "captcha") {
            assert.equal(q.get("sesskey"), "s1");
            // Moodle adds none to a feedback without items, or right after another at the end.
            if (typ === "pagebreak" && items.length > 0 && items.at(-1)!.typ !== "pagebreak") items.push({ id: nextId++, typ, required: 0, name: "", label: "", presentation: "", options: "", dependitem: 0, dependvalue: "" });
            return html(route, "page-mod-feedback-edit", editor());
          }
          const item = items.find((i) => i.id === Number(q.get("id")));
          return html(route, "page-mod-feedback-edit_item", form(item?.typ ?? typ!, item));
        }
        case "/mod/feedback/manage_templates.php": {
          const deleted = Number(q.get("deletetemplate"));
          if (deleted) {
            assert.equal(q.get("sesskey"), "s1");
            templates.splice(
              templates.findIndex((t) => t.id === deleted),
              1,
            );
          }
          return html(route, "page-mod-feedback-manage_templates", templatesPage());
        }
        default:
          return route.fallback();
      }
    });
  };
  return { routes, items, posted, reorders, templates, services };
}

async function open(fake: ReturnType<typeof fakeFeedback>): Promise<BrowserContext> {
  const context = await browser!.newContext();
  await serveFakeMoodle(context, { user: { id: 4, fullName: "Teo Teacher" }, services: fake.services });
  await fake.routes(context);
  return context;
}

describe("parseFeedbackExport", () => {
  it("reads every item's attributes and fields, in order", () => {
    const raw = parseFeedbackExport(exportXml(seeded().slice(0, 2)));
    assert.deepEqual(raw[0], { id: 1, type: "multichoice", required: true, name: "Did it help?", label: "help", presentation: "c>>>>>Yes|No|Somewhat<<<<<1", options: "h", dependItem: 0, dependValue: "" });
    assert.equal(raw[1]!.presentation, "r>>>>>1####Bad|5####Good");
  });
});

describe("feedbackItems", { skip: !browser && "no system browser" }, () => {
  it("reads each item's type, question, options and settings from the export, in order", async () => {
    const context = await open(fakeFeedback());
    assert.deepEqual(await feedbackItems(context, SITE, 34), [
      { id: 1, type: "multichoice", position: 1, question: "Did it help?", label: "help", required: true, options: [{ text: "Yes" }, { text: "No" }, { text: "Somewhat" }], display: "checkbox", horizontal: true, hideNotSelected: true, ignoreEmpty: false },
      { id: 2, type: "multichoicerated", position: 2, question: "Overall", required: false, options: [{ text: "Bad", weight: 1 }, { text: "Good", weight: 5 }], display: "radio", horizontal: false, hideNotSelected: false, ignoreEmpty: true },
      { id: 3, type: "pagebreak", position: 3, question: "", required: false },
      { id: 4, type: "numeric", position: 4, question: "Mark", required: false, range: { from: 0, to: 10 }, dependsOn: { itemId: 1, value: "Yes" } },
      { id: 5, type: "textfield", position: 5, question: "One word", required: false },
      { id: 6, type: "textarea", position: 6, question: "Tell us", required: false },
      { id: 7, type: "info", position: 7, question: "Course", required: false, info: "course" },
      { id: 8, type: "label", position: 8, question: "", required: false, contents: "<p>Thanks</p>" },
    ]);
  });

  it("reads none from a feedback without items, without asking for the export", async () => {
    const context = await open(fakeFeedback({ items: [] }));
    assert.deepEqual(await feedbackItems(context, SITE, 34), []);
  });

  it("names the capability when Moodle refuses the questions page, and the module for another activity", async () => {
    await assert.rejects(feedbackItems(await open(fakeFeedback({ canEdit: false })), SITE, 34), (error: unknown) => error instanceof SurveyError && /mod\/feedback:edititems/.test(error.message) && /Edit items/.test(error.message));
    await assert.rejects(feedbackItems(await open(fakeFeedback()), SITE, 35), /module "feedback"/);
  });
});

describe("addFeedbackItem", { skip: !browser && "no system browser" }, () => {
  it("adds a rated choice after an item, its options with their weights, and returns its id and the order", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    const added = await addFeedbackItem(context, SITE, 34, { type: "multichoicerated", question: "Pace", required: true, options: [{ text: "Slow", weight: 1 }, { text: "Right", weight: 3 }, "Fast"], display: "dropdown", after: 2 });
    assert.equal(added.itemId, 100);
    assert.deepEqual(added.itemIds, [1, 2, 100, 3, 4, 5, 6, 7, 8]);
    assert.match(added.changed, /Added multichoicerated item 100 "Pace" to feedback 34, after item 2/);
    const sent = fake.posted.at(-1)!;
    assert.equal(sent.get("values")?.replaceAll("\r\n", "\n"), "1/Slow\n3/Right\n0/Fast");
    // A checkbox comes after its hidden twin: PHP takes the last.
    assert.deepEqual([sent.get("subtype"), sent.getAll("required").at(-1), sent.get("position"), sent.get("save_item")], ["d", "1", "3", "Save"]);
    const item = (await feedbackItems(context, SITE, 34))[2]!;
    assert.deepEqual(item.options, [{ text: "Slow", weight: 1 }, { text: "Right", weight: 3 }, { text: "Fast", weight: 0 }]);
  });

  it("adds a question last by default, a label first, a numeric item with its range and a dependency", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    const short = await addFeedbackItem(context, SITE, 34, { type: "textfield", question: "Name a tool", label: "tool" });
    assert.equal(short.itemIds.at(-1), short.itemId);
    const label = await addFeedbackItem(context, SITE, 34, { type: "label", contents: "<p>Welcome</p>", after: 0 });
    assert.equal(label.itemIds[0], label.itemId);
    const number = await addFeedbackItem(context, SITE, 34, { type: "numeric", question: "Hours", range: { from: 1 }, dependsOn: { itemId: 1, value: "Yes" } });
    const items = await feedbackItems(context, SITE, 34);
    assert.deepEqual(items.find((i) => i.id === number.itemId), { id: number.itemId, type: "numeric", position: items.length, question: "Hours", required: false, range: { from: 1 }, dependsOn: { itemId: 1, value: "Yes" } });
    assert.equal(items[0]!.contents, "<p>Welcome</p>");
  });

  it("adds a page break at the end and moves it where asked through the reorder service", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    const added = await addFeedbackItem(context, SITE, 34, { type: "pagebreak", after: 1 });
    assert.deepEqual(added.itemIds, [1, 100, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual(fake.reorders, ["1,100,2,3,4,5,6,7,8"]);
    // Right after another at the end, or in a feedback without items, Moodle adds none.
    const empty = await open(fakeFeedback({ items: [] }));
    await assert.rejects(addFeedbackItem(empty, SITE, 34, { type: "pagebreak" }), /no page break/);
  });

  it("refuses, before saving anything, a type not offered, what the type doesn't take, and a place not there", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "captcha" }), (error: unknown) => error instanceof SurveyError && /doesn't offer items of type "captcha"/.test(error.message) && /reCAPTCHA/.test(error.message));
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "essay" as never, question: "x" }), /doesn't offer items of type "essay"/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "textfield", question: "x", options: ["a"] }), /takes no options/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "info", question: "x", required: true }), /can't be required/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "multichoice", question: "x" }), /needs its options/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "multichoice", question: "x", options: ["a|b"] }), /without "\|"/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "multichoicerated", question: "x", options: ["a"], display: "checkbox" }), /radio or dropdown/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "info", question: "x", info: "response-time" }), /response time only where the feedback isn't anonymous/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "textfield", question: "x", dependsOn: { itemId: 3, value: "y" } }), /can depend on 1, 2, 4, 5, 6/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "textfield", question: "x", after: 99 }), /no item 99/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "textfield" }), /needs a question/);
    assert.equal(fake.posted.length, 0);
    assert.equal(fake.items.length, 8);
  });

  it("lets an anonymous feedback's information item show the course, and passes Moodle's refusal on", async () => {
    const fake = fakeFeedback({ anonymous: false });
    const context = await open(fake);
    const info = await addFeedbackItem(context, SITE, 34, { type: "info", question: "When", info: "response-time" });
    assert.equal((await feedbackItems(context, SITE, 34)).find((i) => i.id === info.itemId)?.info, "response-time");
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "textfield", question: " " }), /needs a question/);
    await assert.rejects(addFeedbackItem(context, SITE, 34, { type: "textfield", question: "x", fields: { name: "" } }), (error: unknown) => error instanceof FormError && /name: Required/.test(error.message));
  });
});

describe("editFeedbackItem", { skip: !browser && "no system browser" }, () => {
  it("changes what's given through the item's form and keeps the rest", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    const edited = await editFeedbackItem(context, SITE, 34, 1, { question: "Was it useful?", options: ["Yes", "No"], display: "radio", required: false });
    assert.deepEqual(edited, { changed: "Saved item 1 of feedback 34.", itemId: 1 });
    const sent = fake.posted.at(-1)!;
    assert.equal(sent.get("update_item"), "Save changes");
    const item = (await feedbackItems(context, SITE, 34))[0]!;
    assert.deepEqual([item.question, item.label, item.required, item.options, item.display, item.horizontal, item.hideNotSelected], ["Was it useful?", "help", false, [{ text: "Yes" }, { text: "No" }], "radio", true, true]);
    await editFeedbackItem(context, SITE, 34, 4, { dependsOn: null, range: { from: 2, to: 5 } });
    assert.deepEqual((await feedbackItems(context, SITE, 34)).find((i) => i.id === 4)!.range, { from: 2, to: 5 });
    assert.equal((await feedbackItems(context, SITE, 34)).find((i) => i.id === 4)!.dependsOn, undefined);
  });

  it("refuses a page break, an item not there, nothing to change, and what the type doesn't take", async () => {
    const context = await open(fakeFeedback());
    await assert.rejects(editFeedbackItem(context, SITE, 34, 3, { question: "x" }), /is a pagebreak/);
    await assert.rejects(editFeedbackItem(context, SITE, 34, 99, { question: "x" }), /no item 99: its items are 1, 2, 3/);
    await assert.rejects(editFeedbackItem(context, SITE, 34, 1, {}), /Give what to change/);
    await assert.rejects(editFeedbackItem(context, SITE, 34, 8, { question: "x" }), /contents, not a question/);
  });
});

describe("moveFeedbackItem", { skip: !browser && "no system browser" }, () => {
  it("sends the whole new order to the reorder service and returns it", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    const moved = await moveFeedbackItem(context, SITE, 34, 8, 1);
    assert.deepEqual(moved.itemIds, [8, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(fake.reorders, ["8,1,2,3,4,5,6,7"]);
    await assert.rejects(moveFeedbackItem(context, SITE, 34, 8, 9), /from 1 to 8/);
    await assert.rejects(moveFeedbackItem(context, SITE, 34, 99, 1), /no item 99/);
  });
});

describe("deleteFeedbackItem", { skip: !browser && "no system browser" }, () => {
  it("deletes an item by the questions page's delete link and returns the items left", async () => {
    const fake = fakeFeedback();
    const context = await open(fake);
    const deleted = await deleteFeedbackItem(context, SITE, 34, 3);
    assert.deepEqual(deleted, { changed: "Deleted item 3 from feedback 34.", itemId: 3, itemIds: [1, 2, 4, 5, 6, 7, 8] });
    await assert.rejects(deleteFeedbackItem(context, SITE, 34, 3), /no item 3/);
  });
});

describe("feedback templates", { skip: !browser && "no system browser" }, () => {
  it("saves the items as a template, lists it, uses it after the items or in their place, and deletes it", async () => {
    const fake = fakeFeedback({ templates: [{ id: 7, name: "Site survey", public: true, items: [] }] });
    const context = await open(fake);
    const saved = await saveFeedbackTemplate(context, SITE, 34, "Driver template");
    assert.equal(saved.templateId, 50);
    assert.deepEqual(await feedbackTemplates(context, SITE, 34), [
      { id: 50, name: "Driver template", public: false },
      { id: 7, name: "Site survey", public: true },
    ]);
    const appended = await useFeedbackTemplate(context, SITE, 34, 50);
    assert.equal(appended.itemIds.length, 16);
    assert.equal(fake.posted.at(-1)!.get("deleteolditems"), "0");
    const replaced = await useFeedbackTemplate(context, SITE, 34, 50, { replace: true });
    assert.equal(replaced.itemIds.length, 8);
    assert.match(replaced.changed, /Replaced the items of feedback 34 with template 50's/);
    await assert.rejects(useFeedbackTemplate(context, SITE, 34, 99), /can't use template 99: its templates are 50 "Driver template", 7 "Site survey"/);
    await assert.rejects(saveFeedbackTemplate(context, SITE, 34, " "), /needs a name/);
    assert.deepEqual(await deleteFeedbackTemplate(context, SITE, 34, 50), { changed: "Deleted template 50.", templateId: 50 });
    assert.deepEqual(
      (await feedbackTemplates(context, SITE, 34)).map((t) => t.id),
      [7],
    );
  });

  it("refuses to save a feedback without items, and lists none where there are none", async () => {
    const context = await open(fakeFeedback({ items: [] }));
    assert.deepEqual(await feedbackTemplates(context, SITE, 34), []);
    await assert.rejects(saveFeedbackTemplate(context, SITE, 34, "Empty"), /no items to save/);
  });
});
