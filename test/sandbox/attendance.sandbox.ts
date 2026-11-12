// Attendance (mod_attendance) against the sandbox: an Attendance activity made by the teacher on the
// scratch course, weekly sessions added between two dates (after the course's start, which Moodle's
// form sets to tomorrow), listed, edited, attendance taken for the student (a status outside the set
// refused first, nothing saved), the report's counts and percentages read, a group session added to a
// second activity in group mode, and a session deleted.
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { AttendanceError, MoodleError, NotAnAttendanceError, type AttendanceSession } from "../../src/index.js";
import { as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

// The sandbox is shared and can be slow: a write takes minutes when it is busy.
const SLOW = { timeout: 900_000 };
const SETUP = { timeout: 1_800_000 };

/** The Monday at least a week from now, at 10:00 UTC: after the scratch course's start, a whole minute. */
function nextMonday(): Date {
  const day = new Date(Date.now() + 7 * 86_400_000);
  day.setUTCHours(10, 0, 0, 0);
  while (day.getUTCDay() !== 1) day.setUTCDate(day.getUTCDate() + 1);
  return day;
}

const DAY = 86_400_000;

describe("attendance", () => {
  let course: ScratchCourse;
  let attendanceId: number;
  let groupedId: number;
  let pageId: number;
  let studentId: number;
  let monday: Date;
  let sessions: AttendanceSession[];

  before(async () => {
    course = await scratchCourse("attendance");
    const teacher = await as("teacher");
    studentId = await userId("student");
    monday = nextMonday();
    attendanceId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "attendance", name: "Driver check attendance", visibility: "shown" })).activityId!;
    groupedId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "attendance", name: "Driver check grouped attendance", visibility: "shown", settings: { groupmode: 2 } })).activityId!;
    pageId = (await teacher.createActivity({ courseId: course.id, sectionId: course.sectionId, type: "page", name: "Driver check page", content: "<p>x</p>", visibility: "shown" })).activityId!;
  }, SETUP);

  it("addAttendanceSessions: Mondays and Wednesdays for two weeks, 90 minutes each, with a description", SLOW, async () => {
    const teacher = await as("teacher");
    const until = new Date(monday.getTime() + 9 * DAY);
    const added = await teacher.addAttendanceSessions(attendanceId, { start: monday, durationMinutes: 90, description: "<p>Driver check class</p>", repeatOn: ["Mon", "Wed"], repeatUntil: until });
    assert.equal(added.sessions.length, 4);
    assert.deepEqual(
      added.sessions.map((s) => s.start),
      [0, 2, 7, 9].map((d) => new Date(monday.getTime() + d * DAY).toISOString()),
    );
    assert.ok(added.sessions.every((s) => s.durationMinutes === 90 && s.description === "<p>Driver check class</p>" && !s.taken && s.groupId === undefined));
    assert.deepEqual(added.sessionIds, added.sessions.map((s) => s.id));
  });

  it("attendanceSessions: the four, by date, for the teacher; refused to the student and on another module", SLOW, async () => {
    sessions = await (await as("teacher")).attendanceSessions(attendanceId);
    assert.equal(sessions.length, 4);
    assert.equal(sessions[0]!.start, monday.toISOString());
    assert.ok(sessions.every((s) => s.when.length > 0));
    await assert.rejects((await as("student")).attendanceSessions(attendanceId), AttendanceError);
    await assert.rejects((await as("teacher")).attendanceSessions(pageId), NotAnAttendanceError);
  });

  it("editAttendanceSession: the last one an hour later, 60 minutes, another description; no such session refused", SLOW, async () => {
    const teacher = await as("teacher");
    const last = sessions[3]!;
    const later = new Date(Date.parse(last.start!) + 3_600_000);
    const changed = await teacher.editAttendanceSession(attendanceId, last.id, { start: later, durationMinutes: 60, description: "<p>Moved</p>" });
    assert.equal(changed.session?.start, later.toISOString());
    assert.equal(changed.session?.durationMinutes, 60);
    assert.equal(changed.session?.description, "<p>Moved</p>");
    const kept = await teacher.editAttendanceSession(attendanceId, last.id, { description: "<p>Moved again</p>" });
    assert.equal(kept.session?.start, later.toISOString());
    assert.equal(kept.session?.durationMinutes, 60);
    await assert.rejects(teacher.editAttendanceSession(attendanceId, 99_999_999, { description: "x" }), AttendanceError);
  });

  it("sessionAttendance: the default status set, the student unmarked", SLOW, async () => {
    const read = await (await as("teacher")).sessionAttendance(attendanceId, sessions[0]!.id);
    assert.deepEqual(read.statuses.map((s) => s.acronym).sort(), ["A", "E", "L", "P"]);
    assert.ok(read.statuses.find((s) => s.acronym === "P")?.description === "Present");
    const student = read.participants.find((p) => p.userId === studentId);
    assert.ok(student && student.canMark && student.status === undefined && student.remarks === "");
  });

  it("takeAttendance: a status outside the set refused before saving; then Present and Absent with remarks", SLOW, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.takeAttendance(attendanceId, sessions[0]!.id, [{ userId: studentId, status: "X" }]), (error: Error) => error instanceof AttendanceError && /isn't a status/.test(error.message));
    assert.equal((await teacher.sessionAttendance(attendanceId, sessions[0]!.id)).participants.find((p) => p.userId === studentId)?.status, undefined);
    await assert.rejects(teacher.takeAttendance(attendanceId, sessions[0]!.id, [{ userId: 99_999_999, status: "P" }]), AttendanceError);
    const present = await teacher.takeAttendance(attendanceId, sessions[0]!.id, [{ userId: studentId, status: "P" }]);
    assert.equal(present.attendance.participants.find((p) => p.userId === studentId)?.status, "P");
    const absent = await teacher.takeAttendance(attendanceId, sessions[1]!.id, [{ userId: studentId, status: "absent", remarks: "Driver check remark" }]);
    const marked = absent.attendance.participants.find((p) => p.userId === studentId);
    assert.equal(marked?.status, "A");
    assert.equal(marked?.remarks, "Driver check remark");
    const listed = await teacher.attendanceSessions(attendanceId);
    assert.deepEqual(listed.map((s) => s.taken), [true, true, false, false]);
    await assert.rejects(teacher.takeAttendance(attendanceId, sessions[0]!.id, []), MoodleError);
  });

  it("attendanceReport: the student's counts and percentages over taken and all sessions", SLOW, async () => {
    const report = await (await as("teacher")).attendanceReport(attendanceId);
    const row = report.find((r) => r.userId === studentId);
    assert.ok(row, "the student is in the report");
    const count = (acronym: string) => row.statuses.find((s) => s.acronym === acronym);
    assert.deepEqual(count("P"), { acronym: "P", count: 1, percentage: 50 });
    assert.deepEqual(count("A"), { acronym: "A", count: 1, percentage: 50 });
    assert.deepEqual(count("L"), { acronym: "L", count: 0, percentage: 0 });
    // Moodle's default set: Present 2 points, Absent 0.
    assert.deepEqual(row.taken, { sessions: 2, points: 2, maxPoints: 4, percentage: 50 });
    assert.equal(row.all.sessions, 4);
    assert.equal(row.all.maxPoints, 8);
    assert.equal(row.maxPossible.points, 6);
    await assert.rejects((await as("student")).attendanceReport(attendanceId), AttendanceError);
  });

  it("addAttendanceSessions: a group session where the activity takes groups; groups refused where it doesn't", SLOW, async () => {
    const teacher = await as("teacher");
    const { groupId } = await teacher.createGroup(course.id, { name: "Driver check attendance group" });
    await teacher.setGroupMembers(groupId, { add: [studentId] });
    const added = await teacher.addAttendanceSessions(groupedId, { start: monday, durationMinutes: 45, groupIds: [groupId] });
    assert.equal(added.sessions.length, 1);
    assert.equal(added.sessions[0]!.groupId, groupId);
    const read = await teacher.sessionAttendance(groupedId, added.sessionIds[0]!);
    assert.deepEqual(read.participants.map((p) => p.userId), [studentId]);
    await assert.rejects(teacher.addAttendanceSessions(attendanceId, { start: monday, durationMinutes: 45, groupIds: [groupId] }), AttendanceError);
  });

  it("deleteAttendanceSession: the last one goes; no such session refused", SLOW, async () => {
    const teacher = await as("teacher");
    const deleted = await teacher.deleteAttendanceSession(attendanceId, sessions[3]!.id);
    assert.equal(deleted.sessionId, sessions[3]!.id);
    assert.deepEqual((await teacher.attendanceSessions(attendanceId)).map((s) => s.id), sessions.slice(0, 3).map((s) => s.id));
    await assert.rejects(teacher.deleteAttendanceSession(attendanceId, 99_999_999), AttendanceError);
  });
});
