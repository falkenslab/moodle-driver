import type { BrowserContext } from "playwright-core";
import { callService, parseServiceResponse } from "./ajax.js";
import { decodeEntities } from "./text.js";

const TIMEOUT_MS = 60_000;

/** The parts of `tool_mobile_get_public_config` (Moodle 5.2) the server reports. */
interface PublicConfig {
  wwwroot: string;
  sitename: string;
  lang?: string;
  langlist?: string;
  typeoflogin?: number;
  guestlogin?: number;
  maintenanceenabled?: boolean;
  maintenancemessage?: string;
  supportpage?: string;
  identityproviders?: { name: string; url?: string }[];
}

// typeoflogin: how the mobile app is told to log in, which says whether the site uses its own form.
const LOGIN_TYPES: Record<number, "app" | "browser" | "embedded"> = { 1: "app", 2: "browser", 3: "embedded" };

/**
 * What the site tells anyone about itself, through Moodle's AJAX entry point for services that need
 * no login (`service-nologin.php`): readable before logging in, without the browser. Moodle shows its
 * version only to administrators, so it isn't here.
 */
export async function publicSiteInfo(siteUrl: string, fetchImpl: typeof fetch = fetch) {
  const methodname = "tool_mobile_get_public_config";
  const response = await fetchImpl(new URL(`lib/ajax/service-nologin.php?info=${methodname}`, siteUrl).href, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ index: 0, methodname, args: {} }]),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const config = parseServiceResponse<PublicConfig>(methodname, response.status, await response.text());
  // "en|English,es|Español": the languages the menu offers; empty means every installed one.
  const languages = (config.langlist ?? "").split(",").map((entry) => entry.split("|")[0]?.trim() ?? "").filter(Boolean);
  return {
    name: decodeEntities(config.sitename),
    url: config.wwwroot,
    language: config.lang,
    ...(languages.length > 0 ? { languages } : {}),
    login: {
      ...(config.typeoflogin !== undefined && LOGIN_TYPES[config.typeoflogin] ? { appLogin: LOGIN_TYPES[config.typeoflogin] } : {}),
      guestAccess: config.guestlogin === 1,
      identityProviders: (config.identityproviders ?? []).map((p) => decodeEntities(p.name)),
    },
    ...(config.maintenanceenabled ? { maintenance: decodeEntities(config.maintenancemessage ?? "") || "The site is in maintenance mode." } : {}),
    ...(config.supportpage ? { supportPage: config.supportpage } : {}),
  };
}

/** The activity and resource types the person can add to a course: none when they can't edit it. */
export async function courseActivityTypes(context: BrowserContext, siteUrl: string, courseId: number) {
  const { content_items: items } = await callService<{ content_items: { name: string; title: string; purpose?: string }[] }>(context, siteUrl, "core_course_get_course_content_items", { courseid: courseId });
  // A type with several items (LTI tools) is listed once.
  const seen = new Set<string>();
  return items
    .filter((item) => !seen.has(item.name) && seen.add(item.name))
    .map((item) => ({ type: item.name, title: decodeEntities(item.title), ...(item.purpose ? { purpose: item.purpose } : {}) }));
}
