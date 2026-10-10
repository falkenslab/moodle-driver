# Troubleshooting

## NotLoggedInError on every call

The session ended: Moodle expired it, the person logged out, or logged in elsewhere on a site that allows one session. Call `logIn()` again; a window opens. If it happens right after logging in, check that the profile folder is the same in both runs and writable: the session cookies live in a file inside it.

## "Neither Microsoft Edge nor Google Chrome is available, so it's being downloaded"

That's `BrowserDownloadingError`: no system browser was found and Chromium is downloading in the background (about 180 MB). Try again in a minute or two. Behind a proxy or without internet the download fails; `chromiumDownload()` then says `"failed"`. Install Edge or Chrome, or set `PLAYWRIGHT_BROWSERS_PATH` to a folder with Playwright's browsers.

## NoDisplayError

A window was needed (logging in, `setVisible(true)`) on Linux without `DISPLAY` or `WAYLAND_DISPLAY`: a server, a container, an SSH session. Log in once where there's a screen with the same profile, then run headless. In a container, `xvfb-run` gives a virtual display if a window is really needed.

## A form "has no such field" or "has these fields disabled"

Field names are Moodle's, from the form's HTML: read them with `activitySettings()` for an activity, or from the page. A field that's disabled is waiting for another one: a date's `[enabled]` checkbox, an assignment's "rescale existing grades" choice before a new maximum grade. Set that one first in the same call.

## Moodle refused the form

`FormError` lists Moodle's validation messages by field, in the site's language: a short name already used, a date before another, a required field left empty. Fix the values and try again; nothing was saved.

## "servicenotavailable" from callService

The service exists but isn't open to AJAX: many are only for the mobile app. The driver's functions use only AJAX-enabled services, or the pages and forms where none is open.

## The grader report says it's recalculating

After deleting activities or changing weights Moodle recalculates grades in a background task, and the grader report shows a progress bar meanwhile (`GradebookError`). On a site without cron (a local sandbox), run Moodle's tasks.

## A quiz can't change its questions

Moodle doesn't let a quiz with attempts add or remove questions. Make a new quiz, or delete its attempts in Moodle first.

## Slow calls

Each call is a page or a service request, and student functions with the realistic trail wait like a reader (see [Working at a student's pace](../concepts/student-pace.md)). Use `trail: "fast"` where pace doesn't matter, read what you need once and keep it, and prefer functions that return the state after a change instead of reading it again.

## Something works in the browser but not through the driver

Show the browser with `setVisible(true)`: it follows the pages functions open, so you see where it stops. `moodleErrorMessage(page)` reads Moodle's error on a page of your own, and `browser.tab()` lets you try the steps by hand with Playwright.
