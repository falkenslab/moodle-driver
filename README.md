# moodle-driver

Work a Moodle site with the person's own session, through a real browser (Playwright): no web services, no tokens. Read courses, content, assignments, quizzes, forums, grades, surveys, choices, lessons and H5P activities; create and edit activities, sections, course settings, calendar events and questions; grade (rubrics and marking guides too), grant extensions and quiz overrides, set up the gradebook and completion; list participants and groups; read notifications and send messages; answer as a student at a person's pace. Every function returns plain data.

Documentation: https://falkenslab.github.io/moodle-driver/ (guides for every Moodle area and the API reference).

Extracted from moodle-mcp, its first consumer. The design is in `.minispec/` (start with `core/project.md` and the decisions).

## Why a browser

Every other Moodle client found uses Moodle's web services with a token, which many institutions don't enable for students or teachers. This one drives the system's Edge or Chrome on a persistent profile where the person logs in by hand (SSO included), and calls the AJAX services Moodle's own pages use from a logged-in tab. It never handles a password.

## Use

```ts
import { createMoodle } from "@falkenslab/moodle-driver";

const moodle = createMoodle({ site: "https://campus.example.org/", profileDir: "/home/me/.moodle-profile", headless: true, downloadBrowser: true });
await moodle.logIn({ timeoutMs: 300_000 }); // a window opens the first time; the person logs in there
const courses = await moodle.listCourses();
await moodle.gradeSubmission(35, 7, { grade: "8", feedback: "<p>Good work.</p>" });
await moodle.close();
```

Every operation is a method of the `Moodle` object, and also an exported function that takes the browser context and the site first (`listCourses(context, site)`), for programs that manage the browser themselves. Every error is a `MoodleDriverError` with a stable `code`, and those a program can act on have their own classes (`NotLoggedInError`, `NoDisplayError`, `BrowserDownloadingError`…). The primitives the operations are built from (Moodle's services, pages and forms) are in `@falkenslab/moodle-driver/internals`, for going lower level. Test helpers (a fake Moodle served inside a browser context) are in `@falkenslab/moodle-driver/testing`. Every function declares the data it touches in `DATA_CATEGORIES` (own, course content, others' personal data, grading others, communication…), so a program can allow only some kinds.

## Development

```sh
npm install
npm run typecheck && npm run lint
npm run test:docker    # the tests open browsers: always in Docker, never on the desktop
npm run build          # dist/, with declarations
```

The Docker runner joins the [Moodle sandbox](../moodle-sandbox)'s network when it's running.

## License

MIT, Falkenslab.
