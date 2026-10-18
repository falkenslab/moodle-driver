import { chromium, type Browser, type BrowserContext, type Page, type Route } from "playwright-core";
import { setTransport } from "../core/http.js";

/** The fake Moodle's URL: the site URL to give the functions under test. */
export const SITE = "http://moodle.test/";

// The fake's own blank page, for requests the driver makes without a tab.
const TRANSPORT_PATH = "__fake-transport";

/**
 * A Moodle page reduced to what the driver reads: the body class, `M.cfg` (`wwwroot`, `sesskey`,
 * `userId`, and `contextid` when given), the logout link in the user menu and the page heading, as
 * Moodle 5.2 renders them.
 */
export function moodlePage({
  userId,
  heading = "Dashboard",
  guest = false,
  sesskey = "s1",
  wwwroot = "http://moodle.test",
  body = "",
  bodyId = "",
  bodyClass = "",
  contextId,
}: { userId: number; heading?: string; guest?: boolean; sesskey?: string; wwwroot?: string; body?: string; bodyId?: string; bodyClass?: string; contextId?: number }): string {
  const loggedIn = userId > 0;
  return `<!DOCTYPE html><html><head><title>${heading}</title>
<script>var M = {}; M.cfg = {"wwwroot":${JSON.stringify(wwwroot).replaceAll("/", "\\/")},"sesskey":"${sesskey}","userId":${userId},"language":"en","usertimezone":"Europe/Madrid"${contextId ? `,"contextid":${contextId}` : ""}};</script></head>
<body${bodyId ? ` id="${bodyId}"` : ""} class="${loggedIn ? "" : "notloggedin"} ${bodyClass}">
<nav>${loggedIn && !guest ? '<div class="usermenu"><a href="http://moodle.test/login/logout.php?sesskey=x">Log out</a></div>' : '<a href="http://moodle.test/login/index.php">Log in</a>'}</nav>
<div id="page-header"><div class="page-header-headings"><h1>${heading}</h1></div></div>
${body}
</body></html>`;
}

/**
 * The first browser that launches headless: the system's Edge or Chrome, or Playwright's own Chromium
 * (the test container, `npm run test:docker`); `undefined` skips the tests that need one.
 */
export async function launchTestBrowser(): Promise<Browser | undefined> {
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      // Try the next one.
    }
  }
  return undefined;
}

/** Thrown by a fake service to answer with Moodle's exception `errorcode`. */
export class ServiceFailure extends Error {
  constructor(readonly errorcode: string) {
    super(errorcode);
  }
}

/**
 * What the fake Moodle serves (`serveFakeMoodle`): the test sets it up and may change it while it
 * runs (log someone in, change the sesskey); the fake records what it served in it.
 */
export interface FakeMoodleState {
  /** The logged-in user; none means every page is the login page. */
  user?: { id: number; fullName: string };
  /** The session's sesskey: changing it makes older tabs' service calls fail with `invalidsesskey`. */
  sesskey?: string;
  /** AJAX services by name: what each returns as `data` for its arguments; throwing `ServiceFailure` answers with that error code. */
  services?: Record<string, (args: Record<string, unknown>) => unknown>;
  /** Extra body HTML for the pages at these paths (logged in only). */
  bodies?: Record<string, string>;
  /** Extra body classes for the pages at these paths, as Moodle adds (`format-topics` on a course page). */
  bodyClasses?: Record<string, string>;
  /** Every page path served, for tests that count page loads. */
  pagesServed?: string[];
  /** Every service call received. */
  serviceCalls?: { methodname: string; args: Record<string, unknown> }[];
  /** The release LTI's platform configuration names ("4.5.15 (Build: 20261005)"); none answers it with 404. */
  release?: string;
  /** The components whose icon the site serves ("mod/qbank"), which tell its version; any other icon answers 404. */
  components?: string[];
}

/**
 * Serves a fake Moodle at `SITE` in `context`: logged out, every page is the login page, as with
 * Moodle's forced login (served in place: Playwright doesn't route the request after a redirect it
 * fulfilled, confirmed empirically); `state.user` logs someone in. `lib/ajax/service.php` answers
 * like Moodle's, exceptions included.
 */
export async function serveFakeMoodle(context: BrowserContext, state: FakeMoodleState): Promise<void> {
  // The driver's requests without a tab (`context.request`) don't go through routes: here they go
  // through a blank page of the site's origin, whose `fetch` does (the page itself isn't counted).
  let transportPage: Promise<Page> | undefined;
  setTransport(context, async (url, request) => {
    transportPage ??= context.newPage().then(async (page) => {
      await page.goto(`${SITE}${TRANSPORT_PATH}`);
      return page;
    });
    const page = await transportPage;
    return page.evaluate(
      async ({ url, request }) => {
        const g = globalThis as unknown as { fetch(url: string, init: object): Promise<{ status: number; url: string; text(): Promise<string> }> };
        const response = await g.fetch(url, { method: request.method ?? "GET", headers: request.headers, body: request.body, credentials: "same-origin" });
        return { status: response.status, url: response.url, body: await response.text() };
      },
      { url, request },
    );
  });
  await context.route(`${SITE}**`, async (route: Route) => {
    const url = new URL(route.request().url());
    if (url.pathname === `/${TRANSPORT_PATH}`) return route.fulfill({ status: 200, contentType: "text/html", body: "<!DOCTYPE html><title>transport</title>" });
    const sesskey = state.sesskey ?? "s1";
    if (url.pathname === "/lib/ajax/service.php") {
      const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
      const [request] = JSON.parse(route.request().postData() ?? "[]") as { methodname: string; args: Record<string, unknown> }[];
      if (!request) return json([]);
      state.serviceCalls?.push({ methodname: request.methodname, args: request.args });
      const fail = (errorcode: string) => json([{ error: true, exception: { message: errorcode, errorcode } }]);
      if (!state.user) return fail("servicerequireslogin");
      if (url.searchParams.get("sesskey") !== sesskey) return fail("invalidsesskey");
      const service = state.services?.[request.methodname];
      if (!service) return fail("invalidrecord");
      try {
        return json([{ error: false, data: service(request.args) }]);
      } catch (error) {
        if (error instanceof ServiceFailure) return fail(error.errorcode);
        throw error;
      }
    }
    if (url.pathname === "/mod/lti/openid-configuration.php") {
      if (!state.release) return route.fulfill({ status: 404, contentType: "text/html", body: "Not found" });
      const config = { issuer: "http://moodle.test", "https://purl.imsglobal.org/spec/lti-platform-configuration": { product_family_code: "moodle", version: state.release } };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config) });
    }
    const icon = /^\/(.+)\/pix\/monologo\.svg$/.exec(url.pathname);
    if (icon) return route.fulfill(state.components?.includes(icon[1]!) ? { status: 200, contentType: "image/svg+xml", body: "<svg/>" } : { status: 404, body: "Not found" });
    state.pagesServed?.push(url.pathname);
    const html = (body: string) => route.fulfill({ status: 200, contentType: "text/html", body });
    if (!state.user) return html(moodlePage({ userId: 0, heading: "Log in", sesskey }));
    const heading = url.pathname === "/user/profile.php" ? state.user.fullName : "Dashboard";
    // Moodle names each page in the body id: /mod/forum/view.php is page-mod-forum-view.
    const bodyId = `page${url.pathname.replace(/\.php$/, "").replaceAll("/", "-")}`;
    return html(moodlePage({ userId: state.user.id, heading, sesskey, body: state.bodies?.[url.pathname], bodyId, bodyClass: state.bodyClasses?.[url.pathname] }));
  });
}
