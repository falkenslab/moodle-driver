import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeEntities } from "../../src/moodle/text.js";

describe("decodeEntities", () => {
  it("decodes the entities format_string writes, and leaves the rest", () => {
    assert.equal(decodeEntities("A &amp; B &lt;C&gt; &quot;D&quot; &#039;E&#039; &#x41;&nbsp;F &copy;"), "A & B <C> \"D\" 'E' A F &copy;");
  });
});
