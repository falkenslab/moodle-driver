import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { FormError } from "../../src/index.js";
import { dateSelectorDate, dateSelectorValues, setFields, submitForm } from "../../src/core/forms.js";
import { launchTestBrowser } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

/** A maximum grade disabled until rescaling is chosen, as Moodle's form dependencies do once grades exist; made up. */
const FORM = `<form class="mform"><select name="grade[modgrade_rescalegrades]" id="rescale"><option value="">Choose</option><option value="no">No</option></select>
<input type="text" name="grade[modgrade_point]" id="point" value="100" disabled></form>
<script>document.getElementById("rescale").addEventListener("change", (e) => setTimeout(() => { document.getElementById("point").disabled = e.target.value === ""; }));</script>`;

describe("setFields", { skip: !browser && "no system browser" }, () => {
  it("refuses a disabled field, and sets it once a field before it in the same call enables it, even later", async () => {
    const page = await browser!.newPage();
    await page.setContent(FORM);
    await assert.rejects(setFields(page, { "grade[modgrade_point]": 80 }), (error: Error) => error instanceof FormError && /disabled.*grade\[modgrade_point\]/.test(error.message));
    await setFields(page, { "grade[modgrade_rescalegrades]": "no", "grade[modgrade_point]": 80 });
    assert.equal(await page.inputValue('[name="grade[modgrade_point]"]'), "80");
    await page.close();
  });

  it("waits for a TinyMCE editor still starting, which can't take content yet", async () => {
    const page = await browser!.newPage();
    // A made-up TinyMCE: the editor exists at once but starts later, and throws on content before
    // then, as a real one's plugins do (codesample in a Moodle 5.2 forum reply).
    await page.setContent(`<form class="mform"><textarea name="message[text]" id="msg"></textarea></form>
<script>
  const editor = { initialized: false, setContent(html) { if (!this.initialized) throw new TypeError("Cannot read properties of undefined (reading 'select')"); this.html = html; }, save() { document.getElementById("msg").value = this.html; } };
  window.tinymce = { get: (id) => (id === undefined ? [editor] : id === "msg" ? editor : null) };
  setTimeout(() => { editor.initialized = true; }, 300);
</script>`);
    await setFields(page, { "message[text]": "<p>Late but set</p>" });
    assert.equal(await page.inputValue('[name="message[text]"]'), "<p>Late but set</p>");
    await page.close();
  });
});

describe("submitForm", { skip: !browser && "no system browser" }, () => {
  it("saves under a user tour's backdrop, which takes the mouse's clicks (Moodle 4.5's course page tours)", async () => {
    const page = await browser!.newPage();
    await page.route("http://fake.test/**", (route) => {
      const saved = route.request().url().endsWith("/saved");
      const body = saved ? "<p>Saved</p>" : `<form class="mform" method="post" action="http://fake.test/saved"><input type="text" name="title" value="x"><input type="submit" name="submitbutton" value="Save"></form><div data-flexitour="backdrop" style="position:fixed;inset:0;z-index:10"></div>`;
      return route.fulfill({ status: 200, contentType: "text/html", body });
    });
    await page.goto("http://fake.test/form");
    await submitForm(page, "submitbutton");
    assert.equal(page.url(), "http://fake.test/saved");
    await page.close();
  });
});

describe("date selectors", { skip: !browser && "no system browser" }, () => {
  // A date selector as Moodle renders it, in a person's time zone (Madrid: CEST in October, CET in November).
  const select = (part: string, from: number, to: number) => `<select name="due[${part}]">${Array.from({ length: to - from + 1 }, (_, i) => `<option value="${from + i}">${from + i}</option>`).join("")}</select>`;
  const FORM = `<script>var M = { cfg: { usertimezone: "Europe/Madrid" } };</script><form class="mform"><input type="checkbox" name="due[enabled]" value="1" checked>
${select("day", 1, 31)}${select("month", 1, 12)}${select("year", 2025, 2027)}${select("hour", 0, 23)}${select("minute", 0, 59)}</form>`;

  it("sets and reads a date in the person's time zone, on either side of a daylight saving change", async () => {
    const page = await browser!.newPage();
    await page.setContent(FORM);
    for (const date of [new Date("2026-10-23T12:30:00Z"), new Date("2026-11-30T18:00:00Z")]) {
      const values = await dateSelectorValues(page, "due", date);
      await setFields(page, values);
      assert.deepEqual(await dateSelectorDate(page, "due"), date);
    }
    assert.deepEqual(await dateSelectorValues(page, "due", new Date("2026-10-23T12:30:00Z")), { "due[day]": 23, "due[month]": 10, "due[year]": 2026, "due[hour]": 14, "due[minute]": 30 });
    await setFields(page, { "due[enabled]": false });
    assert.equal(await dateSelectorDate(page, "due"), undefined);
    await page.close();
  });
});
