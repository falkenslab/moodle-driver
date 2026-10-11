# Logs and reports

Who did what in a course, as a teacher sees it in Moodle's reports: the logs (by user, activity, kind of action and time), the views per activity (the activity report), and who took part in one activity (the participation report). They need the reports' capabilities in the course (`report/log:view`, `report/outline:view`, `report/participation:view`), which teachers have on a default site; a student gets a `ReportError`.

**Terms:** [log](../reference/glossary.md#log), [activity](../reference/glossary.md#activity), [course module id](../reference/glossary.md#course-module-id), [role](../reference/glossary.md#role).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

Moodle opens no service to AJAX for these reports: they're read from the report pages, by their tables' cells, links and form fields, so they work in any interface language. The texts Moodle writes (the component and event names, "Course module viewed") come in the site's language; the descriptions in English, as events write them. Dates are read back with the site language's own date format (its `langconfig` strings, through `core_get_strings`) in the person's time zone, and come as ISO 8601. Every function throws `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)).

## courseLogs

A course's logs, newest first.

```ts
function courseLogs(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  options?: { userId?: number; activityId?: number; from?: Date; until?: Date; action?: LogAction; limit?: number },
): Promise<LogEntry[]>;

type LogAction = "create" | "view" | "update" | "delete" | "change"; // LOG_ACTIONS

interface LogEntry {
  time?: string;
  timeText: string;
  userId?: number;
  userName: string;
  realUserId?: number;
  relatedUserId?: number;
  relatedUserName?: string;
  context: string;
  activityId?: number;
  component: string;
  event: string;
  description: string;
  origin: string;
  ip?: string;
}
```

- `userId`, `activityId` and `action` are the report's own filters: one person's events, one activity's (its course module id), and one kind of action (`"change"` is any create, update or delete).
- `from` and `until` keep to a time span: the report is read page by page, newest first, stopping at the first event older than `from`.
- `limit`: at most this many entries, 100 unless given.
- Each entry: `time` (ISO 8601) and `timeText` as the report shows it; who did it (`userId`, `userName`, none for the system's events; `realUserId` when someone acted logged in as them); whom it was about (`relatedUserId`, `relatedUserName`: graded, enrolled…); where (`context`, "Forum: News", and `activityId` when it was an activity); `component` and `event` names; Moodle's `description`; `origin` (`"web"`, `"cli"`, `"ws"`…) and `ip`.

`time` is missing only when the site's date format couldn't be read back; then a call with `from` or `until` throws `ReportError` rather than guess. Viewing the report is itself logged, so a later page may begin with rows already read: they're left out (two events identical to the second would be taken as one). Throws `ReportError` when the person can't see the course's logs.

## activityReport

A course's activity report: per activity, its views.

```ts
function activityReport(context: BrowserContext, siteUrl: string, courseId: number, options?: { from?: Date; until?: Date }): Promise<ActivityViews[]>;

interface ActivityViews {
  activityId: number;
  type: string;
  name: string;
  views: number;
  users: number;
  lastAccess?: string;
}
```

- `views`: how many times it was viewed; `users`: by how many people (0 for both when nobody did); `lastAccess`: the last view (ISO 8601, to the minute), missing when there's none or the site hides last access from the person.
- `from` and `until` count only the views in that span, as the report's own date filter does.
- `type` is the module (`"page"`, `"quiz"`…), and the activities come in the course's order.

Throws `ReportError` when the person can't see it.

## participationReport

Who took part in an activity of a course, and who didn't.

```ts
function participationReport(
  context: BrowserContext,
  siteUrl: string,
  courseId: number,
  activityId: number,
  options?: { roleId?: number; since?: Date; action?: ParticipationAction },
): Promise<ActivityParticipant[]>;

type ParticipationAction = "view" | "post"; // PARTICIPATION_ACTIONS

interface ActivityParticipant {
  userId: number;
  fullName: string;
  roleId: number;
  actions: number;
}
```

- Everyone with the role `roleId` in the course (every role the report offers, one after the other, when not given: a person with two roles comes once for each), with `actions`, how many actions they made in the activity; 0 for those who did nothing.
- `action` counts only views, or only posts (submitting, answering, posting); `since` only actions after that date.
- The course id is needed as well as the activity's: the report belongs to the course.

Moodle counts the actions people made as participants (through the web or the app), not a teacher's editing. Throws `ReportError` when the person can't see the report, or the activity isn't one of the course's.

## Example

```ts
import { ReportError } from "@falkenslab/moodle-driver";

// `moodle` is the object from createMoodle(), as in the getting-started pages.

try {
  // What Lucía (user 5) did in the last week.
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  for (const entry of await moodle.courseLogs(3, { userId: 5, from: since })) {
    console.log(`${entry.time ?? entry.timeText}  ${entry.event}  ${entry.context}`);
  }

  // Activities nobody has opened yet.
  const unseen = (await moodle.activityReport(3)).filter((activity) => activity.views === 0);
  console.log("Not viewed:", unseen.map((activity) => activity.name).join(", "));

  // Students who haven't posted in the forum (activity 46), role 5 being Student on this site.
  const silent = (await moodle.participationReport(3, 46, { roleId: 5, action: "post" })).filter((person) => person.actions === 0);
  console.log("No posts:", silent.map((person) => person.fullName).join(", "));
} catch (error) {
  if (error instanceof ReportError) console.error(error.message);
  else throw error;
}
```

## Data categories

- `courseLogs`, `participationReport`: `others-personal` (what each person did).
- `activityReport`: `course-content` and `others-aggregate` (counts that identify no one).

See [Data categories](../concepts/data-categories.md).
