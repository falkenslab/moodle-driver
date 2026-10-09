# ADR-007: The browser shown on demand, and one working tab

## Decision

`BrowserManager.setVisible(true)` relaunches the browser with a window (the session kept, ADR-003) and `setVisible(false)` closes it, so the next call runs headless again; a window the person closes counts as hiding it. While shown, `show(url)` brings a site page to the front of one working tab, and every page a function opened with `openSitePage()` is followed there once the function is done with it. `tab()` gives that working tab to a program that drives pages itself. Moved from moodle-mcp's ADR-010 and ADR-011, whose mechanism this is (9 October 2026).

## Motivation

Most functions work through AJAX from a hidden tab (ADR-004), so a visible browser alone shows almost nothing. A person who wants to watch a program work needs the page each step is about. Playwright can't add or remove a window from a running browser, so switching relaunches it; the saved session makes that cheap.

## Consequences

- Following is best effort: a page that doesn't load never changes a function's result. It costs one more page load per step while shown, nothing while hidden.
- Open tabs don't survive a switch; what was saved in Moodle does.
- Without a screen, `setVisible(true)` throws `NoDisplayError` and the browser stays headless.
- Which page an AJAX-only step shows is the consumer's choice (moodle-mcp maps each tool to one).
