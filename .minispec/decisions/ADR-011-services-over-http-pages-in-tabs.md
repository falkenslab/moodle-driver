# ADR-011: Services over HTTP, pages in tabs

## Decision

Moodle's AJAX services are called over HTTP with the profile's session, without a tab: a POST to `lib/ajax/service.php` through `context.request` (the persistent context's cookies), with the session's `sesskey` read once from a light page fetched the same way (`src/core/http.ts`, `src/core/ajax.ts`). Pages stay in tabs: the measured gain of reading them over HTTP is too small to rewrite the readers. `fetchSitePage()` (a page's HTML over HTTP, checked for a session) is a primitive in `/internals` for programs that want it (measured and decided with the owner, 10 October 2026).

## Motivation

`service.php` needs the session cookie and the `sesskey`, nothing a browser adds; the kept tab only lent them to a `fetch`. Measured against the Moodle sandbox (Moodle 5.2 in Docker, course 3, a teacher's profile, medians of 5 warm runs, `scripts/benchmark-reads.mts`):

| Read | Through a tab | Without one |
| --- | --- | --- |
| An AJAX service (`core_course_get_enrolled_courses_by_timeline_classification`) | 712 ms | 664 ms over HTTP (×1.1) |
| The course page | 4442 ms | 4201 ms without subresources, 4048 ms over HTTP (×1.1) |
| The user grade report | 3842 ms | 3062 ms, 2768 ms (×1.4) |
| A quiz's page | 3276 ms | 3091 ms, 2970 ms (×1.1) |
| A forum's page | 3887 ms | 3773 ms, 3511 ms (×1.1) |
| An assignment's page | 3364 ms | 3100 ms, 2934 ms (×1.1) |

The time is Moodle's: the server renders a page in seconds on the sandbox, and the tab adds little, because `openSitePage` already waits only for `domcontentloaded`. Services over HTTP still win: no tab kept open per context, one way to call them, and nothing to replace when it goes stale. Pages over HTTP would need every reader rewritten (relative links, `page.url()`, pagination by navigation, content built by JavaScript) for 10–40%.

## Consequences

- Requests without a tab don't go through `context.route` (confirmed empirically, playwright-core 1.64): the fake Moodle sends them through a page of its own (`setTransport`), so tests keep serving them from their routes.
- `readPageConfig` reads `M.cfg` from that light page each time it's asked: someone else may have logged in on the profile since.
- A site much faster than the sandbox could change the balance for pages; `scripts/benchmark-reads.mts` measures it again on any site and profile.
- ADR-004 still holds: services first, pages and forms where none helps; only how the services are reached changed.
