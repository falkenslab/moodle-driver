# Glossary

## Site

The Moodle installation the driver works on, given by its base URL (`siteUrl`, ending in `/`).

## Profile

The browser's persistent user-data folder: it keeps the person's Moodle session between runs. Only one browser can use it at a time.

## Channel

Which browser Playwright launches: the system's `msedge` or `chrome`, or `chromium`, downloaded when neither is installed (ADR-001).

## Course module id (cmid)

The id of an activity in a course, which every activity function takes; not the activity's instance id, which some services want and the driver finds itself.

## Working tab

The one tab a program can drive itself (`tab()`), the same one the browser follows pages in while shown (ADR-007).

## Trail

How student actions view and do things: `realistic`, through the real pages at a person's pace, or `fast` (ADR-005).

## Consumer

A program that uses the driver: moodle-mcp, a CLI.
