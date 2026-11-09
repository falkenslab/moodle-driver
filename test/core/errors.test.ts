import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "../../src/index.js";
import { FormError, MoodleError, MoodleServiceError, NotLoggedInError, SurveyError } from "../../src/index.js";
import { BrowserLostError, isBrowserLost } from "../../src/core/errors.js";

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

describe("isBrowserLost", () => {
  it("knows Playwright's words for a browser or a tab that's gone", () => {
    for (const message of [
      "page.goto: Target page, context or browser has been closed",
      "browserContext.newPage: Target page, context or browser has been closed",
      "apiRequestContext.fetch: Request context disposed.",
      "locator.click: Target crashed ",
      "page.goto: Page crashed",
    ]) {
      assert.ok(isBrowserLost(new Error(message)), message);
    }
    assert.ok(isBrowserLost(new BrowserLostError()));
  });

  it("leaves everything else, and a browser that couldn't start", () => {
    for (const error of [new Error("page.goto: net::ERR_ABORTED at https://x/"), new Error("locator.click: Timeout 15000ms exceeded."), new Error("browserType.launchPersistentContext: Target page, context or browser has been closed"), new MoodleError("x", "not-found"), "a string", undefined]) {
      assert.ok(!isBrowserLost(error), String(error));
    }
  });
});
