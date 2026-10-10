# ADR-004: Moodle's AJAX services through the logged-in page

## Decision

The driver reads and writes Moodle through the AJAX services its own pages use (`lib/ajax/service.php`, functions marked `ajax => true`), called from a logged-in tab with the page's `sesskey` and cookies, whenever such a service gives what's needed. It reads rendered pages and fills Moodle's forms only when no service does, by structure (ids, data attributes, body ids, URLs), never by visible texts. It never uses a web service token. Moved from moodle-mcp's ADR-008 when the driver was extracted (9 October 2026).

## Motivation

The services return structured data, independent of the interface's language and theme, and are what Moodle's own JavaScript calls, so they exist on any site where the page works. Scraped HTML changes with themes and versions. A web service token would need the site to enable web services and the person to create a token, a credential a program would have to hold (ADR-002); many institutions don't allow either. Every other Moodle client found (moodle-client, moodle-webservice, joodle, the Moodle MCP servers) depends on that token: working with the person's own session is what this driver adds.

## Consequences

- The driver acts only as the person logged in, with their permissions: a service the page can't call, it can't either.
- One tab with a session is kept open and reused for service calls (`src/core/ajax.ts`); a `servicerequireslogin` or `invalidsesskey` answer means a new tab, and if the site shows its login page, `NotLoggedInError`.
- Which service a function uses is an internal detail: a service missing in an older Moodle is a bug to fix in that function, with the Moodle version noted.
