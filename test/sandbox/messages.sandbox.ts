// Notifications and messages against the sandbox. A notification comes from the teacher grading the
// student in a forum of the scratch course (graded as a whole, with "notify"); the messages go from the
// teacher to the student and stay in their conversation (Moodle has no way to unsend one), so there
// are two, named "Driver check suite".
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { MessageError } from "../../src/index.js";
import { as, scratchCourse, userId, type ScratchCourse } from "./harness.js";

describe("notifications and messages", () => {
  let course: ScratchCourse;
  let studentId: number;
  let teacherId: number;
  let forumId: number;
  const stamp = new Date().toISOString();
  let conversationId: number | undefined;

  before(async () => {
    course = await scratchCourse("messages");
    studentId = await userId("student");
    teacherId = await userId("teacher");
    const created = await (await as("teacher")).createActivity({
      courseId: course.id,
      sectionId: course.sectionId,
      type: "forum",
      name: "Driver check suite graded forum",
      visibility: "shown",
      settings: { "grade_forum[modgrade_type]": "point", "grade_forum[modgrade_point]": 10 },
    });
    assert.ok(created.activityId);
    forumId = created.activityId;
  });

  it("notifications: the student is notified of a forum grade", { timeout: 300_000 }, async () => {
    const before = new Set((await (await as("student")).notifications()).map((n) => n.id));
    await (await as("teacher")).gradeForumUser(forumId, studentId, { grade: 6, notify: true });
    const student = await as("student");
    const fresh = (await student.notifications()).filter((n) => !before.has(n.id));
    assert.equal(fresh.length, 1, `expected one new notification, got ${JSON.stringify(fresh)}`);
    const [notification] = fresh;
    assert.equal(notification!.fromUserId, teacherId);
    assert.equal(notification!.read, false);
    assert.ok(notification!.subject);
    assert.ok(Date.parse(notification!.time ?? "") > Date.now() - 3_600_000);
    assert.ok((await student.notifications({ unreadOnly: true })).some((n) => n.id === notification!.id));
  });

  it("markNotificationsRead: none unread afterwards", { timeout: 300_000 }, async () => {
    const student = await as("student");
    assert.ok((await student.notifications({ unreadOnly: true })).length > 0);
    await student.markNotificationsRead();
    assert.deepEqual(await student.notifications({ unreadOnly: true }), []);
    // Twice changes nothing.
    await student.markNotificationsRead();
  });

  it("sendMessage: the teacher writes to the student", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    await assert.rejects(teacher.sendMessage(studentId, "<p> </p>"), MessageError);
    const sent = await teacher.sendMessage(studentId, `Driver check suite: a message (${stamp}).`);
    assert.ok(sent.messageId > 0);
    conversationId = sent.conversationId;
    const listed = (await (await as("student")).conversations()).find((c) => c.members.some((m) => m.userId === teacherId) && c.type === "private");
    assert.ok(listed, "the student has no conversation with the teacher");
    conversationId ??= listed.id;
    assert.equal(listed.id, conversationId);
    assert.equal(listed.lastMessage?.text, `Driver check suite: a message (${stamp}).`);
  });

  it("conversations: the student's, latest first, with the teacher's unread", { timeout: 300_000 }, async () => {
    const list = await (await as("student")).conversations();
    const withTeacher = list.find((c) => c.id === conversationId);
    assert.ok(withTeacher);
    assert.equal(withTeacher.type, "private");
    assert.deepEqual(
      withTeacher.members.map((m) => m.userId),
      [teacherId],
    );
    assert.ok(withTeacher.unread >= 1);
    assert.equal(withTeacher.lastMessage?.fromUserId, teacherId);
  });

  it("conversation: its messages oldest first, from both sides", { timeout: 300_000 }, async () => {
    const forStudent = await (await as("student")).conversation(conversationId!);
    assert.equal(forStudent.id, conversationId);
    assert.deepEqual(
      forStudent.members.map((m) => m.userId),
      [teacherId],
    );
    const last = forStudent.messages.at(-1);
    assert.equal(last?.fromUserId, teacherId);
    assert.equal(last?.text, `Driver check suite: a message (${stamp}).`);
    const times = forStudent.messages.map((m) => Date.parse(m.time ?? ""));
    assert.deepEqual(
      times,
      [...times].sort((a, b) => a - b),
    );
    const forTeacher = await (await as("teacher")).conversation(conversationId!);
    assert.deepEqual(
      forTeacher.members.map((m) => m.userId),
      [studentId],
    );
    assert.equal(forTeacher.messages.at(-1)?.id, last?.id);
  });

  it("messageParticipants: the teacher writes to the scratch course's students", { timeout: 300_000 }, async () => {
    const teacher = await as("teacher");
    const text = `Driver check suite: a message to the course (${stamp}).`;
    const result = await teacher.messageParticipants(course.id, text, { role: 5 });
    assert.deepEqual(result.sentTo, [studentId]);
    assert.deepEqual(result.refused, []);
    const read = await (await as("student")).conversation(conversationId!);
    assert.equal(read.messages.at(-1)?.text, text);
    await assert.rejects(teacher.messageParticipants(course.id, text, { userIds: [] }), MessageError);
  });
});
