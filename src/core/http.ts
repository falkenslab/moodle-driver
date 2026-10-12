// HTTP requests to the site with the profile's session, without a tab: Playwright's `context.request`
// shares the persistent context's cookies (ADR-011).
import type { BrowserContext } from "playwright-core";

export interface SiteRequest {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

/** What the site answered: the status, the URL after redirects, the body as text. */
export interface SiteResponse {
  status: number;
  url: string;
  body: string;
}

type Transport = (url: string, request: SiteRequest) => Promise<SiteResponse>;

// A context's own way to make requests, when it has one: the fake Moodle answers through its routes,
// which `context.request` doesn't go through (confirmed empirically, playwright-core 1.64).
const transports = new WeakMap<BrowserContext, Transport>();

/** Sends this context's requests through `transport` instead of `context.request` (for the fake Moodle). */
export function setTransport(context: BrowserContext, transport: Transport): void {
  transports.set(context, transport);
}

/** A request to `url` with the context's cookies; redirects are followed, and any status is returned. */
export async function siteFetch(context: BrowserContext, url: string, request: SiteRequest = {}): Promise<SiteResponse> {
  const transport = transports.get(context);
  if (transport) return transport(url, request);
  let response;
  try {
    response = await context.request.fetch(url, {
      method: request.method ?? "GET",
      headers: request.headers,
      data: request.body,
      maxRedirects: 10,
      failOnStatusCode: false,
    });
  } catch (error) {
    throw redacted(error);
  }
  return { status: response.status(), url: response.url(), body: await response.text() };
}

/**
 * The error without the session in it. A request that times out fails with Playwright's call log,
 * which lists the request's headers, the session cookie among them (confirmed empirically,
 * playwright-core 1.64), and its URL, which carries the sesskey for services: anyone reading a log
 * of the error could take over the session.
 */
export function redacted(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  const hide = (text: string) =>
    text.replace(/^(\s*-\s*(?:cookie|set-cookie|authorization):).*$/gim, "$1 [redacted]").replace(/([?&]sesskey=)[^&\s"']+/gi, "$1[redacted]");
  error.message = hide(error.message);
  if (error.stack) error.stack = hide(error.stack);
  return error;
}
