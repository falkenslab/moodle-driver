import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import {
  AttendanceError,
  FormError,
  MoodleError,
  NotAnAttendanceError,
  addAttendanceSessions,
  attendanceReport,
  attendanceSessions,
  deleteAttendanceSession,
  editAttendanceSession,
  sessionAttendance,
  takeAttendance,
} from "../../../src/index.js";
import { SITE, launchTestBrowser } from "../../../src/testing/index.js";
import { newAttendance, serveAttendance, type FakeAttendance, type FakeSession } from "./fakeAttendance.js";

const browser = await launchTestBrowser();
after(() => browser?.close());

async function site(overrides: Partial<FakeAttendance> = {}) {
  const context = await browser!.newContext();
  const a = newAttendance(overrides);
  const state = await serveAttendance(context, a);
  return { context, a, state };
}

// Monday 16 November 2026, 10:00 in Madrid (CET): 09:00 UTC.
const MONDAY = new Date("2026-11-16T09:00:00.000Z");
const at = (iso: string) => Date.parse(iso) / 1000;
const SESSIONS: FakeSession[] = [
  { id: 201, start: at("2026-11-16T09:00:00Z"), duration: 5400, groupId: 0, description: "<p>One</p>", taken: false },
  { id: 202, start: at("2026-11-18T09:00:00Z"), duration: 5400, groupId: 0, description: "", taken: false },
];

describe("attendanceSessions", { skip: !browser && "no system browser" }, () => {
  it("lists every session with its exact start, duration and description from its form", async () => {
    const { context } = await site({ sessions: structuredClone(SESSIONS) });
    try {
      const sessions = await attendanceSessions(context, SITE, 40);
      assert.deepEqual(sessions, [
        { id: 201, start: "2026-11-16T09:00:00.000Z", durationMinutes: 90, when: "Day 16.11.2026 10:00", taken: false, description: "<p>One</p>" },
        { id: 202, start: "2026-11-18T09:00:00.000Z", durationMinutes: 90, when: "Day 18.11.2026 10:00", taken: false, description: "" },
      ]);
    } finally {
      await context.close();
    }
  });

  it("gives a teacher who can't change sessions Moodle's text, no exact start", async () => {
    const { context } = await site({ role: "teacher", sessions: structuredClone(SESSIONS) });
    try {
      const [first, second] = await attendanceSessions(context, SITE, 40);
      assert.deepEqual(first, { id: 201, when: "Day 16.11.2026 10:00", taken: false, description: "<p>One</p>" });
      assert.equal(second?.description, "No description");
    } finally {
      await context.close();
    }
  });

  it("refuses a student, and another module", async () => {
    const { context } = await site({ role: "student" });
    try {
      await assert.rejects(attendanceSessions(context, SITE, 40), (error: Error) => error instanceof AttendanceError && /takeattendances/.test(error.message));
      await assert.rejects(attendanceSessions(context, SITE, 41), NotAnAttendanceError);
    } finally {
      await context.close();
    }
  });
});

