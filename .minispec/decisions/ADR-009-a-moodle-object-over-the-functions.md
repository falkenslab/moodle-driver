# ADR-009: A Moodle object over the functions

## Decision

`createMoodle({ site, ...browserOptions })` (or `{ site, browser }`) gives a `Moodle` object: every exported function whose first parameters are the browser context and the site becomes a method of the same name without them (`moodle.listCourses()` is `listCourses(context, site)`), plus the session and the browser (`logIn`, `close`, `context`, `tab`, `setVisible`, `callService<T>`…). The methods are bound from one table of functions, typed by a mapped type, not written by hand. The functions stay exported and keep working on their own (decided by the owner before the first release, 10 October 2026).

## Motivation

Passing the context and the site to every call is noise for the common case, a program working one site, and a `BrowserManager` the program has to keep beside them. Flat methods named as the functions keep one name per operation: the guides, the API reference and `DATA_CATEGORIES` describe both forms at once, and nothing about the functions changes for programs that already use them (moodle-mcp). Methods grouped by area (`moodle.courses.list()`) read better but would need a second naming and a second category table.

## Consequences

- A new function taking `(context, siteUrl, …)` goes into the table in `src/client.ts`; a test fails when a bound method's type isn't a function, and `DATA_CATEGORIES` covers the object's own methods as `Moodle.<method>`.
- Generic functions lose their type parameter when bound: they're bound by hand (`callService<T>`).
- The guides' examples use the object; the function forms are described in each area's signatures and remain the way to go lower level.
- The object holds the high-level operations only: the pieces they're built from (an assignment's ids and grading panel, a quiz attempt's single steps, the course's raw state, the editor's actions) stay functions. Settings a program would repeat on every call are the object's defaults (`trail`, `onProgress`, `loginTimeoutMs`, `downloadDir`), each overridable per call; the methods that use them are bound by hand. Ids never become state: a program works several courses (reviewed with the owner, 10 October 2026).
