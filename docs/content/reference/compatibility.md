# Compatibility

## Moodle

The driver is developed and checked against **Moodle 5.2** (a real site in Docker, the Moodle sandbox), and most of what it reads has been stable since Moodle 4.0: the course editor's state, the AJAX services, form field names, body ids. Behaviors confirmed by hand are marked "confirmed empirically" in the code's comments, with the Moodle version.

What depends on newer versions:

- Question banks as `qbank` activities, and quizzes' own banks: Moodle 5.0 and later.
- The activities overview (`activitiesOverview`): Moodle 5.0 and later.
- Random quiz questions as question set references (shown as `random` slots): Moodle 4.3 and later.

Moodle's themes change the look but rarely the structure the driver reads; it's checked with Boost, the default theme. Interface languages don't matter: nothing is read by its text.

## Browsers

Microsoft Edge, Google Chrome, or Playwright's Chromium, through `playwright-core` 1.64 or later (a peer dependency). The browser runs on Windows, macOS and Linux; on Linux without a display only headless.

## Node.js

Node.js 20 or later, ESM only.

## Single sign-on

Anything the person can complete in a browser window: Moodle's own form, SAML, OAuth 2 (Google, Microsoft), CAS, two-factor authentication. The driver only waits until a page of the site shows a logged-in user.

## Plugins

Modules from plugins work where the driver reads Moodle's generic structures (the course state, the activities overview, settings forms). Area functions are written for core modules, and for the questionnaire plugin in [surveys](../areas/surveys-and-choices.md). `moduleCategories()` answers `any` for modules it doesn't know.