describe("addAttendanceSessions", { skip: !browser && "no system browser" }, () => {
  it("adds one session at the start's time in the person's zone", async () => {
    const { context, a } = await site();
    try {
      const added = await addAttendanceSessions(context, SITE, 40, { start: MONDAY, durationMinutes: 90, description: "<p>Class</p>" });
      assert.equal(added.sessions.length, 1);
      assert.deepEqual(added.sessionIds, [a.sessions[0]!.id]);
      assert.equal(added.sessions[0]!.start, MONDAY.toISOString());
      assert.equal(added.sessions[0]!.durationMinutes, 90);
      assert.equal(added.sessions[0]!.description, "<p>Class</p>");
      const form = a.posts.at(-1)!.form;
      assert.equal(form.get("sestime[starthour]"), "10");
      assert.equal(form.get("sestime[endhour]"), "11");
      assert.equal(form.get("sestime[endminute]"), "30");
      assert.match(added.changed, /Added session \d+ to attendance 40/);
    } finally {
      await context.close();
    }
  });

  it("repeats on the given weekdays until the last day, every so many weeks", async () => {
    const { context } = await site();
    try {
      const until = new Date("2026-12-02T12:00:00Z");
      const added = await addAttendanceSessions(context, SITE, 40, { start: MONDAY, durationMinutes: 60, repeatOn: ["Mon", "Wed"], repeatUntil: until, repeatEveryWeeks: 2 });
      assert.deepEqual(
        added.sessions.map((s) => s.start),
        ["2026-11-16T09:00:00.000Z", "2026-11-18T09:00:00.000Z", "2026-11-30T09:00:00.000Z", "2026-12-02T09:00:00.000Z"],
      );
    } finally {
      await context.close();
    }
  });

  it("adds a session per group where the activity takes groups, and refuses groups where it doesn't", async () => {
    const groups = [
      { id: 7, name: "A" },
      { id: 8, name: "B" },
    ];
    const grouped = await site({ groupMode: 2, groups });
    try {
      const added = await addAttendanceSessions(grouped.context, SITE, 40, { start: MONDAY, durationMinutes: 60, groupIds: [7, 8] });
      assert.deepEqual(added.sessions.map((s) => s.groupId).sort(), [7, 8]);
      assert.equal(grouped.a.posts.at(-1)!.form.get("sessiontype"), "1");
    } finally {
      await grouped.context.close();
    }
    const plain = await site();
    try {
      await assert.rejects(addAttendanceSessions(plain.context, SITE, 40, { start: MONDAY, durationMinutes: 60, groupIds: [7] }), AttendanceError);
      assert.equal(plain.a.posts.length, 0);
    } finally {
      await plain.context.close();
    }
    const separate = await site({ groupMode: 1, groups });
    try {
      await assert.rejects(addAttendanceSessions(separate.context, SITE, 40, { start: MONDAY, durationMinutes: 60 }), (error: Error) => error instanceof AttendanceError && /separate groups/.test(error.message));
    } finally {
      await separate.context.close();
    }
  });

  it("refuses bad input before opening anything, and a teacher who can't manage sessions", async () => {
    const { context, state } = await site({ role: "teacher" });
    try {
      await assert.rejects(addAttendanceSessions(context, SITE, 40, { start: MONDAY, durationMinutes: 1.5 }), /whole number/);
      await assert.rejects(addAttendanceSessions(context, SITE, 40, { start: MONDAY, durationMinutes: 60, repeatOn: ["Mon"], repeatUntil: new Date("2026-11-01T00:00:00Z") }), /before start/);
      await assert.rejects(addAttendanceSessions(context, SITE, 40, { start: MONDAY, durationMinutes: 60, repeatOn: ["Funday" as "Mon"], repeatUntil: MONDAY }), /repeatOn takes/);
      assert.deepEqual(state.pagesServed, []);
      await assert.rejects(addAttendanceSessions(context, SITE, 40, { start: MONDAY, durationMinutes: 60 }), (error: Error) => !(error instanceof FormError) && error instanceof AttendanceError && /manageattendances/.test(error.message));
    } finally {
      await context.close();
    }
    // Past midnight in the person's zone (23:30 in Madrid), though not in UTC.
    const editing = await site();
    try {
      await assert.rejects(addAttendanceSessions(editing.context, SITE, 40, { start: new Date("2026-11-16T22:30:00Z"), durationMinutes: 60 }), (error: Error) => error instanceof MoodleError && error.code === "invalid-input" && /midnight \(Europe\/Madrid\)/.test(error.message));
      assert.equal(editing.a.posts.length, 0);
    } finally {
      await editing.context.close();
    }
  });
});

