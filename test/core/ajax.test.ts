import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MoodleServiceError, callService, parseServiceResponse } from "../../src/core/ajax.js";
import { NotLoggedInError } from "../../src/core/session.js";
import { SITE, launchTestBrowser, serveFakeMoodle, type FakeMoodleState } from "../../src/testing/fakeMoodle.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

describe("parseServiceResponse", () => {
  it("returns the data of a successful call", () => {
    assert.deepEqual(parseServiceResponse("f", 200, '[{"error":false,"data":{"a":1}}]'), { a: 1 });
  });

  it("throws the exception of a failed call, in both of Moodle's shapes", () => {
    assert.throws(
      () => parseServiceResponse("f", 200, '[{"error":true,"exception":{"errorcode":"nopermissions","message":"No"}}]'),
      (error: unknown) => error instanceof MoodleServiceError && error.errorcode === "nopermissions",
    );
    assert.throws(
      () => parseServiceResponse("f", 200, '{"error":"Invalid sesskey","errorcode":"invalidsesskey"}'),
      (error: unknown) => error instanceof MoodleServiceError && error.errorcode === "invalidsesskey",
    );
  });

  it("refuses an answer that isn't JSON", () => {
    assert.throws(() => parseServiceResponse("f", 500, "<html>Error</html>"), /isn't JSON/);
  });
});

describe("callService", { skip: !browser && "no system browser" }, () => {
  async function site(state: FakeMoodleState) {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { pagesServed: [], serviceCalls: [], ...state });
    return context;
  }

  it("calls a service with its arguments and reuses the tab", async () => {
    const state: FakeMoodleState = { user: { id: 3, fullName: "T" }, pagesServed: [], services: { echo: (args) => args } };
    const context = await site(state);
    await serveFakeMoodle(context, state);
    assert.deepEqual(await callService(context, SITE, "echo", { x: 1 }), { x: 1 });
    assert.deepEqual(await callService(context, SITE, "echo", { x: 2 }), { x: 2 });
    assert.equal(state.pagesServed?.length, 1);
    await context.close();
  });

  it("opens a new tab when the kept one's sesskey is stale", async () => {
    const state: FakeMoodleState = { user: { id: 3, fullName: "T" }, pagesServed: [], services: { echo: (args) => args } };
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    await callService(context, SITE, "echo", {});
    state.sesskey = "s2"; // The person logged in again.
    assert.deepEqual(await callService(context, SITE, "echo", { y: 1 }), { y: 1 });
    assert.equal(state.pagesServed?.length, 2);
    await context.close();
  });

  it("reports a missing session, and a session that ended", async () => {
    const state: FakeMoodleState = { services: { echo: (args) => args } };
    const context = await browser!.newContext();
    await serveFakeMoodle(context, state);
    await assert.rejects(callService(context, SITE, "echo", {}), NotLoggedInError);
    state.user = { id: 3, fullName: "T" };
    await callService(context, SITE, "echo", {});
    state.user = undefined;
    await assert.rejects(callService(context, SITE, "echo", {}), NotLoggedInError);
    await context.close();
  });

  it("passes other service errors through", async () => {
    const context = await browser!.newContext();
    await serveFakeMoodle(context, { user: { id: 3, fullName: "T" } });
    await assert.rejects(callService(context, SITE, "missing_function", {}), MoodleServiceError);
    await context.close();
  });
});
