import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { after, describe, it } from "node:test";
import { downloadFile } from "../../src/index.js";
import { redacted, siteFetch } from "../../src/core/http.js";
import { launchTestBrowser } from "../../src/testing/index.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

describe("redacted", () => {
  it("hides the session's cookie, authorization and sesskey in an error, and nothing else", () => {
    const error = new Error(`apiRequestContext.fetch: Timeout 30000ms exceeded.
Call log:
  - → POST http://moodle.test/lib/ajax/service.php?sesskey=abc123&info=core_get_string
    - accept: */*
    - cookie: MoodleSession=s3cr3t; MOODLEID1_=x
    - Authorization: Bearer t0ken`);
    const message = (redacted(error) as Error).message;
    assert.doesNotMatch(message, /s3cr3t|t0ken|abc123/);
    assert.match(message, /- cookie: \[redacted\]/);
    assert.match(message, /- Authorization: \[redacted\]/);
    assert.match(message, /service\.php\?sesskey=\[redacted\]&info=core_get_string/);
    assert.match(message, /- accept: \*\/\*/);
    assert.equal(redacted("not an error"), "not an error");
  });
});

describe("requests that time out", { skip: !browser && "no system browser" }, () => {
  it("fail without the session cookie in their message, from siteFetch and downloadFile", async () => {
    // A site that takes requests and never answers, as a stuck Moodle would.
    const server = createServer(() => undefined).listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    const site = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const context = await browser!.newContext();
    await context.addCookies([{ name: "MoodleSession", value: "SECRET-SESSION", url: site }]);
    context.setDefaultTimeout(1_500);
    try {
      for (const call of [() => siteFetch(context, `${site}lib/ajax/service.php?sesskey=SECRET-SESSKEY`, { method: "POST", body: "[]" }), () => downloadFile(context, site, `${site}pluginfile.php/1/a.pdf`, tmpdir())]) {
        await assert.rejects(call(), (error: Error) => {
          // Playwright's call log lists the request's headers: the cookie was there, now hidden.
          assert.match(error.message, /Timeout/);
          assert.doesNotMatch(`${error.message}\n${error.stack}`, /SECRET-SESSION|SECRET-SESSKEY/);
          return true;
        });
      }
    } finally {
      await context.close();
      server.closeAllConnections();
      server.close();
    }
  });
});
