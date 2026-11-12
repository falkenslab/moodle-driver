# Attendance

Attendance activities (module `attendance`, the mod_attendance plugin), as teachers use them: their sessions added (one, or weekly between two dates), listed, changed and deleted, attendance taken for a session, and the report with each participant's counts and percentages. Create the activity itself with `createActivity({ type: "attendance", … })` (see [Activities and sections](activities.md)), with its settings by their form names (`groupmode: 1` or `2` for group sessions, `grade`…).

**Terms:** [attendance](../reference/glossary.md#attendance), [course module id](../reference/glossary.md#course-module-id).

The signatures below are the functions'. Each operation is also a method of the [Moodle object](../concepts/calling-functions.md) without its first two parameters (`fn(context, site, …)` is `moodle.fn(…)`), which is how the examples call them.

None of the plugin's services is open to AJAX (they are the mobile app's): the driver works the plugin's own pages, the sessions page, the add and update session forms, the delete confirmation, the take page and the report, read by their fields, links and data, so it works in any interface language. Every function throws `NotAnAttendanceError` when the id isn't an Attendance activity the person can open, `AttendanceError` when Moodle refuses (with Moodle's message and the capability it takes) or a session or a mark isn't there, and `NotLoggedInError` when there's no session (see [Errors](../concepts/errors.md)). Checked with the plugin's 2026042102 release on Moodle 5.2; on Moodle 4.5 the plugin's own 4.5 release runs, not checked yet.

## attendanceSessions

An Attendance activity's sessions, by date.

```ts
function attendanceSessions(context: BrowserContext, siteUrl: string, activityId: number): Promise<AttendanceSession[]>;

interface AttendanceSession {
  id: number;
  start?: string;
  durationMinutes?: number;
  when: string;
  groupId?: number;
  description: string;
  taken: boolean;
}
```

- What the sessions page shows: every session from the course's start date on, of the groups the person sees. Moodle hides sessions before the course's start date (and leaves them out of the report).
- `start` (ISO 8601) and `durationMinutes` come from each session's update form, which only who can change sessions opens (`mod/attendance:manageattendances`, editing teachers). A non-editing teacher gets `when` alone: the date and time as the page shows them, in the person's language.
- `groupId`: the group the session is for; left out for a session for all students. `description`: HTML (`""` when it has none; Moodle's "No description" for who can't open its form).
- `taken`: attendance has been taken for it.
- It takes `mod/attendance:takeattendances` (teachers have it); a student gets `AttendanceError`.

## addAttendanceSessions

Adds sessions through the add session form: one, or one on each given weekday until a date.

```ts
function addAttendanceSessions(context: BrowserContext, siteUrl: string, activityId: number, input: AttendanceSessionInput): Promise<AttendanceSessionsAdded>;

interface AttendanceSessionInput {
  start: Date;
  durationMinutes: number;
  description?: string;
  groupIds?: number[];
  repeatOn?: AttendanceWeekday[];
  repeatUntil?: Date;
  repeatEveryWeeks?: number;
}

type AttendanceWeekday = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";

interface AttendanceSessionsAdded {
  changed: string;
  sessionIds: number[];
  sessions: AttendanceSession[];
}
```

- The form takes a date and a start and end time in the person's time zone in Moodle: the driver writes `start` in that zone, and a session must end the day it starts (`MoodleError` `invalid-input` otherwise, before anything is sent).
- `repeatOn`: one session on each of those weekdays from `start`'s week until `repeatUntil` (that day included), every `repeatEveryWeeks` weeks (1 by default, up to 36, as the form offers), all at `start`'s time of day; `repeatUntil` goes with it. Moodle's validation refuses a repeat whose weekdays never fall between the two dates (`FormError`).
- `groupIds`: one session for each group, in an activity with group mode; `AttendanceError` when the activity takes no groups, and when it uses separate groups and none were given.
- The form's other settings (a calendar event, students recording their own attendance…) stay as Moodle's defaults set them.
- Gives the sessions added, read back from the sessions page. It takes `mod/attendance:manageattendances` (editing teachers); `AttendanceError` when Moodle lists none of them (a start before the course's start date).

## editAttendanceSession

Changes a session through its update form: only what's given.

```ts
function editAttendanceSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number, changes: AttendanceSessionChanges): Promise<AttendanceSessionChange>;

interface AttendanceSessionChanges {
  start?: Date;
  durationMinutes?: number;
  description?: string;
}

interface AttendanceSessionChange {
  changed: string;
  sessionId: number;
  session?: AttendanceSession;
}
```

- A new `start` keeps the session's duration unless a new one is given; a new `durationMinutes` keeps its start.
- Moodle doesn't move a session to another group.
- It takes `mod/attendance:manageattendances`; `AttendanceError` for a session that isn't the activity's.

## deleteAttendanceSession

Deletes a session through its delete confirmation, as the sessions page's delete icon does.

```ts
function deleteAttendanceSession(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<AttendanceSessionChange>;
```

- The attendance taken for the session goes with it, and Moodle recalculates the activity's grades.
- It takes `mod/attendance:manageattendances`; `AttendanceError` for a session that isn't the activity's.

## sessionAttendance

A session's attendance, as its take page shows it.

```ts
function sessionAttendance(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number): Promise<SessionAttendance>;

interface SessionAttendance {
  sessionId: number;
  statuses: AttendanceStatus[];
  participants: SessionParticipant[];
}

interface AttendanceStatus {
  id: number;
  acronym: string;
  description: string;
}

interface SessionParticipant {
  userId: number;
  fullName: string;
  statusId?: number;
  status?: string;
  remarks: string;
  canMark: boolean;
}
```

- `statuses`: the session's status set, as the activity defines it (Moodle's default is Present, Absent, Late and Excused, `P`, `A`, `L`, `E`), the ones the activity shows.
- `participants`: everyone the session is for (its group's, for a group session), from all of Moodle's pages of participants; `status` (the acronym) and `statusId` when marked, and their remarks. `canMark` is false for whose enrolment ended or is suspended before the session: Moodle shows no radios for them.
- It takes `mod/attendance:takeattendances`; `AttendanceError` for a session that isn't the activity's.

## takeAttendance

Takes attendance for a session through its take page.

```ts
function takeAttendance(context: BrowserContext, siteUrl: string, activityId: number, sessionId: number, marks: AttendanceMark[]): Promise<AttendanceTaken>;

interface AttendanceMark {
  userId: number;
  status: number | string;
  remarks?: string;
}

interface AttendanceTaken {
  changed: string;
  sessionId: number;
  attendance: SessionAttendance;
}
```

- `status`: a status of the session's set, by id, acronym (`"P"`, then ignoring case) or name (`"Absent"`, ignoring case). The set is read from the page, never assumed.
- Every mark is checked before anything is saved: a status not in the set, a participant the session doesn't list or who can't be marked, refuses the whole call with `AttendanceError`, naming each problem and the set's statuses.
- The participants not given keep what they have; `remarks` are left as they are when not given.
- Moodle marks the session taken and recalculates the activity's grade. Gives the session's attendance afterwards.
- It takes `mod/attendance:takeattendances`, and `mod/attendance:changeattendances` once the session is taken (teachers have both).

## attendanceReport

The activity's report, as its summary view shows it: a row per participant.

```ts
function attendanceReport(context: BrowserContext, siteUrl: string, activityId: number, options?: AttendanceReportOptions): Promise<AttendanceReportRow[]>;

interface AttendanceReportOptions {
  groupId?: number;
}

interface AttendanceReportRow {
  userId: number;
  fullName: string;
  statuses: { acronym: string; count: number; percentage: number }[];
  taken: AttendancePoints;
  all: AttendancePoints;
  maxPossible: AttendancePoints;
}

interface AttendancePoints {
  sessions?: number;
  points: number;
  maxPoints: number;
  percentage: number;
}
```

- `statuses`: how many of the participant's taken sessions have each status, and that as a percentage of their taken sessions (one decimal), in the report's column order.
- `taken`: over the sessions taken for them, how many, the points earned of those possible and the percentage: what Moodle grades. `all`: the same over all sessions, taken or not. `maxPossible`: the points and percentage they'd reach attending every session not taken yet.
- Points come from each status's grade in the status set (Present 2, Late and Excused 1, Absent 0 by default).
- `groupId`: only that group's participants. All of Moodle's pages of participants are read.
- It takes `mod/attendance:viewreports` (teachers have it).

## Example

```ts
// `moodle` is the object from createMoodle(), as in the getting-started pages.
const activityId = 72;

// Mondays and Wednesdays at 10:00, 90 minutes, for the term.
const { sessionIds } = await moodle.addAttendanceSessions(activityId, {
  start: new Date("2027-02-01T10:00:00+01:00"),
  durationMinutes: 90,
  description: "<p>Lecture</p>",
  repeatOn: ["Mon", "Wed"],
  repeatUntil: new Date("2027-05-26T12:00:00+02:00"),
});
console.log(`${sessionIds.length} sessions added`);

// Everyone present at the first one, but one student absent.
const first = await moodle.sessionAttendance(activityId, sessionIds[0]!);
await moodle.takeAttendance(
  activityId,
  sessionIds[0]!,
  first.participants.filter((p) => p.canMark).map((p) => ({ userId: p.userId, status: p.userId === 41 ? "A" : "P" })),
);

// Who has more than 20% of their taken sessions absent.
for (const row of await moodle.attendanceReport(activityId)) {
  const absent = row.statuses.find((s) => s.acronym === "A");
  if (absent && absent.percentage > 20) console.log(`${row.fullName}: ${absent.count} absences (${absent.percentage}%)`);
}
```

## Data categories

`attendanceSessions`, `addAttendanceSessions` and `editAttendanceSession` are `course-content`; `deleteAttendanceSession` is `course-content` and `others-write`, since the attendance taken for the session goes with it; `sessionAttendance` and `attendanceReport` are `others-personal`; `takeAttendance` is `others-personal` and `others-write`. See [Data categories](../concepts/data-categories.md).
