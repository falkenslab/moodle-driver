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
- `categories.ts` — what data each public function reads or writes (`DATA_CATEGORIES`, `moduleCategories()`), for programs that restrict what an agent may do; a test fails on an undeclared export.
- `moodle/session.ts` — whether a page has a user logged in (body class, `M.cfg.userId`, login and logout links), `openSitePage()`, `logOut()`, and the hook that lets the browser follow the pages functions open.
- `moodle/ajax.ts` — `callService()`: AJAX from a kept logged-in tab with its `sesskey`, a stale tab replaced, session errors as `NotLoggedInError` (ADR-004); `readPageConfig()`.
- `moodle/forms.ts` — forms: fields by name (TinyMCE through its API), draft-area uploads as the file picker does, submit, validation errors by field. `moodle/inPage.ts` — `inPage()`.
- `moodle/text.ts` — entities decoded, elements' text with paragraphs and lists, media in content. `moodle/pace.ts` — a person's reading pace for the realistic trail (ADR-005).
- `moodle/site.ts`, `moodle/siteInfo.ts` — a site's base URL from any page (no browser), the public configuration (no session), a course's addable types.
- `moodle/login.ts` — `logIn()`: the user at once if there's a session, else a window at the login page waiting for the person (ADR-002).
- `moodle/user.ts` — a user by id, the site's name, roles and abilities in a course, `whoAmI()`.
- `moodle/participants.ts` — a course's participants and groups from the participants table's service, filtered by role, group and inactivity; roles and groups by id from the page's filters.
- `moodle/completion.ts` — manual completion (the person's), overrides (a teacher's) through their services; the progress report read by its links and icon names.
- `moodle/gradebook.ts` — the grader report and the gradebook setup read by data attributes; categories and items changed through Moodle's dynamic forms (`core_form_dynamic_form`) and the setup page's move action.
- `moodle/questionBank.ts` — question banks (Moodle 5: qbank activities, quizzes' own) and their questions read from the bank page by field names and icons; imports through the import form; single questions through their type's edit form. A bank's module is checked first: opening any activity's bank page creates categories for it.
- `moodle/messages.ts` — the person's notifications and conversations, and sending a private message, through the popover's and the messaging drawer's services.
- `moodle/calendar.ts` — course events created through the calendar's event form (a fragment opened at the start time, so no dates are filled in the person's time zone), read from the upcoming view, deleted through its service.
- `moodle/h5p.ts` — an H5P activity's content type (from its player page's settings) and the person's attempts (their report, by position and icon); playing it is the working tab's (ADR-007).
- `moodle/lesson.ts` — a lesson page by page as a student: content pages' buttons, question forms, the feedback after an answer and the end, read by their forms; Moodle's "resume where you left" is accepted.
- `moodle/choice.ts` — a choice read and answered on its page (its services aren't open to AJAX): options by id, whether answers can change, the answer.
- `moodle/courses.ts`, `moodle/course.ts`, `moodle/structure.ts` — the person's courses, and changing one's settings through its form; a course's state and activity details; its structure, assignments and what's pending.
- `moodle/content.ts` — a page, book, label, URL, file or folder viewed as a person would. `moodle/files.ts` — local files checked, site files downloaded with the session.
- `moodle/editor.ts`, `moodle/activities.ts` — the course editor's actions and renames; creating, updating, moving, duplicating and deleting activities and sections, each answering with the structure afterwards. `activitySettings()` reads an activity's form as fields (name, label, value, options, disabled) without submitting it.
- `moodle/assign.ts`, `moodle/grading.ts`, `moodle/submission.ts` — an assignment's ids, participants and panels; everyone's submissions and grading (simple, rubric levels, guide scores; the grading method read from the panel); extensions through their form (dates in the person's time zone, `dateSelectorValues`/`dateSelectorDate`); the student's side (save, submit).
- `moodle/quiz.ts` — a quiz's page, attempts (questions by form name, answers page by page, finish), reviews; user overrides through their form.
- `moodle/quizResults.ts` — a quiz's attempts from its overview and responses reports: ids from inputs and links, the grade column by its class, state and dates by position from it.
- `moodle/quizStructure.ts` — a quiz's slots and pages from its edit page; bank and random questions added as its bank actions post them (an attempted quiz can't change).
- `moodle/forum.ts`, `moodle/forumPosts.ts` — discussions from the forum's pages (pinned and locked included), posts through the service; replying and starting discussions through the post form; pinning and locking through their services.
- `moodle/grades.ts`, `moodle/overview.ts`, `moodle/survey.ts` — the user grade report; the activities overview, deadlines and course updates; questionnaire and feedback surveys.
- `testing/` — the fake Moodle served inside a browser context, grading panel HTML, a browser manager that launches nothing.

## Folder map

- `src/` — the library; `test/` — `node:test` suites mirroring it.
- `scripts/` — the Docker runner for anything that opens a browser (`in-docker.mjs`, `docker-proxy.mjs`).
- `dist/` — the build, with declarations (not committed).
