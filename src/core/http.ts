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
  const response = await context.request.fetch(url, {
    method: request.method ?? "GET",
    headers: request.headers,
    data: request.body,
    maxRedirects: 10,
    failOnStatusCode: false,
  });
  return { status: response.status(), url: response.url(), body: await response.text() };
}
