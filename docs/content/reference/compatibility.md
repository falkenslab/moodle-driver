# Compatibility

## Moodle

The driver supports **Moodle 4.5** (the long-term support release) and **Moodle 5.x**. It's developed against Moodle 5.2 and checked against real sites of both in Docker (the Moodle sandbox's 5.2 and 4.5 sites); most of what it reads has been stable since Moodle 4.0: the course editor's state, the AJAX services, form field names, body ids. Behaviors confirmed by hand are marked "confirmed empirically" in the code's comments, with the Moodle version.

Where Moodle changed between versions, the driver takes the path the site's version needs. What a version simply lacks is refused before anything is opened, with a `MoodleError` of code `not-available` that names the function, the Moodle it needs and the one the site runs ("activitiesOverview needs Moodle 5.0 or later; this site runs 4.5").

### Functions that need a newer Moodle {#functions-that-need-a-newer-moodle}

Every function not listed here works from Moodle 4.5.

| Function | Needs | Why |
| --- | --- | --- |
| `activitiesOverview` | Moodle 5.0 | The activities overview page and its service came in 5.0. |

Other differences within a function, not refusals:

- Question banks as `qbank` activities, and quizzes' own banks: Moodle 5.0 and later.
- Random quiz questions as question set references (shown as `random` slots): Moodle 4.3 and later.

### How the version is found {#how-the-version-is-found}

`moodleVersion()` (see [users and the site](../areas/users-and-site.md#moodleversion)) tells the site's branch ("4.5", "5.2"…) and its release, without administrator rights: Moodle shows its version only to administrators, so the driver reads what the site offers anyone.

- LTI's public platform configuration (`mod/lti/openid-configuration.php`, there since Moodle 3.10) names the release: the branch comes from it.
- When that isn't available, which modules the site has: question bank activities (`mod/qbank`) came in 5.0, subsections (`mod/subsection`) in 4.5. A site with subsections and no question bank activities is 4.5.
- Otherwise the branch is `unknown`, never guessed as the newest: a 5.x site that hides its release, or a site older than 4.5. Functions that need a newer Moodle let an unknown version through, and fail as Moodle answers.

The answer is asked once per browser context and reused.

### Themes and languages {#themes-and-languages}

Moodle's themes change the look but rarely the structure the driver reads; it's checked with Boost (the default theme, on the 5.2 sandbox) and with Classic (on the 4.5 sandbox, as many campuses on 4.5 use it). Pages are read by structure that both themes draw, such as ids, data attributes and field names; where a function reads a part Classic draws differently, its guide says so. Interface languages don't matter: nothing is read by its text.

## Browsers

Microsoft Edge, Google Chrome, or Playwright's Chromium, through `playwright-core` 1.64 or later (a peer dependency). The browser runs on Windows, macOS and Linux; on Linux without a display only headless.

## Node.js

Node.js 20 or later, ESM only.

## Single sign-on

Anything the person can complete in a browser window: Moodle's own form, SAML, OAuth 2 (Google, Microsoft), CAS, two-factor authentication. The driver only waits until a page of the site shows a logged-in user.

## Plugins

Modules from plugins work where the driver reads Moodle's generic structures (the course state, the activities overview, settings forms). Area functions are written for core modules, and for the questionnaire plugin in [surveys](../areas/surveys-and-choices.md). `moduleCategories()` answers `any` for modules it doesn't know.
