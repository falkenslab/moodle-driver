import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { MoodleServiceError, publicSiteInfo } from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
const browser = await launchTestBrowser();
after(() => browser?.close());

/** A fetch that answers Moodle's no-login service entry point with `data`, recording the request. */
function fakeFetch(answer: unknown, requests: { url: string; body: string }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    requests.push({ url, body: String(init?.body) });
    return new Response(JSON.stringify([answer]), { status: 200 });
  }) as typeof fetch;
}

describe("publicSiteInfo", () => {
  it("reads the public configuration without a session", async () => {
    const requests: { url: string; body: string }[] = [];
    const data = { wwwroot: "https://campus.example.org", sitename: "Campus &amp; Co", lang: "es", langlist: "es|Español,en|English", typeoflogin: 3, guestlogin: 0, identityproviders: [{ name: "CAS", url: "x" }], maintenanceenabled: false };
    const info = await publicSiteInfo("https://campus.example.org/", fakeFetch({ error: false, data }, requests));
    assert.equal(requests[0]?.url, "https://campus.example.org/lib/ajax/service-nologin.php?info=tool_mobile_get_public_config");
    assert.deepEqual(JSON.parse(requests[0]!.body)[0].methodname, "tool_mobile_get_public_config");
    assert.deepEqual(info, {
      name: "Campus & Co",
      url: "https://campus.example.org",
      language: "es",
      languages: ["es", "en"],
      login: { appLogin: "embedded", guestAccess: false, identityProviders: ["CAS"] },
    });
  });

  it("says when the site is in maintenance, and passes Moodle's errors on", async () => {
    const info = await publicSiteInfo(SITE, fakeFetch({ error: false, data: { wwwroot: SITE, sitename: "S", maintenanceenabled: true, maintenancemessage: "Back at 9" } }));
    assert.equal(info.maintenance, "Back at 9");
    assert.equal("languages" in info, false);
    await assert.rejects(publicSiteInfo(SITE, fakeFetch({ error: true, exception: { errorcode: "servicenotavailable", message: "Web service is not available" } })), MoodleServiceError);
  });
});