describe("editAttendanceSession and deleteAttendanceSession", { skip: !browser && "no system browser" }, () => {
  it("changes only what's given, keeping the duration with a new start", async () => {
    const { context, a } = await site({ sessions: structuredClone(SESSIONS) });
    try {
      const moved = await editAttendanceSession(context, SITE, 40, 201, { start: new Date("2026-11-17T15:00:00Z") });
      assert.equal(moved.session?.start, "2026-11-17T15:00:00.000Z");
      assert.equal(moved.session?.durationMinutes, 90);
      assert.equal(moved.session?.description, "<p>One</p>");
      const shorter = await editAttendanceSession(context, SITE, 40, 201, { durationMinutes: 45, description: "<p>Short</p>" });
      assert.equal(shorter.session?.start, "2026-11-17T15:00:00.000Z");
      assert.equal(shorter.session?.durationMinutes, 45);
      assert.equal(a.sessions.find((s) => s.id === 201)?.description, "<p>Short</p>");
      const nothing = await editAttendanceSession(context, SITE, 40, 201, {});
      assert.equal(nothing.changed, "Nothing to change.");
    } finally {
      await context.close();
    }
  });

  it("refuses a session that isn't there", async () => {
    const { context } = await site({ sessions: structuredClone(SESSIONS) });
    try {
      await assert.rejects(editAttendanceSession(context, SITE, 40, 999, { description: "x" }), (error: Error) => error instanceof AttendanceError && /attendanceSessions/.test(error.message));
      await assert.rejects(deleteAttendanceSession(context, SITE, 40, 999), AttendanceError);
    } finally {
      await context.close();
    }
  });

  it("deletes through the confirmation", async () => {
    const { context, a } = await site({ sessions: structuredClone(SESSIONS) });
    try {
      const deleted = await deleteAttendanceSession(context, SITE, 40, 202);
      assert.deepEqual(deleted, { changed: "Deleted session 202 of attendance 40.", sessionId: 202 });
      assert.deepEqual(a.sessions.map((s) => s.id), [201]);
    } finally {
      await context.close();
    }
  });
});

