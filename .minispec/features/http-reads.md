# Reads over HTTP with the profile's session

Issue: [#21](https://github.com/falkenslab/moodle-driver/issues/21)

## Goal

Measure how much faster read-only operations are over plain HTTP requests carrying the profile's session than through a browser tab, and move the ones that gain and don't need Moodle's JavaScript, without changing the API.

## Context

- Every read opens a tab: `openSitePage()` navigates (`domcontentloaded`), the page loads its CSS, scripts and images, and the driver reads the DOM with `page.evaluate`. AJAX services go through `fetch` in a kept tab (ADR-004).
- Playwright's `context.request` makes HTTP requests with the persistent context's cookies, without a tab; `downloadFile` already uses it.
- `lib/ajax/service.php` is one endpoint for every AJAX service: it needs the session cookie and the session's `sesskey` (in `M.cfg` of any page), nothing from a browser. The kept tab only lends those two to a `fetch`, and already doesn't follow (`follow: false`).
- Other Moodle clients read over HTTP with a session cookie only (moodle-cli takes it from the person's browser). The driver keeps its own profile and its browser for logging in, writing and pages built by JavaScript (ADR-001, ADR-002); reads are where HTTP may pay.
- Reading HTML without a page needs a parser: a dependency (one more for every program), or the HTML set into one reused blank tab (`page.setContent`, no network, no scripts), which keeps the current `page.evaluate` readers as they are.

## Changes

- A benchmark script (in Docker, against the Moodle sandbox, course 3; never course 2) timing each read both ways, cold and warm, several runs: `courseStructure`, `courseStructure({ details })`, `myGrades`, `forumDiscussions`, `discussion`, `activityContent` (page, book), `quizInfo`, `participants`, `assignmentSubmissions`, `studentAssignment`, `deadlines`, a `callService` call (kept tab against `context.request` with the sesskey).

First, the services (most reads go through them, so all gain at once):

- `callService` over `context.request`: a POST to `lib/ajax/service.php` with the `sesskey` kept per context, read once from a light page fetched over HTTP; `invalidsesskey` renews it once, `servicerequireslogin` (or the login page) is `NotLoggedInError`, as now. The kept tab goes.

Then, pages:

- A primitive `fetchSitePage(context, siteUrl, path)`: the HTML over `context.request`, `NotLoggedInError` when Moodle answers with its login page or a redirect to it, Moodle's error page reported as now.
- Parse the fetched HTML in one reused blank tab with `setContent` (scripts off), so the page readers don't change; compare with a parser dependency only if that's clearly faster.
- Migrate the operations that gain and whose content is in the HTML Moodle sends (not filled in by JavaScript); keep the tab for the rest, the forms and the writes.
- What the person watching sees (ADR-007) stays: `fetchSitePage` follows like `openSitePage`; with the browser shown, the working tab loads the page's URL after the read (a page load only while someone watches); hidden, it's HTTP only. Services aren't shown, as now.
- One way per thing, never a switchable "HTTP mode": services always over HTTP; each page read uses `fetchSitePage` or `openSitePage` by what it needs (static HTML, or forms, JavaScript and the realistic trail); both share the page readers.
- The realistic trail (ADR-005) keeps opening the real pages: a student's views are a person's.

## Acceptance

- A table of timings per operation, both ways, in the ADR that records the decision, with the Moodle version and how it was measured.
- The migrated operations return exactly what they returned through a tab (same tests, and a check against the sandbox), and are measurably faster.
- No change for a program using the driver except speed; no new runtime dependency unless the measurement justifies it.
