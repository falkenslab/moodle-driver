# Architecture

## Flow

```
program (moodle-mcp, a CLI) --> index.ts (public API)
  createBrowserManager(options) --> browser.ts (persistent context on the profile, system channel or Chromium)
  area functions (context, siteUrl, ids, options) --> moodle/ajax.ts (AJAX from a kept tab) | moodle/session.ts (openSitePage) | moodle/forms.ts --> Moodle
```

## Key pieces (`src/`)

- `options.ts` — what a program chooses: `BrowserOptions` (profile, channel, headless, download), channels, trails, `parseSiteUrl()`.
- `browser.ts` — `createBrowserManager()`: the persistent context opened on first use and reused, one operation at a time; a headed request relaunches it with a window; Chromium downloaded in the background when no browser is installed (ADR-001); shown or hidden on demand (`setVisible`), following pages in one working tab (`show`, `tab`, ADR-007); refuses a window where there's no screen.
- `sessionCookies.ts` — session cookies saved in the profile and restored on launch (ADR-003). `chromiumInstaller.ts` — Playwright's CLI as a process tree that ends with the program.
- `moodle/session.ts` — whether a page has a user logged in (body class, `M.cfg.userId`, login and logout links), `openSitePage()`, `logOut()`, and the hook that lets the browser follow the pages functions open.
- `moodle/ajax.ts` — `callService()`: AJAX from a kept logged-in tab with its `sesskey`, a stale tab replaced, session errors as `NotLoggedInError` (ADR-004); `readPageConfig()`.
- `moodle/forms.ts` — forms: fields by name (TinyMCE through its API), draft-area uploads as the file picker does, submit, validation errors by field. `moodle/inPage.ts` — `inPage()`.
- `moodle/text.ts` — entities decoded, elements' text with paragraphs and lists, media in content. `moodle/pace.ts` — a person's reading pace for the realistic trail (ADR-005).
- `moodle/site.ts`, `moodle/siteInfo.ts` — a site's base URL from any page (no browser), the public configuration (no session), a course's addable types.
- `moodle/login.ts` — `logIn()`: the user at once if there's a session, else a window at the login page waiting for the person (ADR-002).
- `moodle/user.ts` — a user by id, the site's name, roles and abilities in a course, `whoAmI()`.
- `moodle/courses.ts`, `moodle/course.ts`, `moodle/structure.ts` — the person's courses; a course's state and activity details; its structure, assignments and what's pending.
- `moodle/content.ts` — a page, book, label, URL, file or folder viewed as a person would. `moodle/files.ts` — local files checked, site files downloaded with the session.
- `moodle/editor.ts`, `moodle/activities.ts` — the course editor's actions and renames; creating, updating, moving, duplicating and deleting activities and sections, each answering with the structure afterwards.
- `moodle/assign.ts`, `moodle/grading.ts`, `moodle/submission.ts` — an assignment's ids, participants and panels; everyone's submissions and grading; the student's side (save, submit).
- `moodle/quiz.ts` — a quiz's page, attempts (questions by form name, answers page by page, finish), reviews.
- `moodle/forum.ts`, `moodle/forumPosts.ts` — discussions from the forum's pages, posts through the service; replying and starting discussions through the post form.
- `moodle/grades.ts`, `moodle/overview.ts`, `moodle/survey.ts` — the user grade report; the activities overview, deadlines and course updates; questionnaire and feedback surveys.
- `testing/` — the fake Moodle served inside a browser context, grading panel HTML, a browser manager that launches nothing.

## Folder map

- `src/` — the library; `test/` — `node:test` suites mirroring it.
- `scripts/` — the Docker runner for anything that opens a browser (`in-docker.mjs`, `docker-proxy.mjs`).
- `dist/` — the build, with declarations (not committed).