describe("sessionAttendance and takeAttendance", { skip: !browser && "no system browser" }, () => {
  const users = [
    { id: 4, name: "Alumno Demo", groupIds: [] },
    { id: 5, name: "Lucía Martín", groupIds: [] },
    { id: 6, name: "Marcos López", groupIds: [], suspended: true },
  ];

  it("reads the status set and every page of participants", async () => {
    const { context } = await site({ users, perPage: 2, sessions: structuredClone(SESSIONS), logs: [{ sessionId: 201, userId: 5, statusId: 15, remarks: "bus" }] });
    try {
      const read = await sessionAttendance(context, SITE, 40, 201);
      assert.deepEqual(read.statuses, [
        { id: 13, acronym: "P", description: "Present" },
        { id: 14, acronym: "A", description: "Absent" },
        { id: 15, acronym: "L", description: "Late" },
        { id: 16, acronym: "E", description: "Excused" },
      ]);
      assert.deepEqual(read.participants, [
        { userId: 4, fullName: "Alumno Demo", remarks: "", canMark: true },
        { userId: 5, fullName: "Lucía Martín", statusId: 15, status: "L", remarks: "bus", canMark: true },
        { userId: 6, fullName: "Marcos López", remarks: "", canMark: false },
      ]);
    } finally {
      await context.close();
    }
  });

  it("refuses a status outside the set, a participant not listed or not markable, before saving anything", async () => {
    const { context, a } = await site({ users, sessions: structuredClone(SESSIONS) });
    try {
      await assert.rejects(takeAttendance(context, SITE, 40, 201, [{ userId: 4, status: "P" }, { userId: 5, status: "X" }]), (error: Error) => error instanceof AttendanceError && /"X" isn't a status of the session's set \(P \(Present, 13\)/.test(error.message));
      await assert.rejects(takeAttendance(context, SITE, 40, 201, [{ userId: 99, status: "P" }]), /participant 99 isn't among/);
      await assert.rejects(takeAttendance(context, SITE, 40, 201, [{ userId: 6, status: "P" }]), /can't be marked/);
      await assert.rejects(takeAttendance(context, SITE, 40, 201, [{ userId: 4, status: 99 }]), AttendanceError);
      await assert.rejects(takeAttendance(context, SITE, 40, 201, [{ userId: 4, status: "P" }, { userId: 4, status: "A" }]), (error: Error) => error instanceof MoodleError && error.code === "invalid-input");
      assert.equal(a.posts.length, 0);
      assert.deepEqual(a.logs, []);
    } finally {
      await context.close();
    }
  });

  it("marks by acronym, name or id across pages, keeping the others' marks", async () => {
    const { context, a } = await site({ users: [...users, { id: 7, name: "Sara Gil", groupIds: [] }], perPage: 2, sessions: structuredClone(SESSIONS), logs: [{ sessionId: 201, userId: 5, statusId: 15, remarks: "bus" }] });
    try {
      const taken = await takeAttendance(context, SITE, 40, 201, [
        { userId: 4, status: "p" },
        { userId: 7, status: "Absent", remarks: "ill" },
      ]);
      assert.deepEqual(
        taken.attendance.participants.map((p) => [p.userId, p.status, p.remarks]),
        [
          [4, "P", ""],
          [5, "L", "bus"],
          [6, undefined, ""],
          [7, "A", "ill"],
        ],
      );
      // One post per page with a mark: the first page (4, 5) and the second (6, 7).
      assert.equal(a.posts.filter((p) => p.path === "/mod/attendance/take.php").length, 2);
      assert.equal(a.sessions.find((s) => s.id === 201)?.taken, true);
      await takeAttendance(context, SITE, 40, 201, [{ userId: 4, status: 14 }]);
      assert.equal(a.logs.find((l) => l.userId === 4)?.statusId, 14);
    } finally {
      await context.close();
    }
  });
});

describe("attendanceReport", { skip: !browser && "no system browser" }, () => {
  it("reads each participant's counts, points and percentages from every page", async () => {
    const sessions = structuredClone(SESSIONS).map((s) => ({ ...s, taken: true }));
    const logs = [
      { sessionId: 201, userId: 4, statusId: 13, remarks: "" },
      { sessionId: 202, userId: 4, statusId: 14, remarks: "" },
      { sessionId: 201, userId: 5, statusId: 15, remarks: "" },
    ];
    const { context } = await site({ perPage: 1, sessions: [...sessions, { id: 203, start: at("2026-11-23T09:00:00Z"), duration: 3600, groupId: 0, description: "", taken: false }], logs });
    try {
      const report = await attendanceReport(context, SITE, 40);
      assert.deepEqual(report, [
        {
          userId: 4,
          fullName: "Alumno Demo",
          statuses: [
            { acronym: "P", count: 1, percentage: 50 },
            { acronym: "A", count: 1, percentage: 50 },
            { acronym: "L", count: 0, percentage: 0 },
            { acronym: "E", count: 0, percentage: 0 },
          ],
          taken: { sessions: 2, points: 2, maxPoints: 4, percentage: 50 },
          all: { sessions: 3, points: 2, maxPoints: 6, percentage: 33.3 },
          maxPossible: { points: 4, maxPoints: 6, percentage: 66.7 },
        },
        {
          userId: 5,
          fullName: "Lucía Martín",
          statuses: [
            { acronym: "P", count: 0, percentage: 0 },
            { acronym: "A", count: 0, percentage: 0 },
            { acronym: "L", count: 1, percentage: 100 },
            { acronym: "E", count: 0, percentage: 0 },
          ],
          taken: { sessions: 1, points: 1, maxPoints: 2, percentage: 50 },
          all: { sessions: 3, points: 1, maxPoints: 6, percentage: 16.7 },
          maxPossible: { points: 5, maxPoints: 6, percentage: 83.3 },
        },
      ]);
    } finally {
      await context.close();
    }
  });

  it("refuses a student", async () => {
    const { context } = await site({ role: "student" });
    try {
      await assert.rejects(attendanceReport(context, SITE, 40), (error: Error) => error instanceof AttendanceError && /viewreports/.test(error.message));
    } finally {
      await context.close();
    }
  });
});
