import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { FormError, setFields } from "../../src/index.js";
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
});
