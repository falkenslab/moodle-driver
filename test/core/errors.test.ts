import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "../../src/index.js";
import { FormError, MoodleError, MoodleServiceError, NotLoggedInError, SurveyError } from "../../src/index.js";

describe("MoodleError", () => {
  it("is the base of every exported error class", () => {
    const classes = Object.entries(api).filter(([name, value]) => typeof value === "function" && name.endsWith("Error") && name !== "MoodleError");
    assert.ok(classes.length > 20);
    for (const [name, value] of classes) assert.ok((value as { prototype: unknown }).prototype instanceof MoodleError, name);
  });

  it("gives each class its own stable code, beside its name", () => {
    const errors = [new SurveyError("x"), new NotLoggedInError(), new MoodleServiceError("core_x", "invalidrecord", "y"), new FormError("Not saved.", [])];
    assert.deepEqual(
      errors.map((e) => [e.name, e.code, e instanceof MoodleError]),
      [
        ["SurveyError", "survey", true],
        ["NotLoggedInError", "not-logged-in", true],
        ["MoodleServiceError", "moodle-service", true],
        ["FormError", "form", true],
      ],
    );
    assert.equal(new MoodleError("No file.", "not-found").code, "not-found");
  });
});
