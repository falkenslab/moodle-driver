# Architecture

## Flow

```
program (moodle-mcp, a CLI) --> index.ts (public API): createMoodle() (client.ts, ADR-009) or the functions; internals.ts: the primitives (ADR-010)
  createBrowserManager(options) --> browser/manager.ts (persistent context on the profile, system channel or Chromium)
  area functions (context, siteUrl, ids, options) --> core/ajax.ts (AJAX over HTTP) | core/session.ts (openSitePage) | core/forms.ts --> Moodle
```

## Key pieces (`src/`)

- `index.ts` — the main entry, curated: the object, the operations, their types and errors. `internals.ts` — `@falkenslab/moodle-driver/internals`: the generic primitives (services, pages, forms, text, pace, the editor, the course's raw state) (ADR-010).
- `client.ts` — `createMoodle()`: one site and its browser as an object whose methods are the site functions, bound (ADR-009).
- `home.ts` — `siteProfileDir()`: the folder the `moodle` command keeps a site's profile in (`~/.moodle-driver/sites/<host>/`), for programs that share its sessions (ADR-013).
- `options.ts` — what a program chooses: `BrowserOptions` (profile, channel, headless, download), channels, trails, `parseSiteUrl()`.
- `categories.ts` — what data each public function reads or writes (`DATA_CATEGORIES`, `moduleCategories()`), for programs that restrict what an agent may do; a test fails on an undeclared export.
- `cli/` — the `moodle` command (ADR-012): `main.ts` (the `bin`), `run.ts` (one command line, its surroundings injected), `args.ts` (arguments and flags into the method's arguments), `output.ts` (tables or JSON), `config.ts` (the home: the default site, a folder per site with its `site.json` and named profiles, a first login named after the username, `sites`, `forget`; ADR-013), `commands.generated.ts` (the table, from `scripts/generate-cli-commands.mjs`).
- `testing/` — the fake Moodle served inside a browser context, grading panel HTML, a browser manager that launches nothing.

### `browser/`

- `manager.ts` — `createBrowserManager()`: the persistent context opened on first use and reused, one operation at a time; a headed request relaunches it with a window; Chromium downloaded in the background when no browser is installed (ADR-001); shown or hidden on demand (`setVisible`), following pages in one working tab (`show`, `tab`, ADR-007); refuses a window where there's no screen.
- `cookies.ts` — session cookies saved in the profile and restored on launch (ADR-003). `chromium.ts` — Playwright's CLI as a process tree that ends with the program.

### `core/`: what every area is built on

- `session.ts` — whether a page has a user logged in (body class, `M.cfg.userId`, login and logout links), `openSitePage()`, `logOut()`, and the hook that lets the browser follow the pages functions open.
- `ajax.ts` — `callService()`: AJAX over HTTP with the profile's session and the `sesskey` read from a light page, a stale one read again, session errors as `NotLoggedInError` (ADR-004, ADR-011); `http.ts` — requests without a tab (`context.request`, or the fake Moodle's transport); `readPageConfig()`.
- `forms.ts` — forms: fields by name (TinyMCE through its API), draft areas as the file picker and file manager work them (upload, list, delete), submit, validation errors by field, date selectors in the person's time zone. `inPage.ts` — `inPage()`.
- `text.ts` — entities decoded, elements' text with paragraphs and lists, media in content. `pace.ts` — a person's reading pace for the realistic trail (ADR-005).
- `site.ts` — a site's base URL from any page (no browser). `login.ts` — `logIn()`: the user at once if there's a session, else a window at the login page waiting for the person (ADR-002).
- `editor.ts` — the course editor's actions and renames. `files.ts` — local files checked, site files downloaded with the session.
- `errors.ts` — `MoodleError`, the base of every error the driver throws, and its stable codes (`MoodleErrorCode`).

### `areas/`: one folder per Moodle area

- `site/` — `info.ts`: the public configuration (no session), a course's addable types; `users.ts`: a user by id, the site's name, roles and abilities in a course, `whoAmI()`.
- `courses/` — `list.ts`: the person's courses, and changing one's settings through its form; `state.ts`: a course's state and what its page adds (activities' dates and restrictions, sections' descriptions); `structure.ts`: its structure, assignments and what's pending; `overview.ts`: the activities overview, deadlines and course updates.
- `activities/` — `build.ts`: creating, updating (a resource's or folder's files too), moving, duplicating and deleting activities and sections, each answering with the structure afterwards; `activitySettings()` reads an activity's form as fields (name, label, value, options, disabled) without submitting it. `conditions.ts`: restrictions (Moodle's availability JSON) and completion (the module's fields) to and from plain terms, a grade condition's item found in the gradebook setup. `content.ts`: a page, book, label, URL, file or folder viewed as a person would.
- `assignments/` — `grader.ts`: an assignment's ids, participants and panels; `grading.ts`: everyone's submissions and grading (simple, rubric levels, guide scores; the grading method read from the panel), extensions through their form, feedback files through the panel's draft area, the marking workflow's batch forms (states, markers); `student.ts`: the student's side (save, submit, the group a submission is for).
- `quizzes/` — `attempts.ts`: a quiz's page, attempts (questions by form name, answers page by page, finish), reviews, user overrides through their form; `results.ts`: attempts from the overview and responses reports (ids from inputs and links, the grade column by its class, state and dates by position); `grading.ts`: what waits for grading by hand (the grading report's questions, the results report's attempts) and a question graded through the comment form, posted as its Save does; `structure.ts`: sections, slots and pages from the edit page; changed as the edit page does: bank and random questions and repagination posted to it, moves, removals, page breaks and section headings through its edit_rest.php requests (the quiz's instance id from its toolboxes' settings), marks through `mod_quiz_update_slots` (an attempted quiz can't change but its marks).
- `questions/banks.ts` — question banks (Moodle 5: qbank activities, quizzes' own) and their questions read from the bank page by field names and icons; imports through the import form; single questions created and edited through their type's edit form (a save is a new version); deleted through the delete page, asked then confirmed (a question in use is hidden: told apart by whether it still opens); status through `qbank_editquestion_set_status`. A bank's module is checked first: opening any activity's bank page creates categories for it.
- `forums/` — `discussions.ts`: discussions from the forum's pages (pinned and locked included); `posts.ts`: posts through the service, replying, starting discussions and editing posts through the post form, deleting through its confirmation (refusals read from Moodle's error box or redirect notification), pinning and locking through their services; `grading.ts`: whole-forum grades through the grader's grading panel services, with the ids its button carries.
- `ratings/` — `ratings.ts`: rating a forum post, glossary entry or database record through the rating form under it, sent to `rating/rate_ajax.php`.
- `surveys/` — `surveys.ts`: questionnaire and feedback surveys; `choice.ts`: a choice read and answered on its page (its services aren't open to AJAX): options by id, whether answers can change, the answer.
- `lessons/lessons.ts` — a lesson page by page as a student: content pages' buttons, question forms, the feedback after an answer and the end, read by their forms; Moodle's "resume where you left" is accepted.
- `h5p/h5p.ts` — an H5P activity's content type (from its player page's settings) and the person's attempts (their report, by position and icon); playing it is the working tab's (ADR-007).
- `scorm/scorm.ts` — a SCORM activity's attempt status (its page, by line position) and SCOs (the player's table of contents from `prereqs.php`, status by icon), and its player opened on the working tab; Moodle's SCORM services aren't open to AJAX.
- `grades/` — `user-report.ts`: the user grade report; `gradebook.ts`: the grader report and the gradebook setup read by data attributes, categories and items added, changed and deleted through Moodle's dynamic forms (`core_form_dynamic_form`) and the setup page's move and delete actions; `singleview.ts`: grading in the gradebook through the single view report, in editing mode for the change; `export.ts`: the export plugins' form, its file saved as a download.
- `completion/completion.ts` — manual completion (the person's), overrides (a teacher's) through their services; the progress report read by its links and icon names.
- `participants/participants.ts` — a course's participants and groups from the participants table's service, filtered by role, group and inactivity; roles and groups by id from the page's filters. `enrolments.ts`: enrolling (the "Enrol users" form fragment, sent to `enrol/manual/ajax.php`), unenrolling (each enrolment's unenrol link in the table) and roles (the roles column's inplace editable). `groups.ts`: groups and groupings through the group and grouping forms and the members and grouping pages (`group/members.php`, `group/assign.php`), posted as their buttons post. `methods.ts`: enrolment methods from the methods page (`enrol/instances.php`) and each method's form (`enrol/editinstance.php`).
- `calendar/calendar.ts` — course events created through the calendar's event form (a fragment opened at the start time, so no dates are filled in the person's time zone) and changed through the same form opened on the event (its dates filled in the person's time zone), sending only the fields of the event's type; read from the upcoming view or by id, deleted through its service.
- `messages/messages.ts` — the person's notifications and conversations, and sending a private message (to one person, or to participants chosen as `participants` chooses them), through the popover's and the messaging drawer's services.

## Folder map

- `src/` — the library: `browser/`, `core/`, `areas/<area>/`; `test/` — `node:test` suites mirroring it.
- `scripts/` — the Docker runner for anything that opens a browser (`in-docker.mjs`, `docker-proxy.mjs`).
- `dist/` — the build, with declarations (not committed).
- `docs/` — the documentation site (Docusaurus): guides per area in `docs/content/`, the API reference generated from the doc comments.
