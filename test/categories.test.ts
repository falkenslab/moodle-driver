import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as api from "../src/index.js";
import { ALL_DATA_CATEGORIES, DATA_CATEGORIES, moduleCategories } from "../src/index.js";
import { fakeBrowserManager } from "../src/testing/index.js";

// Exported functions, not error classes: those are thrown, never called for data.
const functions = Object.entries(api)
  .filter(([, value]) => typeof value === "function" && !/^class\b/.test(Function.prototype.toString.call(value)))
  .map(([name]) => name);
const managerMethods = Object.keys(fakeBrowserManager()).map((method) => `BrowserManager.${method}`);

describe("DATA_CATEGORIES", () => {
  it("declares every exported function and every browser manager method", () => {
    const missing = [...functions, ...managerMethods].filter((name) => !(name in DATA_CATEGORIES));
    assert.deepEqual(missing, [], `declare these in src/categories.ts: ${missing.join(", ")}`);
  });

  it("names only exported functions and manager methods, with known categories", () => {
    const known = new Set([...functions, ...managerMethods]);
    for (const [name, categories] of Object.entries(DATA_CATEGORIES)) {
      assert.ok(known.has(name), `${name} isn't an exported function`);
      assert.ok(categories.length > 0, `${name} has no category`);
      for (const category of categories) assert.ok(ALL_DATA_CATEGORIES.includes(category), `${name}: unknown category ${category}`);
    }
  });

  it("keeps others' data, grading and posting apart from course content", () => {
    for (const name of ["assignmentSubmissions", "gradeSubmission", "replyToPost", "userById", "discussion"]) {
      assert.ok(!DATA_CATEGORIES[name]!.includes("course-content"), `${name} isn't course content`);
    }
    for (const name of ["createActivity", "courseStructure", "activityContent"]) assert.ok(DATA_CATEGORIES[name]!.includes("course-content"), `${name} is course content`);
    for (const name of ["callService", "openSitePage", "openForm", "setFields", "submitForm", "uploadToDraft", "BrowserManager.tab"]) assert.deepEqual(DATA_CATEGORIES[name], ["any"]);
  });
});

describe("moduleCategories", () => {
  it("is course content for what teachers make, others' data too where participants leave work", () => {
    for (const module of ["page", "book", "label", "url", "resource", "folder"]) assert.deepEqual(moduleCategories(module), ["course-content"]);
    for (const module of ["assign", "quiz", "forum", "glossary", "choice", "h5pactivity"]) assert.deepEqual(moduleCategories(module), ["course-content", "others-personal"]);
    assert.deepEqual(moduleCategories("someplugin"), ["any"]);
  });
});
